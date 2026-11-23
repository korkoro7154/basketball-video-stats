import type {
  GameMatch,
  GameRecord,
  GameStatEvent,
  Player,
  PlayerBoxScoreEntry,
  StatActionType,
} from '../types';
import { getGameMatches, hasNonEmptyManualBox } from './matches';

export { hasNonEmptyManualBox };

export interface StatMetaItem {
  label: string;
  shortLabel: string;
  points: number;
  tone: 'success' | 'danger' | 'info' | 'purple' | 'warning';
}

export const STAT_META: Record<StatActionType, StatMetaItem> = {
  '2P_MADE': { label: '2P成功', shortLabel: '+2P', points: 2, tone: 'success' },
  '2P_MISS': { label: '2P失敗', shortLabel: '2P×', points: 0, tone: 'danger' },
  '3P_MADE': { label: '3P成功', shortLabel: '+3P', points: 3, tone: 'success' },
  '3P_MISS': { label: '3P失敗', shortLabel: '3P×', points: 0, tone: 'danger' },
  FT_MADE: { label: 'FT成功', shortLabel: '+1FT', points: 1, tone: 'success' },
  FT_MISS: { label: 'FT失敗', shortLabel: 'FT×', points: 0, tone: 'danger' },
  OREB: { label: 'オフェンスREB', shortLabel: 'O-REB', points: 0, tone: 'info' },
  DREB: { label: 'ディフェンスREB', shortLabel: 'D-REB', points: 0, tone: 'info' },
  AST: { label: 'アシスト', shortLabel: 'AST', points: 0, tone: 'info' },
  STL: { label: 'スティール', shortLabel: 'STL', points: 0, tone: 'purple' },
  BLK: { label: 'ブロック', shortLabel: 'BLK', points: 0, tone: 'purple' },
  TO: { label: 'ターンオーバー', shortLabel: 'TO', points: 0, tone: 'warning' },
  PF: { label: 'ファウル', shortLabel: 'PF', points: 0, tone: 'danger' },
};

export interface PlayerBoxScoreRow extends PlayerBoxScoreEntry {
  number: string;
  name: string;
  reb: number;
  fgPercent: number;
  tpPercent: number;
  ftPercent: number;
}

export interface BoxScoreTotals {
  pts: number;
  fgm: number;
  fga: number;
  fgPercent: number;
  tpm: number;
  tpa: number;
  tpPercent: number;
  ftm: number;
  fta: number;
  ftPercent: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
}

export function createEmptyBoxScoreEntry(playerId: string): PlayerBoxScoreEntry {
  return {
    playerId,
    pts: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    to: 0,
    pf: 0,
  };
}

function calcPercent(made: number, attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.round((made / attempts) * 100);
}

export function applyEventToEntry(
  entry: PlayerBoxScoreEntry,
  type: StatActionType
): void {
  switch (type) {
    case '2P_MADE':
      entry.pts += 2;
      entry.fgm += 1;
      entry.fga += 1;
      break;
    case '2P_MISS':
      entry.fga += 1;
      break;
    case '3P_MADE':
      entry.pts += 3;
      entry.fgm += 1;
      entry.fga += 1;
      entry.tpm += 1;
      entry.tpa += 1;
      break;
    case '3P_MISS':
      entry.fga += 1;
      entry.tpa += 1;
      break;
    case 'FT_MADE':
      entry.pts += 1;
      entry.ftm += 1;
      entry.fta += 1;
      break;
    case 'FT_MISS':
      entry.fta += 1;
      break;
    case 'OREB':
      entry.oreb += 1;
      break;
    case 'DREB':
      entry.dreb += 1;
      break;
    case 'AST':
      entry.ast += 1;
      break;
    case 'STL':
      entry.stl += 1;
      break;
    case 'BLK':
      entry.blk += 1;
      break;
    case 'TO':
      entry.to += 1;
      break;
    case 'PF':
      entry.pf += 1;
      break;
  }
}

