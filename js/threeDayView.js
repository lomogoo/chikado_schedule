/**
 * 3日間ビュー（タイムグリッド）
 *
 * 画面には 3 日ぶんが収まりますが、内部にはその前後の日も用意してあり、
 * 横スクロールでシームレスに他の日付を確認できます。
 * 30分刻みのスロットをタップすると、その枠で新規予約フォームが開きます。
 *
 * 日をまたぐ予約は、初日は開始時刻から 24:00 まで、中日は上部の「終日」帯に、
 * 最終日は 0:00 から終了時刻まで、という形で描画されます。
 */

import {
  DOW_JA, ymd, toHHMM, el, STATUS_LABEL, overlaps, eachDate, daySpan, formatSpanJa,
} from './util.js';
import { SLOT_MINUTES, VISIBLE_DAYS, DEFAULT_SCROLL_HOUR, OPEN_HOUR, CLOSE_HOUR } from './config.js';

const DAY_MIN = 24 * 60;
const EDGE_PX = 240;
const MIN_COL_W = 96;
const AD_BAR_H = 18;
const AD_MAX_LANES = 3;

function cssPx(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseFloat(v) || fallback;
}

/** 重なり合う予約を横並びのレーンに割り付ける */
function layout(entries) {
  const sorted = [...entries].sort((a, b) => (a.start - b.start) || (a.end - b.end));

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

  for (const entry of sorted) {
    if (entry.start >= clusterEnd) flush();

    let lane = 0;
    while (cluster.some((c) => c.lane === lane && overlaps(entry.start, entry.end, c.start, c.end))) lane += 1;

    cluster.push({ ...entry, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  flush();
  return placed;
}

/**
 * 「終日」帯に載せる区間を抽出してレーンを決める。
 * 中日（0:00〜24:00 を占める日）が連続している範囲を 1 本の帯として扱う。
 */
function allDayLayout(dayKeys, byDate) {
  const segs = new Map();

  for (const key of dayKeys) {
    for (const item of byDate.get(key) || []) {
      if (!daySpan(item, key).full) continue;
      const cur = segs.get(item.id);
      if (!cur) segs.set(item.id, { item, from: key, to: key });
      else cur.to = key;
    }
  }

  const list = [...segs.values()]
    .sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to));

  const laneEnds = [];
  for (const seg of list) {
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] >= seg.from) lane += 1;
    laneEnds[lane] = seg.to;
    seg.lane = lane;
  }

  return { list, laneCount: laneEnds.length };
}

