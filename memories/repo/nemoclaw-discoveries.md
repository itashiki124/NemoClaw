# NemoClaw/OpenClaw リポジトリメモ

## 設計図の更新ルール
- エージェント構成（ポリシー、設定、スクリプト、チャネル、起動手順など）を変更した場合は `docs/ARCHITECTURE-AGENT.md` も同時に更新すること
- 変更履歴セクション（12章）に日付と変更内容を追記すること

## Discord 接続の主要発見事項 (2026-03-23)

### 1. CoreDNS 問題
- k3s CoreDNS が `/etc/resolv.conf` → `127.0.0.11` (Docker embedded DNS) に転送
- k3s ポッドからは 127.0.0.11 に到達不可 → DNS 全滅
- 修正: `scripts/fix-coredns-wsl.sh` で `8.8.8.8 1.1.1.1` に転送設定
- ただし sandbox ポッドは独自ネットワーク名前空間で UDP/53 をブロック

### 2. sandbox ネットワークアーキテクチャ
- sandbox はプロキシ `10.200.0.1:3128` 経由のみ外部通信可能
- HTTP/HTTPS: Node.js `HTTPS_PROXY`/`HTTP_PROXY` 環境変数で自動プロキシ
- WebSocket: 自動プロキシ **されない** → DNS 解決ローカルで失敗
- DNS (UDP/53): sandbox ネットワーク名前空間でブロック

### 3. Discord proxy 設定（最重要）
- `channels.discord.proxy: "http://10.200.0.1:3128"` を `openclaw.json` に追加
- コード: `compact-1mmJ_KWL.js` 75790行目
  - `HttpsProxyAgent(proxy)` → WebSocket 用 (ws module の agent オプション)
  - `ProxyAgent(proxy)` → REST API 用 (undici dispatcher)
- これにより WebSocket も CONNECT トンネル経由 → プロキシが DNS 解決

### 4. プロキシ binary 識別
- openshell プロキシは `/proc/<pid>/exe` で実際のバイナリパスをチェック
- `openclaw` は `/usr/local/bin/node` へのシンボリックリンク
- ポリシーの `binaries` に `/usr/local/bin/node` を含める必要あり

### 5. ポリシー method 制限
- Discord は GET/POST 以外に PUT/PATCH/DELETE も使用（コマンド登録等）
- `method: '*'` (ワイルドカード) で全メソッド許可が必要

### 6. CRLF 問題
- Windows で編集した YAML ファイルに CRLF が混入
- `policies.js` の `extractPresetEntries()` の regex が CRLF で失敗
- `sed -i 's/\r$//'` で修正

## 重要ファイル
- `scripts/openclaw-config.json`: sandbox 設定のバックアップ（ポッド再起動後に復元）
- `scripts/full-policy.yaml`: 完全なネットワークポリシー（discord含む）
- `scripts/fix-coredns-wsl.sh`: WSL2 用 CoreDNS パッチスクリプト

## 起動後の手順 (ポッド再起動時)
1. config 復元: `cat openclaw-config.json | ssh openshell-my-assistant 'cat > /sandbox/.openclaw/openclaw.json'`
2. gateway 起動: `ssh openshell-my-assistant 'nohup openclaw gateway run --port 18789 > /tmp/gateway.log 2>&1 &'`
3. HEARTBEAT.md 復元: `cat HEARTBEAT.md | ssh openshell-my-assistant 'mkdir -p /sandbox/workspace && cat > /sandbox/workspace/HEARTBEAT.md'`
