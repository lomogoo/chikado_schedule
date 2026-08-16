/**
 * チカ堂 SCHEDULE — アプリ本体
 */

import { Reservations, ApiError } from './api.js';
import { THREE_DAY_SPAN, SLOT_MINUTES } from './config.js';
import { renderMonth } from './monthView.js';
import { renderThreeDay } from './threeDayView.js';
import {
  ymd, parseYmd, addDays, addMonths, monthMatrix, todayYmd,
  toMin, toHHMM, hhmm, slotOptions, durationLabel, formatDateJa,
  el, overlaps, STATUS_LABEL, DOW_JA,
} from './util.js';

/* ==========================================================================
   状態
   ========================================================================== */

const state = {
  view: 'month',        // 'month' | 'three'
  anchor: new Date(),   // 月別＝表示月の任意日 / 3日間＝先頭日
  filter: 'all',        // 'all' | 'confirmed' | 'tentative'
  items: [],
  byDate: new Map(),
  loading: false,
  editing: null,        // 編集中の予約（新規は null）
  detail: null,         // 詳細表示中の予約
  pendingConflict: false, // 重複警告に対して「もう一度押せば保存」の状態
};

/* ==========================================================================
   DOM 参照
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);

const dom = {
  periodLabel: $('#period-label'),
  loading: $('#loading-bar'),
  viewMonth: $('#view-month'),
  viewThree: $('#view-three'),

  overlayForm: $('#overlay-form'),
  form: $('#reservation-form'),
  formTitle: $('#form-title'),
  formAlert: $('#form-alert'),
  formSubmit: $('#form-submit'),
  formDelete: $('#form-delete'),
  durationLabel: $('#duration-label'),

  overlayDetail: $('#overlay-detail'),
  detailBody: $('#detail-body'),
  detailConfirm: $('#detail-confirm'),

  toastWrap: $('#toast-wrap'),
};

/* ==========================================================================
   トースト
   ========================================================================== */

function toast(message, kind = 'info') {
  const node = el('div', { class: `toast${kind === 'error' ? ' is-error' : ''}`, text: message });
  dom.toastWrap.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 5200 : 2600);
}

/* ==========================================================================
   データ取得
   ========================================================================== */

/** 現在のビューが必要とする日付レンジ（前後に余白を持たせる） */
function currentRange() {
  if (state.view === 'month') {
    const cells = monthMatrix(state.anchor);
    return [ymd(cells[0]), ymd(cells[cells.length - 1])];
  }
  return [ymd(addDays(state.anchor, -1)), ymd(addDays(state.anchor, THREE_DAY_SPAN))];
}

function setLoading(on) {
  state.loading = on;
  dom.loading.hidden = !on;
}

async function load() {
  const [from, to] = currentRange();
  setLoading(true);
  try {
    state.items = await Reservations.listRange(from, to);
  } catch (err) {
    state.items = [];
    reportError(err);
  } finally {
    setLoading(false);
  }
  indexItems();
  render();
}

function indexItems() {
  const map = new Map();
  for (const item of state.items) {
    if (state.filter !== 'all' && item.status !== state.filter) continue;
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
  }
  for (const list of map.values()) {
    list.sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  }
  state.byDate = map;
}

function reportError(err) {
  const msg = err instanceof ApiError ? err.message : '予期しないエラーが発生しました。';
  console.error(err);
  toast(msg, 'error');
}

/* ==========================================================================
   描画
   ========================================================================== */

function periodText() {
  if (state.view === 'month') {
    return {
      main: `${state.anchor.getFullYear()}年${state.anchor.getMonth() + 1}月`,
      sub: '',
    };
  }
  const a = state.anchor;
  const b = addDays(a, THREE_DAY_SPAN - 1);
  const sameMonth = a.getMonth() === b.getMonth();
  const main = sameMonth
    ? `${a.getFullYear()}年${a.getMonth() + 1}月`
    : `${a.getFullYear()}年${a.getMonth() + 1}–${b.getMonth() + 1}月`;
  return { main, sub: `${a.getDate()}日（${DOW_JA[a.getDay()]}）– ${b.getDate()}日（${DOW_JA[b.getDay()]}）` };
}

