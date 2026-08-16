/**
 * 3日間ビュー（タイムグリッド）
 * 30分刻みのスロットをタップすると、その枠で新規予約フォームが開きます。
 */

import { DOW_JA, ymd, addDays, toMin, toHHMM, hhmm, el, STATUS_LABEL, overlaps } from './util.js';
import { SLOT_MINUTES, THREE_DAY_SPAN, DEFAULT_SCROLL_HOUR, OPEN_HOUR, CLOSE_HOUR } from './config.js';

const DAY_MIN = 24 * 60;

function hourHeight() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--hour-h');
  return parseFloat(v) || 52;
}

/**
 * 重なり合う予約を横並びのレーンに割り付ける。
 * 返り値: [{ item, lane, lanes }]
 */
function layout(items) {
  const sorted = [...items].sort((a, b) => {
    const d = toMin(a.start_time) - toMin(b.start_time);
    return d !== 0 ? d : toMin(a.end_time) - toMin(b.end_time);
  });

  const placed = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const lanes = Math.max(...cluster.map((c) => c.lane)) + 1;
    cluster.forEach((c) => { c.lanes = lanes; });
    placed.push(...cluster);
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of sorted) {
    const s = toMin(item.start_time);
    const e = Math.max(toMin(item.end_time), s + SLOT_MINUTES / 2);

    if (s >= clusterEnd) flush();

    // 空いている最小のレーン番号を探す
    let lane = 0;
    while (cluster.some((c) => c.lane === lane && overlaps(s, e, c.start, c.end))) lane += 1;

    cluster.push({ item, start: s, end: e, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();

  return placed;
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {Date} ctx.anchor    表示開始日
 * @param {Map<string, object[]>} ctx.byDate
 * @param {(dateStr: string, startTime: string) => void} ctx.onSlotCreate
 * @param {(item: object) => void} ctx.onEventOpen
 * @param {(dateStr: string) => void} ctx.onDayOpen
 */
export function renderThreeDay(root, ctx) {
  const { anchor, byDate, onSlotCreate, onEventOpen, onDayOpen } = ctx;
  const hourH = hourHeight();
  const totalH = DAY_MIN / 60 * hourH;
  const todayStr = ymd(new Date());

  const days = Array.from({ length: THREE_DAY_SPAN }, (_, i) => addDays(anchor, i));

  // 再描画でスクロール位置が飛ばないよう記憶しておく
  const prevBody = root.querySelector('.three-body');
  const prevScroll = prevBody ? prevBody.scrollTop : null;

  root.replaceChildren();
  const wrap = el('div', { class: 'three' });

  /* ---- 日付ヘッダ（固定） ---- */
  const head = el('div', { class: 'three-head' });
  head.append(el('div', { class: 'three-tz', text: 'JST' }));

  for (const d of days) {
    const key = ymd(d);
    const cls = ['three-day'];
    if (key === todayStr) cls.push('is-today');
    if (d.getDay() === 0) cls.push('is-sun');
    if (d.getDay() === 6) cls.push('is-sat');

    head.append(el('div', {
      class: cls.join(' '),
      title: 'この日を先頭にする',
      onclick: () => onDayOpen(key),
    }, [
      el('div', { class: 'three-day-dow', text: DOW_JA[d.getDay()] }),
      el('div', { class: 'three-day-num', text: String(d.getDate()) }),
    ]));
  }
  wrap.append(head);

  /* ---- 本体（スクロール領域） ---- */
  const body = el('div', { class: 'three-body' });
  const canvas = el('div', { class: 'three-canvas', style: `height:${totalH}px` });

  /* 時間軸 */
  const gutter = el('div', { class: 'three-gutter' });
  for (let h = 1; h < 24; h++) {
    gutter.append(el('div', {
      class: 'hour-label',
      style: `top:${h * hourH}px`,
      text: `${h}:00`,
    }));
  }
  canvas.append(gutter);

  /* 日ごとのカラム */
  for (const d of days) {
    const key = ymd(d);
    const col = el('div', { class: `three-col${key === todayStr ? ' is-today' : ''}` });

    /* 罫線 */
    for (let h = 0; h <= 24; h++) {
      if (h < 24) {
        col.append(el('div', { class: 'half-line', style: `top:${(h + 0.5) * hourH}px` }));
      }
      col.append(el('div', { class: 'hour-line', style: `top:${h * hourH}px` }));
    }

    /* 営業時間外の薄いトーン */
    if (OPEN_HOUR > 0) {
      col.append(el('div', { class: 'off-hours', style: `top:0;height:${OPEN_HOUR * hourH}px` }));
    }
    if (CLOSE_HOUR < 24) {
      col.append(el('div', {
        class: 'off-hours',
        style: `top:${CLOSE_HOUR * hourH}px;height:${(24 - CLOSE_HOUR) * hourH}px`,
      }));
    }

    /* 30分スロット（クリックで新規作成） */
    const slotH = hourH * (SLOT_MINUTES / 60);
    for (let m = 0; m < DAY_MIN; m += SLOT_MINUTES) {
      const t = toHHMM(m);
      col.append(el('button', {
        class: 'slot',
        type: 'button',
        style: `top:${m / 60 * hourH}px;height:${slotH}px`,
        'aria-label': `${d.getMonth() + 1}月${d.getDate()}日 ${t} から予約`,
        onclick: () => onSlotCreate(key, t),
      }));
    }

    /* 現在時刻ライン */
    if (key === todayStr) {
      const now = new Date();
      const y = (now.getHours() * 60 + now.getMinutes()) / 60 * hourH;
      col.append(el('div', { class: 'now-line', style: `top:${y}px` }));
    }

    /* 予約ブロック */
    for (const p of layout(byDate.get(key) || [])) {
      const top = p.start / 60 * hourH;
      const height = Math.max((p.end - p.start) / 60 * hourH - 2, 15);
      const widthPct = 100 / p.lanes;
      const leftPct = widthPct * p.lane;
      const isShort = (p.end - p.start) <= 30;

      const evt = el('button', {
        class: `evt is-${p.item.status}${isShort ? ' is-short' : ''}`,
        type: 'button',
        style: `top:${top}px;height:${height}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px)`,
        title: `${hhmm(p.item.start_time)}–${hhmm(p.item.end_time)} ${p.item.title}（${STATUS_LABEL[p.item.status] || ''}）`,
        onclick: (e) => { e.stopPropagation(); onEventOpen(p.item); },
      }, [
        el('span', { class: 'evt-time', text: `${hhmm(p.item.start_time)}–${hhmm(p.item.end_time)}` }),
        el('span', { class: 'evt-title', text: p.item.title || '(無題)' }),
        !isShort && p.item.purpose ? el('span', { class: 'evt-purpose', text: p.item.purpose }) : null,
      ]);

      col.append(evt);
    }

    canvas.append(col);
  }

  body.append(canvas);
  wrap.append(body);
  root.append(wrap);

  /* スクロール位置の復元 / 初期位置 */
  body.scrollTop = prevScroll !== null
    ? prevScroll
    : Math.max(0, DEFAULT_SCROLL_HOUR * hourH - hourH);
}
