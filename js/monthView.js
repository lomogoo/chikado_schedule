/**
 * 月別ビュー
 */

import { DOW_JA, ymd, monthMatrix, hhmm, el, STATUS_LABEL } from './util.js';

const MAX_CHIPS_DESKTOP = 3;
const MAX_CHIPS_MOBILE = 2;

function maxChips() {
  return window.matchMedia('(max-width: 720px)').matches ? MAX_CHIPS_MOBILE : MAX_CHIPS_DESKTOP;
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {Date}   ctx.anchor        表示中の月のいずれかの日
 * @param {Map<string, object[]>} ctx.byDate  日付 → 予約配列
 * @param {(dateStr: string) => void} ctx.onDayOpen
 * @param {(item: object) => void}    ctx.onEventOpen
 * @param {(dateStr: string) => void} ctx.onDayCreate
 */
export function renderMonth(root, ctx) {
  const { anchor, byDate, onDayOpen, onEventOpen, onDayCreate } = ctx;
  const today = ymd(new Date());
  const month = anchor.getMonth();
  const limit = maxChips();

  root.replaceChildren();

  const wrap = el('div', { class: 'month' });

  /* 曜日ヘッダ */
  const dow = el('div', { class: 'month-dow' });
  DOW_JA.forEach((d, i) => {
    dow.append(el('span', {
      text: d,
      class: i === 0 ? 'is-sun' : i === 6 ? 'is-sat' : '',
    }));
  });
  wrap.append(dow);

  /* 日付グリッド */
  const grid = el('div', { class: 'month-grid' });

  for (const date of monthMatrix(anchor)) {
    const key = ymd(date);
    const items = byDate.get(key) || [];
    const dowIdx = date.getDay();

    const classes = ['mcell'];
    if (date.getMonth() !== month) classes.push('is-outside');
    if (key === today) classes.push('is-today');
    if (dowIdx === 0) classes.push('is-sun');
    if (dowIdx === 6) classes.push('is-sat');

    const cell = el('div', {
      class: classes.join(' '),
      role: 'gridcell',
      tabindex: '0',
      'aria-label': `${date.getMonth() + 1}月${date.getDate()}日 予約${items.length}件`,
    });

    /* 空白部分のクリックで新規作成、日付数字のクリックで3日間ビューへ */
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.mchip, .mchip-more, .mcell-num')) return;
      onDayCreate(key);
    });
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayCreate(key); }
    });

    const head = el('div', { class: 'mcell-head' }, [
      el('button', {
        class: 'mcell-num',
        type: 'button',
        title: 'この日から3日間ビューで開く',
        text: String(date.getDate()),
        onclick: (e) => { e.stopPropagation(); onDayOpen(key); },
      }),
      items.length ? el('span', { class: 'mcell-count', text: `${items.length}件` }) : null,
    ]);
    cell.append(head);

    const body = el('div', { class: 'mcell-body' });
    items.slice(0, limit).forEach((item) => {
      body.append(el('button', {
        class: `mchip is-${item.status}`,
        type: 'button',
        title: `${hhmm(item.start_time)}–${hhmm(item.end_time)} ${item.title}（${STATUS_LABEL[item.status] || ''}）`,
        onclick: (e) => { e.stopPropagation(); onEventOpen(item); },
      }, [
        el('span', { class: 'mchip-time', text: hhmm(item.start_time) }),
        el('span', { class: 'mchip-title', text: item.title || '(無題)' }),
      ]));
    });

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

  wrap.append(grid);
  root.append(wrap);
}
