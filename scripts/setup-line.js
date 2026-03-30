#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * LINE Messaging API セットアップスクリプト (Playwright)
 *
 * LINE Developers Console にログインし、Messaging API チャネルの
 * Channel Secret / Channel Access Token を取得、Webhook URL を設定する。
 *
 * Usage:
 *   npx playwright install chromium   # 初回のみ
 *   node scripts/setup-line.js [--webhook-url https://xxxx.ngrok-free.app/webhook]
 *
 * 取得した認証情報は .env に書き出される。
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ENV_FILE = path.resolve(__dirname, "..", ".env");
const LINE_DEV_URL = "https://developers.line.biz/console/";

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--webhook-url" && args[i + 1]) {
      opts.webhookUrl = args[++i];
    }
  }
  return opts;
}

function updateEnvFile(key, value) {
  let content = "";
  if (fs.existsSync(ENV_FILE)) {
    content = fs.readFileSync(ENV_FILE, "utf-8");
  }
  const regex = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + "\n" + line + "\n";
  }
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
}

async function main() {
  const opts = parseArgs();

  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  LINE Messaging API セットアップ (Playwright)       │");
  console.log("  │                                                     │");
  console.log("  │  ブラウザが開きます。LINE アカウントでログイン      │");
  console.log("  │  してください。                                     │");
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log("");

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    locale: "ja-JP",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  // ── Step 1: LINE Developers Console にログイン ──────────────────

  console.log("[1/6] LINE Developers Console を開いています...");
  await page.goto(LINE_DEV_URL, { waitUntil: "networkidle" });

  // ログイン済みでなければ手動ログインを待つ
  if (page.url().includes("account.line.biz") || page.url().includes("access.line.me")) {
    console.log("");
    console.log("  → ブラウザで LINE にログインしてください。");
    console.log("    ログイン完了まで待機中...");
    console.log("");
    await page.waitForURL("**/console/**", { timeout: 300000 });
  }

  console.log("[2/6] ログイン完了。プロバイダー一覧を取得中...");
  await page.waitForTimeout(2000);

  // ── Step 2: プロバイダー・チャネル選択 ──────────────────────────

  // プロバイダー一覧を取得
  const providers = await page.$$eval(
    'a[href*="/console/provider/"]',
    (els) => els.map((el) => ({ name: el.textContent.trim(), href: el.getAttribute("href") })),
  );

  let providerUrl;
  if (providers.length === 0) {
    // プロバイダーが無い場合は新規作成
    console.log("  プロバイダーが見つかりません。新規作成します...");
  } else {
    console.log("\n  プロバイダーを選択してください:");
    providers.forEach((p, i) => console.log(`    ${i + 1}. ${p.name}`));
    console.log(`    0. 新規作成`);
    const choice = await ask("  番号 (0 で新規作成): ");
    const idx = parseInt(choice, 10);

    if (idx > 0 && idx <= providers.length) {
      providerUrl = providers[idx - 1].href;
    } else if (idx !== 0) {
      console.error("無効な選択です。");
      await browser.close();
      process.exit(1);
    }
    // idx === 0  → 新規作成フローへ
  }

  // 新規プロバイダー作成
  if (!providerUrl) {
    const providerName = await ask("  新しいプロバイダー名を入力してください: ");
    if (!providerName) {
      console.error("プロバイダー名が空です。");
      await browser.close();
      process.exit(1);
    }

    // 「Create a new provider」ボタンをクリック
    const createBtn = await page.$(
      'button:has-text("Create"), button:has-text("作成"), a:has-text("Create a new provider"), a:has-text("新規プロバイダー作成")',
    );
    if (createBtn) {
      await createBtn.click();
      await page.waitForTimeout(1500);
    } else {
      // 直接 URL でプロバイダー作成ページへ
      await page.goto("https://developers.line.biz/console/register/provider/", { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
    }

    // プロバイダー名を入力
    const nameInput = await page.$('input[name*="provider"], input[placeholder*="provider"], input[type="text"]');
    if (nameInput) {
      await nameInput.fill(providerName);
      await page.waitForTimeout(500);

      // Create / 作成 ボタン
      const confirmBtn = await page.$('button:has-text("Create"), button:has-text("作成"), button[type="submit"]');
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
        console.log(`  プロバイダー「${providerName}」を作成しました。`);
      }
    } else {
      console.log("  プロバイダー名の入力フィールドが見つかりません。");
      console.log("  ブラウザで手動で新規プロバイダーを作成してください。");
      await ask("  作成したら Enter を押してください...");
    }

    // 新しいプロバイダーの URL を取得
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    if (currentUrl.includes("/console/provider/")) {
      providerUrl = currentUrl;
    } else {
      // コンソールに戻ってプロバイダーを探す
      await page.goto(LINE_DEV_URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);
      const updatedProviders = await page.$$eval(
        'a[href*="/console/provider/"]',
        (els) => els.map((el) => ({ name: el.textContent.trim(), href: el.getAttribute("href") })),
      );
      const found = updatedProviders.find((p) => p.name.includes(providerName));
      providerUrl = found ? found.href : updatedProviders[updatedProviders.length - 1]?.href;

      if (!providerUrl) {
        console.error("プロバイダーが見つかりません。");
        await browser.close();
        process.exit(1);
      }
    }
  }

  // プロバイダーページに遷移
  const fullProviderUrl = providerUrl.startsWith("http")
    ? providerUrl
    : `https://developers.line.biz${providerUrl}`;
  await page.goto(fullProviderUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Messaging API チャネルを探す
  const channels = await page.$$eval(
    '[class*="channel"]  a[href*="/channel/"]',
    (els) =>
      els
        .filter((el) => {
          const text = el.closest("[class*='channel']")?.textContent || "";
          return text.includes("Messaging API");
        })
        .map((el) => ({ name: el.textContent.trim(), href: el.getAttribute("href") })),
  );

  let channelUrl;
  const needsNewChannel = channels.length === 0;
  if (!needsNewChannel && channels.length >= 1) {
    console.log("\n  チャネルを選択してください:");
    channels.forEach((c, i) => console.log(`    ${i + 1}. ${c.name}`));
    console.log(`    0. 新規作成`);
    const choice = await ask("  番号 (0 で新規作成): ");
    const idx = parseInt(choice, 10);
    if (idx > 0 && idx <= channels.length) {
      channelUrl = channels[idx - 1].href;
    } else if (idx !== 0) {
      console.error("無効な選択です。");
      await browser.close();
      process.exit(1);
    }
    // idx === 0 → 新規作成フローへ
  }

  // Messaging API チャネルを新規作成
  if (!channelUrl) {
    console.log("\n  Messaging API チャネルを新規作成します...");
    const channelName = await ask("  チャネル名 (例: NemoClaw Bot): ");
    const channelDesc = await ask("  チャネルの説明 (短い説明): ");

    // 「Create a Messaging API channel」ボタンを探す
    const createChBtn = await page.$(
      'a:has-text("Create a Messaging API channel"), a:has-text("Messaging API"), button:has-text("Create a new channel")',
    );
    if (createChBtn) {
      await createChBtn.click();
      await page.waitForTimeout(2000);
    } else {
      // プロバイダーIDを URL から取得して直接遷移
      const providerMatch = page.url().match(/provider\/(\d+)/);
      if (providerMatch) {
        await page.goto(
          `https://developers.line.biz/console/provider/${providerMatch[1]}/channel/create?type=messaging-api`,
          { waitUntil: "networkidle" },
        );
      } else {
        console.log("  チャネル作成ページが見つかりません。ブラウザで手動作成してください。");
        await ask("  作成したら Enter を押してください...");
      }
    }

    await page.waitForTimeout(1500);

    // チャネル作成フォームを埋める
    // Channel name
    const chNameInput = await page.$('input[name*="name" i], input[placeholder*="name" i]');
    if (chNameInput) {
      await chNameInput.fill(channelName || "NemoClaw Bot");
      await page.waitForTimeout(300);
    }

    // Channel description
    const chDescInput = await page.$('textarea[name*="description" i], textarea[placeholder*="description" i], input[name*="description" i]');
    if (chDescInput) {
      await chDescInput.fill(channelDesc || "NemoClaw AI assistant powered by Nemotron");
      await page.waitForTimeout(300);
    }

    // 利用規約に同意するチェックボックス
    const agreeCheckboxes = await page.$$('input[type="checkbox"]');
    for (const cb of agreeCheckboxes) {
      const isChecked = await cb.isChecked();
      if (!isChecked) {
        await cb.check();
        await page.waitForTimeout(200);
      }
    }

    // フォーム埋められなかった場合のフォールバック
    if (!chNameInput) {
      console.log("  フォームフィールドが見つかりません。ブラウザで手動入力してください。");
      console.log(`  チャネル名: ${channelName || "NemoClaw Bot"}`);
      console.log(`  説明: ${channelDesc || "NemoClaw AI assistant"}`);
      await ask("  フォームを入力したら Enter を押してください...");
    }

    // Create ボタン
    const submitBtn = await page.$('button:has-text("Create"), button:has-text("作成"), button[type="submit"]');
    if (submitBtn) {
      const isEnabled = await submitBtn.isEnabled();
      if (isEnabled) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
        console.log(`  チャネル「${channelName || "NemoClaw Bot"}」を作成しました。`);
      } else {
        console.log("  作成ボタンがまだ無効です。ブラウザでフォームを完成させてください。");
        await ask("  作成ボタンを押したら Enter を押してください...");
      }
    } else {
      await ask("  チャネルを作成したら Enter を押してください...");
    }

    // 作成されたチャネルの URL を取得
    await page.waitForTimeout(2000);
    const currentChUrl = page.url();
    if (currentChUrl.includes("/channel/")) {
      channelUrl = currentChUrl;
    } else {
      // プロバイダーページに戻って探す
      await page.goBack();
      await page.waitForTimeout(2000);
      const updatedChannels = await page.$$eval(
        'a[href*="/channel/"]',
        (els) => els.map((el) => ({ name: el.textContent.trim(), href: el.getAttribute("href") })),
      );
      channelUrl = updatedChannels[updatedChannels.length - 1]?.href;
      if (!channelUrl) {
        console.error("チャネルが見つかりません。");
        await browser.close();
        process.exit(1);
      }
    }
  }

  // チャネルページに遷移
  const fullChannelUrl = channelUrl.startsWith("http")
    ? channelUrl
    : `https://developers.line.biz${channelUrl}`;
  await page.goto(fullChannelUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  // ── Step 3: Channel Secret を取得 ──────────────────────────────

  console.log("[3/6] Channel Secret を取得中...");

  // 「Basic settings」タブへ
  const basicTab = await page.$('a[href*="basic"], button:has-text("Basic settings"), [role="tab"]:has-text("Basic")');
  if (basicTab) await basicTab.click();
  await page.waitForTimeout(1500);

  let channelSecret = "";

  // Channel secret フィールドを探す
  const secretEl = await page.$('text=Channel secret');
  if (secretEl) {
    // 同じ行 or 次の要素からコピーボタンか値を取得
    const parent = await secretEl.evaluateHandle((el) => el.closest("tr") || el.closest("[class*='row']") || el.parentElement);
    const copyBtn = await parent.$('button:has-text("Copy"), button[aria-label*="copy"], button[aria-label*="コピー"]');
    if (copyBtn) {
      await copyBtn.click();
      await page.waitForTimeout(500);
      // クリップボードから取得を試みる
    }
    // テキストから直接取得を試みる
    const possibleSecret = await parent.$$eval(
      "span, code, input, div",
      (els) => {
        for (const el of els) {
          const val = el.value || el.textContent || "";
          // Channel secret は32文字の16進数
          if (/^[0-9a-f]{32}$/i.test(val.trim())) return val.trim();
        }
        return "";
      },
    );
    if (possibleSecret) channelSecret = possibleSecret;
  }

  if (!channelSecret) {
    console.log("  Channel Secret を自動取得できませんでした。");
    console.log("  ブラウザの「Basic settings」タブで Channel secret をコピーしてください。");
    channelSecret = await ask("  Channel Secret を貼り付けてください: ");
  }

  if (channelSecret) {
    console.log(`  Channel Secret: ${channelSecret.slice(0, 6)}...${channelSecret.slice(-4)}`);
    updateEnvFile("LINE_CHANNEL_SECRET", channelSecret);
    console.log("  → .env に保存しました。");
  }

  // ── Step 4: Channel Access Token を取得 ─────────────────────────

  console.log("[4/6] Channel Access Token を取得中...");

  // 「Messaging API」タブへ
  const apiTab = await page.$('a[href*="messaging-api"], button:has-text("Messaging API"), [role="tab"]:has-text("Messaging API")');
  if (apiTab) await apiTab.click();
  await page.waitForTimeout(1500);

  let accessToken = "";

  // Channel access token (long-lived) の Issue ボタンを探す
  const tokenSection = await page.$('text=Channel access token');
  if (tokenSection) {
    const tokenParent = await tokenSection.evaluateHandle(
      (el) => el.closest("section") || el.closest("[class*='card']") || el.closest("[class*='panel']") || el.parentElement?.parentElement,
    );

    // 既存トークンがあるか確認
    const existingToken = await tokenParent.$$eval(
      "textarea, input, code, span",
      (els) => {
        for (const el of els) {
          const val = el.value || el.textContent || "";
          if (val.length > 100) return val.trim();
        }
        return "";
      },
    );

    if (existingToken) {
      accessToken = existingToken;
    } else {
      // Issue ボタンを押す
      const issueBtn = await tokenParent.$('button:has-text("Issue"), button:has-text("発行")');
      if (issueBtn) {
        await issueBtn.click();
        await page.waitForTimeout(3000);

        // 新しく発行されたトークンを取得
        const newToken = await tokenParent.$$eval(
          "textarea, input, code, span",
          (els) => {
            for (const el of els) {
              const val = el.value || el.textContent || "";
              if (val.length > 100) return val.trim();
            }
            return "";
          },
        );
        if (newToken) accessToken = newToken;
      }
    }
  }

  if (!accessToken) {
    console.log("  Channel Access Token を自動取得できませんでした。");
    console.log("  ブラウザの「Messaging API」タブで Channel access token を Issue/コピーしてください。");
    accessToken = await ask("  Channel Access Token を貼り付けてください: ");
  }

  if (accessToken) {
    console.log(`  Access Token: ${accessToken.slice(0, 10)}...${accessToken.slice(-6)}`);
    updateEnvFile("LINE_CHANNEL_ACCESS_TOKEN", accessToken);
    console.log("  → .env に保存しました。");
  }

  // ── Step 5: Webhook URL を設定 ──────────────────────────────────

  console.log("[5/6] Webhook URL を設定中...");

  let webhookUrl = opts.webhookUrl;
  if (!webhookUrl) {
    webhookUrl = await ask("  Webhook URL を入力してください (例: https://xxxx.ngrok-free.app/webhook): ");
  }

  if (webhookUrl) {
    // Webhook URL の入力フィールドを探す
    const webhookInput = await page.$('input[placeholder*="webhook" i], input[placeholder*="URL" i], input[name*="webhook" i]');
    const editBtn = await page.$('button:has-text("Edit"), button:has-text("編集")');

    if (editBtn) {
      await editBtn.click();
      await page.waitForTimeout(1000);
    }

    const urlInput = webhookInput || await page.$('input[type="url"], input[type="text"][placeholder*="https"]');
    if (urlInput) {
      await urlInput.fill("");
      await urlInput.fill(webhookUrl);
      await page.waitForTimeout(500);

      // Update / 保存 ボタンを押す
      const saveBtn = await page.$('button:has-text("Update"), button:has-text("Save"), button:has-text("保存")');
      if (saveBtn) {
        await saveBtn.click();
        await page.waitForTimeout(2000);
        console.log(`  Webhook URL: ${webhookUrl}`);
      }
    } else {
      console.log("  Webhook URL フィールドが見つかりません。ブラウザで手動設定してください。");
      console.log(`  URL: ${webhookUrl}`);
      await ask("  設定したら Enter を押してください...");
    }

    // Webhook の利用をオンにする
    const webhookToggle = await page.$('input[type="checkbox"]:near(:text("Use webhook")), input[type="checkbox"]:near(:text("Webhookの利用"))');
    if (webhookToggle) {
      const isChecked = await webhookToggle.isChecked();
      if (!isChecked) {
        await webhookToggle.check();
        await page.waitForTimeout(1000);
        console.log("  Webhook を有効化しました。");
      }
    }

    updateEnvFile("LINE_WEBHOOK_URL", webhookUrl);
  }

  // ── Step 6: 自動応答をオフに ────────────────────────────────────

  console.log("[6/6] 自動応答メッセージを無効化中...");

  // 「応答メッセージ」「Auto-reply messages」の無効化
  const autoReplyLink = await page.$('a:has-text("Auto-reply messages"), a:has-text("応答メッセージ"), button:has-text("Edit auto-reply"), button:has-text("編集")');
  if (autoReplyLink) {
    console.log("  応答メッセージの設定は LINE Official Account Manager で行ってください。");
    console.log("  https://manager.line.biz/ → 応答設定 → 応答メッセージ: オフ");
  } else {
    console.log("  自動応答設定が見つかりません。手動でオフにしてください。");
  }

  // ── 完了 ────────────────────────────────────────────────────────

  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  セットアップ完了!                                  │");
  console.log("  │                                                     │");
  console.log("  │  .env に以下が保存されました:                       │");
  console.log("  │    LINE_CHANNEL_SECRET                              │");
  console.log("  │    LINE_CHANNEL_ACCESS_TOKEN                        │");
  if (webhookUrl) {
    console.log("  │    LINE_WEBHOOK_URL                                 │");
  }
  console.log("  │                                                     │");
  console.log("  │  起動:                                              │");
  console.log("  │    ./scripts/start-line-bridge.sh                   │");
  console.log("  │    ./scripts/start-line-bridge.sh --daemon          │");
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log("");

  await ask("  Enter を押すとブラウザを閉じます...");
  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
