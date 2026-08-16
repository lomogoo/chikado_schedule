/**
 * Supabase 接続設定
 *
 * ここに置いているのは publishable key（旧 anon key に相当する公開鍵）です。
 * ブラウザから直接叩く前提の鍵なので、リポジトリに含めて問題ありません。
 * service_role キーは絶対にここへ置かないでください。
 */
export const SUPABASE_URL = 'https://tfkzsbwhvhgxbnnfwtou.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Ro1VwRK4o96IkyV6JC0q6w_vCjfFWYm';

/**
 * 予約を格納するテーブル名。
 * 既存の `reservations` とは分離するため、このアプリ専用のテーブルを使います。
 */
export const TABLE = 'chikado_reservations';

/** 3日間ビューで一度に表示する日数 */
export const THREE_DAY_SPAN = 3;

/** 予約枠の刻み（分） */
export const SLOT_MINUTES = 30;

/** 3日間ビューを開いたときに最初にスクロールして見せる時刻（時） */
export const DEFAULT_SCROLL_HOUR = 12;

/** 施設の想定営業時間（背景の色分けにのみ使用。予約自体は 0:00〜24:00 で可能） */
export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 23;
