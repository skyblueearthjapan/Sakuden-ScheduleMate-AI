// 所在ダッシュボード（sakurai-dashboard）の HTTP API クライアント。
// SQLite に直接書かない: API 経由でないと SSE 通知が飛ばず、開いている画面が更新されない。
import { config } from './config.mjs';

const TIMEOUT_MS = 8000;

async function call(method, path, body) {
  const res = await fetch(`${config.dashboardApiBase}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`dashboard ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** 会長のスタッフ行（events を含む）。 */
export async function chairman() {
  const staff = await call('GET', '/staff');
  const row = staff.find((s) => s.id === config.chairmanStaffId);
  if (!row) throw new Error(`staff ${config.chairmanStaffId} not found on dashboard`);
  return row;
}

/** from 以降（連日予定は終了日が from 以降）の予定を日付順で。 */
export async function upcomingEvents(from, to) {
  const row = await chairman();
  return (row.events || [])
    .filter((e) => (e.endDate || e.date) >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99'));
}

export function addEvent(ev) {
  // EventIn: date, endDate?, title(<=120), time?, kind(訪問/工事/社内/休み/その他)
  return call('POST', `/staff/${config.chairmanStaffId}/events`, {
    date: ev.date,
    endDate: ev.endDate ?? null,
    title: String(ev.title).slice(0, 120),
    time: ev.time ?? null,
    kind: ev.kind,
  });
}

export async function deleteEvent(eventId) {
  try {
    await call('DELETE', `/staff/${config.chairmanStaffId}/events/${eventId}`);
  } catch (e) {
    if (!String(e.message).includes('404')) throw e; // もう無いなら消えている
  }
}

/** 全スタッフの予定 title から客先名（「/」の前）を集める。聞き取りの表記ゆれ（リョウワ→菱和産業）を寄せるための参考。 */
export async function knownNames() {
  const staff = await call('GET', '/staff');
  const counts = new Map();
  for (const s of staff) for (const e of s.events || []) {
    const name = String(e.title).split(/[\/／(（]/)[0].trim();
    if (name && name.length <= 20 && !/休み|休暇/.test(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([n]) => n);
}

export async function health() {
  const res = await fetch(`${config.dashboardApiBase}/health`, { signal: AbortSignal.timeout(3000) });
  return res.ok;
}