function render() {
  const { main, sub } = periodText();
  dom.periodLabel.replaceChildren(
    document.createTextNode(main),
    sub ? el('span', { class: 'period-sub', text: sub }) : document.createTextNode(''),
  );

  document.querySelectorAll('.seg-btn').forEach((b) => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });

  document.querySelectorAll('.chip-filter').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.filter === state.filter);
  });

  const ctx = {
    anchor: state.anchor,
    byDate: state.byDate,
    onEventOpen: openDetail,
    onDayOpen: (dateStr) => {
      state.view = 'three';
      state.anchor = parseYmd(dateStr);
      syncHash();
      load();
    },
    onDayCreate: (dateStr) => openForm({ date: dateStr }),
    onSlotCreate: (dateStr, startTime) => openForm({
      date: dateStr,
      start_time: startTime,
      end_time: toHHMM(Math.min(toMin(startTime) + SLOT_MINUTES * 2, 24 * 60)),
    }),
  };

  if (state.view === 'month') {
    dom.viewMonth.hidden = false;
    dom.viewThree.hidden = true;
    renderMonth(dom.viewMonth, ctx);
  } else {
    dom.viewMonth.hidden = true;
    dom.viewThree.hidden = false;
    renderThreeDay(dom.viewThree, ctx);
  }
}

/* ==========================================================================
   ナビゲーション
   ========================================================================== */

function step(dir) {
  state.anchor = state.view === 'month'
    ? addMonths(state.anchor, dir)
    : addDays(state.anchor, dir * THREE_DAY_SPAN);
  syncHash();
  load();
}

function goToday() {
  state.anchor = new Date();
  syncHash();
  load();
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  syncHash();
  load();
}