function addBoxEntry(
  target: PlayerBoxScoreEntry,
  src: PlayerBoxScoreEntry
): void {
  target.pts += src.pts;
  target.fgm += src.fgm;
  target.fga += src.fga;
  target.tpm += src.tpm;
  target.tpa += src.tpa;
  target.ftm += src.ftm;
  target.fta += src.fta;
  target.oreb += src.oreb;
  target.dreb += src.dreb;
  target.ast += src.ast;
  target.stl += src.stl;
  target.blk += src.blk;
  target.to += src.to;
  target.pf += src.pf;
}

/** Computes score and recorded status for a single match within a game day. */
export function computeMatchSummary(match: GameMatch): {
  homeScore: number;
  awayScore: number;
  hasStats: boolean;
  isManual: boolean;
  eventCount: number;
} {
  const hasManual = hasNonEmptyManualBox(match.manualBoxScore);

  let homeScore = match.homeScore ?? 0;
  let awayScore = match.awayScore ?? 0;

  if (hasManual) {
    const manualHomePts = Object.values(match.manualBoxScore ?? {}).reduce(
      (sum, entry) => sum + entry.pts,
      0
    );
    homeScore = manualHomePts > 0 ? manualHomePts : (match.homeScore ?? 0);
    awayScore = match.awayScore ?? 0;
  } else if (match.events.length > 0) {
    let homePts = 0;
    let awayPts = 0;
    match.events.forEach((e) => {
      const pts = STAT_META[e.type].points;
      if (e.team === 'home') homePts += pts;
      else awayPts += pts;
    });
    homeScore = homePts > 0 ? homePts : (match.homeScore ?? 0);
    awayScore = awayPts > 0 ? awayPts : (match.awayScore ?? 0);
  }

  const hasStats =
    hasManual ||
    match.events.length > 0 ||
    homeScore > 0 ||
    awayScore > 0;

  return {
    homeScore,
    awayScore,
    hasStats,
    isManual: hasManual,
    eventCount: match.events.length,
  };
}

export function computeGameBoxScore(
  game: GameRecord,
  players: Player[],
  matchId?: string | 'ALL'
): {
  rows: PlayerBoxScoreRow[];
  teamTotals: BoxScoreTotals;
  isManual: boolean;
  hasStats: boolean;
} {
  const entryMap = new Map<string, PlayerBoxScoreEntry>();
  players.forEach((p) => {
    entryMap.set(p.id, createEmptyBoxScoreEntry(p.id));
  });

  const addEventsToMap = (events: GameStatEvent[]) => {
    events
      .filter((e) => e.team === 'home' && e.playerId)
      .forEach((e) => {
        const current = entryMap.get(e.playerId!);
        if (current) applyEventToEntry(current, e.type);
      });
  };

  const addManualBoxToMap = (box?: Record<string, PlayerBoxScoreEntry>) => {
    if (!box) return;
    players.forEach((p) => {
      const src = box[p.id];
      const current = entryMap.get(p.id);
      if (src && current) addBoxEntry(current, src);
    });
  };

  const matches = getGameMatches(game);
  let isManual = false;
  let hasStats = false;

  if (matchId && matchId !== 'ALL') {
    const match = matches.find((m) => m.id === matchId);
    if (match) {
      const summary = computeMatchSummary(match);
      isManual = summary.isManual;
      hasStats = summary.hasStats;
      if (summary.isManual) {
        addManualBoxToMap(match.manualBoxScore);
      } else {
        addEventsToMap(match.events);
      }
    }
  } else {
    matches.forEach((match) => {
      const summary = computeMatchSummary(match);
      if (!summary.hasStats) return;
      hasStats = true;
      if (summary.isManual) {
        addManualBoxToMap(match.manualBoxScore);
      } else {
        addEventsToMap(match.events);
      }
    });
    isManual = hasStats && matches.every((m) => m.events.length === 0);
  }

  const rows: PlayerBoxScoreRow[] = [...players]
    .sort((a, b) => (parseInt(a.number, 10) || 999) - (parseInt(b.number, 10) || 999))
    .map((player) => {
      const e = entryMap.get(player.id) ?? createEmptyBoxScoreEntry(player.id);
      const reb = e.oreb + e.dreb;
      return {
        ...e,
        number: player.number,
        name: player.name,
        reb,
        fgPercent: calcPercent(e.fgm, e.fga),
        tpPercent: calcPercent(e.tpm, e.tpa),
        ftPercent: calcPercent(e.ftm, e.fta),
      };
    });

  const totals = rows.reduce<Omit<BoxScoreTotals, 'fgPercent' | 'tpPercent' | 'ftPercent'>>(
    (acc, r) => ({
      pts: acc.pts + r.pts,
      fgm: acc.fgm + r.fgm,
      fga: acc.fga + r.fga,
      tpm: acc.tpm + r.tpm,
      tpa: acc.tpa + r.tpa,
      ftm: acc.ftm + r.ftm,
      fta: acc.fta + r.fta,
      oreb: acc.oreb + r.oreb,
      dreb: acc.dreb + r.dreb,
      reb: acc.reb + r.reb,
      ast: acc.ast + r.ast,
      stl: acc.stl + r.stl,
      blk: acc.blk + r.blk,
      to: acc.to + r.to,
      pf: acc.pf + r.pf,
    }),
    {
      pts: 0,
      fgm: 0,
      fga: 0,
      tpm: 0,
      tpa: 0,
      ftm: 0,
      fta: 0,
      oreb: 0,
      dreb: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      to: 0,
      pf: 0,
    }
  );

  return {
    rows,
    isManual,
    hasStats,
    teamTotals: {
      ...totals,
      fgPercent: calcPercent(totals.fgm, totals.fga),
      tpPercent: calcPercent(totals.tpm, totals.tpa),
      ftPercent: calcPercent(totals.ftm, totals.fta),
    },
  };
}

