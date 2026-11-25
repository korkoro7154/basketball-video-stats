export type PortalTab = 'home' | 'games' | 'practices' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  loginMethod: 'google' | 'email';
}

export interface Player {
  id: string;
  number: string;
  name: string;
  position?: string;
  grade?: string;
}

export interface GameVideoClip {
  id: string;
  label: string;
  youtubeTitle?: string;
  youtubeId: string;
  youtubeUrl: string;
  homeScore?: number;
  awayScore?: number;
  manualBoxScore?: Record<string, PlayerBoxScoreEntry>;
}

export type QuarterLabel = '1Q' | '2Q' | '3Q' | '4Q' | 'OT';

export type StatActionType =
  | '2P_MADE'
  | '2P_MISS'
  | '3P_MADE'
  | '3P_MISS'
  | 'FT_MADE'
  | 'FT_MISS'
  | 'AST'
  | 'OREB'
  | 'DREB'
  | 'STL'
  | 'BLK'
  | 'TO'
  | 'PF';

export interface GameStatEvent {
  id: string;
  videoClipId?: string;
  quarter: QuarterLabel;
  timestampSec: number;
  team: 'home' | 'away';
  playerId: string | null;
  type: StatActionType;
  note?: string;
}

export interface PlayerBoxScoreEntry {
  playerId: string;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
}

export type GameCategory = '公式戦' | '練習試合' | 'カップ戦';

export type TeamUnit = 'A' | 'B' | 'その他' | '';

export interface GameMatch {
  id: string;
  label: string;
  teamUnit?: TeamUnit;
  opponent: string;
  homeScore: number;
  awayScore: number;
  videos: GameVideoClip[];
  events: GameStatEvent[];
  manualBoxScore?: Record<string, PlayerBoxScoreEntry>;
}

export interface GameRecord {
  id: string;
  title: string;
  date: string;
  opponent: string;
  category: GameCategory;
  homeScore: number;
  awayScore: number;
  youtubePlaylistId?: string;
  matches?: GameMatch[];
  videos: GameVideoClip[];
  events: GameStatEvent[];
  manualBoxScore?: Record<string, PlayerBoxScoreEntry>;
  notes?: string;
  isOrganized?: boolean;
}

export interface PracticeMoment {
  id: string;
  timestampSec: number;
  label: string;
}

export interface PracticeVideo {
  id: string;
  title: string;
  date: string;
  youtubeId: string;
  youtubeUrl: string;
  youtubePlaylistId?: string;
  tags: string[];
  memo?: string;
  moments: PracticeMoment[];
}

export interface PortalData {
  teamName: string;
  players: Player[];
  games: GameRecord[];
  practices: PracticeVideo[];
  practiceTags: string[];
  adminPin: string;
  ownerEmails: string[];
  allowedEmails: string[];
}
