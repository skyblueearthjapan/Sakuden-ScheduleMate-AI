// 日付はすべて Asia/Tokyo の暦日文字列（YYYY-MM-DD）で扱う。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });

export const tokyoDate = (d = new Date()) => fmt.format(d); // "2026-09-14"
export const tokyoTime = (d = new Date()) => timeFmt.format(d); // "09:03"

const parts = (iso) => iso.split('-').map(Number);
const isoOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** 暦日の加算。UTC の日付成分だけで計算するのでタイムゾーンの影響を受けない */
export const addDays = (iso, n) => {
  const [y, m, d] = parts(iso);
  return isoOf(new Date(Date.UTC(y, m - 1, d + n)));
};

export const weekday = (iso) => {
  const [y, m, d] = parts(iso);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
};

/** "9月15日（火）" */
export const label = (iso) => {
  const [, m, d] = iso.split('-');
  return `${Number(m)}月${Number(d)}日（${weekday(iso)}）`;
};

/** 今日から n 日ぶんの「日付 曜日」一覧（判断モデルが「木曜」「明後日」を解決するための表） */
export const calendarTable = (today, n = 21) =>
  Array.from({ length: n }, (_, i) => {
    const iso = addDays(today, i);
    const rel = i === 0 ? '今日' : i === 1 ? '明日' : i === 2 ? '明後日' : `${i}日後`;
    return `${iso} ${weekday(iso)}曜 ${rel}`;
  }).join('\n');
