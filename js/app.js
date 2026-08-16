/**
 * チカ堂 SCHEDULE — アプリ本体
 */

import { Reservations, ApiError } from './api.js';
import {
  VISIBLE_DAYS, SLOT_MINUTES, DAY_WINDOW, DAY_EXTEND, DAY_MAX, MONTH_MAX,
  URGENT_DAYS, POLL_INTERVAL_MS, NOTIFY_PAST_DAYS, NOTIFY_FUTURE_DAYS,
} from './config.js';
import { renderMonths, captureMonthScroll, restoreMonthScroll, scrollToMonth } from './monthView.js';
import {
  renderDayStrip, captureStripScroll, restoreStripScroll, scrollToDay, currentFirstDay,
} from './threeDayView.js';
import { buildNotifications, markRead, primeOnFirstRun, signature } from './readState.js';
import {
  ymd, parseYmd, addDays, addMonths, startOfMonth, monthCells, monthKey, monthLabel,
  todayYmd, toMin, toHHMM, hhmm, slotOptions, durationLabel,
  formatDateJa, formatDateRangeJa, eachDate, el, overlaps, urgencyDays,
  STATUS_LABEL, DOW_JA,
} from './util.js';

/* ==========================================================================
   状態
   ========================================================================== */

const state = {
  view: 'month',          // 'month' | 'three'
  anchor: new Date(),     // 月別＝表示中の月 / 3日間＝左端の日
  filter: 'all',          // 'all' | 'confirmed' | 'tentative' | 'urgent'
  months: [],             // 月別ビューが保持する月（連続）
  days: [],               // 3日間ビューが保持する日（連続）
  items: [],              // 表示範囲の予約
  byDate: new Map(),      // 日付 → 予約[]（複数日予約は各日に展開）
  notifyItems: [],        // お知らせ判定用の広い範囲の予約
  notifications: [],
  shownKeys: '',          // 自動ポップアップ済みのお知らせ集合
  loading: 0,
  extending: false,
  editing: null,
  detail: null,
  pendingConflict: false,
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
  durationLabel: $('#duration-label'),
  spanLabel: $('#span-label'),

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
  state.months = [addMonths(base, -1), base, addMonths(base, 1)];
}

function initDays() {
  const base = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), state.anchor.getDate());
  const lead = Math.floor((DAY_WINDOW - VISIBLE_DAYS) / 2);
  state.days = Array.from({ length: DAY_WINDOW }, (_, i) => addDays(base, i - lead));
}

function viewRange() {
  if (state.view === 'month') {
    if (!state.months.length) initMonths();
    const first = monthCells(state.months[0])[0];
    const lastCells = monthCells(state.months[state.months.length - 1]);
    return [ymd(first), ymd(lastCells[lastCells.length - 1])];
  }
  if (!state.days.length) initDays();
  return [ymd(state.days[0]), ymd(state.days[state.days.length - 1])];
}

/* ==========================================================================
   データ取得
   ========================================================================== */

