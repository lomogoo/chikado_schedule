/**
 * チカ堂 SCHEDULE — アプリ本体
 */

import { Reservations, Inquiries, ApiError } from './api.js';
import {
  VISIBLE_DAYS, SLOT_MINUTES, DAY_WINDOW, DAY_EXTEND, DAY_MAX,
  MONTH_MAX, MONTH_BUFFER,
  URGENT_DAYS, POLL_INTERVAL_MS, NOTIFY_PAST_DAYS, NOTIFY_FUTURE_DAYS,
} from './config.js';
import { renderMonths, captureMonthScroll, restoreMonthScroll, scrollToMonth } from './monthView.js';
import {
  renderDayStrip, captureStripScroll, restoreStripScroll, scrollToDay, currentFirstDay,
} from './threeDayView.js';
import { renderBoard } from './boardView.js';
import {
  buildNotifications, markRead, primeOnFirstRun, signature, boardSignature, boardKey,
} from './readState.js';
import {
  ymd, parseYmd, addDays, addMonths, startOfMonth, monthCells, monthKey, monthLabel,
  todayYmd, toMin, toHHMM, hhmm, slotOptions, durationLabel,
  formatSpanJa, eachDate, el, overlaps, urgencyDays,
  itemStart, itemEnd, totalMinutes, isAllDay,
  STATUS_LABEL, INQUIRY_STATUS_LABEL, INQUIRY_CATEGORY_LABEL, categoryOf, applyInquiryCategory, DOW_JA,
} from './util.js';

/* ==========================================================================
   状態
   ========================================================================== */

const state = {
  view: 'month',          // 'month' | 'three' | 'board'
  anchor: new Date(),     // 月別＝表示中の月 / 3日間＝左端の日
  filter: 'all',          // 'all' | 'confirmed' | 'tentative'
  months: [],
  days: [],
  items: [],
  byDate: new Map(),

  inquiries: [],
  boardFilter: 'all',      // 'all' | 'open' | 'scheduled' | 'other'
  freshIds: new Set(),

  notifyItems: [],
  notifications: [],
  shownKeys: '',

  loading: 0,
  extending: false,
  editing: null,
  detail: null,
  inquiryDetail: null,
  fromInquiry: null,      // 相談からカレンダー化しているときの相談レコード
  pendingConflict: false,
};

/* ==========================================================================
   DOM 参照
   ========================================================================== */

const $ = (sel) => document.querySelector(sel);

const dom = {
  periodLabel: $('#period-label'),
  navCluster: $('#nav-cluster'),
  filterCluster: $('#filter-cluster'),
  loading: $('#loading-bar'),
  viewMonth: $('#view-month'),
  viewThree: $('#view-three'),
  viewBoard: $('#view-board'),
  btnNew: $('#btn-new'),
  btnNewLabel: $('#btn-new-label'),

  notifBtn: $('#btn-notif'),
  notifBadge: $('#notif-badge'),
  notifPop: $('#notif-pop'),
  notifList: $('#notif-list'),
  notifCount: $('#notif-count'),

  overlayForm: $('#overlay-form'),
  form: $('#reservation-form'),
  formTitle: $('#form-title'),
  formAlert: $('#form-alert'),
  formSubmit: $('#form-submit'),
  formDelete: $('#form-delete'),
  fromInquiry: $('#from-inquiry'),
  spanLabel: $('#span-label'),

  overlayDetail: $('#overlay-detail'),
  detailBody: $('#detail-body'),
  detailConfirm: $('#detail-confirm'),

  overlayInquiry: $('#overlay-inquiry'),
  inquiryForm: $('#inquiry-form'),
  inquiryTitle: $('#inquiry-title'),
  inquiryAlert: $('#inquiry-alert'),
  inquirySubmit: $('#inquiry-submit'),
  inquiryDelete: $('#inquiry-delete'),

  overlayIDetail: $('#overlay-inquiry-detail'),
  idetailBody: $('#idetail-body'),
  idetailSchedule: $('#idetail-schedule'),
  idetailShelve: $('#idetail-shelve'),

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
  }, kind === 'error' ? 5200 : 2800);
}

function reportError(err) {
  const msg = err instanceof ApiError ? err.message : '予期しないエラーが発生しました。';
  console.error(err);
  toast(msg, 'error');
}

function setLoading(delta) {
  state.loading = Math.max(0, state.loading + delta);
  dom.loading.hidden = state.loading === 0;
}

/* ==========================================================================
   表示ウィンドウ
   ========================================================================== */

function initMonths() {
  const base = startOfMonth(state.anchor);
  state.months = [];
  for (let i = -MONTH_BUFFER; i <= MONTH_BUFFER; i++) state.months.push(addMonths(base, i));
}

function initDays() {
  const base = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), state.anchor.getDate());
  const lead = Math.floor((DAY_WINDOW - VISIBLE_DAYS) / 2);
  state.days = Array.from({ length: DAY_WINDOW }, (_, i) => addDays(base, i - lead));
}

function viewRange() {
  if (state.view === 'three') {
    if (!state.days.length) initDays();
    return [ymd(state.days[0]), ymd(state.days[state.days.length - 1])];
  }
  if (!state.months.length) initMonths();
  const first = monthCells(state.months[0])[0];
  const lastCells = monthCells(state.months[state.months.length - 1]);
  return [ymd(first), ymd(lastCells[lastCells.length - 1])];
}

