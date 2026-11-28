# 高校バスケ部 動画・スタッツ共有ポータルWebアプリ 仕様書

このドキュメントは、部員全員がスマホから試合動画・練習動画・スタッツを閲覧し、マネージャー・顧問が記録・整理を行えるチームポータル（`src/portal/`）の最新仕様書です。

---

## 1. プロジェクト概要・運用環境

- **目的**：高校バスケ部の部員全員がスマホのブラウザから「試合動画」「練習動画」「スタッツ」をいつでも見返せる共有ポータルを提供する。
- **本番公開URL**：Vercel（`https://basketball-video-stats.vercel.app`）
  - 東京リージョン（`hnd1`）構成、Serverless Functions（`api/*.ts`）の最大実行時間は `45` 秒（`vercel.json`）。
  - 学校Wi-Fi での `*.firebaseapp.com` フィルタリングおよび Safari のクロスドメイン制限（ITP）対策として、`vercel.json` の `rewrites` で `/__/auth/*` と `/__/firebase/*` を `https://basketball-portal-11649.firebaseapp.com` へ中継する。
- **クラウドDB・認証**：Firebase プロジェクト `basketball-portal-11649`
  - Firestore の単一ドキュメント（`portal/main`）をリアルタイム購読・保存し、部員全員のスマホへ即時共有する（`src/portal/services/portalStore.ts`）。
  - Firebase 未設定の試作環境のみ、ブラウザの `localStorage` にフォールバックする。
  - `authDomain` は `src/portal/utils/authDomain.ts`（`resolveFirebaseAuthDomain()`）で判定し、本番ドメイン（`basketball-video-stats.vercel.app`）アクセス時のみ本番ドメイン自体を `authDomain` として認証を中継し、`localhost` やプレビュー環境等では従来どおり `VITE_FIREBASE_AUTH_DOMAIN` を使用する（`src/portal/firebase.ts`）。
- **ローカル限定テストモード（サンドボックス）**：
  - ローカル開発環境（`localhost` / `127.0.0.1` / LAN 開発サーバー等）のみで表示・有効化でき、Vercel 本番URLでは一切表示されない（`src/portal/utils/sandbox.ts`）。
  - 「テストモードに切替」を押すと、その時点の本番データ（`cloudData`）をディープコピーしてブラウザ内（`localStorage`）のみで保持し、ON 中は Firestore への書き込みを完全に遮断する（Google 認証は維持されるため AI 処理や YouTube 取込もテスト可能）。
  - リロード時もテストモード状態と仮データを維持し、「本番データでやり直す」での最新本番データからのリセットや、「テスト終了（本番へ戻る）」での本番接続復帰に対応する。
- **既存ファイル保持方針**：
  - 従来のPC向け画面ファイル（`src/App.tsx`, `src/components/*`, `src/utils/*`）は削除せず参考として保持している。
  - 現在のアプリ入口（`src/main.tsx`）はポータル画面（`PortalApp`）を描画する。
- **改修前セーブポイント**：Gitタグ `savepoint-before-portal`（コミット `90650d6`）
- **個人情報・機密保護**：
  - `都立三原/`、`スクショ例/`、`.env`（`.env.*`）、`.secrets/`、`.portal-backups/`、`*firebase-adminsdk*.json`、`*service-account*.json` は `.gitignore` と `scripts/parallel.mjs` の forbidden 判定で二重に除外し、絶対にコミット・公開しない。

---

## 2. セキュリティ（2段階ロック）

| 段階 | 対象 | 仕組み・できること |
| :--- | :--- | :--- |
| **第1ロック**<br>（全員ログイン必須） | 部員・マネージャー・顧問全員 | Firebase Authentication の Google ログイン必須。`ownerEmails` または `allowedEmails` に登録されたメールアドレスのみデータ閲覧が可能。未許可アカウントには `AccessDeniedScreen` を表示する。 |
| **第2ロック**<br>（管理者・記録者PIN） | マネージャー・顧問 | 「記録・管理」タブの操作時に `adminPin`（`PinGate`）の入力を必要とし、部員による誤編集・削除を防ぐ。 |

