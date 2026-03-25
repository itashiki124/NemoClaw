# NemoClaw プロジェクト移行ガイド

このドキュメントは、現在の NemoClaw 環境を別の端末に複製する手順をまとめたものです。

---

## 前提条件（移行先）

- Windows 10/11 + WSL2 が利用可能
- Git がインストール済み
- インターネット接続あり

---

## 方法 A: GitHub Fork 経由（推奨）

継続的に同期でき、複数端末で使いたい場合に最適。

### 1. Fork を作成（現在の端末で一度だけ）

```powershell
# GitHub CLI がなければインストール
winget install --id GitHub.cli

# ログイン
gh auth login

# Fork 作成（自分のアカウントにコピー）
cd C:\Users\kazuk\NemoClaw
gh repo fork NVIDIA/NemoClaw --remote-name myfork
```

### 2. ローカルの変更をすべてコミット・プッシュ

```powershell
cd C:\Users\kazuk\NemoClaw

# .env は gitignore 済みなので安全
git add -A
git commit -m "feat: local customizations (scripts, discord bridge, copilot config)"
git push myfork main
```

### 3. 移行先でクローン

```powershell
git clone https://github.com/<あなたのユーザー名>/NemoClaw.git
cd NemoClaw
git remote add upstream https://github.com/NVIDIA/NemoClaw.git
```

---

## 方法 B: Git Bundle（オフライン転送）

USB メモリやファイル共有で直接転送する場合。

### 1. Bundle を作成（現在の端末）

```powershell
cd C:\Users\kazuk\NemoClaw

# まずローカルの変更をコミット
git add -A
git commit -m "feat: local customizations"

# Bundle ファイルを作成
git bundle create ../NemoClaw.bundle --all
```

生成される `NemoClaw.bundle` (約数十MB) を移行先にコピー。

### 2. 移行先で復元

```powershell
git clone NemoClaw.bundle NemoClaw
cd NemoClaw
git remote set-url origin https://github.com/NVIDIA/NemoClaw.git
```

---

## 方法 C: ZIP アーカイブ（最も簡単）

```powershell
cd C:\Users\kazuk
# node_modules, venv, .git を除外してアーカイブ
tar -czf NemoClaw-export.tar.gz --exclude='node_modules' --exclude='venv' --exclude='.git' NemoClaw/
```

移行先で展開後、`git init` → upstream を設定。

---

## 移行先での環境セットアップ

コードを取得した後、以下の手順で環境を構築します。

### Step 1: WSL2 + Ubuntu

```powershell
# 管理者権限の PowerShell で実行
wsl --install -d Ubuntu
```

再起動後、Ubuntu を起動してユーザーを作成。

### Step 2: NemoClaw インストール（WSL 内）

```bash
# WSL Ubuntu 内で実行
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
source ~/.nvm/nvm.sh
```

### Step 3: Docker インストール（WSL 内）

```bash
# Docker 公式リポジトリ追加 & インストール
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER
```

### Step 4: Docker MTU 設定（WSL2 TLS 問題回避）

```bash
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "default-cgroupns-mode": "host",
  "mtu": 1350
}
EOF

sudo service docker restart
```

### Step 5: MTU 設定（WSL 起動ごとに必要）

```bash
sudo ip link set dev eth0 mtu 1350
sudo sysctl -w net.ipv4.tcp_mtu_probing=1
```

### Step 6: NemoClaw Onboard

```bash
source ~/.nvm/nvm.sh
nemoclaw onboard
```

対話ウィザードで以下を設定:
- NVIDIA API キー（https://build.nvidia.com/settings/api-keys で取得）
- Sandbox 名（例: `my-assistant`）
- モデル選択（例: `nvidia/nemotron-3-super-120b-a12b`）

### Step 7: 動作確認

```bash
nemoclaw my-assistant connect
# sandbox 内で:
openclaw tui
```

---

## 手動で移行が必要なもの（⚠ 自動コピー不可）

以下のファイル/設定はセキュリティ上 Git に含まれないため、手動で設定してください。

| 項目 | 場所 | 説明 |
|------|------|------|
| NVIDIA API キー | WSL: `~/.nemoclaw/credentials.json` | `nemoclaw onboard` で自動設定される |
| Discord Bot トークン | プロジェクト: `.env` | `DISCORD_TOKEN=<トークン>` |
| GitHub Token | WSL: `~/.nemoclaw/credentials.json` | プライベートリポジトリ使用時のみ |
| Telegram Token | WSL: `~/.nemoclaw/credentials.json` | Telegram ブリッジ使用時のみ |
| Docker daemon.json | WSL: `/etc/docker/daemon.json` | Step 4 で設定 |

### .env ファイルの作成

```bash
# プロジェクトルートに .env を作成
cat > .env << 'EOF'
DISCORD_TOKEN=<Discord Bot トークンをここに>
EOF
```

---

## Discord ブリッジの設定（オプション）

Discord ブリッジを使う場合:

```bash
# .env に DISCORD_TOKEN を設定した後
export DISCORD_TOKEN=$(grep DISCORD_TOKEN .env | cut -d= -f2)
bash scripts/start-discord-bridge.sh --daemon
```

---

## VS Code の設定

プロジェクトに含まれる以下のファイルが VS Code の Copilot Agent を構成します（Git で共有済み）:

- `.github/copilot-instructions.md` — プロジェクト固有の指示
- `.github/agents/openclaw.agent.md` — OpenClaw エージェントモード
- `memories/repo/` — リポジトリスコープのメモ

ユーザースコープの設定（`~/.vscode/` 以下）は各端末で個別に設定してください。

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `tls: bad record MAC` | WSL2 MTU 問題 | Step 4, 5 を再実行 |
| `K8s namespace not ready` | Docker/MTU 未設定 | Step 3, 4, 5 を確認 |
| ポート 8080 使用中 | 古いコンテナ残存 | `docker rm -f openshell-cluster-nemoclaw` |
| CoreDNS 解決不可 | WSL2 DNS 問題 | `bash scripts/fix-coredns-wsl.sh` |
| ゲートウェイ起動失敗 | 状態不整合 | `openshell gateway destroy --name nemoclaw` → `nemoclaw onboard` |
