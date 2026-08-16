/**
 * Supabase (PostgREST) の薄いラッパ。
 * 依存ライブラリ無しで動くよう、fetch を直接叩いています。
 */

import { SUPABASE_URL, SUPABASE_KEY, TABLE, BOARD_TABLE } from './config.js';

const REST = `${SUPABASE_URL}/rest/v1`;

/** 予約フォームで扱う列。DB に無い列を送らないようここで固定する。 */
export const FIELDS = [
  'start_date', 'end_date', 'start_time', 'end_time',
  'title', 'purpose', 'status',
  'organizer', 'contact', 'staff', 'headcount', 'notes',
];

/** 相談（掲示板）で扱う列 */
export const BOARD_FIELDS = [
  'title', 'desired_period', 'purpose', 'status',
  'organizer', 'contact', 'staff', 'headcount', 'notes', 'reservation_id',
];

const SELECT = ['id', ...FIELDS, 'created_at', 'updated_at'].join(',');
const BOARD_SELECT = ['id', ...BOARD_FIELDS, 'created_at', 'updated_at'].join(',');

function baseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export class ApiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${REST}${path}`, { ...options, headers: baseHeaders(options.headers) });
  } catch (cause) {
    throw new ApiError('Supabase に接続できませんでした。通信環境をご確認ください。', { details: String(cause) });
  }

  if (!res.ok) {
    let payload = null;
    try { payload = await res.json(); } catch { /* 本文なし */ }
    const msg = payload?.message || payload?.hint || `Supabase エラー (HTTP ${res.status})`;
    throw new ApiError(msg, { status: res.status, details: payload?.details || payload?.code });
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** 送信前に、DB のカラム型に合うよう値を整える */
function normalize(input, fields) {
  const out = {};
  for (const key of fields) {
    if (!(key in input)) continue;
    let v = input[key];

    if (typeof v === 'string') v = v.trim();
    if (v === '') v = null;
    if (key === 'headcount') v = v === null ? null : Number(v);

    out[key] = v;
  }
  return out;
}

/** 汎用の CRUD を組み立てる */
function makeResource(table, fields, select) {
  return {
    async create(input) {
      const rows = await request(`/${table}`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(normalize(input, fields)),
      });
      return rows?.[0] ?? null;
    },

    async update(id, input) {
      const body = { ...normalize(input, fields), updated_at: new Date().toISOString() };
      const rows = await request(`/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
      return rows?.[0] ?? null;
    },

    async remove(id) {
      await request(`/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async all(order) {
      const q = new URLSearchParams();
      q.append('select', select);
      q.append('order', order);
      return (await request(`/${table}?${q}`)) || [];
    },
  };
}

const reservationResource = makeResource(TABLE, FIELDS, SELECT);

export const Reservations = {
  ...reservationResource,

  /**
   * 期間に「かかっている」予約をすべて取得する。
   * 複数日にまたがる予約も拾えるよう、期間の重なりで判定している。
   */
  async listRange(fromDate, toDate) {
    const q = new URLSearchParams();
    q.append('select', SELECT);
    q.append('start_date', `lte.${toDate}`);
    q.append('end_date', `gte.${fromDate}`);
    q.append('order', 'start_date.asc,start_time.asc');
    return (await request(`/${TABLE}?${q}`)) || [];
  },

  /** 終了日を省略した場合は開始日と同じ（単日利用）とみなして作成する */
  async create(input) {
    const v = { ...input };
    if (v.start_date && !v.end_date) v.end_date = v.start_date;
    return reservationResource.create(v);
  },
};

export const Inquiries = {
  ...makeResource(BOARD_TABLE, BOARD_FIELDS, BOARD_SELECT),

  async list() {
    return this.all('created_at.desc');
  },
};
