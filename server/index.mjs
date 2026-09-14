// 会長のスケジュール係 — サーバー本体（1 プロセス、DB なし）。
//   GET  /                          Web UI（web/）
//   POST /api/voice/sessions        { sdp_offer } → { session_id, sdp_answer }   GPT-Live セッション作成
//   POST /api/voice/sessions/:id/close
//   GET  /api/state                 予定・お弁当・音声の状態（画面が数秒おきに読む）
//   GET  /api/health
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config, readApiKey } from './config.mjs';
import { addDays, tokyoDate } from './dates.mjs';
import * as dashboard from './dashboard.mjs';
import * as store from './store.mjs';
import { LiveSession } from './live.mjs';
import { liveInstructions } from './prompts.mjs';
import { gatherFacts, handleDelegation, newState } from './flow.mjs';
import { createAccess } from './access.mjs';

const log = {
  info: (...a) => console.log(new Date().toISOString(), 'INFO', ...a),
  warn: (...a) => console.warn(new Date().toISOString(), 'WARN', ...a),
  error: (...a) => console.error(new Date().toISOString(), 'ERROR', ...a),
};

/** 同時に 1 セッションだけ（会長専用）。 */
let current = null; // { live, state, timer }

const access = createAccess(process.env.APP_ACCESS_KEYS, log);
const OPEN_PATHS = new Set(['/api/health', '/api/key']);

/* ------------------------------------------------------------ セッション作成・終了 */
async function createVoiceSession(sdpOffer) {
  if (typeof sdpOffer !== 'string' || sdpOffer.trim() === '' || Buffer.byteLength(sdpOffer) > 64 * 1024) {
    throw httpError(400, 'sdp_offer が必要です');
  }
  const apiKey = readApiKey();
  if (!apiKey) throw httpError(503, 'OpenAI の API キーが設定されていません');

  const today = tokyoDate();
  const usedMin = store.usageSecondsOn(today) / 60;
  if (usedMin >= config.voiceDailyLimitMin) throw httpError(429, '本日の音声の利用枠を使い切りました');

  if (current && !current.live.closed) {
    // 会長専用なので 1 本だけ。古い方を閉じて作り直す
    log.warn('closing previous live session');
    await current.live.close().catch(() => {});
  }

  const state = newState();
  const facts = await gatherFacts(state);
  const live = new LiveSession({ apiKey, log });
  const session = { live, state, timer: null };
  live.on({
    onDelegation: (id) => handleDelegation(session, id, log).catch((e) => log.error('delegation failed', String(e))),
    onClosed: (_reason, seconds) => {
      clearTimeout(session.timer);
      store.addUsage(today, seconds);
      if (current === session) current = null;
    },
  });
  const sdpAnswer = await live.create({
    sdp: sdpOffer,
    model: config.liveModel,
    voice: config.voiceName,
    instructions: liveInstructions({ chairmanName: config.chairmanName, facts: facts.text }),
  });
  // 話しっぱなし対策: 上限時間で自動終了（$0.05/分）
  session.timer = setTimeout(() => live.close().catch(() => {}), config.voiceSessionMaxMin * 60_000);
  session.timer.unref?.();
  current = session;
  return { session_id: live.id, sdp_answer: sdpAnswer };
}

async function stateSnapshot() {
  const today = tokyoDate();
  let events = [];
  let dashboardOk = true;
  try {
    events = await dashboard.upcomingEvents(addDays(today, -7), addDays(today, 21));
  } catch (e) {
    dashboardOk = false;
    log.warn('dashboard unreachable', String(e.message));
  }
  return {
    today,
    chairman: { id: config.chairmanStaffId, name: config.chairmanName },
    dashboard_ok: dashboardOk,
    events,
    lunch: store.lunchFor(addDays(today, -7), addDays(today, 21)),
    voice: {
      active: Boolean(current && !current.live.closed),
      minutes_today: Math.round(store.usageSecondsOn(today) / 60),
      daily_limit_min: config.voiceDailyLimitMin,
    },
    pending: current?.state.pending ?? null,
    last_added: current?.state.lastAdded ?? null,
  };
}

/* ------------------------------------------------------------ HTTP */
const httpError = (status, message) => Object.assign(new Error(message), { status });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 128 * 1024) throw httpError(413, 'too large');
  }
  return body ? JSON.parse(body) : {};
}
// 全応答に付ける。CSP は web/index.html が使う外部（Google Fonts）だけ許可する
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
const sendJson = (res, status, data, extra = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
};

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = normalize(join(config.webDir, rel));
  if (!file.startsWith(normalize(config.webDir))) return sendJson(res, 404, { error: 'not found' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('dir');
    const data = await readFile(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': rel === '/index.html' ? 'no-store' : 'public, max-age=86400',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, dashboard: await dashboard.health().catch(() => false) });
    }
    // 配布リンクのキーを長期 cookie に変える（毎回叩いて期限も延ばす）
    if (req.method === 'POST' && url.pathname === '/api/key') {
      if (!access.configured) return sendJson(res, 503, { error: 'アクセスキーが未設定です' });
      const body = await readJson(req);
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      const label = access.labelFor(key);
      if (label === null) return sendJson(res, 401, { error: 'アクセスキーが無効です' });
      return sendJson(res, 200, { ok: true, label }, { 'set-cookie': access.cookieFor(key) });
    }
    // ここから下の /api/* はすべてキー必須（未設定 503、無効 401）
    if (url.pathname.startsWith('/api/') && !OPEN_PATHS.has(url.pathname)) {
      const r = access.resolve(req);
      if (r.error) {
        if (r.status === 401) log.info('rejected', url.pathname);
        return sendJson(res, r.status, { error: r.error });
      }
      req.accessLabel = r.label;
    }
    if (req.method === 'GET' && url.pathname === '/api/me') return sendJson(res, 200, { label: req.accessLabel });
    if (req.method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, await stateSnapshot());
    if (req.method === 'POST' && url.pathname === '/api/voice/sessions') {
      const body = await readJson(req);
      return sendJson(res, 201, await createVoiceSession(body.sdp_offer));
    }
    const m = url.pathname.match(/^\/api\/voice\/sessions\/([^/]+)\/close$/);
    if (req.method === 'POST' && m) {
      if (current && current.live.id === m[1]) {
        const seconds = await current.live.close();
        return sendJson(res, 200, { closed: true, seconds });
      }
      return sendJson(res, 200, { closed: true, seconds: null });
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    const status = e.status ?? 500;
    if (status >= 500) log.error('request failed', String(e));
    return sendJson(res, status, { error: status >= 500 ? 'server error' : e.message });
  }
};

const tls = config.tlsCert && config.tlsKey ? { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) } : null;
const server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);

server.listen(config.port, () => {
  log.info(`listening on ${tls ? 'https' : 'http'} :${config.port}  dashboard=${config.dashboardApiBase}  staff=${config.chairmanStaffId}  live=${config.liveModel}  agent=${config.agentModel}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (current) await current.live.close().catch(() => {});
    process.exit(0);
  });
}
