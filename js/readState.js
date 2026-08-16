/**
 * 既読 / 未読の管理。
 *
 * サーバー側にユーザーの概念が無いため、既読状態は
 * **この端末の localStorage** に予約 ID をキーとして保存します
 * （端末ごとに独立して既読が管理されます）。
 *
 *   read[<予約ID>]            = その予約を最後に確認したときの内容シグネチャ
 *   read['deadline:<予約ID>'] = 期限接近アラートを確認済み
 */

import { URGENT_DAYS } from './config.js';
import { urgencyDays } from './util.js';

const KEY_READ = 'chikado.read.v1';
const KEY_INIT = 'chikado.initialized.v1';
const KEY_CLIENT = 'chikado.clientId.v1';

/** この端末を識別するローカル ID（お知らせの既読はこの単位で管理されます） */
export function clientId() {
  let id = null;
  try { id = localStorage.getItem(KEY_CLIENT); } catch { /* 使用不可 */ }
  if (!id) {
    id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    try { localStorage.setItem(KEY_CLIENT, id); } catch { /* 使用不可 */ }
  }
  return id;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY_READ) || '{}') || {};
  } catch {
    return {};
  }
}

function save(map) {
  try {
    localStorage.setItem(KEY_READ, JSON.stringify(map));
  } catch { /* 容量超過などは無視（既読が残らないだけ） */ }
}

/** 予約の「内容」を表す文字列。ここが変わったら更新として扱う */
export function signature(item) {
  return [
    item.updated_at || '',
    item.start_date, item.end_date,
    item.start_time, item.end_time,
    item.status, item.title,
  ].join('|');
}

export function isFirstRun() {
  try {
    return localStorage.getItem(KEY_INIT) !== '1';
  } catch {
    return false;
  }
}

function markInitialized() {
  try { localStorage.setItem(KEY_INIT, '1'); } catch { /* 使用不可 */ }
}

/** 初回起動時に既存の予定をすべて既読にする（過去分の通知でうずまらないように） */
export function primeOnFirstRun(items) {
  if (!isFirstRun()) return false;
  const map = load();
  for (const item of items) map[item.id] = signature(item);
  save(map);
  markInitialized();
  return true;
}

export function markRead(keys) {
  const map = load();
  for (const [key, sig] of keys) map[key] = sig;
  save(map);
}

/**
 * 未読のお知らせを組み立てる。
 * - new      … この端末でまだ見ていない予定
 * - updated  … 前回確認時から内容が変わった予定
 * - deadline … 仮予約のまま実施日が URGENT_DAYS 以内に迫った予定
 */
export function buildNotifications(items, todayStr) {
  const map = load();
  const out = [];

  for (const item of items) {
    const sig = signature(item);
    const prev = map[item.id];
    if (prev === undefined) out.push({ kind: 'new', key: item.id, sig, item });
    else if (prev !== sig) out.push({ kind: 'updated', key: item.id, sig, item });
  }

  for (const item of items) {
    const days = urgencyDays(item, todayStr, URGENT_DAYS);
    if (days === null) continue;
    const key = `deadline:${item.id}`;
    if (map[key] === 'done') continue;
    out.push({ kind: 'deadline', key, sig: 'done', item, days });
  }

  const order = { deadline: 0, new: 1, updated: 2 };
  out.sort((a, b) => (order[a.kind] - order[b.kind])
    || a.item.start_date.localeCompare(b.item.start_date));
  return out;
}
