# NemoClaw Agent 設計図

> **最終更新**: 2026-03-24
> **バージョン**: 1.0
> **目的**: このドキュメントはエージェント構成の全体設計を記述する。変更時は本ドキュメントも同時に更新すること。

---

## 1. システム概要

```
┌─────────────────────────────────────────────────────────────────┐
│  Windows (Surface Laptop 3)                                     │
│                                                                 │
│  ┌──────────────────────┐   ┌────────────────────────────────┐  │
│  │ VS Code              │   │ Discord (ブラウザ/アプリ)      │  │
│  │  └─ Copilot Agent    │   │  └─ Channel: 1484243...489     │  │
│  │     (openclaw mode)  │   └──────────────┬─────────────────┘  │
│  └──────────┬───────────┘                  │                    │
│             │ wsl -d Ubuntu                │ Discord API        │
│  ┌──────────▼──────────────────────────────▼─────────────────┐  │
│  │  WSL2 Ubuntu                                              │  │
│  │                                                           │  │
│  │  ┌─────────────────┐   ┌──────────────────────────────┐   │  │
│  │  │ Discord Bridge  │   │ Docker CE 29.3.0             │   │  │
│  │  │ Bot (Python)    │   │                              │   │  │
│  │  │ PID on WSL host │   │  ┌────────────────────────┐  │   │  │
│  │  │                 │   │  │ k3s (openshell-cluster- │  │   │  │
│  │  │ SSH ──────────────────▶│ nemoclaw)               │  │   │  │
│  │  └─────────────────┘   │  │                        │  │   │  │
│  │                        │  │  ┌──────────────────┐  │  │   │  │
│  │                        │  │  │ Pod: my-assistant │  │  │   │  │
│  │                        │  │  │ (sandbox)        │  │  │   │  │
│  │                        │  │  │                  │  │  │   │  │
│  │                        │  │  │  OpenClaw Gateway│  │  │   │  │
│  │                        │  │  │  :18789          │  │  │   │  │
│  │                        │  │  │  ├─ NemoClaw     │  │  │   │  │
│  │                        │  │  │  ├─ Discord ch.  │  │  │   │  │
│  │                        │  │  │  ├─ Heartbeat    │  │  │   │  │
│  │                        │  │  │  └─ Agent (main) │  │  │   │  │
│  │                        │  │  └──────────────────┘  │  │   │  │
│  │                        │  │                        │  │   │  │
│  │                        │  │  ┌──────────────────┐  │  │   │  │
│  │                        │  │  │ Pod: openshell-0 │  │  │   │  │
│  │                        │  │  │ (control plane)  │  │  │   │  │
│  │                        │  │  │  ├─ Proxy :3128  │  │  │   │  │
│  │                        │  │  │  ├─ Policy engine│  │  │   │  │
│  │                        │  │  │  └─ SSH server   │  │  │   │  │
│  │                        │  │  └──────────────────┘  │  │   │  │
│  │                        │  └────────────────────────┘  │   │  │
│  │                        └──────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │ NVIDIA Cloud API   │
                    │ build.nvidia.com   │
                    │ nemotron-3-super   │
                    │ -120b-a12b         │
                    └────────────────────┘
```

---

## 2. コンポーネント一覧

| # | コンポーネント | 場所 | 役割 |
|---|---------------|------|------|
| 1 | **Copilot Agent (openclaw mode)** | `.github/agents/openclaw.agent.md` | VS Code 内から環境操作を指示 |
| 2 | **copilot-instructions.md** | `.github/copilot-instructions.md` | プロジェクト全体のコンテキスト |
| 3 | **OpenClaw Gateway** | sandbox 内 `:18789` | AI 推論・チャネル・ハートビート管理 |
| 4 | **NemoClaw Plugin** | `/opt/nemoclaw` → sandbox 拡張 | セキュリティポリシー・推論ルーティング |
| 5 | **Discord Channel (Native)** | Gateway 内蔵 | サンドボックスから直接 Discord API 接続 |
| 6 | **Discord Bridge Bot** | `scripts/discord-bridge-bot.py` | WSL ホストから SSH 経由でメッセージ中継 |
| 7 | **Network Policy** | `scripts/full-policy.yaml` | プロキシのアクセス制御ルール |
| 8 | **Sandbox Config** | `scripts/openclaw-config.json` | openclaw.json のバックアップ |
| 9 | **CoreDNS Fix** | `scripts/fix-coredns-wsl.sh` | WSL2 環境の DNS 修正 |
| 10 | **Heartbeat** | `scripts/HEARTBEAT.md` | 定期メッセージ送信指示 |

