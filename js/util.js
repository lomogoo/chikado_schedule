/**
 * 日付・時刻まわりのユーティリティ。
 *
 * このアプリは日付を `YYYY-MM-DD`、時刻を `HH:MM` の「ローカル値」として扱います。
 * DB 側も date / time 型で持つため、タイムゾーン変換は一切発生しません
 * （施設予約は常に現地時間で運用されるため、この方が事故が起きません）。
 */

import { SLOT_MINUTES } from './config.js';

export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

/* ------------------------------------------------------------------ 日付 */

/** Date → 'YYYY-MM-DD'（ローカル） */
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' → Date（ローカル 0:00） */
export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d, n) {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() + n);
  return c;
}

export function addMonths(d, n) {
  const c = new Date(d.getFullYear(), d.getMonth(), 1);
  c.setMonth(c.getMonth() + n);
  return c;
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** 月別ビューのマス目（日曜始まりで 6 週ぶん = 42 日）を返す */
export function monthMatrix(d) {
  const first = startOfMonth(d);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function todayYmd() {
  return ymd(new Date());
}

/* ------------------------------------------------------------------ 時刻 */

/** 'HH:MM' / 'HH:MM:SS' → 0:00 からの分数 */
export function toMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 分数 → 'HH:MM'（24:00 も許容） */
export function toHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** DB から来た 'HH:MM:SS' を表示用の 'HH:MM' に落とす */
export function hhmm(t) {
  return toHHMM(toMin(t));
}

/** 00:00 〜 24:00 を SLOT_MINUTES 刻みで返す */
export function slotOptions({ includeMidnightEnd = false } = {}) {
  const out = [];
  const last = includeMidnightEnd ? 24 * 60 : 24 * 60 - SLOT_MINUTES;
  for (let m = 0; m <= last; m += SLOT_MINUTES) out.push(toHHMM(m));
  return out;
}

/** 分数 → 「2時間30分」 */
export function durationLabel(min) {
  if (min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
}

/* ------------------------------------------------------------------ 表示 */

export function formatDateJa(dateStr, { withDow = true } = {}) {
  const d = parseYmd(dateStr);
  const base = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withDow ? `${base}（${DOW_JA[d.getDay()]}）` : base;
}

export const STATUS_LABEL = {
  confirmed: '本予約',
  tentative: '仮予約',
};

/* ------------------------------------------------------------------ 汎用 */

/** テキストを DOM に安全に流し込むための最小ヘルパー */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c);
  }
  return node;
}

/** 2 つの区間（分）が重なっているか */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
