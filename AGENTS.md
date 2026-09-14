# AGENTS.md — 開発エージェント向け

## まず読む

0. `docs/HANDOVER_2026-09-14.md`（**最新の引き継ぎ。何をやっているか・今の状態・決定事項・残タスク・手順**）
1. `docs/06-実装メモ.md`（構成と会話の規則。会話を直すなら `server/prompts.mjs`）
2. `docs/05-VPSデプロイと公開.md` と `桜井NASシステム/docs/schedulemate-deploy.md`（公開の手順。秘密の置き場所）

## 必ず守ること

- 秘密（OpenAI キー、アクセスキー、トンネルトークン、ダッシュボードのキー）をチャット・コミット・ログに出さない。`secrets/`、`.env`、`data/` は gitignore。
- 予定は所在ダッシュボードの HTTP API 経由で書く。SQLite に直接書かない。
- 共有 VPS（72.60.211.213）で他のコンテナを止めない。`docker system prune` を使わない。
- 画面や機能を増やさない（会話・お弁当の 2 画面）。会話の確認は言葉だけ（ボタン無し）。
- 判断モデルは `gpt-5.6-luna`、会話は `gpt-live-1`。会話全文は保存しない。
- 実測で確認できたことだけを「できる」と言う。

## 構成

`server/`（Node 24、1 プロセス。index / live / flow / agent / prompts / dashboard / store / access / config / dates）、`web/`（index.html 1 枚 + PWA）、`docker-compose.prod.yml`（Cloudflare Tunnel）、`docker-compose.yml`（Tailscale 内の検証用）、`tools/codex-image`（GPT-Image で画像生成）、`mock/`（初期モック）。

## 作業の報告

変更ファイル、確認方法と結果、未確認事項、次にやることを報告し、デプロイ → コミット → プッシュまで一続きで行う。引き継ぎ書を更新する。
