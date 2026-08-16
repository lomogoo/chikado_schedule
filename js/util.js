/**
 * 日付・時刻まわりのユーティリティ。
 *
 * このアプリは日付を `YYYY-MM-DD`、時刻を `HH:MM` の「ローカル値」として扱います。
 * DB 側も date / time 型で持つため、タイムゾーン変換は一切発生しません
 * （施設予約は常に現地時間で運用されるため、この方が事故が起きません）。
 *
 * 予約は「`start_date` の `start_time` から `end_date` の `end_time` まで**連続して**
 * 施設を使う」というモデルです。日をまたぐ利用もそのまま表現できます。
 */

import { SLOT_MINUTES } from './config.js';

export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

const MS_PER_DAY = 86_400_000;
const DAY_MIN = 24 * 60;

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
  const last = includeMidnightEnd ? DAY_MIN : DAY_MIN - SLOT_MINUTES;
  for (let m = 0; m <= last; m += SLOT_MINUTES) out.push(toHHMM(m));
  return out;
}

/** 分数 → 「2時間30分」 */
export function durationLabel(min) {
  if (min <= 0) return '';
  const d = Math.floor(min / DAY_MIN);
  const h = Math.floor((min % DAY_MIN) / 60);
  const m = min % 60;
  const parts = [];
  if (d) parts.push(`${d}日`);
  if (h) parts.push(`${h}時間`);
  if (m) parts.push(`${m}分`);
  return parts.join('') || '0分';
}

/* ------------------------------------------------------------- 期間モデル */

/** 予約の終了日（未設定なら開始日と同じ扱い） */
export function endDateOf(item) {
  return item.end_date && item.end_date >= item.start_date ? item.end_date : item.start_date;
}

/** 比較用のタイムスタンプ文字列（'2026-08-05T15:00'）。文字列比較で前後関係が正しく出る */
export function stampOf(dateStr, timeStr) {
  return `${dateStr}T${hhmm(timeStr)}`;
}

export function itemStart(item) {
  return stampOf(item.start_date, item.start_time);
}

export function itemEnd(item) {
  return stampOf(endDateOf(item), item.end_time);
}

/** 開始から終了までの総分数 */
export function totalMinutes(item) {
  return daysDiff(item.start_date, endDateOf(item)) * DAY_MIN
    + toMin(item.end_time) - toMin(item.start_time);
}

export function isAllDay(item) {
  return hhmm(item.start_time) === '00:00' && hhmm(item.end_time) === '24:00';
}

/**
 * ある日について、その予約が占める時間帯（分）を返す。
 * 中日は 0:00〜24:00、初日は start_time から、最終日は end_time まで。
 */
export function daySpan(item, dateStr) {
  const last = endDateOf(item);
  const isFirst = dateStr === item.start_date;
  const isLast = dateStr === last;
  const start = isFirst ? toMin(item.start_time) : 0;
  const end = isLast ? toMin(item.end_time) : DAY_MIN;
  return { start, end, isFirst, isLast, full: start === 0 && end === DAY_MIN };
}

/** カレンダーのチップに出す時刻ラベル */
export function dayTimeLabel(item, dateStr) {
  const sp = daySpan(item, dateStr);
  if (sp.full) return '終日';
  if (sp.isFirst && !sp.isLast) return `${toHHMM(sp.start)}〜`;
  if (!sp.isFirst && sp.isLast) return `〜${toHHMM(sp.end)}`;
  return toHHMM(sp.start);
}

/** 予約が指定日にかかっているか */
export function coversDate(item, dateStr) {
  return item.start_date <= dateStr && dateStr <= endDateOf(item);
}

/**
 * 仮予約のまま実施が迫っているか。
 * @returns {number|null} 実施開始日までの残り日数（対象外なら null）
 */
export function urgencyDays(item, todayStr, threshold) {
  if (item.status !== 'tentative') return null;
  if (endDateOf(item) < todayStr) return null;      // 終了済みは対象外
  const d = daysDiff(todayStr, item.start_date);
  if (d > threshold) return null;
  return Math.max(d, 0);
}

/* ------------------------------------------------------------------ 表示 */

export function formatDateJa(dateStr, { withDow = true } = {}) {
  const d = parseYmd(dateStr);
  const base = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withDow ? `${base}（${DOW_JA[d.getDay()]}）` : base;
}

function shortDateJa(dateStr, refStr) {
  const d = parseYmd(dateStr);
  const r = parseYmd(refStr);
  const head = d.getFullYear() === r.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${head}（${DOW_JA[d.getDay()]}）`;
}

/** 「2026年8月5日（水） 15:00 → 8月8日（土） 22:00」 */
export function formatSpanJa(item) {
  const last = endDateOf(item);
  const allDay = isAllDay(item);
  const head = formatDateJa(item.start_date);

  if (last === item.start_date) {
    return allDay ? `${head}　終日` : `${head}　${hhmm(item.start_time)} – ${hhmm(item.end_time)}`;
  }
  const tail = shortDateJa(last, item.start_date);
  return allDay
    ? `${head} – ${tail}　終日`
    : `${head} ${hhmm(item.start_time)} → ${tail} ${hhmm(item.end_time)}`;
}

export const STATUS_LABEL = {
  confirmed: '本予約',
  tentative: '仮予約',
};

export const INQUIRY_STATUS_LABEL = {
  open: '相談中',
  scheduled: '日程確定',
  closed: '見送り',
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

/** 2 つの区間が重なっているか（数値でも比較可能な文字列でも可） */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** 文字列から安定した小さな整数を作る（付箋の傾きや色の決定に使用） */
export function hashCode(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = (h * 31 + String(str).charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