- **本番ドメイン経由の認証中継（学校Wi-Fi・Safari 対策）**：本番URL（`basketball-video-stats.vercel.app`）からの Google ログイン時は同ドメイン上の `/__/auth/*`・`/__/firebase/*` を経由して認証処理を行うため、学校Wi-Fi で `firebaseapp.com` がブロックされる環境や Safari でもログインが可能（Google Cloud Console の承認済みリダイレクト URI `https://basketball-video-stats.vercel.app/__/auth/handler` および Firebase Console の承認済みドメイン `basketball-video-stats.vercel.app` 登録を前提とする）。

---

## 3. 画面構成と最新機能（スマホ下部4タブ）

画面下部の4タブ（`home` / `games` / `practices` / `admin`）で片手操作を前提に構成されている。

### ① ホーム (`HomeView`)
- **通算成績サマリー**：3層構造の各試合（`GameMatch` 単位）ごとの勝敗・試合数カウントを集計表示。
- **最新情報＆入口**：最新の試合結果カード、新着の練習動画（直近3件）、試合／練習へのクイック検索、「記録・管理」への導線。
- **チームロゴ・PWAアプリアイコン＆ホーム画面追加案内**：
  - チームロゴから生成した各種アイコン（`public/manifest.webmanifest`・`apple-touch-icon.png`・`icon-192.png`・`icon-512.png`・`icon-512-maskable.png`・`favicon.png`）を PWA・ブラウザタブ・アプリ内ヘッダー・ログイン画面へ設定。
  - ブラウザから閲覧している場合のみ、ホーム画面最下部に折りたたみ式の「スマホのホーム画面に追加する」手順ガイド（iPhone Safari / Android Chrome 対応）を表示する（ホーム画面からのスタンドアロン起動時は自動で非表示）。

### ② 試合 (`GamesView`)
- **3層試合管理**：
  - **試合日（再生リスト／`GameRecord`） → 各試合（A戦・B戦・3校戦の対戦相手別／`GameMatch`） → 動画（1Q〜4Q等／`GameVideoClip`）** の3層で管理。
  - 3層導入前の旧データも `getGameMatches()` により自動で引き継ぎ表示する。
- **一覧＆検索**：
  - カテゴリ絞り込み（`すべて` / `公式戦` / `練習試合` / `カップ戦`）。
  - 試合日タイトル・各試合の対戦相手名・日付・メモを横断して検索可能。
- **試合詳細ビュー**：
  - 上部に YouTube 埋め込み再生（試合切替・動画切替に対応）。
  - 下部にボックススコア表／タイムラインを表示。集計範囲を **「この試合 (`match`)」／「1日合計 (`all`)」** で切り替えられる。
  - プレイ履歴の時刻タップで上の YouTube 動画の該当時刻へ自動ジャンプする。

### ③ 練習 (`PracticesView`)
- 限定公開 YouTube 練習動画の一覧表示＆埋め込み再生。
- キーワード検索、日付順切り替え（新着順／古い順）、練習タグによるワンタップ絞り込み。
- 動画ごとの見どころ時刻（`moments`）タップによる該当シーンへのジャンプ再生。

### ④ 記録・管理 (`AdminView`・PIN保護)
上部のサブタブを **3タブ（`スタッツ記録` / `YouTube登録` / `管理・設定`）** に統合している。

1. **スタッツ記録タブ**
   - **写真からの自動読み取り (`StatsScreenshotImporter`)**：画面最上部に配置。スコアシートやスタッツ画面のスクリーンショットからボックススコア・スコア・日付を AI で自動読み取りし、確認・補正して登録できる。
   - **手動記録（開閉式）**：ボックススコアまとめ入力・2タップリアルタイム入力は専用の開閉パネルに整理。
   - **試合と動画の整理 (`MatchOrganizerPanel`)**：
     - 各動画の元の YouTube タイトル（`youtubeTitle`）と現在の「何試合目・何Q」を上部に表示。
     - **AI自動整理ボタン**による自動グルーピング・ラベル付け。
     - 動画移動後に残ったスタッツ枠の1タップ移動・削除・誤合体防止機能を搭載。
   - **過去の試合日をまとめてAI整理 (`BulkMatchOrganizerPanel`)**：
     - `inspectGameOrganizationStatus()` により「1試合に5本以上集中」「仮ラベルあり」「元タイトル未取得」「対戦相手未設定」「細切れ・クォーター順ズレ」等の未整理候補を自動判定し、各日の内訳プレビュー・理由チップ・スタッツ有無付きで一覧表示。
     - 整頓済みの日はチェックを外したまま、未整理日だけ（または「未整理候補だけ」「未整理すべて」「スタッツ未記録のみ」「全選択」）を選んで複数日を順番に一括 AI 自動整理できる（途中中断・既存スタッツ保護に対応）。
   - **試合日ごとの「整理済み」チェックボックス (`GameRecord.isOrganized`)**：
     - 試合日プルダウン（選択時先頭に `✅` 表示＋整理済み件数表示）、個別整理パネル（`MatchOrganizerPanel`）、一括 AI 整理一覧の各行で連動して切り替え可能。
     - 「整理済み」にチェックを入れた試合日は、一括 AI 整理の「未整理候補」および初期選択から自動で除外される。
