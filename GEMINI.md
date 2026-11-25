# 並行開発ルール（basketball-video-stats）

このワークスペースでは、複数のAIチャットが同時に安全に開発できるよう、以下のルールに従って作業してください。

---

## 1. 適用条件

- **調査・質問・相談だけの場合**：作業部屋を借りずに、そのまま確認・回答して構いません。
- **コード・設定・ドキュメントを編集する場合**：必ず `scripts/parallel.mjs` で専用作業部屋（`.worktrees/room-a` 〜 `room-c`）を確保し、その部屋の中だけを編集してください。親フォルダ（原本の `src/` や `api/` 等）を直接編集してはいけません。

### メインチャット（相談・進行役）と開発チャットの役割分担

- **メインチャット（相談・設計・進捗確認・本番公開を行うチャット）では、原則として勝手にコードやファイルの編集を始めないこと。**
  - 新機能や修正の方針が決まったら、デフォルトでは**別チャットへそのまま貼り付けられる依頼文（`PARALLEL_GUIDE.md` のスタート文形式）**を作成してユーザーに渡してください。
- **例外は「その1回限り」と扱うこと**：
  - ユーザーが「このチャットで作っていいよ」と明示した場合でも、その許可は**その1つのタスクのみ**に適用されます。次の新しい要望や追加改修では再び原則に戻り、勝手に直接編集せず**別チャット用の依頼文を作るか、このチャットで作るかを確認**してください。
- **本番公開（`git push`）はメインチャットでまとめて行う**：
  - 各開発チャットはローカル `main` への統合（`scripts/parallel.mjs merge`）までを担当し、本番公開はメインチャットへ明示的に指示があったときだけ実行します。

---

## 2. 標準ワークフロー（4手順）

1. **状況確認・仕様把握**
   - 作業前に `node scripts/parallel.mjs status` を実行し、`PARALLEL_BOARD.md` で他のチャットが作業中のエリア・`shared` ロックを確認する。
   - **実装・画面改修・設計相談の前に必ず `PORTAL_SPEC.md` を読み、現在の最新仕様（3層試合管理・2段階ロック・管理3タブ構成・AI処理等）を把握してから進める。**
2. **作業部屋の確保**
   - `node scripts/parallel.mjs claim --task "<作業内容>" --area "<エリア1,エリア2>"` を実行する（共通ファイルも触る場合は `--shared` を付ける）。
   - 以降は必ずコマンドが表示した **作業部屋の絶対パス（`.worktrees/<room>/...`）配下のみ** を編集し、コマンドやビルドもその部屋をカレントディレクトリにして実行する。
   - 必要に応じて `node scripts/parallel.mjs note <room> "<進捗メモ>"` でボードを更新する。
3. **動作確認（専用ポート・必ず停止）**
   - ローカル確認サーバーを起動する場合は、部屋ごとの専用ポートを使う（`room-a: 5174` / `room-b: 5175` / `room-c: 5176`、`main` の `5173` は使わない）。
   - 例：`npm run dev -- --port 5174`
   - Mac（Intel MacBook Pro / 16GB）への負荷を防ぐため、確認が終わったら起動したサーバーを**必ず停止**する。
4. **仕様書反映・統合（または解放）**
   - 画面構成・データ構造・主要機能・AI仕様など**大きな仕様変更を行った場合は、作業完了時に `PORTAL_SPEC.md` も最新内容へ更新する**（変更対象に `docs` エリアを含めるか、完了後に更新する）。
   - 作業部屋内で `git add`（対象ファイルのみ）・`git commit` を行い、`node scripts/parallel.mjs check <room>` で違反がないことを確認する。
   - 親フォルダ（または作業部屋）から `node scripts/parallel.mjs merge <room> --summary "<完了メモ>"` を実行し、`main` 同期と `npm run build` を通過させてローカル `main` へ統合する。
   - 編集を取りやめた場合は `node scripts/parallel.mjs release <room> --reason "<理由>"` で予約だけを解放する。

---

## 3. エリア区分と衝突ルール

| エリア名 | 主な対象ファイル |
| :--- | :--- |
| `portal-home` | `HomeView.*`, `LoginScreen.*`, `PinGate.*`, `AccessDeniedScreen.*` |
| `portal-games` | `GamesView.*`, `MatchOrganizerPanel.*`, `StatsScreenshotImporter.*`, `src/portal/utils/matches.*`, `src/portal/utils/stats.*` |
| `portal-practices` | `PracticesView.*`, `YouTubeEmbed.*`, `YouTubeImportPanel.*`, `src/portal/services/youtubeApi.*`, `src/portal/utils/youtube.*` |
| `portal-admin` | `AdminView.*`, `src/portal/utils/roster.*` |
| `video-analyzer` | `src/App.tsx`, `src/App.css`, `src/components/**`, `src/utils/**` |
| `api` | `api/**`, `src/portal/services/statsOcrApi.*`, `src/portal/services/matchOrganizeApi.*` |
| `docs` | `*.md`（`GEMINI.md` と `PARALLEL_BOARD.md` は除く） |
| `shared`（`--shared`） | `PortalApp.tsx`, `types.ts`, `portalStore.ts`, `firebase.ts`, `portal.css`, `index.css`, `main.tsx`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `firestore.rules`, `vercel.json`, `render.yaml`, `index.html`, `GEMINI.md`, `scripts/parallel.mjs`, `.gitignore` |

- **衝突時の行動**：他チャットが担当中のエリアや `shared` ロック中ファイルに触れる必要がある場合は、勝手に強行せず **ユーザーへ順番待ちまたは範囲調整を確認** してください。
- **スタイル追加のコツ**：`src/portal/portal.css` は `shared`（同時1部屋のみ）です。画面専用の見た目を追加する場合は、可能な限り同じディレクトリに専用CSS（例：`GamesView.css`）を新規作成してコンポーネントから読み込んでください。

---

## 4. 安全・保護ルール

- **本番公開しない**：`git push`（Vercel 本番反映）は、ユーザーが明示的に「本番に公開して」等と指示したときだけ実行する。
- **本番データ保護**：Firebase 本番データや `firestore.rules` を指示なく変更しない。
- **機密・個人情報保護**：`都立三原/`、`スクショ例/`、`.env`（`.env.*`）は絶対に `git add` / コミットしない。
- **削除禁止**：ユーザーの許可なくファイルや `.worktrees/` を削除しない（作業部屋は解放後も再利用する）。

---

## 5. ユーザーへの返答ルール

- ユーザーは非エンジニアのため、コードや技術用語の詳細説明は省き、簡潔な日本語で進捗と結果のみを報告してください（説明を求められた場合のみ、わかりやすい例え話を使って説明します）。
