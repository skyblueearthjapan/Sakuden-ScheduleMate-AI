// 配布リンクのアクセスキー（このアプリ唯一の認証。ログイン画面は無い）。
// 他の桜井電装アプリ（写真・発注書）と同じ方式: 桜井NASシステム app/backend/app/access_key.py に合わせる。
//
//   APP_ACCESS_KEYS = "ラベル:キー,ラベル:キー"   キーは [A-Za-z0-9_-]{24,}
//   取り出し順: cookie ssm_key → ヘッダ x-app-key（クエリ文字列は受け取らない。アクセスログに残るため）
//   照合は定数時間で全キーを走査する（どのキーに近いかを時間から漏らさない）
import { timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'ssm_key';
export const HEADER_NAME = 'x-app-key';
export const COOKIE_MAX_AGE = 34560000; // 400 日（Chrome が受け付ける上限）
const KEY_RE = /^[A-Za-z0-9_-]{24,}$/;

/** [{ label, key }] と、書式が崩れた項目の警告文 */
export function parseKeys(raw) {
  const keys = [];
  const warnings = [];
  for (const item of String(raw ?? '').split(',')) {
    const entry = item.trim();
    if (!entry) continue;
    const i = entry.indexOf(':');
    const label = i < 0 ? '' : entry.slice(0, i).trim();
    const key = i < 0 ? '' : entry.slice(i + 1).trim();
    if (!label || !KEY_RE.test(key)) {
      warnings.push(`項目「${entry.slice(0, 12)}…」の書式が不正（ラベル:キー、キーは英数字と _- で 24 文字以上）`);
      continue;
    }
    keys.push({ label, key });
  }
  return { keys, warnings };
}

export function createAccess(raw, log) {
  const { keys, warnings } = parseKeys(raw);
  for (const w of warnings) log.warn('APP_ACCESS_KEYS', w);
  if (keys.length === 0) log.error('APP_ACCESS_KEYS が未設定です。/api/health と /api/key 以外の /api/* は 503 を返します');
  else log.info(`アクセスキー ${keys.length} 件を読み込みました: ${keys.map((k) => k.label).join(', ')}`);

  const bufs = keys.map((k) => ({ label: k.label, buf: Buffer.from(k.key, 'utf8') }));

  /** 一致したラベル。無ければ null。全キーと比較してから返す */
  const labelFor = (key) => {
    if (typeof key !== 'string' || key === '') return null;
    const probe = Buffer.from(key, 'utf8');
    let found = null;
    for (const k of bufs) {
      const same = probe.length === k.buf.length && timingSafeEqual(probe, k.buf);
      if (same) found = k.label;
    }
    return found;
  };

  const keyFromRequest = (req) => {
    const cookie = String(req.headers.cookie ?? '');
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
    let key = m ? decodeURIComponent(m[1]).trim() : '';
    if (!key) key = String(req.headers[HEADER_NAME] ?? '').trim();
    return key;
  };

  const cookieFor = (key) => `${COOKIE_NAME}=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;

  return {
    configured: keys.length > 0,
    labelFor,
    keyFromRequest,
    cookieFor,
    /** 要求のキーを解決する。{ label } または { error, status } */
    resolve(req) {
      if (keys.length === 0) return { status: 503, error: 'アクセスキーが未設定です' };
      const label = labelFor(keyFromRequest(req));
      if (label === null) return { status: 401, error: 'アクセスキーが無効です' };
      return { label };
    },
  };
}