2. **YouTube登録タブ (`YouTubeImportPanel`)**
   - 以下の3導線のシンプルな構成で動画登録を行える。
   - **① まとめ再生リストから日付ごとに取り込み**：複数日分が入った再生リストから開始日フィルター（初期値 `2026-11-22`・早期打ち切り対応）で対象日を抽出し、日付別一覧・ワンタップ新着チェック（`localStorage` 記憶）から取り込める。
   - **② 再生リストURLをまとめて一括取り込み**：複数再生リスト URL や案内文をまとめて貼り付けて一括取り込みできる。
   - **③ 動画URLを1本ずつ登録**：練習動画・試合動画を1本ずつ直接登録できる。
   - **全試合動画登録ルートでの AI 自動整理（デフォルトON／OFF切替可）**：
     - 試合動画の登録時はまとめ取込（日付ごと）・一括取込・1本ずつ登録（元タイトル自動取得付き）のすべてで AI 整理を自動実行する（練習動画には走らせない）。
     - 既存試合日へ追加する場合も「既存動画＋新規動画の全体」を再整理し、`applyAiOrganizedMatches()` により既存スタッツを消さず・二重加算せずに安全反映する。
     - AI 整理の成功時は完了通知で明示し、失敗時は簡易分けで保存したうえで「仮分け保存・あとから『試合と動画の整理』でやり直せる」旨を通知する。
   - **全導線の二重登録防止**：ポータル全体（全試合・試合内マッチ・練習動画）の `youtubeId` を横断チェックして重複登録を防止する。
3. **管理・設定タブ**
   - 普段使わない「選手名簿」「データ削除」「基本設定（チーム名・管理者PIN・練習タグ・ログイン許可メンバー）」を折りたたみセクションへ整理。
   - 選手名簿は **「複数人まとめてコピペ登録」**（`src/portal/utils/roster.ts`：背番号＋氏名の複数行テキストを一括解析・表記ゆれ正規化・重複判定）に対応。

---

## 4. 裏側の AI 処理 (`api/`)

- **`api/parse-stats.ts`（スクショ自動読み取り API）**
  - Firebase ID トークン検証付き。
  - `gemini-3.8-flash` を最優先に、`gemini-3-flash-preview` → `gemini-3.7-flash` → `gemini-3.5-flash` → `gemini-3.5-flash-lite` へ高速フォールバック（モデル単位のクールダウン制御あり）。
  - フロント側（`StatsScreenshotImporter` / `statsOcrApi.ts`）の画像軽量化および2枚目以降の混雑スキップと連携して高速処理する。
- **`api/organize-matches.ts`（AI試合整理＆YouTubeタイトル取得 API）**
  - Firebase ID トークン検証付き。
  - YouTube 動画タイトルの一括取得（YouTube Data API / oEmbed）を行い、`gemini-3-flash-preview` / `gemini-3.8-flash` 等を用いて試合単位・チーム区分（`A` / `B` / `その他` / `指定なし`）・対戦相手ごとに自動整理する。
  - 丸数字（`①` `②`…）の 1動画＝1試合判定、時系列昇順（`① → ②` / `1Q → 4Q`）、対戦相手名直結の `A`/`B` や 8桁日付の分離、複数校混在時の試合分離ルールを備える。
- **ローカル開発サーバー連携**
  - `vite.config.ts` が開発時に `/api/parse-stats` と `/api/organize-matches` へ同じハンドラをマウントするため、ローカルでも本番同様の AI API 動作を確認できる。

---

## 5. データ構造サマリー（Firestore `portal/main` / `src/portal/types.ts`）