export function computeGameScores(
  game: GameRecord,
  matchId?: string | 'ALL'
): {
  homeScore: number;
  awayScore: number;
  hasStats: boolean;
  recordedMatchCount: number;
  totalMatchCount: number;
  wins: number;
  losses: number;
  draws: number;
} {
  const matches = getGameMatches(game);

  if (matchId && matchId !== 'ALL') {
    const match = matches.find((m) => m.id === matchId);
    if (!match) {
      return {
        homeScore: 0,
        awayScore: 0,
        hasStats: false,
        recordedMatchCount: 0,
        totalMatchCount: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
    }
    const sum = computeMatchSummary(match);
    const res = sum.hasStats
      ? getGameResult(sum.homeScore, sum.awayScore)
      : null;
    return {
      homeScore: sum.homeScore,
      awayScore: sum.awayScore,
      hasStats: sum.hasStats,
      recordedMatchCount: sum.hasStats ? 1 : 0,
      totalMatchCount: 1,
      wins: res === 'W' ? 1 : 0,
      losses: res === 'L' ? 1 : 0,
      draws: res === 'D' ? 1 : 0,
    };
  }

  let homeScore = 0;
  let awayScore = 0;
  let recordedMatchCount = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;

  matches.forEach((m) => {
    const sum = computeMatchSummary(m);
    if (!sum.hasStats) return;
    recordedMatchCount += 1;
    homeScore += sum.homeScore;
    awayScore += sum.awayScore;
    const res = getGameResult(sum.homeScore, sum.awayScore);
    if (res === 'W') wins += 1;
    else if (res === 'L') losses += 1;
    else draws += 1;
  });

  return {
    homeScore,
    awayScore,
    hasStats: recordedMatchCount > 0,
    recordedMatchCount,
    totalMatchCount: matches.length,
    wins,
    losses,
    draws,
  };
}

export function getGameResult(homeScore: number, awayScore: number): 'W' | 'L' | 'D' {
  if (homeScore > awayScore) return 'W';
  if (homeScore < awayScore) return 'L';
  return 'D';
}