---

## 3. ファイル構成

```
NemoClaw/
├── .github/
│   ├── copilot-instructions.md          # プロジェクトコンテキスト
│   └── agents/
│       └── openclaw.agent.md            # Copilot Agent モード定義
├── .env                                 # DISCORD_TOKEN, DISCORD_CHANNEL_ID
├── .gitignore                           # .env を除外
├── memories/
│   └── repo/
│       └── nemoclaw-discoveries.md      # 発見事項・ノウハウ記録
├── scripts/
│   ├── openclaw-config.json             # ★ sandbox 設定バックアップ
│   ├── full-policy.yaml                 # ★ 完全ネットワークポリシー (v13)
│   ├── discord-bridge-bot.py            # Discord ↔ OpenClaw ブリッジ
│   ├── start-discord-bridge.sh          # ブリッジ起動 (--daemon 対応)
│   ├── stop-discord-bridge.sh           # ブリッジ停止
│   ├── fix-coredns-wsl.sh              # CoreDNS → 8.8.8.8 パッチ
│   ├── HEARTBEAT.md                     # ハートビート指示テンプレート
│   ├── apply-discord-policy.sh          # Discord ポリシー適用
│   ├── test-dns.js                      # DNS 診断スクリプト
│   ├── test-discord-fetch.js            # Discord API 疎通テスト
│   ├── test-proxy.js                    # プロキシ疎通テスト
│   └── test-endpoints.js               # エンドポイント疎通テスト
└── docs/
    └── ARCHITECTURE-AGENT.md            # ★ 本ドキュメント
```

---

## 4. Discord 接続アーキテクチャ

2 つの独立した Discord 接続経路がある:

### 4.1 Native Discord Channel (推奨・現在稼働中)

```
Discord API ←──(HTTPS/WSS)──→ Proxy 10.200.0.1:3128 ←── OpenClaw Gateway (sandbox内)
```

- **設定場所**: `openclaw-config.json` → `channels.discord`
- **認証**: Bot Token (`channels.discord.token`)
- **プロキシ**: `channels.discord.proxy: "http://10.200.0.1:3128"`
  - REST API: `undici.ProxyAgent` で HTTP CONNECT トンネル
  - WebSocket: `https-proxy-agent.HttpsProxyAgent` で CONNECT トンネル
  - プロキシが DNS を解決するため sandbox 内の DNS 不通を回避
- **ポリシー**: `full-policy.yaml` → `network_policies.discord`
  - `method: '*'` (GET/POST/PUT/PATCH/DELETE 全許可)
  - `binaries: [/usr/local/bin/openclaw, /usr/local/bin/node]`
- **ハートビート**: Gateway 内蔵。30 分間隔で Discord チャネルにメッセージ送信
- **Bot**: NemoClaw_bot (App ID: 1485134123126231192)

### 4.2 Discord Bridge Bot (外部・バックアップ)

```
Discord API ←── discord.py (WSL host) ──SSH──→ sandbox (openclaw agent CLI)
```

- **実体**: `scripts/discord-bridge-bot.py` (Python, discord.py)
- **動作場所**: WSL ホスト上（sandbox 外）
- **通信**: SSH 経由で `openclaw agent --agent main --local -m ...` を実行
- **用途**: Gateway が落ちている場合のフォールバック
- **管理**: `start-discord-bridge.sh --daemon` / `stop-discord-bridge.sh`
- **ステート**: PID ファイル `/tmp/discord-bot/bot.pid`

---

## 5. ネットワークポリシー設計

### 5.1 sandbox ネットワーク制約