- **`PortalData`**：`teamName`, `players`, `games`, `practices`, `practiceTags`, `adminPin`, `ownerEmails`, `allowedEmails`
- **`GameRecord`（試合日）**：`title`, `date`, `opponent`, `category`, `homeScore`, `awayScore`, `youtubePlaylistId?`, `matches?: GameMatch[]`, `videos`, `events`, `manualBoxScore?`, `notes?`, `isOrganized?`
  - `GameMatch`（各試合）：`id`, `label`, `teamUnit?` (`'A' | 'B' | 'その他' | ''`), `opponent`, `homeScore`, `awayScore`, `videos: GameVideoClip[]`, `events: GameStatEvent[]`, `manualBoxScore?`
  - `GameVideoClip`（動画）：`id`, `label`, `youtubeTitle?`, `youtubeId`, `youtubeUrl`, `homeScore?`, `awayScore?`, `manualBoxScore?`
  - 後方互換のため `syncGameFromMatches()` で親階層のスコア・動画・イベント等とも同期を保つ。
- **`PracticeVideo`（練習動画）**：`id`, `title`, `date`, `youtubeId`, `youtubeUrl`, `youtubePlaylistId?`, `tags`, `memo?`, `moments` (`PracticeMoment[]`)
- **`PortalRevision`（変更履歴・`portal/main/revisions/{revisionId}`）**：`id`, `createdAt`, `actorEmail`, `actorName`, `actionSummary`, `changes`（最大10件）, `beforeSnapshot`（変更前の `PortalData`）, `afterStats`（`gameDays`, `matches`, `scoredMatches`, `players`, `practices`）

### オーナー専用 変更履歴＆ワンタップ復元（`?mode=history`）
- **1MB上限対策のサブコレクション保存**：
  - `portal/main` ドキュメント内には履歴を持たせず、Firestore サブコレクション `portal/main/revisions/{revisionId}` に 1変更＝1ドキュメントで保存する。
- **自動記録（`PortalApp.tsx` / `portalStore.ts` / `src/portal/utils/revisions.ts`）**：
  - `PortalApp.tsx` の `updateData` で本番クラウド（`target === 'cloud'`）への保存成功後、`summarizePortalDiff(before, after)` により差分があるときだけ変更者情報（`actorEmail`, `actorName`）と変更前スナップショット（`beforeSnapshot`）を自動記録する。
  - ローカルテストモード（サンドボックス）ON 中は履歴も Firestore へ一切書き込まない。
  - 履歴の保存に失敗した場合でも、ポータル本体のデータ保存は失敗させず安全に継続する。
- **専用URL・権限・復元フロー（`OwnerHistoryView`）**：
  - 通常4タブの画面内には入口（ボタン・リンク）を一切表示せず、URL に `?mode=history` を付けた場合のみ専用画面へ切り替える。
  - 未ログイン時は通常のログイン画面を表示し、ログイン済みでもオーナー以外（`isOwnerEmail()` が偽）には「オーナー専用ページです（閲覧権限がありません）」と「通常のポータルへ戻る」ボタンのみ表示する。
  - オーナー本人は新しい順に最大30件の履歴（日時 JST・変更者・1行要約・変更詳細）を閲覧でき、確認ダイアログ付きの **「この変更前に戻す」** で現在の最新データを「復元前の控え」として新しい履歴に保存してから `beforeSnapshot` を `portal/main` へ復元できる。履歴が30件を超えている場合は31件目以降の古い履歴を整理できる。
- **Firestore ルール（`firestore.rules`）**：
  - 既存の `match /portal/main` ルールを維持したまま、`match /portal/main/revisions/{revisionId}` を追加し、`create` は許可メンバー（オーナー含む）、`read`・`delete` はオーナー（`kokoronan7@gmail.com` または `portal/main` の `ownerEmails`）のみに限定、`update` は不可（改ざん防止）とする（※本番適用時は Firebase Console 側へ `firestore.rules` の反映が必要）。