function dayIndexLabel(item, dateStr) {
  const days = eachDate(item.start_date, item.end_date);
  if (days.length <= 1) return '';
  const i = days.indexOf(dateStr);
  return i < 0 ? '' : `${i + 1}/${days.length}日目`;
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {Date[]} ctx.days   横に並べる日付（連続していること）
 * @param {Map<string, object[]>} ctx.byDate
 * @param {string} ctx.todayStr
 * @param {(dateStr: string, startTime: string) => void} ctx.onSlotCreate
 * @param {(item: object) => void} ctx.onEventOpen
 * @param {(dateStr: string) => void} ctx.onDayOpen
 * @param {(edge: 'left'|'right') => void} ctx.onEdge
 * @param {(firstKey: string) => void} ctx.onVisibleDays
 */
export function renderDayStrip(root, ctx) {
  const { days, byDate, todayStr, onSlotCreate, onEventOpen, onDayOpen } = ctx;

  const hourH = cssPx('--hour-h', 52);
  const gutterW = cssPx('--gutter-w', 54);
  const totalH = DAY_MIN / 60 * hourH;
  const dayKeys = days.map(ymd);

  root.replaceChildren();
  const wrap = el('div', { class: 'three' });
  const scroller = el('div', { class: 'three-scroll' });

  // 3 日が画面幅にちょうど収まる列幅を先に決める
  const avail = (root.clientWidth || window.innerWidth) - gutterW;
  const colW = Math.max(MIN_COL_W, Math.floor(avail / VISIBLE_DAYS));
  const template = `${gutterW}px repeat(${days.length}, ${colW}px)`;

  const inner = el('div', {
    class: 'three-inner',
    style: `width:${gutterW + colW * days.length}px`,
  });

  const ad = allDayLayout(dayKeys, byDate);
  const adLanes = Math.min(ad.laneCount, AD_MAX_LANES);
  const adHeight = adLanes ? adLanes * AD_BAR_H + 6 : 22;

  /* ---- ヘッダ（日付＋終日帯。上に固定・横スクロールに追従） ---- */
  const head = el('div', { class: 'three-head' });

  const headDays = el('div', { class: 'three-head-days', style: `grid-template-columns:${template}` });
  headDays.append(el('div', { class: 'three-tz', text: 'JST' }));

  for (const d of days) {
    const key = ymd(d);
    const cls = ['three-day'];
    if (key === todayStr) cls.push('is-today');
    if (d.getDay() === 0) cls.push('is-sun');
    if (d.getDay() === 6) cls.push('is-sat');

    headDays.append(el('div', {
      class: cls.join(' '),
      dataset: { day: key },
      title: 'この日を先頭にする',
      onclick: () => onDayOpen(key),
    }, [
      el('div', { class: 'three-day-dow', text: DOW_JA[d.getDay()] }),
      el('div', { class: 'three-day-num', text: String(d.getDate()) }),
      d.getDate() === 1 ? el('div', { class: 'three-day-mon', text: `${d.getMonth() + 1}月` }) : null,
    ]));
  }
  head.append(headDays);

  /* 終日帯 */
  const adRow = el('div', {
    class: 'three-allday',
    style: `grid-template-columns:${template};height:${adHeight}px`,
  });
  adRow.append(el('div', { class: 'three-ad-tz', text: '終日' }));

  for (const key of dayKeys) {
    const col = el('div', { class: 'ad-col', dataset: { day: key } });
    for (const seg of ad.list) {
      if (key < seg.from || key > seg.to) continue;
      if (seg.lane >= AD_MAX_LANES) continue;
      const isHead = key === seg.from || key === dayKeys[0];
      const cls = ['ad-bar', `is-${seg.item.status}`];
      if (seg.item.__urgent) cls.push('is-urgent');
      if (key === seg.from) cls.push('is-start');
      if (key === seg.to) cls.push('is-end');

      col.append(el('button', {
        class: cls.join(' '),
        type: 'button',
        style: `top:${seg.lane * AD_BAR_H + 2}px`,
        title: `${formatSpanJa(seg.item)}　${seg.item.title}`,
        onclick: (e) => { e.stopPropagation(); onEventOpen(seg.item); },
      }, isHead ? [el('span', { class: 'ad-bar-title', text: seg.item.title || '(無題)' })] : []));
    }
    if (ad.laneCount > AD_MAX_LANES) {
      const hidden = ad.list.filter((s) => s.lane >= AD_MAX_LANES && key >= s.from && key <= s.to).length;
      if (hidden) col.append(el('span', { class: 'ad-more', text: `+${hidden}` }));
    }
    adRow.append(col);
  }
  head.append(adRow);
  inner.append(head);

  /* ---- タイムグリッド本体 ---- */
  const body = el('div', {
    class: 'three-body',
    style: `grid-template-columns:${template};height:${totalH}px`,
  });

  const gutter = el('div', { class: 'three-gutter' });
  for (let h = 1; h < 24; h++) {
    gutter.append(el('div', { class: 'hour-label', style: `top:${h * hourH}px`, text: `${h}:00` }));
  }
  body.append(gutter);

  const slotH = hourH * (SLOT_MINUTES / 60);

  for (const d of days) {
    const key = ymd(d);
    const col = el('div', {
      class: `three-col${key === todayStr ? ' is-today' : ''}`,
      dataset: { day: key },
    });

    for (let h = 0; h <= 24; h++) {
      if (h < 24) col.append(el('div', { class: 'half-line', style: `top:${(h + 0.5) * hourH}px` }));
      col.append(el('div', { class: 'hour-line', style: `top:${h * hourH}px` }));
    }

    if (OPEN_HOUR > 0) {
      col.append(el('div', { class: 'off-hours', style: `top:0;height:${OPEN_HOUR * hourH}px` }));
    }
    if (CLOSE_HOUR < 24) {
      col.append(el('div', {
        class: 'off-hours',
        style: `top:${CLOSE_HOUR * hourH}px;height:${(24 - CLOSE_HOUR) * hourH}px`,
      }));
    }

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

    if (key === todayStr) {
      const now = new Date();
      col.append(el('div', {
        class: 'now-line',
        style: `top:${(now.getHours() * 60 + now.getMinutes()) / 60 * hourH}px`,
      }));
    }

    /* 終日帯に出したものを除いた予定を、時間帯ブロックとして描く */
    const entries = (byDate.get(key) || [])
      .map((item) => ({ item, ...daySpan(item, key) }))
      .filter((e) => !e.full);

    for (const p of layout(entries)) {
      const top = p.start / 60 * hourH;
      const height = Math.max((p.end - p.start) / 60 * hourH - 2, 15);
      const widthPct = 100 / p.lanes;
      const leftPct = widthPct * p.lane;
      const isShort = (p.end - p.start) <= 30;
      const idx = dayIndexLabel(p.item, key);

      const cls = ['evt', `is-${p.item.status}`];
      if (isShort) cls.push('is-short');
      if (p.item.__urgent) cls.push('is-urgent');

      col.append(el('button', {
        class: cls.join(' '),
        type: 'button',
        style: `top:${top}px;height:${height}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px)`,
        title: `${formatSpanJa(p.item)}　${p.item.title}（${STATUS_LABEL[p.item.status] || ''}）`,
        onclick: (e) => { e.stopPropagation(); onEventOpen(p.item); },
      }, [
        el('span', {
          class: 'evt-time',
          text: `${toHHMM(p.start)}–${p.end === DAY_MIN ? '24:00' : toHHMM(p.end)}`,
        }),
        el('span', { class: 'evt-title' }, [
          p.item.__urgent ? el('i', { class: 'evt-flag', text: '!' }) : null,
          document.createTextNode(p.item.title || '(無題)'),
        ]),
        !isShort && idx ? el('span', { class: 'evt-idx', text: idx }) : null,
        !isShort && p.item.purpose ? el('span', { class: 'evt-purpose', text: p.item.purpose }) : null,
      ]));
    }

    body.append(col);
  }

  inner.append(body);
  scroller.append(inner);
  wrap.append(scroller);
  root.append(wrap);

  scroller.scrollTop = Math.max(0, DEFAULT_SCROLL_HOUR * hourH - hourH);

  let ticking = false;
  let lastFirst = '';
  scroller.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const idx = Math.round(scroller.scrollLeft / colW);
      const first = days[Math.min(Math.max(idx, 0), days.length - 1)];
      const key = first ? ymd(first) : '';
      if (key && key !== lastFirst) {
        lastFirst = key;
        ctx.onVisibleDays?.(key);
      }
      if (scroller.scrollLeft < EDGE_PX) ctx.onEdge?.('left');
      else if (scroller.scrollLeft + scroller.clientWidth > scroller.scrollWidth - EDGE_PX) ctx.onEdge?.('right');
    });
  }, { passive: true });
}

