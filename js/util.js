/**
 * 日付・時刻まわりのユーティリティ。
 *
 * このアプリは日付を `YYYY-MM-DD`、時刻を `HH:MM` の「ローカル値」として扱います。
 * DB 側も date / time 型で持つため、タイムゾーン変換は一切発生しません
 * （施設予約は常に現地時間で運用されるため、この方が事故が起きません）。
 *
 * 予約は `start_date` 〜 `end_date` の各日を `start_time` 〜 `end_time` で使う、
 * という「期間 × 毎日の時間帯」モデルです。
 */

import { SLOT_MINUTES } from './config.js';

export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

const MS_PER_DAY = 86_400_000;

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

/** その月を表示するのに必要な週（日曜始まり）の日付をすべて返す */
export function monthCells(d) {
  const first = startOfMonth(d);
  const last = endOfMonth(d);
  const start = addDays(first, -first.getDay());
  const end = addDays(last, 6 - last.getDay());
  const out = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

export function todayYmd() {
  return ymd(new Date());
}

/** b - a を日数で返す（どちらも 'YYYY-MM-DD'） */
export function daysDiff(aStr, bStr) {
  return Math.round((parseYmd(bStr) - parseYmd(aStr)) / MS_PER_DAY);
}

/** start 〜 end（両端含む）の日付文字列を返す */
export function eachDate(startStr, endStr, cap = 400) {
  const out = [];
  if (!startStr) return out;
  const end = endStr && endStr >= startStr ? endStr : startStr;
  let cur = parseYmd(startStr);
  const last = parseYmd(end);
  while (cur <= last && out.length < cap) {
    out.push(ymd(cur));
    cur = addDays(cur, 1);
  }
  return out;
}

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
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

/** 期間の見出し。同日なら 1 つだけ、同月内なら「日」だけを省略表記にする */
export function formatDateRangeJa(startStr, endStr) {
  if (!endStr || endStr === startStr) return formatDateJa(startStr);
  const a = parseYmd(startStr);
  const b = parseYmd(endStr);
  const head = formatDateJa(startStr);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${head} – ${b.getDate()}日（${DOW_JA[b.getDay()]}）`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${head} – ${b.getMonth() + 1}月${b.getDate()}日（${DOW_JA[b.getDay()]}）`;
  }
  return `${head} – ${formatDateJa(endStr)}`;
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

/** 予約が指定日にかかっているか */
export function coversDate(item, dateStr) {
  const end = item.end_date && item.end_date >= item.start_date ? item.end_date : item.start_date;
  return item.start_date <= dateStr && dateStr <= end;
}

/**
 * 仮予約のまま実施が迫っているか。
 * @returns {number|null} 実施開始日までの残り日数（対象外なら null）
 */
export function urgencyDays(item, todayStr, threshold) {
  if (item.status !== 'tentative') return null;
  const endStr = item.end_date && item.end_date >= item.start_date ? item.end_date : item.start_date;
  if (endStr < todayStr) return null;                 // 終了済みは対象外
  const d = daysDiff(todayStr, item.start_date);
  if (d > threshold) return null;
  return Math.max(d, 0);
}