| レイヤー | 制約 |
|---------|------|
| **netns** | sandbox 専用ネットワーク名前空間。外部直接通信不可 |
| **DNS** | UDP/53 ブロック。CoreDNS (10.43.0.10) に到達不可 |
| **HTTP(S)** | プロキシ 10.200.0.1:3128 経由のみ許可 |
| **WebSocket** | 明示的 proxy 設定が必要（env var による自動プロキシ不可） |

### 5.2 ポリシーエントリ (full-policy.yaml)

| ポリシー名 | ホスト | TLS モード | 用途 |
|-----------|--------|-----------|------|
| `discord` | discord.com, gateway.discord.gg, cdn.discordapp.com | terminate | Discord Bot 通信 |
| `nvidia` | integrate.api.nvidia.com, inference-api.nvidia.com | terminate | LLM 推論 |
| `github` | github.com, api.github.com | full (pass-through) | Git/GitHub CLI |
| `claude_code` | api.anthropic.com, statsig.anthropic.com, sentry.io | terminate | Claude Code スキル |
| `npm_registry` | registry.npmjs.org | full | npm パッケージ |
| `openclaw_api` | openclaw.ai | terminate | OpenClaw API |
| `openclaw_docs` | docs.openclaw.ai | terminate | ドキュメント |
| `clawhub` | clawhub.com | terminate | ClawhHub |
| `telegram` | api.telegram.org | terminate | Telegram (未使用) |

### 5.3 重要な設計判断

- **binary 識別**: プロキシは `/proc/<pid>/exe` で実行バイナリを検証。`openclaw` は Node.js シンボリンク → **`/usr/local/bin/node` を binaries に記載必須**
- **method ワイルドカード**: Discord は PUT/PATCH/DELETE も使用 → **`method: '*'`** が必要
- **CRLF 注意**: Windows で YAML を編集すると CRLF が混入し `extractPresetEntries()` の regex が壊れる → **LF で保存すること**

---

## 6. sandbox 設定 (openclaw-config.json)

### 6.1 モデル設定

```
inference/nvidia/nemotron-3-super-120b-a12b
  ├── Provider: NVIDIA Cloud API via build.nvidia.com
  ├── Endpoint: https://inference.local/v1 (openshell がプロキシ)
  ├── Context Window: 131,072 tokens
  ├── Max Tokens: 4,096
  └── Cost: 無料 (NVIDIA API キー)
```

### 6.2 チャネル設定

| 項目 | 値 |
|------|-----|
| `channels.discord.enabled` | `true` |
| `channels.discord.proxy` | `http://10.200.0.1:3128` |
| `channels.discord.groupPolicy` | `allowlist` |
| `channels.discord.streaming` | `off` |

### 6.3 Gateway 設定

| 項目 | 値 |
|------|-----|
| `gateway.mode` | `local` |
| `gateway.auth.mode` | `token` |
| ControlUI | `http://127.0.0.1:18789` |

### 6.4 プラグイン

| プラグイン | 有効 | ソース |
|-----------|------|--------|
| `nemoclaw` | Yes | `/opt/nemoclaw` → `/sandbox/.openclaw/extensions/nemoclaw` |
| `discord` | Yes | OpenClaw 内蔵 |

---

## 7. 起動・復旧手順

### 7.1 通常起動 (WSL 再起動後)

```
1. Docker 起動
   wsl -d Ubuntu -- bash -c 'sudo service docker start'

2. MTU 修正
   wsl -d Ubuntu -- bash -c 'sudo ip link set dev eth0 mtu 1350; sudo sysctl -w net.ipv4.tcp_mtu_probing=1'

3. ゲートウェイ確認
   wsl -d Ubuntu -- bash -c 'docker ps | grep openshell'

4. CoreDNS パッチ (初回のみ / WSL 再起動後)
   wsl -d Ubuntu -e bash /mnt/c/Users/kazuk/NemoClaw/scripts/fix-coredns-wsl.sh

5. サンドボックス接続
   wsl -d Ubuntu -- bash -c 'source ~/.nvm/nvm.sh; nemoclaw my-assistant connect'
```

### 7.2 sandbox ポッド再起動後の復旧

sandbox の `/sandbox` はエフェメラルストレージのため、ポッド再起動で全消失する。

