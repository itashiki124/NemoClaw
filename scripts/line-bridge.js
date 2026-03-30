#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * LINE → NemoClaw bridge.
 *
 * Receives messages via LINE Messaging API webhook and forwards them
 * to the OpenClaw agent running inside the sandbox. Responses go back
 * to LINE.
 *
 * Env:
 *   LINE_CHANNEL_SECRET      — Channel secret (from LINE Developers Console)
 *   LINE_CHANNEL_ACCESS_TOKEN — Channel access token (long-lived)
 *   NVIDIA_API_KEY            — for inference
 *   SANDBOX_NAME              — sandbox name (default: my-assistant)
 *   LINE_PORT                 — webhook server port (default: 3100)
 *   ALLOWED_LINE_USER_IDS     — comma-separated LINE user IDs to accept (optional, accepts all if unset)
 */

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync, spawn } = require("child_process");
const { getCredential } = require("../bin/lib/credentials");
const { resolveOpenshell } = require("../bin/lib/resolve-openshell");

const OPENSHELL = resolveOpenshell();
if (!OPENSHELL) {
  console.error("openshell not found on PATH or in common locations");
  process.exit(1);
}

function parseJsonCredentials(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    let text;
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      text = buffer.toString("utf16le").replace(/^\uFEFF/, "");
    } else {
      text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    }
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getRepoCredential(key) {
  const repoCredsPath = path.resolve(__dirname, "..", "credentials.json");
  const creds = parseJsonCredentials(repoCredsPath);
  return creds[key] || null;
}

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const API_KEY = process.env.NVIDIA_API_KEY || getCredential("NVIDIA_API_KEY") || getRepoCredential("NVIDIA_API_KEY");
const SANDBOX = process.env.SANDBOX_NAME || "my-assistant";
const PORT = parseInt(process.env.LINE_PORT || "3100", 10);
const ALLOWED_USERS = process.env.ALLOWED_LINE_USER_IDS
  ? process.env.ALLOWED_LINE_USER_IDS.split(",").map((s) => s.trim())
  : null;

if (API_KEY) {
  process.env.NVIDIA_API_KEY = API_KEY;
}

if (!CHANNEL_SECRET) { console.error("LINE_CHANNEL_SECRET required"); process.exit(1); }
if (!CHANNEL_ACCESS_TOKEN) { console.error("LINE_CHANNEL_ACCESS_TOKEN required"); process.exit(1); }
if (!API_KEY) { console.error("NVIDIA_API_KEY required"); process.exit(1); }

// ── Signature verification ────────────────────────────────────────