/* ==========================================================================
   データ取得
   ========================================================================== */

async function loadView({ keepScroll = true } = {}) {
  if (state.view === 'board') { render({ keepScroll }); return; }

  const [from, to] = viewRange();
  setLoading(1);
  try {
    state.items = await Reservations.listRange(from, to);
  } catch (err) {
    state.items = [];
    reportError(err);
  } finally {
    setLoading(-1);
  }
  indexItems();
  render({ keepScroll });
}

async function loadBoard({ rerender = true } = {}) {
  setLoading(1);
  try {
    state.inquiries = await Inquiries.list();
  } catch (err) {
    state.inquiries = [];
    reportError(err);
  } finally {
    setLoading(-1);
  }
  if (rerender && state.view === 'board') render();
}

async function loadNotifications() {
  const today = new Date();
  const from = ymd(addDays(today, -NOTIFY_PAST_DAYS));
  const to = ymd(addDays(today, NOTIFY_FUTURE_DAYS));
  let rows = [];
  let inquiries = [];
  try {
    [rows, inquiries] = await Promise.all([Reservations.listRange(from, to), Inquiries.list()]);
  } catch {
    return; // お知らせの取得失敗で画面を止めない
  }
  state.notifyItems = rows;
  state.inquiries = inquiries;
  primeOnFirstRun(rows, inquiries);
  refreshNotifications({ autoOpen: true });
}

/** 表示中の予約を日付ごとに展開する（複数日予約は各日に載せる） */
function indexItems() {
  const today = todayYmd();
  const map = new Map();

  for (const item of state.items) {
    item.__urgent = urgencyDays(item, today, URGENT_DAYS) !== null;
    if ((state.filter === 'confirmed' || state.filter === 'tentative') && item.status !== state.filter) continue;

    for (const key of eachDate(item.start_date, item.end_date)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
  }

  for (const list of map.values()) {
    list.sort((a, b) => toMin(a.start_time) - toMin(b.start_time)
      || String(a.title).localeCompare(String(b.title)));
  }
  state.byDate = map;
}

/* ==========================================================================
   お知らせ
   ========================================================================== */

function refreshNotifications({ autoOpen = false } = {}) {
  state.notifications = buildNotifications(state.notifyItems, state.inquiries, todayYmd());
  renderNotifications();

  const keys = state.notifications.map((n) => `${n.kind}:${n.key}`).sort().join(',');
  if (autoOpen && state.notifications.length && keys !== state.shownKeys) {
    state.shownKeys = keys;
    openNotifications();
    const added = state.notifications.filter((n) => n.kind === 'new').length;
    const board = state.notifications.filter((n) => n.kind === 'board').length;
    const urgent = state.notifications.filter((n) => n.kind === 'deadline').length;
    const parts = [];
    if (added) parts.push(`新しい予定 ${added} 件`);
    if (board) parts.push(`掲示板 ${board} 件`);
    if (urgent) parts.push(`要確認の仮予約 ${urgent} 件`);
    if (parts.length) toast(`${parts.join(' / ')} があります`);
  }
}

const NOTIF_KIND = {
  new: { label: '新規', cls: 'is-new' },
  updated: { label: '更新', cls: 'is-updated' },
  board: { label: '掲示板', cls: 'is-board' },
  deadline: { label: '要確認', cls: 'is-deadline' },
};

function renderNotifications() {
  const n = state.notifications.length;
  dom.notifBadge.hidden = n === 0;
  dom.notifBadge.textContent = n > 99 ? '99+' : String(n);
  dom.notifBtn.classList.toggle('has-unread', n > 0);
  dom.notifCount.textContent = n ? ` ${n}` : '';

  if (!n) {
    dom.notifList.replaceChildren(el('p', { class: 'notif-empty', text: '未読のお知らせはありません' }));
    return;
  }

  dom.notifList.replaceChildren(...state.notifications.map((note) => {
    const meta = NOTIF_KIND[note.kind];
    const item = note.item;

    const when = note.isBoard
      ? `希望時期：${item.desired_period || '未定'}`
      : formatSpanJa(item);

    const sub = note.kind === 'deadline'
      ? (note.days === 0 ? '本日が実施日の仮予約です' : `実施まで残り ${note.days} 日の仮予約です`)
      : note.isBoard
        ? `${INQUIRY_STATUS_LABEL[item.status] || item.status}${item.organizer ? ` / ${item.organizer}` : ''}`
        : `${STATUS_LABEL[item.status] || item.status}${item.organizer ? ` / ${item.organizer}` : ''}`;

    return el('div', { class: `notif-item ${meta.cls}` }, [
      el('button', {
        class: 'notif-main',
        type: 'button',
        onclick: () => {
          markRead([[note.key, note.sig]]);
          refreshNotifications();
          closeNotifications();
          if (note.isBoard) { setView('board'); openInquiryDetail(item); }
          else openDetail(item);
        },
      }, [
        el('span', { class: `notif-kind ${meta.cls}`, text: meta.label }),
        el('span', { class: 'notif-body' }, [
          el('span', { class: 'notif-item-title', text: item.title || '(無題)' }),
          el('span', { class: 'notif-when', text: when }),
          el('span', { class: 'notif-sub', text: sub }),
        ]),
      ]),
      el('button', {
        class: 'notif-dismiss',
        type: 'button',
        title: '既読にする',
        text: '既読',
        onclick: () => { markRead([[note.key, note.sig]]); refreshNotifications(); },
      }),
    ]);
  }));
}

/** お知らせポップアップがヘッダーに重ならないよう、実測の高さを CSS 変数に流す */
function syncHeaderHeight() {
  const header = document.querySelector('.app-header');
  if (header) document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
}

function openNotifications() {
  syncHeaderHeight();
  dom.notifPop.hidden = false;
}

function closeNotifications() {
  dom.notifPop.hidden = true;
}

function markAllNotificationsRead() {
  markRead(state.notifications.map((n) => [n.key, n.sig]));
  refreshNotifications();
  toast('すべて既読にしました');
}

function markItemRead(item, isBoard = false) {
  const note = state.notifications.find((n) => n.kind !== 'deadline'
    && Boolean(n.isBoard) === isBoard && n.item.id === item.id);
  if (!note) return;
  markRead([[note.key, note.sig]]);
  refreshNotifications();
}

/* ==========================================================================
   描画
   ========================================================================== */

function periodText() {
  if (state.view === 'board') return { main: '', sub: '' };
  if (state.view === 'month') return { main: monthLabel(state.anchor), sub: '' };

  const a = state.anchor;
  const b = addDays(a, VISIBLE_DAYS - 1);
  const main = a.getMonth() === b.getMonth()
    ? monthLabel(a)
    : `${a.getFullYear()}年${a.getMonth() + 1}–${b.getMonth() + 1}月`;
  return { main, sub: `${a.getDate()}日（${DOW_JA[a.getDay()]}）– ${b.getDate()}日（${DOW_JA[b.getDay()]}）` };
}

function renderChrome() {
  const isBoard = state.view === 'board';
  dom.navCluster.hidden = isBoard;
  dom.filterCluster.hidden = isBoard;
  dom.btnNewLabel.textContent = isBoard ? '相談を貼る' : '新規予約';

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

  dom.filterCluster.querySelectorAll('.chip-filter').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.filter === state.filter);
  });

  syncHeaderHeight();
}