async function loadView({ keepScroll = true } = {}) {
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

async function loadNotifications() {
  const today = new Date();
  const from = ymd(addDays(today, -NOTIFY_PAST_DAYS));
  const to = ymd(addDays(today, NOTIFY_FUTURE_DAYS));
  let rows;
  try {
    rows = await Reservations.listRange(from, to);
  } catch {
    return; // お知らせの取得失敗で画面を止めない
  }
  state.notifyItems = rows;
  primeOnFirstRun(rows);
  refreshNotifications({ autoOpen: true });
}

/** 表示中の予約を日付ごとに展開する（複数日予約は各日に載せる） */
function indexItems() {
  const today = todayYmd();
  const map = new Map();

  for (const item of state.items) {
    item.__urgent = urgencyDays(item, today, URGENT_DAYS) !== null;

    if (state.filter === 'urgent' && !item.__urgent) continue;
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
  state.notifications = buildNotifications(state.notifyItems, todayYmd());
  renderNotifications();

  const keys = state.notifications.map((n) => `${n.kind}:${n.key}`).sort().join(',');
  if (autoOpen && state.notifications.length && keys !== state.shownKeys) {
    state.shownKeys = keys;
    openNotifications();
    const added = state.notifications.filter((n) => n.kind === 'new').length;
    const urgent = state.notifications.filter((n) => n.kind === 'deadline').length;
    const parts = [];
    if (added) parts.push(`新しい予定 ${added} 件`);
    if (urgent) parts.push(`要確認の仮予約 ${urgent} 件`);
    if (parts.length) toast(`${parts.join(' / ')} があります`);
  }
}

const NOTIF_KIND = {
  new: { label: '新規', cls: 'is-new' },
  updated: { label: '更新', cls: 'is-updated' },
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
    const when = `${formatDateRangeJa(item.start_date, item.end_date)}　${hhmm(item.start_time)}–${hhmm(item.end_time)}`;
    const sub = note.kind === 'deadline'
      ? (note.days === 0 ? '本日が実施日の仮予約です' : `実施まで残り ${note.days} 日の仮予約です`)
      : `${STATUS_LABEL[item.status] || item.status}${item.organizer ? ` / ${item.organizer}` : ''}`;

    return el('div', { class: `notif-item ${meta.cls}` }, [
      el('button', {
        class: 'notif-main',
        type: 'button',
        onclick: () => {
          markRead([[note.key, note.sig]]);
          refreshNotifications();
          closeNotifications();
          openDetail(item);
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
        'aria-label': '既読にする',
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

/** 詳細を開いたらその予約は既読扱いにする */
function markItemRead(item) {
  const note = state.notifications.find((n) => n.kind !== 'deadline' && n.item.id === item.id);
  if (!note) return;
  markRead([[note.key, note.sig]]);
  refreshNotifications();
}

/* ==========================================================================
   描画
   ========================================================================== */

function periodText() {
  if (state.view === 'month') {
    return { main: monthLabel(state.anchor), sub: '' };
  }
  const a = state.anchor;
  const b = addDays(a, VISIBLE_DAYS - 1);
  const sameMonth = a.getMonth() === b.getMonth();
  const main = sameMonth
    ? monthLabel(a)
    : `${a.getFullYear()}年${a.getMonth() + 1}–${b.getMonth() + 1}月`;
  return { main, sub: `${a.getDate()}日（${DOW_JA[a.getDay()]}）– ${b.getDate()}日（${DOW_JA[b.getDay()]}）` };
}

function renderChrome() {
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
}

function viewCtx() {
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

  if (state.view === 'month') {
    dom.viewMonth.hidden = false;
    dom.viewThree.hidden = true;

    const saved = keepScroll ? captureMonthScroll(dom.viewMonth) : null;
    renderMonths(dom.viewMonth, {
      ...viewCtx(),
      months: state.months,
      onEdge: onMonthEdge,
      onVisibleMonth: onVisibleMonth,
    });
    if (saved) restoreMonthScroll(dom.viewMonth, saved);
    else scrollToMonth(dom.viewMonth, monthKey(state.anchor));
  } else {
    dom.viewMonth.hidden = true;
    dom.viewThree.hidden = false;

    const saved = keepScroll ? captureStripScroll(dom.viewThree) : null;
    renderDayStrip(dom.viewThree, {
      ...viewCtx(),
      days: state.days,
      onEdge: onStripEdge,
      onVisibleDays: onVisibleDays,
    });
    if (saved && saved.key) restoreStripScroll(dom.viewThree, saved);
    else scrollToDay(dom.viewThree, ymd(state.anchor));
  }
}

/* ==========================================================================
   スクロールによる期間の継ぎ足し
   ========================================================================== */

function onVisibleMonth(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  if (monthKey(state.anchor) === key) return;
  state.anchor = d;
  renderChrome();
  syncHash();
}

function onVisibleDays(key) {
  if (ymd(state.anchor) === key) return;
  state.anchor = parseYmd(key);
  renderChrome();
  syncHash();
}

async function onMonthEdge(edge) {
  if (state.extending || state.months.length >= MONTH_MAX) return;
  state.extending = true;
  try {
    if (edge === 'bottom') {
      state.months = [...state.months, addMonths(state.months[state.months.length - 1], 1)];
    } else {
      state.months = [addMonths(state.months[0], -1), ...state.months];
    }
    await loadView();
  } finally {
    // 連続発火を抑えるため、描画が落ち着いてから解除する
    setTimeout(() => { state.extending = false; }, 250);
  }
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
  else initDays();
  syncHash();
  loadView({ keepScroll: false });
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
  dom.durationLabel.textContent = e > s
    ? `1日あたり ${durationLabel(e - s)}`
    : '終了時刻は開始時刻より後にしてください';
}

function updateSpan() {
  const s = dom.form.elements.start_date.value;
  const e = dom.form.elements.end_date.value;
  if (!s || !e) { dom.spanLabel.textContent = ''; return; }
  if (e < s) { dom.spanLabel.textContent = '終了日は開始日以降にしてください'; return; }
  const days = eachDate(s, e).length;
  dom.spanLabel.textContent = days === 1
    ? '単日利用'
    : `${days}日間の利用（期間中の各日、下記の時間帯で利用します）`;
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
    start_date: preset.start_date || todayYmd(),
    end_date: preset.end_date || preset.start_date || todayYmd(),
    start_time: preset.start_time || '18:00',
    end_time: preset.end_time || '20:00',
    title: '', purpose: '', organizer: '', contact: '', staff: '', headcount: '', notes: '',
  };

  f.elements.id.value = item?.id || '';
  f.elements.title.value = src.title || '';
  f.elements.start_date.value = src.start_date || '';
  f.elements.end_date.value = src.end_date || src.start_date || '';
  f.elements.start_time.value = hhmm(src.start_time);
  f.elements.end_time.value = hhmm(src.end_time);
  f.elements.purpose.value = src.purpose || '';
  f.elements.organizer.value = src.organizer || '';
  f.elements.contact.value = src.contact || '';
  f.elements.staff.value = src.staff || '';
  f.elements.headcount.value = src.headcount ?? '';
  f.elements.notes.value = src.notes || '';
  [...f.elements.status].forEach((r) => { r.checked = r.value === (src.status || 'tentative'); });

  dom.formTitle.textContent = item ? '予約を編集' : '新規予約';
  dom.formDelete.hidden = !item;
  updateDuration();
  updateSpan();

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
    start_date: f.elements.start_date.value,
    end_date: f.elements.end_date.value || f.elements.start_date.value,
    start_time: f.elements.start_time.value,
    end_time: f.elements.end_time.value,
    status: f.querySelector('input[name="status"]:checked')?.value || 'tentative',
    purpose: f.elements.purpose.value.trim(),
    organizer: f.elements.organizer.value.trim(),
    contact: f.elements.contact.value.trim(),
    staff: f.elements.staff.value.trim(),
    headcount: f.elements.headcount.value === '' ? null : Number(f.elements.headcount.value),
    notes: f.elements.notes.value.trim(),
  };
}

function validate(v) {
  const errors = [];
  if (!v.title) errors.push('・件名を入力してください。');
  if (!v.start_date) errors.push('・利用日（開始）を選択してください。');
  if (!v.end_date) errors.push('・利用日（終了）を選択してください。');
  if (v.start_date && v.end_date && v.end_date < v.start_date) {
    errors.push('・終了日は開始日以降にしてください。');
  }
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

/** 期間・時間帯が重なる他の予約を探す */
async function findConflicts(v, excludeId) {
  let rows;
  try {
    rows = await Reservations.listRange(v.start_date, v.end_date);
  } catch {
    return []; // 重複チェックのための通信失敗で保存自体は止めない
  }
  const s = toMin(v.start_time);
  const e = toMin(v.end_time);
  const mine = new Set(eachDate(v.start_date, v.end_date));

  return rows.filter((o) => {
    if (o.id === excludeId) return false;
    if (!overlaps(s, e, toMin(o.start_time), toMin(o.end_time))) return false;
    return eachDate(o.start_date, o.end_date).some((d) => mine.has(d));
  });
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
      const lines = conflicts.map((c) => `・${formatDateRangeJa(c.start_date, c.end_date)} `
        + `${hhmm(c.start_time)}–${hhmm(c.end_time)}　${c.title}（${STATUS_LABEL[c.status] || c.status}）`);
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
    // 自分の操作でお知らせが出ないよう、保存直後に既読へ倒す
    if (saved?.id) markRead([[saved.id, signature(saved)]]);
    toast(id ? '予約を更新しました' : '予約を登録しました');
    closeForm();
    await Promise.all([loadView(), loadNotifications()]);
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

function openDetail(item) {
  state.detail = item;
  const mins = toMin(item.end_time) - toMin(item.start_time);
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
      el('div', { class: 'detail-when-date', text: formatDateRangeJa(item.start_date, item.end_date) }),
      el('div', { class: 'detail-when-time' }, [
        document.createTextNode(`${days > 1 ? '各日 ' : ''}${hhmm(item.start_time)} – ${hhmm(item.end_time)}`),
        el('span', { class: 'detail-dur', text: `${durationLabel(mins)}${days > 1 ? ` × ${days}日` : ''}` }),
      ]),
    ]),
    el('dl', { class: 'detail-list' }, [
      detailRow('利用内容', item.purpose),
      detailRow('利用者・団体名', item.organizer),
      detailRow('連絡先', item.contact),
      detailRow('チカ堂担当者', item.staff),
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
   イベント登録
   ========================================================================== */

function bind() {
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  $('#btn-today').addEventListener('click', goToday);
  $('#btn-new').addEventListener('click', () => openForm({ start_date: ymd(state.anchor) }));

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

  /* フォーム */
  $('#form-close').addEventListener('click', closeForm);
  $('#form-cancel').addEventListener('click', closeForm);
  dom.formSubmit.addEventListener('click', submitForm);
  dom.formDelete.addEventListener('click', () => {
    const id = dom.form.elements.id.value;
    if (id) deleteReservation(id);
  });

  dom.form.addEventListener('submit', (e) => { e.preventDefault(); submitForm(); });
  dom.form.addEventListener('input', () => { state.pendingConflict = false; });

  dom.form.elements.start_date.addEventListener('change', () => {
    const s = dom.form.elements.start_date.value;
    const e = dom.form.elements.end_date.value;
    if (!e || e < s) dom.form.elements.end_date.value = s;
    updateSpan();
  });
  dom.form.elements.end_date.addEventListener('change', updateSpan);

  dom.form.elements.start_time.addEventListener('change', () => {
    const s = toMin(dom.form.elements.start_time.value);
    const e = toMin(dom.form.elements.end_time.value);
    if (e <= s) dom.form.elements.end_time.value = toHHMM(Math.min(s + SLOT_MINUTES * 2, 24 * 60));
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
      else if (!dom.notifPop.hidden) closeNotifications();
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
    else if (e.key === 'n') { dom.notifPop.hidden ? openNotifications() : closeNotifications(); }
  });

  window.addEventListener('hashchange', () => {
    restoreFromHash();
    if (state.view === 'month') initMonths(); else initDays();
    loadView({ keepScroll: false });
  });

  /* 画面幅が変わると列幅・1時間の高さが変わるため描き直す */
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
loadNotifications();

// 現在時刻ラインの更新
setInterval(() => { if (state.view === 'three') render(); }, 60_000);

// 他の端末で追加・更新された予定を拾う
setInterval(() => {
  if (!dom.overlayForm.hidden) return; // 入力中は邪魔しない
  loadNotifications();
  loadView();
}, POLL_INTERVAL_MS);
