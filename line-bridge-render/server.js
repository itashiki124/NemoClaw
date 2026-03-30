#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * NemoClaw LINE Bridge — Render edition.
 *
 * Standalone webhook server that receives LINE messages and responds
 * via NVIDIA NIM API (no sandbox / openshell dependency).
 *
 * Environment variables (set in Render Dashboard):
 *   LINE_CHANNEL_SECRET        — from LINE Developers Console
 *   LINE_CHANNEL_ACCESS_TOKEN  — from LINE Developers Console
 *   NVIDIA_API_KEY             — from build.nvidia.com
 *   MODEL                      — model ID (default: nvidia/llama-3.3-nemotron-super-49b-v1)
 *   SYSTEM_PROMPT              — optional system prompt for the agent
 *   ALLOWED_LINE_USER_IDS      — comma-separated allowlist (optional)
 *   PORT                       — server port (Render sets this automatically)
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");

// ── Config ───────────────────────────────────────────────────────────
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const API_KEY = process.env.NVIDIA_API_KEY;
const MODEL = process.env.MODEL || "nvidia/llama-3.3-nemotron-super-49b-v1";
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "あなたは LINE で会話する AI アシスタント「ねもクロ」です。以下のルールに従ってください。\n\n" +
  "【言語】\n" +
  "- ユーザーが使っている言語で返答する。日本語なら日本語、英語なら英語。\n\n" +
  "【会話スタイル】\n" +
  "- 友人とチャットするようにカジュアルに。\n" +
  "- 短めに。1〜3文が目安。LINE なので長文は避ける。\n" +
  "- 絵文字は控えめに使ってOK。\n\n" +
  "【絶対ルール】\n" +
  "- 嘘をつかない。知らないことは「わからない」と正直に言う。\n" +
  "- 実行できない約束はしない。\n" +
  "- 架空の体験談を作らない。AI であることを隠さなくていい。";
const PORT = parseInt(process.env.PORT || "3100", 10);

if (!CHANNEL_SECRET) { console.error("LINE_CHANNEL_SECRET required"); process.exit(1); }
if (!CHANNEL_ACCESS_TOKEN) { console.error("LINE_CHANNEL_ACCESS_TOKEN required"); process.exit(1); }
if (!API_KEY) { console.error("NVIDIA_API_KEY required"); process.exit(1); }

// ── Per-user conversation history (in-memory, resets on deploy) ──────
const sessions = new Map();
const MAX_HISTORY = 20; // keep last N messages per user

function getHistory(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, []);
  }
  return sessions.get(userId);
}

// ── Signature verification ───────────────────────────────────────────
function verifySignature(body, signature) {
  const hmac = crypto.createHmac("SHA256", CHANNEL_SECRET);
  hmac.update(body);
  const expected = hmac.digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── HTTPS request helper ─────────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── LINE API helpers ─────────────────────────────────────────────────
function lineApi(path, body) {
  return httpsPost("api.line.me", path, {
    Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
  }, body);
}

function buildLineMessages(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 5000) {
    chunks.push(text.slice(i, i + 5000));
  }
  return chunks.slice(0, 5).map((chunk) => ({ type: "text", text: chunk }));
}

async function replyMessage(replyToken, text) {
  return lineApi("/v2/bot/message/reply", {
    replyToken,
    messages: buildLineMessages(text),
  });
}

async function pushMessage(userId, text) {
  return lineApi("/v2/bot/message/push", {
    to: userId,
    messages: buildLineMessages(text),
  });
}

// ── NVIDIA NIM API ───────────────────────────────────────────────────
async function callNvidiaApi(userId, userMessage) {
  const history = getHistory(userId);
  history.push({ role: "user", content: userMessage });

  // Trim history
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
  ];

  const res = await httpsPost(
    "integrate.api.nvidia.com",
    "/v1/chat/completions",
    { Authorization: `Bearer ${API_KEY}` },
    {
      model: MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    },
  );

  if (res.status !== 200) {
    console.error("NVIDIA API error:", res.status, JSON.stringify(res.body).slice(0, 500));
    throw new Error(`NVIDIA API returned ${res.status}`);
  }

  const assistantMessage = res.body.choices?.[0]?.message?.content || "(no response)";
  history.push({ role: "assistant", content: assistantMessage });

  return assistantMessage;
}

// ── Handle webhook events ────────────────────────────────────────────
async function handleEvent(event) {
  console.log(`[webhook] event type=${event.type}, message type=${event.message?.type}`);
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const text = event.message.text;

  console.log(`[${userId}] ${text}`);

  // Handle /reset
  if (text === "/reset" || text === "リセット") {
    sessions.delete(userId);
    await replyMessage(event.replyToken, "セッションをリセットしました。");
    return;
  }

  const startTime = Date.now();

  try {
    const response = await callNvidiaApi(userId, text);
    const elapsed = Date.now() - startTime;
    console.log(`[${userId}] response (${(elapsed / 1000).toFixed(1)}s): ${response.slice(0, 100)}...`);

    // Try reply first, fall back to push if reply token expired
    let sent = false;
    if (elapsed < 20000) {
      const replyResult = await replyMessage(event.replyToken, response);
      console.log(`[${userId}] reply result: ${replyResult.status} ${JSON.stringify(replyResult.body).slice(0, 200)}`);
      if (replyResult.status === 200) {
        sent = true;
      }
    }
    if (!sent) {
      console.log(`[${userId}] falling back to push message`);
      const pushResult = await pushMessage(userId, response);
      console.log(`[${userId}] push result: ${pushResult.status} ${JSON.stringify(pushResult.body).slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`[${userId}] error:`, err.message);
    try {
      await pushMessage(userId, `エラーが発生しました: ${err.message}`);
    } catch (pushErr) {
      console.error(`[${userId}] push also failed:`, pushErr.message);
    }
  }
}

// ── HTTP server ──────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Health check (Render uses this)
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", bridge: "line" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);

    const signature = req.headers["x-line-signature"];
    if (!signature || !verifySignature(rawBody, signature)) {
      console.warn("Invalid signature — rejecting request");
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Respond 200 immediately (LINE expects <1s)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf-8"));
    } catch {
      console.warn("Invalid JSON body");
      return;
    }

    if (body.events) {
      for (const event of body.events) {
        handleEvent(event).catch((err) =>
          console.error("Event handling error:", err.message),
        );
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`LINE Bridge listening on port ${PORT}`);
  console.log(`  Model:   ${MODEL}`);
  console.log(`  Webhook: POST /webhook`);
  console.log(`  Health:  GET  /health`);
});
