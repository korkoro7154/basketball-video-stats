# タスク一覧: CourtVision Stats ゲームクロック拡張

- [x] 共通の型定義ファイル (`src/types.ts`) の更新 (gameTime プロパティの追加)
- [x] ライブモード用大型タイマーコンポーネント (`src/components/LiveTimer.tsx`) の新規作成
- [x] スタッツ入力・交代・ゲームクロックコントローラー (`src/components/StatsController.tsx`) の拡張
- [x] タイマー状態管理とカウントダウン・記録時間同期処理の実装 (`src/App.tsx`)
- [x] 動作確認と walkthrough.md の更新
- [x] `App.tsx` 内の `StatsController` に `onScoutingModeChange={setScoutingMode}` を受け渡し、試合モード・ライブモードの両方で即座に切り替え可能に設定
- [x] **UX向上：相手スカウティングモードOFF時のスタッツ入力フロー効率化（ポップアップバイパス）**
  - [x] スカウティングモードOFFの状態で相手チーム（Away）のアクション（シュート、ファウル、ターンオーバー等）を記録した際、位置選択および選手選択ポップアップを完全にバイパスして即時に記録するよう修正
  - [x] 相手シュート失敗（2P_MISS, 3P_MISS）を記録した場合は、ポップアップを挟まずに即座に記録し、続けてリバウンド登録ポップアップのみを展開して自チーム選手の獲得を追記可能に設定