function calendarCtx() {
  return {
    byDate: state.byDate,
    todayStr: todayYmd(),
    onEventOpen: openDetail,
    onDayOpen: (dateStr) => goToDay(dateStr),
    onDayCreate: (dateStr) => openForm({ start_date: dateStr }),
    onSlotCreate: (dateStr, startTime) => openForm({
      start_date: dateStr,
      start_time: startTime,
      end_time: toHHMM(Math.min(toMin(startTime) + SLOT_MINUTES * 2, 24 * 60)),
    }),
  };
}

function render({ keepScroll = true } = {}) {
  renderChrome();

  dom.viewMonth.hidden = state.view !== 'month';
  dom.viewThree.hidden = state.view !== 'three';
  dom.viewBoard.hidden = state.view !== 'board';

  if (state.view === 'month') {
    const saved = keepScroll ? captureMonthScroll(dom.viewMonth) : null;
    renderMonths(dom.viewMonth, {
      ...calendarCtx(),
      months: state.months,
      onVisibleMonth,
    });
    if (saved) restoreMonthScroll(dom.viewMonth, saved);
    else scrollToMonth(dom.viewMonth, monthKey(state.anchor));
  } else if (state.view === 'three') {
    const saved = keepScroll ? captureStripScroll(dom.viewThree) : null;
    renderDayStrip(dom.viewThree, {
      ...calendarCtx(),
      days: state.days,
      onEdge: onStripEdge,
      onVisibleDays,
    });
    if (saved && saved.key) restoreStripScroll(dom.viewThree, saved);
    else scrollToDay(dom.viewThree, ymd(state.anchor));
  } else {
    renderBoard(dom.viewBoard, {
      inquiries: state.inquiries,
      filter: state.boardFilter,
      freshIds: state.freshIds,
      onOpen: openInquiryDetail,
      onNew: () => openInquiryForm(),
      onFilter: (f) => { state.boardFilter = f; render(); },
      onCopyUrl: copyFormUrl,
    });
  }
}

/* ==========================================================================
   スクロールによる期間の継ぎ足し
   ========================================================================== */

let bufferTimer = null;

function onVisibleMonth(key) {
  if (monthKey(state.anchor) !== key) {
    const [y, m] = key.split('-').map(Number);
    state.anchor = new Date(y, m - 1, 1);
    renderChrome();
    syncHash();
  }
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(ensureMonthBuffer, 320);
}

