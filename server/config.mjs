// 設定は環境変数から。秘密（API キー）はファイルで受け取り、値をログに出さない。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const env = (name, fallback) => (process.env[name] === undefined || process.env[name] === '' ? fallback : process.env[name]);

export const config = {
  port: Number(env('PORT', '8080')),
  // HTTPS（マイクは secure context が必須）。証明書ファイルが両方あるときだけ TLS で待ち受ける
  tlsCert: env('TLS_CERT', ''),
  tlsKey: env('TLS_KEY', ''),
  webDir: env('WEB_DIR', here('../web/')),
  dataDir: env('DATA_DIR', here('../data/')),

  // 所在ダッシュボード（正本）。本番は同じ Docker ネットワークの sd-api。
  dashboardApiBase: env('DASHBOARD_API_BASE', 'http://127.0.0.1:8000/api'),
  // ダッシュボードもアクセスキー方式（X-App-Key）。ダッシュボード側 APP_ACCESS_KEYS のうち 1 本をここに置く
  dashboardApiKey: env('DASHBOARD_API_KEY', ''),
  chairmanStaffId: env('CHAIRMAN_STAFF_ID', 'S006'),
  chairmanName: env('CHAIRMAN_NAME', '会長'),

  // OpenAI
  liveModel: env('LIVE_MODEL', 'gpt-live-1'),
  agentModel: env('AGENT_MODEL', 'gpt-5.6-luna'),
  voiceName: env('VOICE_NAME', 'marin'),

  // 予算（GPT-Live は $0.05/分。60 分/日 ≒ $3/日が上限）
  voiceDailyLimitMin: Number(env('VOICE_DAILY_LIMIT_MIN', '60')),
  voiceSessionMaxMin: Number(env('VOICE_SESSION_MAX_MIN', '10')),

  // 会話の書き起こしをログに出す（開発時だけ true にする）
  debugText: env('VOICE_DEBUG_TEXT', 'false') === 'true',
};

/** API キーは呼び出しのたびに読む。保持しない。 */
export function readApiKey() {
  const direct = process.env.OPENAI_API_KEY;
  if (direct) return direct.trim();
  const file = env('OPENAI_API_KEY_FILE', here('../secrets/openai_api_key'));
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}
