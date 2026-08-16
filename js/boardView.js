/**
 * イベント相談掲示板
 *
 * 日程が決まっていない利用希望を「付箋」として貼っておく場所です。
 * 付箋は ID から決まる角度でわずかに傾き、触れるとまっすぐ起き上がります。
 * 日程が決まった相談には「日程確定」のスタンプが押されます。
 */

import { el, hashCode } from './util.js';

const TINTS = ['is-paper', 'is-pink', 'is-stone', 'is-paper', 'is-pink'];

function tiltOf(id) {
  // -2.4deg 〜 2.4deg を ID から決める（再描画しても傾きが変わらないように）
  return ((hashCode(id) % 49) - 24) / 10;
}

function tintOf(id) {
  return TINTS[hashCode(`${id}t`) % TINTS.length];
}

function buildNote(item, ctx) {
  const cls = ['note', `is-${item.status}`, tintOf(item.id)];
  if (ctx.freshIds?.has(item.id)) cls.push('is-fresh');

  return el('article', {
    class: cls.join(' '),
    style: `--rot:${tiltOf(item.id)}deg`,
  }, [
    el('span', { class: 'note-pin', 'aria-hidden': 'true' }),
    el('button', {
      class: 'note-hit',
      type: 'button',
      onclick: () => ctx.onOpen(item),
    }, [
      el('h3', { class: 'note-title', text: item.title || '(無題)' }),
      el('p', { class: 'note-period' }, [
        el('i', { class: 'note-period-tag', text: '希望時期' }),
        document.createTextNode(item.desired_period || '未定・相談したい'),
      ]),
      item.purpose ? el('p', { class: 'note-purpose', text: item.purpose }) : null,
      el('div', { class: 'note-foot' }, [
        item.organizer ? el('span', { class: 'note-org', text: item.organizer }) : null,
        item.headcount ? el('span', { class: 'note-meta', text: `${item.headcount}名` }) : null,
        item.staff ? el('span', { class: 'note-meta', text: `担当 ${item.staff}` }) : null,
      ]),
    ]),
    item.status === 'scheduled'
      ? el('span', { class: 'note-stamp', text: '日程確定' })
      : null,
    item.status === 'closed'
      ? el('span', { class: 'note-stamp is-closed', text: '見送り' })
      : null,
  ]);
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {object[]} ctx.inquiries
 * @param {string} ctx.filter  'all' | 'open' | 'scheduled'
 * @param {Set<string>} [ctx.freshIds]  貼ったばかりの相談（登場アニメーション用）
 * @param {(item: object) => void} ctx.onOpen
 * @param {() => void} ctx.onNew
 * @param {(filter: string) => void} ctx.onFilter
 */
export function renderBoard(root, ctx) {
  const { inquiries, filter } = ctx;
  const shown = inquiries.filter((q) => {
    if (filter === 'open') return q.status === 'open';
    if (filter === 'scheduled') return q.status !== 'open';
    return true;
  });

  const counts = {
    all: inquiries.length,
    open: inquiries.filter((q) => q.status === 'open').length,
    scheduled: inquiries.filter((q) => q.status !== 'open').length,
  };

  root.replaceChildren();
  const wrap = el('div', { class: 'board' });

  /* ---- 見出し ---- */
  wrap.append(el('div', { class: 'board-top' }, [
    el('div', { class: 'board-lead' }, [
      el('h2', { class: 'board-h', text: 'イベント相談掲示板' }),
      el('p', { class: 'board-sub', text: '日程が決まっていない利用希望を貼っておく場所です。話がまとまったら、そのままカレンダーへ移せます。' }),
    ]),
    el('div', { class: 'board-tools' }, [
      el('div', { class: 'filter-cluster' }, [
        ['all', 'すべて'], ['open', '相談中'], ['scheduled', '日程確定'],
      ].map(([value, label]) => el('button', {
        class: `chip-filter${filter === value ? ' is-active' : ''}`,
        type: 'button',
        onclick: () => ctx.onFilter(value),
      }, [
        document.createTextNode(label),
        el('span', { class: 'chip-count', text: String(counts[value]) }),
      ]))),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: ctx.onNew }, [
        el('span', { text: '相談を貼る' }),
      ]),
    ]),
  ]));

  /* ---- 付箋 ---- */
  const scroll = el('div', { class: 'board-scroll' });

  if (!shown.length) {
    scroll.append(el('div', { class: 'board-empty' }, [
      el('span', { class: 'board-empty-pin', 'aria-hidden': 'true' }),
      el('p', {
        class: 'board-empty-text',
        text: filter === 'all'
          ? 'まだ相談は貼られていません。'
          : 'この条件の相談はありません。',
      }),
      filter === 'all'
        ? el('button', { class: 'btn btn-ghost', type: 'button', text: '最初の相談を貼る', onclick: ctx.onNew })
        : null,
    ]));
  } else {
    const grid = el('div', { class: 'board-grid' });
    shown.forEach((item, i) => {
      const note = buildNote(item, ctx);
      note.style.setProperty('--delay', `${Math.min(i, 12) * 26}ms`);
      grid.append(note);
    });
    scroll.append(grid);
  }

  wrap.append(scroll);
  root.append(wrap);
}
