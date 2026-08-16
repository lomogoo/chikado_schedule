/**
 * 月別ビュー
 *
 * 月ブロックを縦に連ねて描画し、下端までスクロールすると翌月、
 * 上端までスクロールすると前月が継ぎ足されます。
 */

import { DOW_JA, ymd, monthCells, monthKey, monthLabel, hhmm, el, STATUS_LABEL, eachDate } from './util.js';

const MAX_CHIPS_DESKTOP = 3;
const MAX_CHIPS_MOBILE = 2;
const EDGE_PX = 320;

function maxChips() {
  return window.matchMedia('(max-width: 720px)').matches ? MAX_CHIPS_MOBILE : MAX_CHIPS_DESKTOP;
}

/** 複数日予約のとき「2/4」のような通し番号を返す */
function dayIndexLabel(item, dateStr) {
  const days = eachDate(item.start_date, item.end_date);
  if (days.length <= 1) return '';
  const i = days.indexOf(dateStr);
  return i < 0 ? '' : `${i + 1}/${days.length}`;
}

function buildChip(item, dateStr, onEventOpen) {
  const idx = dayIndexLabel(item, dateStr);
  const cls = ['mchip', `is-${item.status}`];
  if (item.__urgent) cls.push('is-urgent');

  return el('button', {
    class: cls.join(' '),
    type: 'button',
    title: `${hhmm(item.start_time)}–${hhmm(item.end_time)} ${item.title}（${STATUS_LABEL[item.status] || ''}）`,
    onclick: (e) => { e.stopPropagation(); onEventOpen(item); },
  }, [
    item.__urgent ? el('i', { class: 'mchip-flag', text: '!' }) : null,
    el('span', { class: 'mchip-time', text: hhmm(item.start_time) }),
    el('span', { class: 'mchip-title', text: item.title || '(無題)' }),
    idx ? el('span', { class: 'mchip-idx', text: idx }) : null,
  ]);
}

function buildMonthBlock(monthDate, ctx) {
  const { byDate, todayStr, onEventOpen, onDayOpen, onDayCreate } = ctx;
  const month = monthDate.getMonth();
  const limit = maxChips();

  const block = el('section', {
    class: 'month-block',
    dataset: { month: monthKey(monthDate) },
  });

  block.append(el('div', { class: 'month-block-head' }, [
    el('span', { class: 'month-block-title', text: monthLabel(monthDate) }),
  ]));

  const grid = el('div', { class: 'month-grid' });

  for (const date of monthCells(monthDate)) {
    // 月をまたいだセルは空欄にする。
    // （縦に月を連ねるレイアウトでは、隣の月のブロックと日付が重複してしまうため）
    if (date.getMonth() !== month) {
      grid.append(el('div', { class: 'mcell is-blank', 'aria-hidden': 'true' }));
      continue;
    }

    const key = ymd(date);
    const items = byDate.get(key) || [];
    const dow = date.getDay();

    const classes = ['mcell'];
    if (key === todayStr) classes.push('is-today');
    if (dow === 0) classes.push('is-sun');
    if (dow === 6) classes.push('is-sat');

    const cell = el('div', {
      class: classes.join(' '),
      role: 'gridcell',
      tabindex: '0',
      'aria-label': `${date.getMonth() + 1}月${date.getDate()}日 予約${items.length}件`,
    });

    cell.addEventListener('click', (e) => {
      if (e.target.closest('.mchip, .mchip-more, .mcell-num')) return;
      onDayCreate(key);
    });
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayCreate(key); }
    });

    cell.append(el('div', { class: 'mcell-head' }, [
      el('button', {
        class: 'mcell-num',
        type: 'button',
        title: 'この日から3日間ビューで開く',
        text: String(date.getDate()),
        onclick: (e) => { e.stopPropagation(); onDayOpen(key); },
      }),
      items.length ? el('span', { class: 'mcell-count', text: `${items.length}件` }) : null,
    ]));

    const body = el('div', { class: 'mcell-body' });
    items.slice(0, limit).forEach((item) => body.append(buildChip(item, key, onEventOpen)));

    if (items.length > limit) {
      body.append(el('button', {
        class: 'mchip-more',
        type: 'button',
        text: `他 ${items.length - limit} 件`,
        onclick: (e) => { e.stopPropagation(); onDayOpen(key); },
      }));
    }

    cell.append(body);
    grid.append(cell);
  }

  block.append(grid);
  return block;
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {Date[]} ctx.months        表示する月（1日の Date）の配列。連続していること
 * @param {Map<string, object[]>} ctx.byDate
 * @param {string} ctx.todayStr
 * @param {(item: object) => void} ctx.onEventOpen
 * @param {(dateStr: string) => void} ctx.onDayOpen
 * @param {(dateStr: string) => void} ctx.onDayCreate
 * @param {(edge: 'top'|'bottom') => void} ctx.onEdge
 * @param {(key: string) => void} ctx.onVisibleMonth
 */
export function renderMonths(root, ctx) {
  root.replaceChildren();

  const wrap = el('div', { class: 'month' });

  const dow = el('div', { class: 'month-dow' });
  DOW_JA.forEach((d, i) => {
    dow.append(el('span', { text: d, class: i === 0 ? 'is-sun' : i === 6 ? 'is-sat' : '' }));
  });
  wrap.append(dow);

  const scroller = el('div', { class: 'month-scroll' });
  for (const m of ctx.months) scroller.append(buildMonthBlock(m, ctx));
  wrap.append(scroller);
  root.append(wrap);

  let ticking = false;
  let lastMonth = '';
  scroller.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const key = visibleMonthKey(scroller);
      if (key && key !== lastMonth) {
        lastMonth = key;
        ctx.onVisibleMonth?.(key);
      }
      if (scroller.scrollTop < EDGE_PX) ctx.onEdge?.('top');
      else if (scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - EDGE_PX) ctx.onEdge?.('bottom');
    });
  }, { passive: true });
}

function visibleMonthKey(scroller) {
  const top = scroller.scrollTop + 40;
  let key = null;
  for (const b of scroller.querySelectorAll('.month-block')) {
    if (b.offsetTop <= top) key = b.dataset.month;
    else break;
  }
  return key || scroller.querySelector('.month-block')?.dataset.month || null;
}

/* ------------------------------------------------------- スクロール位置 */

export function captureMonthScroll(root) {
  const scroller = root.querySelector('.month-scroll');
  if (!scroller) return null;
  const top = scroller.scrollTop;
  let block = null;
  for (const b of scroller.querySelectorAll('.month-block')) {
    if (b.offsetTop <= top + 4) block = b;
    else break;
  }
  block = block || scroller.querySelector('.month-block');
  return block ? { key: block.dataset.month, offset: top - block.offsetTop } : null;
}

export function restoreMonthScroll(root, saved) {
  if (!saved) return;
  const scroller = root.querySelector('.month-scroll');
  const block = scroller?.querySelector(`.month-block[data-month="${saved.key}"]`);
  if (scroller && block) scroller.scrollTop = block.offsetTop + saved.offset;
}

export function scrollToMonth(root, key, { smooth = false } = {}) {
  const scroller = root.querySelector('.month-scroll');
  const block = scroller?.querySelector(`.month-block[data-month="${key}"]`);
  if (!scroller || !block) return false;
  scroller.scrollTo({ top: block.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
  return true;
}
