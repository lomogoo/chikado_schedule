/**
 * 月別ビュー
 *
 * 1 画面に 1 か月がぴったり収まり、縦スクロールで月がスナップして切り替わります
 * （YouTube Shorts のような送り心地）。月の途中で止まることはありません。
 */

import {
  DOW_JA, ymd, monthCells, monthKey, monthLabel, dayTimeLabel,
  el, STATUS_LABEL, eachDate, formatSpanJa,
} from './util.js';

/* レイアウト実測に使う概算値（CSS と合わせている） */
const M = {
  desktop: { dow: 34, head: 30, cellHead: 22, cellPad: 14, chip: 19 },
  mobile: { dow: 30, head: 26, cellHead: 18, cellPad: 10, chip: 15 },
};

function metrics() {
  return window.matchMedia('(max-width: 720px)').matches ? M.mobile : M.desktop;
}

/** 1 セルに収まるチップ数を、実際の高さから割り出す */
function chipCapacity(rootHeight, weeks) {
  const m = metrics();
  const cellH = (rootHeight - m.dow - m.head) / weeks;
  const usable = cellH - m.cellHead - m.cellPad;
  return Math.max(1, Math.min(6, Math.floor(usable / m.chip)));
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
    title: `${formatSpanJa(item)}　${item.title}（${STATUS_LABEL[item.status] || ''}）`,
    onclick: (e) => { e.stopPropagation(); onEventOpen(item); },
  }, [
    item.__urgent ? el('i', { class: 'mchip-flag', text: '!' }) : null,
    el('span', { class: 'mchip-time', text: dayTimeLabel(item, dateStr) }),
    el('span', { class: 'mchip-title', text: item.title || '(無題)' }),
    idx ? el('span', { class: 'mchip-idx', text: idx }) : null,
  ]);
}

function buildMonthBlock(monthDate, ctx, rootHeight) {
  const { byDate, todayStr, onEventOpen, onDayOpen, onDayCreate } = ctx;
  const month = monthDate.getMonth();
  const cells = monthCells(monthDate);
  const weeks = cells.length / 7;
  const limit = chipCapacity(rootHeight, weeks);

  const block = el('section', {
    class: 'month-block',
    dataset: { month: monthKey(monthDate) },
  });

  block.append(el('div', { class: 'month-block-head' }, [
    el('span', { class: 'month-block-title', text: monthLabel(monthDate) }),
  ]));

  const grid = el('div', {
    class: 'month-grid',
    style: `grid-template-rows:repeat(${weeks},minmax(0,1fr))`,
  });

  for (const date of cells) {
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
    // 収まらないときは最後の 1 行を「他 N 件」に使う
    const showCount = items.length > limit ? Math.max(limit - 1, 1) : items.length;
    items.slice(0, showCount).forEach((item) => body.append(buildChip(item, key, onEventOpen)));

    if (items.length > showCount) {
      body.append(el('button', {
        class: 'mchip-more',
        type: 'button',
        text: `他 ${items.length - showCount} 件`,
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
 * @param {(key: string) => void} ctx.onVisibleMonth
 */
export function renderMonths(root, ctx) {
  const rootHeight = root.clientHeight || window.innerHeight - 120;
  root.replaceChildren();

  const wrap = el('div', { class: 'month' });

  const dow = el('div', { class: 'month-dow' });
  DOW_JA.forEach((d, i) => {
    dow.append(el('span', { text: d, class: i === 0 ? 'is-sun' : i === 6 ? 'is-sat' : '' }));
  });
  wrap.append(dow);

  const scroller = el('div', { class: 'month-scroll' });
  for (const m of ctx.months) scroller.append(buildMonthBlock(m, ctx, rootHeight));
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
    });
  }, { passive: true });
}

/** スクロール位置から「いま見えている月」を決める（1画面1か月なので中央で判定） */
function visibleMonthKey(scroller) {
  const center = scroller.scrollTop + scroller.clientHeight / 2;
  let key = null;
  for (const b of scroller.querySelectorAll('.month-block')) {
    if (b.offsetTop <= center) key = b.dataset.month;
    else break;
  }
  return key || scroller.querySelector('.month-block')?.dataset.month || null;
}

/* ------------------------------------------------------- スクロール位置 */

export function captureMonthScroll(root) {
  const scroller = root.querySelector('.month-scroll');
  if (!scroller) return null;
  const key = visibleMonthKey(scroller);
  return key ? { key } : null;
}

export function restoreMonthScroll(root, saved) {
  if (!saved) return;
  scrollToMonth(root, saved.key);
}

export function scrollToMonth(root, key, { smooth = false } = {}) {
  const scroller = root.querySelector('.month-scroll');
  const block = scroller?.querySelector(`.month-block[data-month="${key}"]`);
  if (!scroller || !block) return false;
  scroller.scrollTo({ top: block.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
  return true;
}
