/**
 * イベント相談掲示板
 *
 * 日程が決まっていない利用希望を「付箋」として貼っておく場所です。
 * 付箋は ID から決まる角度でわずかに傾き、触れるとまっすぐ起き上がります。
 * 日程が決まった相談には「日程確定」のスタンプが押されます。
 *
 * 付箋の色は「状態」で決まりますが、施設予約以外の問い合わせ（その他）は
 * 一目で区別できるよう黄色い付箋にしています。
 */

import { el, hashCode, categoryOf, closedLabel } from './util.js';

function tiltOf(id) {
  // -2.4deg 〜 2.4deg を ID から決める（再描画しても傾きが変わらないように）
  return ((hashCode(id) % 49) - 24) / 10;
}

function buildNote(item, ctx) {
  // 色は状態で決まる：相談中＝白／日程確定＝ピンク／見送り＝グレー
  // その他の問い合わせは種別で上書きして黄色にする
  const cat = categoryOf(item);
  const cls = ['note', `is-${item.status}`, `is-cat-${cat}`];
  // 担当者が決まっていない相談は、見送り以外は目立たせる
  const needsStaff = !item.staff && item.status !== 'closed';
  if (needsStaff) cls.push('is-nostaff');
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
      cat === 'other' ? el('span', { class: 'note-cat', text: 'その他の問い合わせ' }) : null,
      el('h3', { class: 'note-title', text: item.title || '(無題)' }),
      cat === 'other' ? null : el('p', { class: 'note-period' }, [
        el('i', { class: 'note-period-tag', text: '希望時期' }),
        document.createTextNode(item.desired_period || '未定・相談したい'),
      ]),
      item.purpose ? el('p', { class: 'note-purpose', text: item.purpose }) : null,
      el('div', { class: 'note-foot' }, [
        item.organizer ? el('span', { class: 'note-org', text: item.organizer }) : null,
        item.headcount ? el('span', { class: 'note-meta', text: `${item.headcount}名` }) : null,
        needsStaff
          ? el('span', { class: 'note-nostaff', text: '担当者 未定' })
          : (item.staff ? el('span', { class: 'note-meta', text: `担当 ${item.staff}` }) : null),
      ]),
    ]),
    item.status === 'scheduled'
      ? el('span', { class: 'note-stamp', text: '日程確定' })
      : null,
    item.status === 'closed'
      ? el('span', { class: 'note-stamp is-closed', text: closedLabel(item) })
      : null,
  ]);
}

/** 外部向け問い合わせフォームの URL（掲示板と同じ場所に置いてある） */
export function publicFormUrl() {
  return new URL('inquiry.html', location.href).href;
}

/** 外部向けフォームへの導線。場所を取らないよう、小さなボタン 2 つだけに留めている */
function buildShare(ctx) {
  const url = publicFormUrl();
  return el('div', { class: 'board-share' }, [
    el('span', { class: 'board-share-tag', text: '外部フォーム' }),
    el('button', {
      class: 'btn-mini',
      type: 'button',
      title: `外部向け問い合わせフォームの URL をコピー（${url}）`,
      text: 'URLをコピー',
      onclick: (e) => ctx.onCopyUrl(url, e.currentTarget),
    }),
    el('a', {
      class: 'btn-mini',
      href: url,
      target: '_blank',
      rel: 'noopener',
      title: '外部向け問い合わせフォームを開く',
      text: '開く ↗',
    }),
  ]);
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 * @param {object[]} ctx.inquiries
 * @param {string} ctx.filter  'all' | 'open' | 'scheduled' | 'other'
 * @param {Set<string>} [ctx.freshIds]  貼ったばかりの相談（登場アニメーション用）
 * @param {(item: object) => void} ctx.onOpen
 * @param {() => void} ctx.onNew
 * @param {(filter: string) => void} ctx.onFilter
 * @param {(url: string, button: HTMLElement) => void} ctx.onCopyUrl
 */
export function renderBoard(root, ctx) {
  const { inquiries, filter } = ctx;

  // 「その他」は状態ではなく種別での絞り込み
  const match = (q, f) => {
    if (f === 'open') return q.status === 'open';
    if (f === 'scheduled') return q.status !== 'open';
    if (f === 'other') return categoryOf(q) === 'other';
    return true;
  };
  // 閉じた相談（見送り / 対応済）は末尾へ。並び順自体は元のまま保つ
  const shown = inquiries
    .filter((q) => match(q, filter))
    .sort((a, b) => (a.status === 'closed' ? 1 : 0) - (b.status === 'closed' ? 1 : 0));

  const FILTERS = [['all', 'すべて'], ['open', '相談中'], ['scheduled', '日程確定'], ['other', 'その他']];
  const counts = Object.fromEntries(
    FILTERS.map(([value]) => [value, inquiries.filter((q) => match(q, value)).length]),
  );

  root.replaceChildren();
  const wrap = el('div', { class: 'board' });

  /* ---- 見出し ---- */
  wrap.append(el('div', { class: 'board-top' }, [
    el('div', { class: 'board-lead' }, [
      el('h2', { class: 'board-h', text: 'イベント相談掲示板' }),
      el('p', { class: 'board-sub', text: '日程が決まっていない利用希望を貼っておく場所です。話がまとまったら、そのままカレンダーへ移せます。' }),
    ]),
    el('div', { class: 'board-tools' }, [
      el('div', { class: 'filter-cluster' }, FILTERS.map(([value, label]) => el('button', {
        class: `chip-filter${filter === value ? ' is-active' : ''}${value === 'other' ? ' chip-other' : ''}`,
        type: 'button',
        onclick: () => ctx.onFilter(value),
      }, [
        document.createTextNode(label),
        el('span', { class: 'chip-count', text: String(counts[value]) }),
      ]))),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: ctx.onNew }, [
        el('span', { text: '相談を貼る' }),
      ]),
      buildShare(ctx),
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