/** 現在月の前後に MONTH_BUFFER か月ぶんの余白を保つ */
async function ensureMonthBuffer() {
  if (state.view !== 'month' || state.extending || !state.months.length) return;
  const idx = state.months.findIndex((m) => monthKey(m) === monthKey(state.anchor));
  if (idx < 0) return;

  const needBefore = MONTH_BUFFER - idx;
  const needAfter = MONTH_BUFFER - (state.months.length - 1 - idx);
  if (needBefore <= 0 && needAfter <= 0) return;
  if (state.months.length >= MONTH_MAX) return;

  state.extending = true;
  try {
    const months = [...state.months];
    for (let i = 0; i < needBefore; i++) months.unshift(addMonths(months[0], -1));
    for (let i = 0; i < needAfter; i++) months.push(addMonths(months[months.length - 1], 1));
    state.months = months;
    await loadView();
  } finally {
    setTimeout(() => { state.extending = false; }, 200);
  }
}

function onVisibleDays(key) {
  if (ymd(state.anchor) === key) return;
  state.anchor = parseYmd(key);
  renderChrome();
  syncHash();
}

async function onStripEdge(edge) {
  if (state.extending || state.days.length >= DAY_MAX) return;
  state.extending = true;
  try {
    if (edge === 'right') {
      const last = state.days[state.days.length - 1];
      state.days = [...state.days, ...Array.from({ length: DAY_EXTEND }, (_, i) => addDays(last, i + 1))];
    } else {
      const first = state.days[0];
      const head = Array.from({ length: DAY_EXTEND }, (_, i) => addDays(first, i - DAY_EXTEND));
      state.days = [...head, ...state.days];
    }
    await loadView();
  } finally {
    setTimeout(() => { state.extending = false; }, 250);
  }
}

/* ==========================================================================
   ナビゲーション
   ========================================================================== */

function goToDay(dateStr) {
  state.view = 'three';
  state.anchor = parseYmd(dateStr);
  initDays();
  syncHash();
  loadView({ keepScroll: false });
}

async function step(dir) {
  if (state.view === 'board') return;

  if (state.view === 'month') {
    const target = addMonths(state.anchor, dir);
    const key = monthKey(target);
    if (!state.months.some((m) => monthKey(m) === key)) {
      state.months = dir > 0
        ? [...state.months, addMonths(state.months[state.months.length - 1], 1)]
        : [addMonths(state.months[0], -1), ...state.months];
      await loadView();
    }
    state.anchor = target;
    renderChrome();
    syncHash();
    scrollToMonth(dom.viewMonth, key, { smooth: true });
    return;
  }

  const first = currentFirstDay(dom.viewThree) || ymd(state.anchor);
  const target = addDays(parseYmd(first), dir * VISIBLE_DAYS);
  const key = ymd(target);
  if (!state.days.some((d) => ymd(d) === key)) {
    await onStripEdge(dir > 0 ? 'right' : 'left');
  }
  state.anchor = target;
  renderChrome();
  syncHash();
  scrollToDay(dom.viewThree, key, { smooth: true });
}

function goToday() {
  if (state.view === 'board') return;
  state.anchor = new Date();
  if (state.view === 'month') initMonths();
  else initDays();
  syncHash();
  loadView({ keepScroll: false });
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  if (view === 'month') initMonths();
  else if (view === 'three') initDays();
  syncHash();
  if (view === 'board') { render(); loadBoard(); }
  else loadView({ keepScroll: false });
}