### ローカル管理者用 Firestore 管理スクリプト（`scripts/portal-db.mjs`）
- **目的**：管理者がローカルPCから Firestore の `portal/main` ドキュメントを安全に確認・バックアップ・更新・復元するための CLI ツール（`npm run portal:db -- <command>` でも実行可能）。
- **秘密鍵とバンドル分離**：
  - `firebase-admin` は `devDependencies` のみに配置し、Vite のフロントエンドビルド（`dist/`）には一切含めない。
  - サービスアカウント鍵は環境変数 `FIREBASE_SERVICE_ACCOUNT_PATH` または既定パス `.secrets/firebase-admin-key.json` から読み込む（未配置時は設定手順を日本語で案内して安全終了）。
- **サブコマンド**：
  - `check`：接続確認し、チーム名・選手数・試合日数（総試合数・動画数）・練習動画数を表示。
  - `backup`：現在の `portal/main` を `.portal-backups/portal-YYYYMMDD-HHMMSS.json` に保存（同一秒衝突時は連番サフィックス付き）。
  - `summary`：登録済みの試合日（日付・タイトル・各試合の対戦相手／スコア有無／動画数）と選手名簿（背番号・氏名）を一覧出力。
  - `apply <jsonFile> [--dry-run] [--force]`：`PortalData` の必須 8 フィールド型検証・重複 ID／不正値検証・`undefined` 除去および既存データ比での安全チェック（試合数・マッチ数・記録済みスタッツ・動画数・選手数・練習動画数の大幅減少や全オーナー削除のブロック）を実施。`--dry-run` 時は変更サマリーのみ表示して書き込まず、本番反映時は**必ず先に自動 `backup` を `.portal-backups/` に保存してから**書き込む。
  - `restore <backupJsonFile>`：入力バックアップの検証後、**復元前に現在状態のバックアップを 1 枚 `.portal-backups/` に保存してから**指定バックアップで `portal/main` を復元。

---

## 6. 実装状況と残りの運用タスク

### 実装済み機能
- [x] スマホ優先4タブポータル土台（`HomeView` / `GamesView` / `PracticesView` / `AdminView`）
- [x] 2段階ロック（Firebase Google ログイン＋許可メール制＋管理者PIN）＆Firestore リアルタイム共有
- [x] まとめ再生リスト日付別取込・複数再生リスト URL 一括取込・個別 URL 登録の3導線（全試合登録ルートの AI 自動整理＆全導線二重登録防止付き）
- [x] 3層試合管理（試合日 → 各試合 → 動画）、3校戦対戦相手別表示＆検索、1日合計表示、動画時刻ジャンプ
- [x] スクショ自動読み取り（写真優先 UI ＋東京リージョン高速フォールバック）＆ AI 試合整理（選択式の過去試合日まとめてAI一括整理対応）
- [x] 管理画面の3タブ統合＆選手名簿の複数人コピペ一括登録
- [x] Vercel 本番反映（`https://basketball-video-stats.vercel.app`）
- [x] 複数チャット並行開発システム（`scripts/parallel.mjs`・`GEMINI.md`・`PARALLEL_GUIDE.md`・`PARALLEL_BOARD.md`）
- [x] ローカル環境限定の切り替え式テストモード（本番データをコピーした仮データで安全に検証・リセット可能）
- [x] チームロゴによる PWA アプリアイコン・ヘッダー/ログインロゴ設定＆スマホ「ホーム画面に追加」ガイド
- [x] 本番サイトの「管理・設定 → 選手名簿」へのチーム選手名簿登録
- [x] ローカル管理者用 Firestore 管理スクリプト（`scripts/portal-db.mjs`）と秘密鍵・バックアップの二重公開防止ガード（`.gitignore`・`scripts/parallel.mjs`）
- [x] 本番ドメイン経由の Firebase Auth 認証中継（`vercel.json` の `/__/auth/*`・`/__/firebase/*` プロキシと `authDomain` 自動切替による学校Wi-Fi・Safari 対策）
- [x] オーナー専用 変更履歴＆ワンタップ復元（`?mode=history`・`portal/main/revisions` サブコレクション保存・確認付き復元＆復元前控え自動保存・`firestore.rules` 対応）

### 残りの運用タスク（本番サイトでの操作）
- [ ] スマホや iPad から本番サイトを開き、未登録の試合日（電機大高校・9/23 美原・国分寺など）で写真取り込み・AI自動整理・表示確認・過去データの整理を行う
- [ ] 部員へ共有するタイミングで、「管理・設定 → ログイン許可メンバー」に部員・マネージャーの Google メールアドレスを追加する
