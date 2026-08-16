/**
 * Supabase 接続設定・表示定数
 *
 * ここに置いているのは publishable key（旧 anon key に相当する公開鍵）です。
 * ブラウザから直接叩く前提の鍵なので、リポジトリに含めて問題ありません。
 * service_role キーは絶対にここへ置かないでください。
 */
export const SUPABASE_URL = 'https://tfkzsbwhvhgxbnnfwtou.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Ro1VwRK4o96IkyV6JC0q6w_vCjfFWYm';

/**
 * テーブル名。既存の `reservations` とは分離した専用テーブルを使います。
 */
export const TABLE = 'chikado_reservations';
export const BOARD_TABLE = 'chikado_inquiries';

/** 3日間ビューで同時に見せる日数（横スクロールでそれ以外の日も辿れます） */
export const VISIBLE_DAYS = 3;

/** 3日間ビューが内部に用意する日数と、端に近づいたときの追加量 */
export const DAY_WINDOW = 28;
export const DAY_EXTEND = 14;
export const DAY_MAX = 180;

/** 月別ビューが保持する月ブロックの上限と、現在月の前後に確保しておく月数 */
export const MONTH_MAX = 24;
export const MONTH_BUFFER = 2;

/** 予約枠の刻み（分） */
export const SLOT_MINUTES = 30;

/** 3日間ビューを開いたときに最初にスクロールして見せる時刻（時） */
export const DEFAULT_SCROLL_HOUR = 12;

/** 施設の想定営業時間（背景の色分けにのみ使用。予約自体は 0:00〜24:00 で可能） */
export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 23;

/** 仮予約のまま実施日がこの日数以内に迫ったら「要確認」として強調・通知する */
export const URGENT_DAYS = 30;

/** 他の端末で追加された予定を拾うためのポーリング間隔（ミリ秒） */
export const POLL_INTERVAL_MS = 90_000;

/** お知らせ対象として監視する期間（今日基準の日数） */
export const NOTIFY_PAST_DAYS = 30;
export const NOTIFY_FUTURE_DAYS = 400;
