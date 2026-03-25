# NemoClaw / OpenClaw プロジェクト

## 概要
このプロジェクトは NVIDIA NemoClaw — OpenClaw を安全なサンドボックス環境で動かすためのオープンソースツールです。

## 環境
- Windows + WSL2 (Ubuntu)
- Node.js v22.22.1 (nvm)
- Docker CE 29.3.0
- Sandbox: my-assistant
- Model: nvidia/nemotron-3-super-120b-a12b

## WSL 再起動後の復旧手順
WSL 再起動後は以下が必要:
1. `sudo service docker start`
2. `sudo ip link set dev eth0 mtu 1350`
3. `sudo sysctl -w net.ipv4.tcp_mtu_probing=1`

## Docker 設定
`/etc/docker/daemon.json`:
```json
{
  "default-cgroupns-mode": "host",
  "mtu": 1350
}
```

## 重要なパス
- nemoclaw: `/home/kazuk/.nvm/versions/node/v22.22.1/bin/nemoclaw`
- nvm: `source ~/.nvm/nvm.sh`

## キーコマンド
- 起動: `nemoclaw my-assistant connect`
- TUI: `openclaw tui`
- CLI: `openclaw agent --agent main --local -m "メッセージ" --session-id test`
- 状態: `nemoclaw my-assistant status`
- ログ: `nemoclaw my-assistant logs --follow`
