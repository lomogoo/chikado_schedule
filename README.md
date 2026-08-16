# チカ堂 SCHEDULE

チカ堂（サンモール一番町・旧金港堂跡地 地下空間）の**施設利用スケジュール管理アプリ**です。

- 📅 **月別ビュー** と **3日間ビュー** の 2 パターン
- 🕒 **30分単位**での貸し出し管理（0:00〜24:00）
- 🏷 **仮予約（未確定）** と **本予約（確定）** を区別
- 📝 予約ごとに**利用内容**を記録
- ☁️ データは **Supabase**（PostgREST）で管理
- ⚪️ 白背景のみ（ダークモードなし）／ポスターのトンマナ（墨黒・ピンク・ストーングレー）準拠

ビルド不要の静的サイトです（依存パッケージ 0）。`index.html` を開けばそのまま動きます。

---

## 画面

| ビュー | 説明 |
| --- | --- |
| 月 | 1か月をカレンダー表示。日付の数字をタップするとその日から 3 日間ビューへ。空白部分をタップで新規予約。 |
| 3日間 | 30 分刻みのタイムグリッド。空きスロットをタップするとその時間で新規予約フォームが開きます。重なった予約は自動で横に並びます。 |

### キーボードショートカット

| キー | 動作 |
| --- | --- |
| `←` / `→` | 前 / 次の期間へ |
| `T` | 今日へ |
| `M` | 月別ビュー |
| `D` | 3日間ビュー |
| `Esc` | ダイアログを閉じる |

---

## セットアップ

### 1. Supabase 側

セットアップ用の SQL は**リポジトリには含めず、別途共有**しています。
Supabase の **SQL Editor** に貼り付けて実行してください。
既存の `public.reservations` テーブルに、アプリが使う列を追加（既にあれば何もしない）します。

### 2. 接続設定

`js/config.js` に Supabase の URL と publishable key を記載しています。

```js
export const SUPABASE_URL = 'https://tfkzsbwhvhgxbnnfwtou.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_...';
```

publishable key（旧 anon key）は**ブラウザに公開される前提の鍵**なので、リポジトリに含めて問題ありません。
`service_role` キーは絶対にここへ置かないでください。

### 3. ローカルで動かす

ES Modules を使っているため、`file://` ではなく HTTP で開いてください。

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

---

## デプロイ

`main` または `claude/facility-booking-app-p46mw5` への push で GitHub Actions が走り、
GitHub Pages へ自動デプロイされます（`.github/workflows/deploy.yml`）。

公開 URL: <https://lomogoo.github.io/chikado_schedule/>

---

## データ構造

`public.reservations`

| 列 | 型 | 説明 |
| --- | --- | --- |
| `id` | uuid | 主キー |
| `date` | date | 利用日 |
| `start_time` | time | 開始時刻（30分単位） |
| `end_time` | time | 終了時刻（30分単位・`24:00` まで可） |
| `title` | text | 件名（必須） |
| `purpose` | text | **利用内容**（必須） |
| `status` | text | `tentative`（仮予約） / `confirmed`（本予約） |
| `organizer` | text | 利用者・団体名 |
| `contact` | text | 連絡先 |
| `headcount` | integer | 人数 |
| `notes` | text | 備考 |
| `created_at` | timestamptz | 作成日時 |
| `updated_at` | timestamptz | 更新日時 |

日時を `date` + `time` で保持しているため、タイムゾーン変換による時刻ズレが起きません
（施設予約は常に現地時間＝JST で運用されるため）。

---

## ファイル構成

```
index.html              画面の骨格（ヘッダー・2つのビュー・ダイアログ）
css/style.css           デザイン全体（ポスターのトンマナ）
assets/logo.svg         チカ堂ロゴ（縦組み）
assets/favicon.svg      ファビコン
js/config.js            Supabase 接続設定・表示定数
js/api.js               Supabase (PostgREST) の薄いラッパ
js/util.js              日付・時刻ユーティリティ
js/monthView.js         月別ビュー
js/threeDayView.js      3日間ビュー
js/app.js               状態管理・フォーム・詳細・イベント配線
```

### ロゴの差し替え

`assets/logo.svg` は公式ロゴの体裁（縦組みの太ゴシック）を再現したものです。
公式のロゴデータ（SVG / PNG）がある場合は、**同名で `assets/logo.svg` を差し替える**だけで
アプリ全体のロゴが入れ替わります（PNG を使う場合は `index.html` の `src` の拡張子も変更してください）。

---

## カラーパレット（ポスター準拠）

| 用途 | 値 |
| --- | --- |
| 墨黒（ロゴ・本予約） | `#141414` |
| ピンク（仮予約・アクセント） | `#f2b3c6` |
| ピンク（濃） | `#d97f9e` |
| ピンク（淡） | `#fdeef3` |
| ストーングレー（ポスター地色） | `#c9c6c0` |
| 背景 | `#ffffff` |
