# VPS デプロイと公開経路

更新: 2026-09-14（本実装版）

## 場所

| 項目 | 値 |
|---|---|
| VPS | `72.60.211.213`（Hostinger。所在ダッシュボード sd-api/sd-web と同居） |
| 配置先 | `/opt/sakuden-schedulemate/`（`docker-compose.yml`, `Dockerfile`, `server/`, `web/`, `.env`, `secrets/openai_api_key`, `data/state.json`） |
| コンテナ | `ssm-api`（node:24-alpine、1 プロセス。UI 配信 + API） |
| ネットワーク | `sakurai-dashboard-internal` に参加し `http://sd-api:8000/api` へ書き込む |
| 公開 | **https://schedule.sakuraidenso.net**（Cloudflare Tunnel `sakuden-schedulemate`、2026-09-14 公開済み。配布リンクは `#k=<キー>` 付き） |
| Tailscale 版 | 停止済み（`docker-compose.yml` は検証用に残す） |

## 重要: マイクは HTTPS が必要

ブラウザの `getUserMedia`（マイク）は secure context（https か localhost）でしか動かない。
Tailscale の http URL では **音声が使えない**。PWA のホーム画面インストールも正規の https が要る。
選択肢:

1. **Cloudflare Tunnel + 配布リンクのアクセスキー**（採用。手順書: `桜井NASシステム/docs/schedulemate-deploy.md`）
   - `docker-compose.prod.yml`（`ssm-api` + `ssm-cloudflared`、ホストポート無し）で https://schedule.sakuraidenso.net に出す
   - ログイン無し。配布リンク `https://schedule.sakuraidenso.net/#k=<キー>` を開いた端末だけ使える
     （サーバー: `server/access.mjs`、`APP_ACCESS_KEYS`。画面: `web/index.html` 冒頭の入口スクリプト）
   - 正規の https になるのでマイク・PWA のインストールがそのまま動く
   - Cloudflare の設定・VPS への配置・起動は「桜井NASシステム」側の手順書 4 章で行う
2. Tailscale Serve（https）: テイルネット管理画面で「HTTPS Certificates」と「Serve」を有効化 → `tailscale serve --bg --https=443 http://127.0.0.1:8090`
3. 自己署名 TLS: `.env` に `TLS_CERT` / `TLS_KEY` を置けばコンテナが https で待ち受ける（警告を「続行」すればマイクは動く。インストールは不可）

## 更新手順（開発 PC の Git Bash）

```bash
cd ~/Documents/会話型スケジュールAI/Sakuden-ScheduleMate-AI
tar -czf - --exclude=node_modules --exclude=data --exclude=mock --exclude=.git --exclude=tools --exclude=docs \
  Dockerfile docker-compose.yml package.json package-lock.json .env server web secrets/openai_api_key \
  | ssh root@72.60.211.213 'cd /opt/sakuden-schedulemate && tar -xzf - && DOCKER_BUILDKIT=1 docker compose up -d --build'
ssh root@72.60.211.213 'docker logs --tail 50 ssm-api'
```

停止: `ssh root@72.60.211.213 'cd /opt/sakuden-schedulemate && docker compose down'`

## 注意

- 同じ VPS の `kaipoke-api` / `carelink-*` / `sd-*` には触れない。`docker system prune` を使わない。
- `.env` の `VOICE_DEBUG_TEXT=true` は会話の書き起こしをログに出す（試験中だけ。本番前に false）。
- 音声の予算は `VOICE_DAILY_LIMIT_MIN`（既定 60 分/日 ≒ $3）と `VOICE_SESSION_MAX_MIN`（10 分で自動終了）。