/** 画面状態を URL ハッシュに保存（リロードしても同じ場所に戻る） */
function syncHash() {
  const h = `#${state.view}/${ymd(state.anchor)}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function restoreFromHash() {
  const m = /^#(month|three)\/(\d{4}-\d{2}-\d{2})$/.exec(location.hash || '');
  if (!m) return;
  state.view = m[1];
  state.anchor = parseYmd(m[2]);
}

/* ==========================================================================
   予約フォーム
   ========================================================================== */

function fillTimeSelects() {
  const startSel = dom.form.elements.start_time;
  const endSel = dom.form.elements.end_time;

  startSel.replaceChildren(...slotOptions().map((t) => el('option', { value: t, text: t })));
  endSel.replaceChildren(...slotOptions({ includeMidnightEnd: true })
    .filter((t) => t !== '00:00')
    .map((t) => el('option', { value: t, text: t })));
}

function updateDuration() {
  const s = toMin(dom.form.elements.start_time.value);
  const e = toMin(dom.form.elements.end_time.value);
  dom.durationLabel.textContent = e > s ? `利用時間 ${durationLabel(e - s)}` : '終了時刻は開始時刻より後にしてください';
}

/**
 * フォームを開く。
 * @param {object} preset 初期値（新規のとき）
 * @param {object|null} item 編集対象
 */
function openForm(preset = {}, item = null) {
  const f = dom.form;
  state.editing = item;
  state.pendingConflict = false;
  dom.formAlert.hidden = true;
  dom.formAlert.textContent = '';

  const src = item || {
    status: 'tentative',
    date: preset.date || todayYmd(),
    start_time: preset.start_time || '18:00',
    end_time: preset.end_time || '20:00',
    title: '',
    purpose: '',
    organizer: '',
    contact: '',
    headcount: '',
    notes: '',
  };

  f.elements.id.value = item?.id || '';
  f.elements.title.value = src.title || '';
  f.elements.date.value = src.date || '';
  f.elements.start_time.value = hhmm(src.start_time);
  f.elements.end_time.value = hhmm(src.end_time);
  f.elements.purpose.value = src.purpose || '';
  f.elements.organizer.value = src.organizer || '';
  f.elements.contact.value = src.contact || '';
  f.elements.headcount.value = src.headcount ?? '';
  f.elements.notes.value = src.notes || '';
  [...f.elements.status].forEach((r) => { r.checked = r.value === (src.status || 'tentative'); });

  dom.formTitle.textContent = item ? '予約を編集' : '新規予約';
  dom.formDelete.hidden = !item;
  updateDuration();

  dom.overlayForm.hidden = false;
  setTimeout(() => f.elements.title.focus(), 30);
}

function closeForm() {
  dom.overlayForm.hidden = true;
  state.editing = null;
  state.pendingConflict = false;
}

function readForm() {
  const f = dom.form;
  return {
    title: f.elements.title.value.trim(),
    date: f.elements.date.value,
    start_time: f.elements.start_time.value,
    end_time: f.elements.end_time.value,
    status: f.querySelector('input[name="status"]:checked')?.value || 'tentative',
    purpose: f.elements.purpose.value.trim(),
    organizer: f.elements.organizer.value.trim(),
    contact: f.elements.contact.value.trim(),
    headcount: f.elements.headcount.value === '' ? null : Number(f.elements.headcount.value),
    notes: f.elements.notes.value.trim(),
  };
}

function validate(v) {
  const errors = [];
  if (!v.title) errors.push('・件名を入力してください。');
  if (!v.date) errors.push('・利用日を選択してください。');
  if (!v.purpose) errors.push('・利用内容を入力してください。');
  if (toMin(v.end_time) <= toMin(v.start_time)) errors.push('・終了時刻は開始時刻より後にしてください。');
  if (toMin(v.start_time) % SLOT_MINUTES || toMin(v.end_time) % SLOT_MINUTES) {
    errors.push(`・時間は${SLOT_MINUTES}分単位で指定してください。`);
  }
  if (v.headcount !== null && (!Number.isFinite(v.headcount) || v.headcount < 0)) {
    errors.push('・人数は 0 以上の数値で入力してください。');
  }
  return errors;
}

/** 同日の他予約との重複を調べる */
async function findConflicts(v, excludeId) {
  let sameDay;
  try {
    sameDay = await Reservations.listRange(v.date, v.date);
  } catch {
    return []; // 重複チェックのための通信失敗で保存自体は止めない
  }
  const s = toMin(v.start_time);
  const e = toMin(v.end_time);
  return sameDay.filter((o) => o.id !== excludeId
    && overlaps(s, e, toMin(o.start_time), toMin(o.end_time)));
}

function showAlert(text) {
  dom.formAlert.textContent = text;
  dom.formAlert.hidden = false;
  dom.formAlert.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function submitForm() {
  const v = readForm();

  const errors = validate(v);
  if (errors.length) {
    state.pendingConflict = false;
    showAlert(`入力内容をご確認ください。\n${errors.join('\n')}`);
    return;
  }

  const id = dom.form.elements.id.value || null;

  if (!state.pendingConflict) {
    const conflicts = await findConflicts(v, id);
    if (conflicts.length) {
      const lines = conflicts.map((c) =>
        `・${hhmm(c.start_time)}–${hhmm(c.end_time)}　${c.title}（${STATUS_LABEL[c.status] || c.status}）`);
      state.pendingConflict = true;
      showAlert(
        `同じ時間帯に ${conflicts.length} 件の予約があります。\n${lines.join('\n')}\n`
        + 'このまま登録する場合は、もう一度「保存」を押してください。',
      );
      return;
    }
  }

  dom.formSubmit.disabled = true;
  try {
    if (id) {
      await Reservations.update(id, v);
      toast('予約を更新しました');
    } else {
      await Reservations.create(v);
      toast('予約を登録しました');
    }
    closeForm();
    await load();
  } catch (err) {
    reportError(err);
    showAlert(err instanceof ApiError ? `保存できませんでした。\n${err.message}` : '保存できませんでした。');
  } finally {
    dom.formSubmit.disabled = false;
  }
}

async function deleteReservation(id) {
  if (!window.confirm('この予約を削除します。よろしいですか？')) return;
  try {
    await Reservations.remove(id);
    toast('予約を削除しました');
    closeForm();
    closeDetail();
    await load();
  } catch (err) {
    reportError(err);
  }
}

/* ==========================================================================
   予約詳細
   ========================================================================== */

function detailRow(label, value) {
  if (value === null || value === undefined || value === '') return null;
  return el('div', { class: 'detail-item' }, [
    el('dt', { text: label }),
    el('dd', { text: String(value) }),
  ]);
}

function openDetail(item) {
  state.detail = item;
  const mins = toMin(item.end_time) - toMin(item.start_time);

  const nodes = [
    el('span', {
      class: `detail-status is-${item.status}`,
      text: STATUS_LABEL[item.status] || item.status,
    }),
    el('h3', { class: 'detail-h', text: item.title || '(無題)' }),
    el('div', { class: 'detail-when' }, [
      document.createTextNode(`${formatDateJa(item.date)}　${hhmm(item.start_time)} – ${hhmm(item.end_time)}`),
      el('span', { class: 'detail-dur', text: durationLabel(mins) }),
    ]),
    el('dl', { class: 'detail-list' }, [
      detailRow('利用内容', item.purpose),
      detailRow('利用者・団体名', item.organizer),
      detailRow('連絡先', item.contact),
      detailRow('人数', item.headcount ? `${item.headcount}名` : ''),
      detailRow('備考', item.notes),
    ].filter(Boolean)),
    item.updated_at || item.created_at
      ? el('div', {
        class: 'detail-meta',
        text: `最終更新 ${new Date(item.updated_at || item.created_at).toLocaleString('ja-JP')}`,
      })
      : null,
  ];

  dom.detailBody.replaceChildren(...nodes.filter(Boolean));

  dom.detailConfirm.hidden = item.status !== 'tentative';
  dom.overlayDetail.hidden = false;
}

function closeDetail() {
  dom.overlayDetail.hidden = true;
  state.detail = null;
}

async function confirmReservation() {
  const item = state.detail;
  if (!item) return;
  try {
    await Reservations.update(item.id, { ...item, status: 'confirmed' });
    toast('本予約に確定しました');
    closeDetail();
    await load();
  } catch (err) {
    reportError(err);
  }
}

/* ==========================================================================
   イベント登録
   ========================================================================== */

function bind() {
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  $('#btn-today').addEventListener('click', goToday);
  $('#btn-new').addEventListener('click', () => openForm({
    date: state.view === 'three' ? ymd(state.anchor) : todayYmd(),
  }));

  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  document.querySelectorAll('.chip-filter').forEach((b) => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      indexItems();
      render();
    });
  });

  /* フォーム */
  $('#form-close').addEventListener('click', closeForm);
  $('#form-cancel').addEventListener('click', closeForm);
  dom.formSubmit.addEventListener('click', submitForm);
  dom.formDelete.addEventListener('click', () => {
    const id = dom.form.elements.id.value;
    if (id) deleteReservation(id);
  });

  dom.form.addEventListener('submit', (e) => { e.preventDefault(); submitForm(); });

  dom.form.addEventListener('input', () => {
    // 入力が変わったら重複警告の「もう一度押す」状態はリセットする
    state.pendingConflict = false;
  });

  dom.form.elements.start_time.addEventListener('change', () => {
    const s = toMin(dom.form.elements.start_time.value);
    const e = toMin(dom.form.elements.end_time.value);
    if (e <= s) {
      dom.form.elements.end_time.value = toHHMM(Math.min(s + SLOT_MINUTES * 2, 24 * 60));
    }
    updateDuration();
  });
  dom.form.elements.end_time.addEventListener('change', updateDuration);

  /* 詳細 */
  $('#detail-close').addEventListener('click', closeDetail);
  $('#detail-edit').addEventListener('click', () => {
    const item = state.detail;
    closeDetail();
    if (item) openForm({}, item);
  });
  $('#detail-delete').addEventListener('click', () => {
    if (state.detail) deleteReservation(state.detail.id);
  });
  dom.detailConfirm.addEventListener('click', confirmReservation);

  /* オーバーレイの外側クリックで閉じる */
  dom.overlayForm.addEventListener('mousedown', (e) => {
    if (e.target === dom.overlayForm) closeForm();
  });
  dom.overlayDetail.addEventListener('mousedown', (e) => {
    if (e.target === dom.overlayDetail) closeDetail();
  });

  /* キーボード */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.overlayForm.hidden) closeForm();
      else if (!dom.overlayDetail.hidden) closeDetail();
      return;
    }
    if (!dom.overlayForm.hidden || !dom.overlayDetail.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;

    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't') goToday();
    else if (e.key === 'm') setView('month');
    else if (e.key === 'd') setView('three');
  });

  window.addEventListener('hashchange', () => {
    restoreFromHash();
    load();
  });

  /* 画面幅が変わるとレイアウト定数（1時間の高さ・チップ数）が変わるため描き直す */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 180);
  });
}

/* ==========================================================================
   起動
   ========================================================================== */

fillTimeSelects();
restoreFromHash();
bind();
syncHash();
load();

// 現在時刻ラインを 1 分ごとに更新
setInterval(() => { if (state.view === 'three') render(); }, 60_000);