```
1. 設定復元
   cat scripts/openclaw-config.json | ssh openshell-my-assistant \
     'mkdir -p /sandbox/.openclaw && cat > /sandbox/.openclaw/openclaw.json'

2. Gateway 起動
   ssh openshell-my-assistant \
     'nohup openclaw gateway run --port 18789 > /tmp/gateway.log 2>&1 &'

3. HEARTBEAT.md 復元
   cat scripts/HEARTBEAT.md | ssh openshell-my-assistant \
     'mkdir -p /sandbox/workspace && cat > /sandbox/workspace/HEARTBEAT.md'

4. 確認
   ssh openshell-my-assistant 'tail -20 /tmp/gateway.log'
   → "logged in to discord as ... (NemoClaw_bot)" を確認
```

### 7.3 ポリシー更新

```
1. scripts/full-policy.yaml を編集
2. 適用:
   wsl -d Ubuntu -- bash -c 'source ~/.nvm/nvm.sh; \
     openshell policy set my-assistant \
     --policy /mnt/c/Users/kazuk/NemoClaw/scripts/full-policy.yaml --wait'
3. ポッド再起動 (プロキシにポリシーを反映):
   docker exec openshell-cluster-nemoclaw kubectl delete pod my-assistant -n openshell
4. 復旧手順 7.2 を実行
```

---

## 8. 環境変数 (.env)

| 変数 | 用途 | 管理場所 |
|------|------|---------|
| `DISCORD_TOKEN` | Discord Bot トークン | `.env` (gitignore 済み) |
| `DISCORD_CHANNEL_ID` | ハートビート送信先チャネル | `.env` |

sandbox 内の環境変数 (自動設定):
| 変数 | 値 |
|------|-----|
| `HTTP_PROXY` / `HTTPS_PROXY` | `http://10.200.0.1:3128` |
| `ALL_PROXY` | `http://10.200.0.1:3128` |
| `NO_PROXY` | `127.0.0.1,localhost,::1` |
| `NODE_USE_ENV_PROXY` | `1` |

---

## 9. ファイルシステムポリシー

| パス | 権限 | 備考 |
|------|------|------|
| `/sandbox` | **読み書き** | ワーキングディレクトリ。エフェメラル |
| `/tmp` | **読み書き** | ログ・一時ファイル |
| `/usr` | 読み取り専用 | Node.js, OpenClaw バイナリ |
| `/etc` | 読み取り専用 | resolv.conf, hosts |
| `/proc` | 読み取り専用 | プロセス情報 |
| `/dev/null`, `/dev/urandom` | 読み取り | デバイスファイル |

---

## 10. 診断・デバッグツール

| スクリプト | 用途 |
|-----------|------|
| `scripts/test-dns.js` | sandbox 内 DNS 解決テスト |
| `scripts/test-discord-fetch.js` | Discord API HTTP 疎通テスト |
| `scripts/test-proxy.js` | プロキシ CONNECT トンネルテスト |
| `scripts/test-endpoints.js` | 全ポリシーエンドポイント疎通テスト |
| `scripts/fix-coredns-wsl.sh` | CoreDNS → 8.8.8.8 パッチ |

---

## 11. 既知の制約・注意事項

1. **sandbox エフェメラル**: ポッド再起動で `/sandbox` 全消失。config の復元が毎回必要
2. **DNS 不通**: sandbox は UDP/53 をブロック。外部 DNS 解決はプロキシ依存
3. **WebSocket proxy**: `channels.discord.proxy` の明示設定が必須。環境変数だけでは WebSocket に適用されない
4. **binary 識別**: ポリシーの `binaries` にシンボリンクではなく実体パスが必要
5. **CRLF**: Windows で YAML/設定ファイルを編集する際は LF 改行を維持
6. **MTU**: WSL2 再起動ごとに MTU=1350 の再設定が必要
7. **対話型コマンド**: `nemoclaw onboard`, `openclaw tui` はエージェントから実行不可

---

## 12. 変更履歴

| 日付 | 変更内容 |
|------|---------|
| 2026-03-24 | 初版作成。全コンポーネント・接続経路・ポリシー設計を記述 |
