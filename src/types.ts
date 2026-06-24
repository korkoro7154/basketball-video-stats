export type Quarter = '1Q' | '2Q' | '3Q' | '4Q' | 'OT' | 'TOTAL';

export interface Player {
  id: string;
  name: string;
  number: string; // 背番号
  team: 'home' | 'away'; // 所属チーム
}

export type StatType =
  | '3P_MADE'   // 3点シュート成功
  | '3P_MISS'   // 3点シュート失敗
  | '2P_MADE'   // 2点シュート成功
  | '2P_MISS'   // 2点シュート失敗
  | 'FT_MADE'   // フリースロー成功
  | 'FT_MISS'   // フリースロー失敗
  | 'AST'       // アシスト
  | 'OREB'      // オフェンスリバウンド
  | 'DREB'      // ディフェンスリバウンド
  | 'STL'       // スティール
  | 'BLK'       // ブロック
  | 'TO'        // ターンオーバー
  | 'PF'        // パーソナルファウル
  | 'TIMEOUT'   // タイムアウト
  | 'SUB_IN'    // 選手交代イン
  | 'SUB_OUT'   // 選手交代アウト
  | 'PRACTICE_TAG'; // 練習モード用カスタムタグ

export interface StatsEvent {
  id: string;
  timestamp: number; // 動画の再生位置（秒）またはライブ時のクオーター経過秒
  gameTime?: number; // 記録時のゲームタイマー残り秒数 (新規追加)
  playerId: string | null; // 選手ID
  type: StatType;
  team: 'home' | 'away';
  quarter: Quarter; // クオーター情報
  notes?: string;
  practiceTag?: string; // 練習モード用のタグ名
  location?: { x: number; y: number }; // シュート位置（x: 0~100, y: 0~100）
}

export interface GameInfo {
  title: string;
  date: string;
  opponent: string;
}

// 各クオーターごとの動画情報
export interface QuarterVideo {
  videoUrl: string | null;
  videoName: string;
}

// アプリケーション全体のエクスポート/インポートデータ構造
export interface ExportData {
  version: string;
  mode: 'game' | 'practice' | 'live' | 'tactical';
  scoutingMode: boolean;
  gameInfo: GameInfo;
  quarterVideos: Record<Quarter, QuarterVideo>;
  startingPlayers: Record<Quarter, string[]>; // クオーターごとのスターティングメンバーID(自チームのみ)
  players: Player[];
  events: StatsEvent[];
  practiceTags: string[]; // 練習用カスタムタグのリスト
}
