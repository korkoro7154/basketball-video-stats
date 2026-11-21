import type {
  GameRecord,
  Player,
  PlayerBoxScoreEntry,
  StatActionType,
} from '../types';

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

export function computeGameBoxScore(
  game: GameRecord,
  players: Player[]
): { rows: PlayerBoxScoreRow[]; teamTotals: BoxScoreTotals; isManual: boolean } {
  const hasManual =
    Boolean(game.manualBoxScore) &&
    Object.keys(game.manualBoxScore ?? {}).length > 0;

  const entryMap = new Map<string, PlayerBoxScoreEntry>();
  players.forEach((p) => {
    const manualEntry = hasManual ? game.manualBoxScore?.[p.id] : undefined;
    entryMap.set(
      p.id,
      manualEntry ? { ...manualEntry, playerId: p.id } : createEmptyBoxScoreEntry(p.id)
    );
  });

  if (!hasManual) {
    game.events
      .filter((e) => e.team === 'home' && e.playerId)
      .forEach((e) => {
        const current = entryMap.get(e.playerId!);
        if (!current) return;

        switch (e.type) {
          case '2P_MADE':
            current.pts += 2;
            current.fgm += 1;
            current.fga += 1;
            break;
          case '2P_MISS':
            current.fga += 1;
            break;
          case '3P_MADE':
            current.pts += 3;
            current.fgm += 1;
            current.fga += 1;
            current.tpm += 1;
            current.tpa += 1;
            break;
          case '3P_MISS':
            current.fga += 1;
            current.tpa += 1;
            break;
          case 'FT_MADE':
            current.pts += 1;
            current.ftm += 1;
            current.fta += 1;
            break;
          case 'FT_MISS':
            current.fta += 1;
            break;
          case 'OREB':
            current.oreb += 1;
            break;
          case 'DREB':
            current.dreb += 1;
            break;
          case 'AST':
            current.ast += 1;
            break;
          case 'STL':
            current.stl += 1;
            break;
          case 'BLK':
            current.blk += 1;
            break;
          case 'TO':
            current.to += 1;
            break;
          case 'PF':
            current.pf += 1;
            break;
        }
      });
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
    isManual: hasManual,
    teamTotals: {
      ...totals,
      fgPercent: calcPercent(totals.fgm, totals.fga),
      tpPercent: calcPercent(totals.tpm, totals.tpa),
      ftPercent: calcPercent(totals.ftm, totals.fta),
    },
  };
}

export function computeGameScores(game: GameRecord): {
  homeScore: number;
  awayScore: number;
} {
  const hasManual =
    Boolean(game.manualBoxScore) &&
    Object.keys(game.manualBoxScore ?? {}).length > 0;

  if (hasManual) {
    const homeFromManual = Object.values(game.manualBoxScore ?? {}).reduce(
      (sum, entry) => sum + entry.pts,
      0
    );
    return {
      homeScore: homeFromManual > 0 ? homeFromManual : game.homeScore,
      awayScore: game.awayScore,
    };
  }

  if (game.events.length > 0) {
    let homePts = 0;
    let awayPts = 0;
    game.events.forEach((e) => {
      const pts = STAT_META[e.type].points;
      if (e.team === 'home') homePts += pts;
      else awayPts += pts;
    });
    return {
      homeScore: homePts > 0 ? homePts : game.homeScore,
      awayScore: awayPts > 0 ? awayPts : game.awayScore,
    };
  }

  return {
    homeScore: game.homeScore,
    awayScore: game.awayScore,
  };
}

export function getGameResult(homeScore: number, awayScore: number): 'W' | 'L' | 'D' {
  if (homeScore > awayScore) return 'W';
  if (homeScore < awayScore) return 'L';
  return 'D';
}