function verifySignature(body, signature) {
  const hmac = crypto.createHmac("SHA256", CHANNEL_SECRET);
  hmac.update(body);
  const expected = hmac.digest("base64");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── LINE API helpers ──────────────────────────────────────────────

function lineApi(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.line.me",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch { resolve({ error: buf }); }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function replyMessage(replyToken, text) {
  // LINE message limit is 5000 characters per bubble, max 5 bubbles
  const chunks = [];
  for (let i = 0; i < text.length; i += 5000) {
    chunks.push(text.slice(i, i + 5000));
  }
  // LINE reply API allows up to 5 messages per reply
  const messages = chunks.slice(0, 5).map((chunk) => ({
    type: "text",
    text: chunk,
  }));
  return lineApi("/v2/bot/message/reply", { replyToken, messages });
}

async function pushMessage(userId, text) {
  // Used when reply token has expired (after 1 minute)
  const chunks = [];
  for (let i = 0; i < text.length; i += 5000) {
    chunks.push(text.slice(i, i + 5000));
  }
  const messages = chunks.slice(0, 5).map((chunk) => ({
    type: "text",
    text: chunk,
  }));
  return lineApi("/v2/bot/message/push", { to: userId, messages });
}

// ── Run agent inside sandbox ──────────────────────────────────────

function runAgentInSandbox(message, sessionId) {
  return new Promise((resolve) => {
    let sshConfig;
    try {
      sshConfig = execSync(`"${OPENSHELL}" sandbox ssh-config "${SANDBOX}"`, { encoding: "utf-8" });
    } catch (err) {
      resolve(`Error: sandbox SSH config failed — ${err.message}`);
      return;
    }

    const confPath = `/tmp/nemoclaw-line-ssh-${sessionId}.conf`;
    require("fs").writeFileSync(confPath, sshConfig, { mode: 0o600 });

    const escaped = message.replace(/'/g, "'\\''");
    const cmd = `export NVIDIA_API_KEY='${API_KEY}' && nemoclaw-start openclaw agent --agent main --local -m '${escaped}' --session-id 'line-${sessionId}'`;

    const proc = spawn("ssh", ["-T", "-F", confPath, `openshell-${SANDBOX}`, cmd], {
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try { require("fs").unlinkSync(confPath); } catch {}

      const lines = stdout.split("\n");
      const responseLines = lines.filter(
        (l) =>
          !l.startsWith("Setting up NemoClaw") &&
          !l.startsWith("[plugins]") &&
          !l.startsWith("(node:") &&
          !l.includes("NemoClaw ready") &&
          !l.includes("NemoClaw registered") &&
          !l.includes("openclaw agent") &&
          !l.includes("┌─") &&
          !l.includes("│ ") &&
          !l.includes("└─") &&
          l.trim() !== "",
      );

      const response = responseLines.join("\n").trim();

      if (response) {
        resolve(response);
      } else if (code !== 0) {
        resolve(`Agent exited with code ${code}. ${stderr.trim().slice(0, 500)}`);
      } else {
        resolve("(応答なし)");
      }
    });

    proc.on("error", (err) => {
      resolve(`Error: ${err.message}`);
    });
  });
}

// ── Handle webhook events ─────────────────────────────────────────

async function handleEvent(event) {
  // Only handle text messages
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = event.source.userId;
  const text = event.message.text;

  // Access control
  if (ALLOWED_USERS && !ALLOWED_USERS.includes(userId)) {
    console.log(`[ignored] user ${userId} not in allowed list`);
    return;
  }

  console.log(`[${userId}] ${text}`);

  // Handle /reset
  if (text === "/reset" || text === "リセット") {
    await replyMessage(event.replyToken, "セッションをリセットしました。");
    return;
  }

  // Reply token expires after ~1 min, so for long agent runs we use push
  const startTime = Date.now();

  try {
    const response = await runAgentInSandbox(text, userId);
    const elapsed = Date.now() - startTime;
    console.log(`[${userId}] agent (${(elapsed / 1000).toFixed(1)}s): ${response.slice(0, 100)}...`);

    if (elapsed < 55000) {
      // Reply token likely still valid
      await replyMessage(event.replyToken, response);
    } else {
      // Token expired — use push message
      await pushMessage(userId, response);
    }
  } catch (err) {
    console.error(`[${userId}] error:`, err.message);
    try {
      await pushMessage(userId, `エラーが発生しました: ${err.message}`);
    } catch {}
  }
}

// ── Webhook HTTP server ───────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
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

    // Verify LINE signature
    const signature = req.headers["x-line-signature"];
    if (!signature || !verifySignature(rawBody, signature)) {
      console.warn("Invalid signature — rejecting request");
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Respond 200 immediately (LINE expects <1s response)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");

    // Process events asynchronously
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

// ── Main ──────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  NemoClaw LINE Bridge                              │");
  console.log("  │                                                     │");
  console.log(`  │  Port:     ${(String(PORT) + "                              ").slice(0, 40)}│`);
  console.log("  │  Webhook:  POST /webhook                           │");
  console.log("  │  Health:   GET  /health                            │");
  console.log("  │  Sandbox:  " + (SANDBOX + "                              ").slice(0, 40) + "│");
  console.log("  │  Model:    nvidia/nemotron-3-super-120b-a12b       │");
  console.log("  │                                                     │");
  console.log("  │  Messages are forwarded to the OpenClaw agent      │");
  console.log("  │  inside the sandbox. Run 'openshell term' in       │");
  console.log("  │  another terminal to monitor + approve egress.     │");
  console.log("  │                                                     │");
  console.log("  │  Expose this port via ngrok or reverse proxy,      │");
  console.log("  │  then set the URL in LINE Developers Console.      │");
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log("");
});
