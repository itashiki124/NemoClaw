# USER.md - About Your Human

_Learn about the person you are helping. Update this as you go._

- **Name:** kazuk
- **What to call them:** kazuk さん
- **Pronouns:** he/him
- **Timezone:** Asia/Tokyo (JST, UTC+9)
- **Notes:** 日本語で会話する。技術的な話題にも詳しい。

## Context

### 環境
- Windows + WSL2 (Ubuntu) で NemoClaw / OpenClaw を運用中
- Surface Laptop 3 を使用
- VS Code をメインエディタとして使っている
- Docker CE 29.3.0 (WSL2 内)
- Node.js v22.22.1 (nvm)
- Sandbox 名: my-assistant
- Model: nvidia/nemotron-3-super-120b-a12b

### プロジェクト
- NVIDIA NemoClaw (OpenClaw Plugin for OpenShell) のセットアップ・運用・開発をしている
- リポジトリ: C:\Users\kazuk\NemoClaw (Windows 側にクローン)
- TypeScript プラグインコードの最適化・リファクタリングを行った
- コードベースの重複排除やパフォーマンス改善に関心がある

### Discord ブリッジ
- Discord チャンネル 1484243496339767489 でハートビートメッセージを受け取っている
- ハートビートは30分間隔で自動送信 (heartbeat-cron.sh デーモン)
- 「自由に発言していい」とのこと。話題・長さ・トーンの制限なし
- 雑談、豆知識、ジョーク、俳句、哲学、おすすめ、プログラミング小ネタなど何でもOK

### コミュニケーションスタイル
- 簡潔な指示を出すタイプ。「やってください」「継続して」など短い指示が多い
- 技術的な内容はすぐ理解する
- 不要なものは「削除していいです」とはっきり言う
- 自由度を与えてくれる（「もっと自由に発言していいですよ」）

### やり取りの履歴 (2026-03-24)
1. NemoClaw コードベース全体のスクリーニング・最適化を依頼（5波に渡るリファクタリング実施）
2. ハートビート機能：固定メッセージ → ランダム候補 → 完全自由生成に進化
3. ハートビートのデプロイパス問題を解決（/sandbox/.openclaw/workspace/ と /sandbox/workspace/ の両方に配置）
4. ハートビートスケジューラ（heartbeat-cron.sh）を作成・起動
5. USER.md にコンテキストを残すよう依頼 ← いまここ

---

The more you know, the better you can help. But remember — you are learning about a person, not building a dossier. Respect the difference.