function syncHash() {
  const h = state.view === 'board' ? '#board' : `#${state.view}/${ymd(state.anchor)}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function restoreFromHash() {
  if (/^#board$/.test(location.hash || '')) { state.view = 'board'; return; }
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

function applyAllDay() {
  const f = dom.form;
  const on = f.elements.all_day.checked;
  f.elements.start_time.disabled = on;
  f.elements.end_time.disabled = on;
  if (on) {
    f.elements.start_time.value = '00:00';
    f.elements.end_time.value = '24:00';
  }
  updateSpan();
}

function currentFormSpan() {
  const f = dom.form;
  return {
    start_date: f.elements.start_date.value,
    end_date: f.elements.end_date.value || f.elements.start_date.value,
    start_time: f.elements.start_time.value,
    end_time: f.elements.end_time.value,
  };
}

function updateSpan() {
  const v = currentFormSpan();
  if (!v.start_date || !v.end_date) { dom.spanLabel.textContent = ''; return; }

  if (itemEnd(v) <= itemStart(v)) {
    dom.spanLabel.textContent = '終了は開始より後にしてください';
    dom.spanLabel.classList.add('is-warn');
    return;
  }
  dom.spanLabel.classList.remove('is-warn');

  const days = eachDate(v.start_date, v.end_date).length;
  const total = durationLabel(totalMinutes(v));
  dom.spanLabel.textContent = days === 1
    ? `${formatSpanJa({ ...v })}（${total}）`
    : `${days}日間にまたがる利用（通し ${total}）`;
}

function openForm(preset = {}, item = null) {
  const f = dom.form;
  state.editing = item;
  state.pendingConflict = false;
  dom.formAlert.hidden = true;
  dom.formAlert.textContent = '';

  state.fromInquiry = preset.inquiry || null;
  if (state.fromInquiry) {
    dom.fromInquiry.hidden = false;
    dom.fromInquiry.replaceChildren(
      el('b', { text: '掲示板の相談から作成中' }),
      el('span', { text: `「${state.fromInquiry.title}」に日程を入れると、掲示板の付箋に「日程確定」が押されます。` }),
    );
  } else {
    dom.fromInquiry.hidden = true;
  }

  const src = item || {
    status: 'tentative',
    start_date: preset.start_date || todayYmd(),
    end_date: preset.end_date || preset.start_date || todayYmd(),
    start_time: preset.start_time || '18:00',
    end_time: preset.end_time || '20:00',
    title: preset.title || '',
    purpose: preset.purpose || '',
    organizer: preset.organizer || '',
    contact_email: preset.contact_email || '',
    contact_phone: preset.contact_phone || '',
    staff: preset.staff || '',
    headcount: preset.headcount ?? '',
    notes: preset.notes || '',
  };

  f.elements.id.value = item?.id || '';
  f.elements.title.value = src.title || '';
  f.elements.start_date.value = src.start_date || '';
  f.elements.end_date.value = src.end_date || src.start_date || '';
  f.elements.start_time.value = hhmm(src.start_time);
  f.elements.end_time.value = hhmm(src.end_time);
  f.elements.all_day.checked = isAllDay(src);
  f.elements.purpose.value = src.purpose || '';
  f.elements.organizer.value = src.organizer || '';
  f.elements.contact_email.value = src.contact_email || '';
  f.elements.contact_phone.value = src.contact_phone || '';
  f.elements.staff.value = src.staff || '';
  f.elements.headcount.value = src.headcount ?? '';
  f.elements.notes.value = src.notes || '';
  [...f.elements.status].forEach((r) => { r.checked = r.value === (src.status || 'tentative'); });

  dom.formTitle.textContent = item ? '予約を編集' : '新規予約';
  dom.formDelete.hidden = !item;
  applyAllDay();

  dom.overlayForm.hidden = false;
  setTimeout(() => f.elements.title.focus(), 30);
}

function closeForm() {
  dom.overlayForm.hidden = true;
  state.editing = null;
  state.fromInquiry = null;
  state.pendingConflict = false;
}

function readForm() {
  const f = dom.form;
  return {
    ...currentFormSpan(),
    title: f.elements.title.value.trim(),
    status: f.querySelector('input[name="status"]:checked')?.value || 'tentative',
    purpose: f.elements.purpose.value.trim(),
    organizer: f.elements.organizer.value.trim(),
    contact_email: f.elements.contact_email.value.trim(),
    contact_phone: f.elements.contact_phone.value.trim(),
    staff: f.elements.staff.value.trim(),
    headcount: f.elements.headcount.value === '' ? null : Number(f.elements.headcount.value),
    notes: f.elements.notes.value.trim(),
  };
}

function validate(v) {
  const errors = [];
  if (!v.title) errors.push('・件名を入力してください。');
  if (!v.start_date) errors.push('・開始日を選択してください。');
  if (!v.end_date) errors.push('・終了日を選択してください。');
  if (!v.purpose) errors.push('・利用内容を入力してください。');
  if (v.start_date && v.end_date && itemEnd(v) <= itemStart(v)) {
    errors.push('・終了日時は開始日時より後にしてください。');
  }
  if (toMin(v.start_time) % SLOT_MINUTES || toMin(v.end_time) % SLOT_MINUTES) {
    errors.push(`・時刻は${SLOT_MINUTES}分単位で指定してください。`);
  }
  if (v.headcount !== null && (!Number.isFinite(v.headcount) || v.headcount < 0)) {
    errors.push('・人数は 0 以上の数値で入力してください。');
  }
  return errors;
}

/** 期間が重なる他の予約を探す */
async function findConflicts(v, excludeId) {
  let rows;
  try {
    rows = await Reservations.listRange(v.start_date, v.end_date);
  } catch {
    return []; // 重複チェックのための通信失敗で保存自体は止めない
  }
  const s = itemStart(v);
  const e = itemEnd(v);
  return rows.filter((o) => o.id !== excludeId && overlaps(s, e, itemStart(o), itemEnd(o)));
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
      const lines = conflicts.map((c) => `・${formatSpanJa(c)}　${c.title}（${STATUS_LABEL[c.status] || c.status}）`);
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
    const saved = id ? await Reservations.update(id, v) : await Reservations.create(v);
    if (saved?.id) markRead([[saved.id, signature(saved)]]);

    // 掲示板の相談から作成した場合は、その付箋を「日程確定」にする
    const inquiry = state.fromInquiry;
    if (inquiry && saved?.id) {
      try {
        const updated = await Inquiries.update(inquiry.id, {
          ...inquiry, status: 'scheduled', reservation_id: saved.id,
        });
        if (updated) markRead([[boardKey(updated), boardSignature(updated)]]);
      } catch (err) {
        reportError(err);
      }
    }

    toast(id ? '予約を更新しました' : inquiry ? 'カレンダーに登録しました' : '予約を登録しました');
    const landing = saved?.start_date || v.start_date;
    closeForm();

    if (inquiry) {
      state.view = 'month';
      state.anchor = parseYmd(landing);
      initMonths();
      syncHash();
    }
    await Promise.all([loadView({ keepScroll: !inquiry }), loadBoard({ rerender: false }), loadNotifications()]);
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
    await Promise.all([loadView(), loadNotifications()]);
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

/** チカ堂担当者。空欄のときは「未定」と分かるように強調して出す */
function staffRow(item) {
  if (item.staff) return detailRow('チカ堂担当者', item.staff);
  return el('div', { class: 'detail-item is-nostaff' }, [
    el('dt', { text: 'チカ堂担当者' }),
    el('dd', {}, [el('span', { class: 'nostaff-tag', text: '未定（担当者が決まっていません）' })]),
  ]);
}

function openDetail(item) {
  state.detail = item;
  const days = eachDate(item.start_date, item.end_date).length;
  const urgent = urgencyDays(item, todayYmd(), URGENT_DAYS);

  const nodes = [
    el('span', {
      class: `detail-status is-${item.status}`,
      text: STATUS_LABEL[item.status] || item.status,
    }),
    urgent !== null
      ? el('div', {
        class: 'detail-urgent',
        text: urgent === 0
          ? '本日が実施日の仮予約です。本予約への切り替えをご確認ください。'
          : `実施まで残り ${urgent} 日の仮予約です。本予約への切り替えをご確認ください。`,
      })
      : null,
    el('h3', { class: 'detail-h', text: item.title || '(無題)' }),
    el('div', { class: 'detail-when' }, [
      el('div', { class: 'detail-when-date', text: formatSpanJa(item) }),
      el('div', { class: 'detail-when-time' }, [
        el('span', { class: 'detail-dur', text: `通し ${durationLabel(totalMinutes(item))}${days > 1 ? ` / ${days}日間` : ''}` }),
      ]),
    ]),
    el('dl', { class: 'detail-list' }, [
      detailRow('利用内容', item.purpose),
      detailRow('利用者・団体名', item.organizer),
      detailRow('メールアドレス', item.contact_email),
      detailRow('電話番号', item.contact_phone),
      detailRow('連絡先', item.contact),
      staffRow(item),
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
  markItemRead(item);
}

function closeDetail() {
  dom.overlayDetail.hidden = true;
  state.detail = null;
}

async function confirmReservation() {
  const item = state.detail;
  if (!item) return;
  try {
    const saved = await Reservations.update(item.id, { ...item, status: 'confirmed' });
    if (saved?.id) markRead([[saved.id, signature(saved)], [`deadline:${saved.id}`, 'done']]);
    toast('本予約に確定しました');
    closeDetail();
    await Promise.all([loadView(), loadNotifications()]);
  } catch (err) {
    reportError(err);
  }
}

/* ==========================================================================
   掲示板（相談）
   ========================================================================== */

/** 外部向けフォームの URL をクリップボードへ。使えない環境では入力欄を選択させる */
async function copyFormUrl(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    toast('フォームの URL をコピーしました');
  } catch {
    const input = button?.parentElement?.querySelector('.board-share-url');
    if (input) { input.focus(); input.select(); }
    toast('コピーできませんでした。URL を選択して手動でコピーしてください。', 'error');
  }
}

function currentInquiryCategory() {
  return dom.inquiryForm.querySelector('input[name="category"]:checked')?.value || 'facility';
}

function openInquiryForm(item = null) {
  const f = dom.inquiryForm;
  dom.inquiryAlert.hidden = true;

  const src = item || {
    title: '', desired_period: '', purpose: '', category: 'facility',
    organizer: '', contact_email: '', contact_phone: '', staff: '', headcount: '', notes: '',
  };

  f.elements.id.value = item?.id || '';
  f.elements.title.value = src.title || '';
  f.elements.desired_period.value = src.desired_period || '';
  f.elements.purpose.value = src.purpose || '';
  f.elements.organizer.value = src.organizer || '';
  f.elements.contact_email.value = src.contact_email || '';
  f.elements.contact_phone.value = src.contact_phone || '';
  f.elements.staff.value = src.staff || '';
  f.elements.headcount.value = src.headcount ?? '';
  f.elements.notes.value = src.notes || '';
  [...f.elements.category].forEach((r) => { r.checked = r.value === categoryOf(src); });
  applyInquiryCategory(f, categoryOf(src));

  dom.inquiryTitle.textContent = item ? '相談を編集' : '相談を貼る';
  dom.inquirySubmit.textContent = item ? '保存' : '貼る';
  dom.inquiryDelete.hidden = !item;

  dom.overlayInquiry.hidden = false;
  setTimeout(() => f.elements.title.focus(), 30);
}

function closeInquiryForm() {
  dom.overlayInquiry.hidden = true;
}

async function submitInquiry() {
  const f = dom.inquiryForm;
  const category = currentInquiryCategory();
  const other = category === 'other';
  const v = {
    title: f.elements.title.value.trim(),
    category,
    desired_period: other ? '' : f.elements.desired_period.value.trim(),
    purpose: f.elements.purpose.value.trim(),
    organizer: f.elements.organizer.value.trim(),
    contact_email: f.elements.contact_email.value.trim(),
    contact_phone: f.elements.contact_phone.value.trim(),
    staff: f.elements.staff.value.trim(),
    headcount: other || f.elements.headcount.value === '' ? null : Number(f.elements.headcount.value),
    notes: other ? '' : f.elements.notes.value.trim(),
  };

  const errors = [];
  if (!v.title) errors.push('・件名を入力してください。');
  if (!v.purpose) errors.push(other ? '・お問い合わせ内容を入力してください。' : '・利用内容を入力してください。');
  if (errors.length) {
    dom.inquiryAlert.textContent = `入力内容をご確認ください。\n${errors.join('\n')}`;
    dom.inquiryAlert.hidden = false;
    return;
  }

  const id = f.elements.id.value || null;
  dom.inquirySubmit.disabled = true;
  try {
    const saved = id ? await Inquiries.update(id, v) : await Inquiries.create(v);
    if (saved?.id) {
      markRead([[boardKey(saved), boardSignature(saved)]]);
      if (!id) {
        state.freshIds.add(saved.id);
        setTimeout(() => { state.freshIds.delete(saved.id); }, 1500);
      }
    }
    toast(id ? '相談を更新しました' : '掲示板に貼りました');
    closeInquiryForm();
    closeInquiryDetail();
    state.view = 'board';
    syncHash();
    await loadBoard();
    loadNotifications();
  } catch (err) {
    reportError(err);
    dom.inquiryAlert.textContent = err instanceof ApiError ? `保存できませんでした。\n${err.message}` : '保存できませんでした。';
    dom.inquiryAlert.hidden = false;
  } finally {
    dom.inquirySubmit.disabled = false;
  }
}

async function deleteInquiry(id) {
  if (!window.confirm('この相談を削除します。よろしいですか？')) return;
  try {
    await Inquiries.remove(id);
    toast('相談を剥がしました');
    closeInquiryForm();
    closeInquiryDetail();
    await loadBoard();
    loadNotifications();
  } catch (err) {
    reportError(err);
  }
}

async function shelveInquiry() {
  const q = state.inquiryDetail;
  if (!q || !window.confirm('この相談を「見送り」にします。よろしいですか？')) return;
  try {
    await Inquiries.update(q.id, { status: 'closed' });
    toast('見送りにしました');
    closeInquiryDetail();
    await loadBoard();
    loadNotifications();
  } catch (err) {
    reportError(err);
  }
}

function openInquiryDetail(item) {
  state.inquiryDetail = item;

  const cat = categoryOf(item);
  const other = cat === 'other';

  const nodes = [
    el('div', { class: 'detail-badges' }, [
      el('span', { class: `detail-status is-inq-${item.status}`, text: INQUIRY_STATUS_LABEL[item.status] || item.status }),
      el('span', { class: `detail-cat is-cat-${cat}`, text: INQUIRY_CATEGORY_LABEL[cat] }),
      item.source === 'public' ? el('span', { class: 'detail-cat is-public', text: '外部フォームから' }) : null,
    ].filter(Boolean)),
    el('h3', { class: 'detail-h', text: item.title || '(無題)' }),
    other ? null : el('div', { class: 'detail-when' }, [
      el('div', { class: 'detail-when-date', text: `希望時期：${item.desired_period || '未定・相談したい'}` }),
    ]),
    el('dl', { class: 'detail-list' }, [
      detailRow(other ? 'お問い合わせ内容' : '利用内容', item.purpose),
      detailRow(other ? 'お名前・団体名' : '利用者・団体名', item.organizer),
      detailRow('メールアドレス', item.contact_email),
      detailRow('電話番号', item.contact_phone),
      detailRow('連絡先', item.contact),
      staffRow(item),
      detailRow('想定人数', item.headcount ? `${item.headcount}名` : ''),
      detailRow('備考', item.notes),
    ].filter(Boolean)),
    item.updated_at || item.created_at
      ? el('div', {
        class: 'detail-meta',
        text: `最終更新 ${new Date(item.updated_at || item.created_at).toLocaleString('ja-JP')}`,
      })
      : null,
  ];

  dom.idetailBody.replaceChildren(...nodes.filter(Boolean));
  $('#idetail-schedule-label').textContent = item.status === 'scheduled'
    ? 'もう一度登録' : 'カレンダーへ';
  dom.idetailSchedule.hidden = other;
  dom.idetailShelve.hidden = item.status === 'closed';
  dom.overlayIDetail.hidden = false;
  markItemRead(item, true);
}

function closeInquiryDetail() {
  dom.overlayIDetail.hidden = true;
  state.inquiryDetail = null;
}

function scheduleInquiry() {
  const q = state.inquiryDetail;
  if (!q) return;
  closeInquiryDetail();
  openForm({
    inquiry: q,
    title: q.title,
    purpose: q.purpose,
    organizer: q.organizer,
    contact_email: q.contact_email,
    contact_phone: q.contact_phone,
    staff: q.staff,
    headcount: q.headcount,
    notes: q.notes,
    start_date: todayYmd(),
  });
}

/* ==========================================================================
   イベント登録
   ========================================================================== */

function bind() {
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  $('#btn-today').addEventListener('click', goToday);
  dom.btnNew.addEventListener('click', () => {
    if (state.view === 'board') openInquiryForm();
    else openForm({ start_date: ymd(state.anchor) });
  });

  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  dom.filterCluster.querySelectorAll('.chip-filter').forEach((b) => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      indexItems();
      render();
    });
  });

  /* お知らせ */
  dom.notifBtn.addEventListener('click', () => {
    if (dom.notifPop.hidden) openNotifications();
    else closeNotifications();
  });
  $('#notif-close').addEventListener('click', closeNotifications);
  $('#notif-readall').addEventListener('click', markAllNotificationsRead);
  document.addEventListener('click', (e) => {
    if (dom.notifPop.hidden) return;
    if (e.target.closest('#notif-pop, #btn-notif')) return;
    closeNotifications();
  });

  /* 予約フォーム */
  $('#form-close').addEventListener('click', closeForm);
  $('#form-cancel').addEventListener('click', closeForm);
  dom.formSubmit.addEventListener('click', submitForm);
  dom.formDelete.addEventListener('click', () => {
    const id = dom.form.elements.id.value;
    if (id) deleteReservation(id);
  });

  dom.form.addEventListener('submit', (e) => { e.preventDefault(); submitForm(); });
  dom.form.addEventListener('input', () => { state.pendingConflict = false; });

  dom.form.elements.all_day.addEventListener('change', applyAllDay);
  dom.form.elements.start_date.addEventListener('change', () => {
    const f = dom.form;
    if (!f.elements.end_date.value || f.elements.end_date.value < f.elements.start_date.value) {
      f.elements.end_date.value = f.elements.start_date.value;
    }
    updateSpan();
  });
  dom.form.elements.end_date.addEventListener('change', updateSpan);
  dom.form.elements.start_time.addEventListener('change', () => {
    const f = dom.form;
    if (f.elements.start_date.value === f.elements.end_date.value
      && toMin(f.elements.end_time.value) <= toMin(f.elements.start_time.value)) {
      f.elements.end_time.value = toHHMM(Math.min(toMin(f.elements.start_time.value) + SLOT_MINUTES * 2, 24 * 60));
    }
    updateSpan();
  });
  dom.form.elements.end_time.addEventListener('change', updateSpan);

  /* 予約詳細 */
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

  /* 掲示板 */
  $('#inquiry-close').addEventListener('click', closeInquiryForm);
  $('#inquiry-cancel').addEventListener('click', closeInquiryForm);
  dom.inquirySubmit.addEventListener('click', submitInquiry);
  dom.inquiryForm.addEventListener('submit', (e) => { e.preventDefault(); submitInquiry(); });
  dom.inquiryForm.querySelectorAll('input[name="category"]').forEach((r) => {
    r.addEventListener('change', () => applyInquiryCategory(dom.inquiryForm, r.value));
  });
  dom.inquiryDelete.addEventListener('click', () => {
    const id = dom.inquiryForm.elements.id.value;
    if (id) deleteInquiry(id);
  });

  $('#idetail-close').addEventListener('click', closeInquiryDetail);
  dom.idetailShelve.addEventListener('click', shelveInquiry);
  $('#idetail-edit').addEventListener('click', () => {
    const item = state.inquiryDetail;
    closeInquiryDetail();
    if (item) openInquiryForm(item);
  });
  $('#idetail-delete').addEventListener('click', () => {
    if (state.inquiryDetail) deleteInquiry(state.inquiryDetail.id);
  });
  dom.idetailSchedule.addEventListener('click', scheduleInquiry);

  /* オーバーレイの外側クリック */
  [[dom.overlayForm, closeForm], [dom.overlayDetail, closeDetail],
    [dom.overlayInquiry, closeInquiryForm], [dom.overlayIDetail, closeInquiryDetail],
  ].forEach(([overlay, close]) => {
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  });

  /* キーボード */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.overlayForm.hidden) closeForm();
      else if (!dom.overlayDetail.hidden) closeDetail();
      else if (!dom.overlayInquiry.hidden) closeInquiryForm();
      else if (!dom.overlayIDetail.hidden) closeInquiryDetail();
      else if (!dom.notifPop.hidden) closeNotifications();
      return;
    }
    if (!dom.overlayForm.hidden || !dom.overlayDetail.hidden
      || !dom.overlayInquiry.hidden || !dom.overlayIDetail.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;

    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't') goToday();
    else if (e.key === 'm') setView('month');
    else if (e.key === 'd') setView('three');
    else if (e.key === 'b') setView('board');
    else if (e.key === 'n') { dom.notifPop.hidden ? openNotifications() : closeNotifications(); }
  });

  window.addEventListener('hashchange', () => {
    restoreFromHash();
    if (state.view === 'month') initMonths();
    else if (state.view === 'three') initDays();
    loadView({ keepScroll: false });
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => render(), 200);
  });
}

/* ==========================================================================
   起動
   ========================================================================== */

fillTimeSelects();
syncHeaderHeight();
if (window.ResizeObserver) {
  new ResizeObserver(syncHeaderHeight).observe(document.querySelector('.app-header'));
}
restoreFromHash();
if (state.view === 'month') initMonths(); else initDays();
bind();
syncHash();
renderNotifications();
loadView({ keepScroll: false });
loadBoard({ rerender: state.view === 'board' });
loadNotifications();

// 現在時刻ラインの更新
setInterval(() => { if (state.view === 'three') render(); }, 60_000);

// 他の端末で追加・更新された予定や相談を拾う
setInterval(() => {
  if (!dom.overlayForm.hidden || !dom.overlayInquiry.hidden) return; // 入力中は邪魔しない
  loadNotifications();
  loadView();
}, POLL_INTERVAL_MS);
