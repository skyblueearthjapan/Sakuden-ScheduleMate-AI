# VPS デプロイ（モック）と Tailscale 公開

配備日: 2026-09-14

## 場所

| 項目 | 値 |
|---|---|
| VPS | `72.60.211.213`（Hostinger、所在ダッシュボード sd-api/sd-web と同居） |
| Tailscale ノード | `sakurai-vps` = `100.83.33.18`（テイルネット `tail12e9fa.ts.net`） |
| 配置先 | `/opt/sakuden-schedulemate/`（`docker-compose.yml` + `mock/`） |
| コンテナ | `ssm-web`（nginx:1.27-alpine、静的配信のみ） |
| **URL（Tailscale 内のみ）** | **http://sakurai-vps.tail12e9fa.ts.net:8090/** または http://100.83.33.18:8090/ |

公開 IP（72.60.211.213:8090）には出ない（コンテナを Tailscale の IP にだけバインド。curl で 000 を確認済み）。

## Tailscale Serve（HTTPS）は使えなかった

`tailscale serve --https=443` は「Serve is not enabled on your tailnet」で止まる。
管理画面 https://login.tailscale.com/f/serve?node=n1w6xS35d621CNTRL で有効化すれば
`https://sakurai-vps.tail12e9fa.ts.net/` にできる（ただし `tailscale cert` は「アカウントが TLS 証明書に非対応」と返るため、プランの確認が要る）。
当面は IP バインドの http で運用する。

## 更新手順（開発 PC の Git Bash）

```bash
cd ~/Documents/会話型スケジュールAI/Sakuden-ScheduleMate-AI
tar -czf - mock/index.html mock/assets/assistant-avatar.png | ssh root@72.60.211.213 'tar -xzf - -C /opt/sakuden-schedulemate'
# 静的ファイルなので再起動不要。compose を変えたときだけ:
ssh root@72.60.211.213 'cd /opt/sakuden-schedulemate && docker compose up -d'
```

停止・撤去: `ssh root@72.60.211.213 'cd /opt/sakuden-schedulemate && docker compose down'`

## 注意

- 同じ VPS の `kaipoke-api` / `carelink-*` / `sd-*` などには触れない。`docker system prune` を使わない。
- 本実装（FastAPI + Claude API）に進むときは、同じ compose に `api` サービスを足し、ダッシュボードの Docker ネットワーク `sakurai-dashboard-internal` に参加させて `http://sd-api:8000/api` を叩く。