/* ------------------------------------------------------- スクロール位置 */

export function captureStripScroll(root) {
  const scroller = root.querySelector('.three-scroll');
  if (!scroller) return null;
  const cols = [...scroller.querySelectorAll('.three-col')];
  const left = scroller.scrollLeft;
  let col = cols[0];
  for (const c of cols) {
    if (c.offsetLeft <= left + 4) col = c;
    else break;
  }
  return col
    ? { key: col.dataset.day, offsetX: left - col.offsetLeft, top: scroller.scrollTop }
    : { key: null, offsetX: 0, top: scroller.scrollTop };
}

export function restoreStripScroll(root, saved) {
  if (!saved) return;
  const scroller = root.querySelector('.three-scroll');
  if (!scroller) return;
  scroller.scrollTop = saved.top;
  if (!saved.key) return;
  const col = scroller.querySelector(`.three-col[data-day="${saved.key}"]`);
  if (col) scroller.scrollLeft = col.offsetLeft + saved.offsetX;
}

export function scrollToDay(root, key, { smooth = false } = {}) {
  const scroller = root.querySelector('.three-scroll');
  const col = scroller?.querySelector(`.three-col[data-day="${key}"]`);
  if (!scroller || !col) return false;
  scroller.scrollTo({ left: col.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
  return true;
}

/** 現在の左端の日付キーを返す */
export function currentFirstDay(root) {
  const scroller = root.querySelector('.three-scroll');
  if (!scroller) return null;
  const cols = [...scroller.querySelectorAll('.three-col')];
  const left = scroller.scrollLeft;
  let col = cols[0];
  for (const c of cols) {
    if (c.offsetLeft <= left + 4) col = c;
    else break;
  }
  return col?.dataset.day || null;
}
