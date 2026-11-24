import type {
  GameMatch,
  GameRecord,
  GameStatEvent,
  Player,
  PlayerBoxScoreEntry,
  PortalData,
  StatActionType,
  TeamUnit,
} from '../types';
import {
  createMatchId,
  getGameMatches,
  hasNonEmptyManualBox,
  mergeBoxScoreMaps,
  syncGameFromMatches,
} from './matches.ts';

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

export type OcrMergeMode = 'replace' | 'add';

export interface EditableOcrPlayer {
  id: string;
  reportedPts: number;
  number: string;
  name: string;
  twoPm: number;
  twoPa: number;
  threePm: number;
  threePa: number;
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

export interface OcrSaveBatchItem {
  targetGameId: string;
  targetMatchId: string | '__new__';
  mergeMode?: OcrMergeMode;
  awayTeamName: string;
  teamUnit: TeamUnit;
  homeScore: number;
  awayScore: number;
  rows: EditableOcrPlayer[];
}

export interface OcrSaveBatchPayload {
  items: OcrSaveBatchItem[];
  autoAddMissingPlayers: boolean;
}

function toAsciiHalfWidth(text: string): string {
  return text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

/** Normalizes a jersey number while keeping "00" and "0" distinct. */
export function normalizeJerseyNumber(raw: string): string {
  return toAsciiHalfWidth(raw)
    .replace(/^(?:no\.?|№|[#＃])\s*/i, '')
    .trim();
}

/** Normalizes a player name for roster comparison. */
export function normalizePlayerNameKey(name: string): string {
  return name.replace(/[\s\u3000]+/g, '').toLowerCase();
}

/** Finds a matching roster player by jersey number (with safe leading-zero handling) or name. */
export function resolvePlayerFromRoster(
  row: { number: string; name: string },
  roster: Player[]
): Player | undefined {
  const num = normalizeJerseyNumber(row.number);
  if (num) {
    const exactNum = roster.find(
      (p) => normalizeJerseyNumber(p.number) === num
    );
    if (exactNum) return exactNum;

    if (/^\d+$/.test(num) && num !== '00') {
      const targetInt = parseInt(num, 10);
      const numericMatch = roster.find((p) => {
        const pn = normalizeJerseyNumber(p.number);
        return /^\d+$/.test(pn) && pn !== '00' && parseInt(pn, 10) === targetInt;
      });
      if (numericMatch) return numericMatch;
    }
  }

  const normName = normalizePlayerNameKey(row.name);
  if (normName) {
    return roster.find((p) => normalizePlayerNameKey(p.name) === normName);
  }
  return undefined;
}

function isJerseyPlaceholderName(
  name: string,
  jersey: string,
  matchedNumber?: string
): boolean {
  const trimmed = toAsciiHalfWidth(name).trim();
  if (!trimmed) return true;
  const cleaned = trimmed
    .replace(/^(?:no\.?|№|[#＃])\s*/i, '')
    .replace(/番$/, '')
    .trim();
  if (!cleaned) return true;

  const candidates = [jersey, matchedNumber]
    .map((v) => (v ? normalizeJerseyNumber(v) : ''))
    .filter(Boolean);
  for (const candidate of candidates) {
    if (cleaned === candidate) return true;
    if (
      /^\d+$/.test(cleaned) &&
      /^\d+$/.test(candidate) &&
      cleaned !== '00' &&
      candidate !== '00' &&
      parseInt(cleaned, 10) === parseInt(candidate, 10)
    ) {
      return true;
    }
  }
  return false;
}

/** Hydrates OCR player rows against the roster and fills blank names by jersey number. */
export function hydrateOcrPlayersWithRoster(
  rawPlayers: Array<{
    number: string;
    name: string;
    pts: number;
    twoPm: number;
    twoPa: number;
    threePm: number;
    threePa: number;
    ftm: number;
    fta: number;
    oreb: number;
    dreb: number;
    ast: number;
    stl: number;
    blk: number;
    to: number;
    pf: number;
  }>,
  roster: Player[],
  createRowId: (prefix: string) => string
): EditableOcrPlayer[] {
  return rawPlayers.map((p) => {
    const normalizedNum = normalizeJerseyNumber(p.number);
    const matched = resolvePlayerFromRoster(
      { number: normalizedNum, name: p.name },
      roster
    );
    const resolvedNumber = normalizedNum || (matched ? matched.number : '');
    const resolvedName =
      matched && isJerseyPlaceholderName(p.name, normalizedNum, matched.number)
        ? matched.name
        : p.name.trim();

    return {
      id: createRowId('ocr_row'),
      reportedPts: p.pts,
      number: resolvedNumber,
      name: resolvedName,
      twoPm: p.twoPm,
      twoPa: p.twoPa,
      threePm: p.threePm,
      threePa: p.threePa,
      ftm: p.ftm,
      fta: p.fta,
      oreb: p.oreb,
      dreb: p.dreb,
      ast: p.ast,
      stl: p.stl,
      blk: p.blk,
      to: p.to,
      pf: p.pf,
    };
  });
}

const GENERIC_FILENAME_TOKENS = new Set([
  'line',
  'album',
  'img',
  'image',
  'photo',
  'pic',
  'screenshot',
  'box',
  'score',
  'scoresheet',
  'stats',
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  '駒場',
  '都立駒場',
  '高校',
  '対戦相手',
]);

function stripLineAlbumSuffix(stem: string): string {
  return stem
    .replace(/_\d{6,8}_\d+$/g, '')
    .replace(/-\d{6,8}-\d+$/g, '');
}

function formatMmDd(month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/** Extracts MM-DD date and meaningful opponent tokens from a file name or folder path. */
export function extractDateAndOpponentHintsFromFileName(name: string): {
  mmdd: string;
  opponentTokens: string[];
} {
  const half = toAsciiHalfWidth(name)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .trim();
  const withoutAlbumSuffix = stripLineAlbumSuffix(half);

  let mmdd = '';
  const explicitMatch = withoutAlbumSuffix.match(
    /(?:^|[^\d])(?:(?:19|20)\d{2}\s*[-/.年]\s*)?(1[0-2]|0?[1-9])\s*(?:月|[-/.])\s*(3[01]|[12]\d|0?[1-9])\s*日?(?:$|[^\d])/
  );
  if (explicitMatch) {
    mmdd = formatMmDd(
      parseInt(explicitMatch[1], 10),
      parseInt(explicitMatch[2], 10)
    );
  }
  if (!mmdd) {
    const fourDigitMatch = withoutAlbumSuffix.match(
      /(?:^|[^\d])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:$|[^\d])/
    );
    if (fourDigitMatch) {
      mmdd = formatMmDd(
        parseInt(fourDigitMatch[1], 10),
        parseInt(fourDigitMatch[2], 10)
      );
    }
  }
  if (!mmdd) {
    const threeDigitMatch = withoutAlbumSuffix.match(
      /(?:^|[^\d])([1-9])(0[1-9]|[12]\d|3[01])(?:$|[^\d])/
    );
    if (threeDigitMatch) {
      mmdd = formatMmDd(
        parseInt(threeDigitMatch[1], 10),
        parseInt(threeDigitMatch[2], 10)
      );
    }
  }

  const cleanedForTokens = withoutAlbumSuffix
    .replace(/LINE_ALBUM/gi, ' ')
    .replace(/(?:^|[^\d])(?:19|20)?\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?(?:$|[^\d])/g, ' ')
    .replace(/(?:^|[^\d])\d{3,4}(?:$|[^\d])/g, ' ');

  const rawTokens = cleanedForTokens
    .split(/[\s_、,・/／\\()（）[\]【】-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const opponentTokens: string[] = [];
  const seen = new Set<string>();
  for (const token of rawTokens) {
    const lower = token.toLowerCase();
    if (lower.length < 2) continue;
    if (/^\d+$/.test(lower)) continue;
    if (/^(?:第?\d+q|q\d+|ot\d*)$/i.test(lower)) continue;
    if (GENERIC_FILENAME_TOKENS.has(lower)) continue;
    if (!seen.has(lower)) {
      seen.add(lower);
      opponentTokens.push(token);
    }
  }

  return { mmdd, opponentTokens };
}

function expandOpponentHints(rawHints: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const addHint = (value: string) => {
    const cleaned = value.trim().toLowerCase();
    if (cleaned.length < 2 || cleaned === '対戦相手' || GENERIC_FILENAME_TOKENS.has(cleaned)) {
      return;
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  };

  for (const raw of rawHints) {
    addHint(raw);
    const stem = raw
      .trim()
      .replace(/^(?:都立|県立|市立|私立|東京都立)/, '')
      .replace(/(?:高等学校|高校|中学|中学校)$/, '')
      .trim();
    if (stem.length >= 2) {
      addHint(stem);
    }
  }
  return out;
}

function gameMatchesMmDd(game: GameRecord, mmdd: string): boolean {
  if (!mmdd) return false;
  if (game.date.endsWith(`-${mmdd}`)) return true;

  const [mmStr, ddStr] = mmdd.split('-');
  const mm = parseInt(mmStr, 10);
  const dd = parseInt(ddStr, 10);
  if (!(mm >= 1 && dd >= 1)) return false;

  const normalizedTitle = toAsciiHalfWidth(game.title);
  const titlePatterns = [
    new RegExp(`(?:^|[^\\d])${mm}[/.-]${dd}(?:$|[^\\d])`),
    new RegExp(`(?:^|[^\\d])${mm}月${dd}日?(?:$|[^\\d])`),
    new RegExp(`(?:^|[^\\d])${mmStr}${ddStr}(?:$|[^\\d])`),
    new RegExp(`(?:^|[^\\d])${mm}${ddStr}(?:$|[^\\d])`),
  ];
  return titlePatterns.some((re) => re.test(normalizedTitle));
}

/** Finds the best matching GameRecord using OCR date, away team name, filename, and path hints. */
export function findBestMatchingGameForItem(
  games: GameRecord[],
  params: {
    screenshotDate?: string;
    awayTeamName?: string;
    fileName?: string;
    pathHint?: string;
  }
): {
  game: GameRecord | null;
  mmddHint: string;
  reason: 'date+opponent' | 'date' | 'opponent' | 'none';
} {
  const fileHints = extractDateAndOpponentHintsFromFileName(
    params.fileName ?? ''
  );
  const pathHints = extractDateAndOpponentHintsFromFileName(
    params.pathHint ?? ''
  );

  const mmddHint =
    (params.screenshotDate ?? '').trim() || fileHints.mmdd || pathHints.mmdd;

  const directAwayHints = expandOpponentHints(
    params.awayTeamName ? [params.awayTeamName] : []
  );
  const otherHints = expandOpponentHints([
    ...fileHints.opponentTokens,
    ...pathHints.opponentTokens,
  ]).filter((h) => !directAwayHints.includes(h));

  if (!mmddHint && directAwayHints.length === 0 && otherHints.length === 0) {
    return { game: null, mmddHint: '', reason: 'none' };
  }

  let bestGame: GameRecord | null = null;
  let bestScore = 0;
  let bestDateMatched = false;
  let bestOppMatched = false;
  let tiedTop = false;

  for (const g of games) {
    const dateMatched = gameMatchesMmDd(g, mmddHint);
    let score = dateMatched ? 10 : 0;

    const haystack = toAsciiHalfWidth(
      [g.title, g.opponent, ...getGameMatches(g).map((m) => m.opponent)].join(
        ' '
      )
    ).toLowerCase();

    let oppMatched = false;
    for (const hint of directAwayHints) {
      if (haystack.includes(hint)) {
        score += 5;
        oppMatched = true;
      }
    }
    for (const hint of otherHints) {
      if (haystack.includes(hint)) {
        score += 3;
        oppMatched = true;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestGame = g;
      bestDateMatched = dateMatched;
      bestOppMatched = oppMatched;
      tiedTop = false;
    } else if (score > 0 && score === bestScore) {
      tiedTop = true;
    }
  }

  if (bestGame && bestScore >= 10) {
    return {
      game: bestGame,
      mmddHint,
      reason: bestDateMatched && bestOppMatched ? 'date+opponent' : 'date',
    };
  }
  if (bestGame && !mmddHint && bestScore >= 3 && !tiedTop) {
    return {
      game: bestGame,
      mmddHint: '',
      reason: 'opponent',
    };
  }
  return { game: null, mmddHint, reason: 'none' };
}

function getOcrRowIdentityKey(
  row: EditableOcrPlayer,
  roster: Player[]
): string {
  const matched = resolvePlayerFromRoster(row, roster);
  if (matched) return `roster:${matched.id}`;
  const num = normalizeJerseyNumber(row.number);
  if (num) return `num:${num}`;
  const normName = normalizePlayerNameKey(row.name);
  if (normName) return `name:${normName}`;
  return `row:${row.id}`;
}

function compareEditableOcrRowsByJersey(
  a: EditableOcrPlayer,
  b: EditableOcrPlayer
): number {
  const na = normalizeJerseyNumber(a.number);
  const nb = normalizeJerseyNumber(b.number);
  const ia = /^\d+$/.test(na) ? (na === '00' ? 0.5 : parseInt(na, 10)) : 9999;
  const ib = /^\d+$/.test(nb) ? (nb === '00' ? 0.5 : parseInt(nb, 10)) : 9999;
  if (ia !== ib) return ia - ib;
  return a.name.localeCompare(b.name, 'ja');
}

/** Merges two quarter preview player row lists by summing each player's stats. */
export function mergeEditableOcrPlayerRows(
  baseRows: EditableOcrPlayer[],
  incomingRows: EditableOcrPlayer[],
  roster: Player[]
): EditableOcrPlayer[] {
  const mergedMap = new Map<string, EditableOcrPlayer>();

  const accumulate = (row: EditableOcrPlayer) => {
    const key = getOcrRowIdentityKey(row, roster);
    const matched = resolvePlayerFromRoster(row, roster);
    const normalizedNum = normalizeJerseyNumber(row.number);
    const existing = mergedMap.get(key);

    if (!existing) {
      mergedMap.set(key, {
        ...row,
        number: normalizedNum || matched?.number || '',
        name:
          matched && isJerseyPlaceholderName(row.name, normalizedNum, matched.number)
            ? matched.name
            : row.name.trim() || matched?.name || '',
      });
      return;
    }

    mergedMap.set(key, {
      ...existing,
      number: existing.number || normalizedNum || matched?.number || '',
      name: existing.name || row.name.trim() || matched?.name || '',
      reportedPts: existing.reportedPts + row.reportedPts,
      twoPm: existing.twoPm + row.twoPm,
      twoPa: existing.twoPa + row.twoPa,
      threePm: existing.threePm + row.threePm,
      threePa: existing.threePa + row.threePa,
      ftm: existing.ftm + row.ftm,
      fta: existing.fta + row.fta,
      oreb: existing.oreb + row.oreb,
      dreb: existing.dreb + row.dreb,
      ast: existing.ast + row.ast,
      stl: existing.stl + row.stl,
      blk: existing.blk + row.blk,
      to: existing.to + row.to,
      pf: existing.pf + row.pf,
    });
  };

  for (const r of baseRows) accumulate(r);
  for (const r of incomingRows) accumulate(r);

  return Array.from(mergedMap.values()).sort(compareEditableOcrRowsByJersey);
}

function buildBoxEntryFromOcrRow(
  playerId: string,
  row: EditableOcrPlayer
): PlayerBoxScoreEntry {
  const pts = row.twoPm * 2 + row.threePm * 3 + row.ftm;
  const fgm = row.twoPm + row.threePm;
  const fga = row.twoPa + row.threePa;
  return {
    playerId,
    pts,
    fgm,
    fga,
    tpm: row.threePm,
    tpa: row.threePa,
    ftm: row.ftm,
    fta: row.fta,
    oreb: row.oreb,
    dreb: row.dreb,
    ast: row.ast,
    stl: row.stl,
    blk: row.blk,
    to: row.to,
    pf: row.pf,
  };
}

/**
 * Applies a multi-day OCR batch (with replace or add quarter-merge mode)
 * to PortalData immutably while auto-adding missing roster players once.
 */
export function applyOcrBatchToPortalData(
  prev: PortalData,
  payload: OcrSaveBatchPayload,
  options: {
    fallbackGameId?: string;
    createPlayerId: (prefix: string) => string;
    createMatchIdFn?: () => string;
  }
): {
  nextData: PortalData;
  addedPlayers: Player[];
  updatedGameIds: string[];
  appliedItemCount: number;
} {
  if (payload.items.length === 0) {
    return {
      nextData: prev,
      addedPlayers: [],
      updatedGameIds: [],
      appliedItemCount: 0,
    };
  }

  const addedPlayers: Player[] = [];
  const workingPlayers = [...prev.players];
  const makeMatchId = options.createMatchIdFn ?? createMatchId;

  interface PreparedPatch {
    targetGameId: string;
    targetMatchId: string | '__new__';
    mergeMode: OcrMergeMode;
    awayTeamName: string;
    teamUnit: TeamUnit;
    manualBox: Record<string, PlayerBoxScoreEntry>;
    hasBox: boolean;
    homeScore: number;
    awayScore: number;
  }

  const patchesByGame = new Map<string, PreparedPatch[]>();

  for (const item of payload.items) {
    const resolvedGameId = item.targetGameId || options.fallbackGameId || '';
    if (!resolvedGameId) continue;

    const manualBox: Record<string, PlayerBoxScoreEntry> = {};

    for (const row of item.rows) {
      const num = normalizeJerseyNumber(row.number);
      let existing = resolvePlayerFromRoster(
        { number: num, name: row.name },
        workingPlayers
      );

      if (!existing && payload.autoAddMissingPlayers) {
        const created: Player = {
          id: options.createPlayerId('p'),
          number: num || '-',
          name:
            !isJerseyPlaceholderName(row.name, num) && row.name.trim()
              ? row.name.trim()
              : num
                ? `#${num} 選手`
                : `選手${workingPlayers.length + 1}`,
          position: '',
          grade: '',
        };
        workingPlayers.push(created);
        addedPlayers.push(created);
        existing = created;
      }

      if (!existing) continue;

      const entry = buildBoxEntryFromOcrRow(existing.id, row);
      const prevEntry = manualBox[existing.id];
      if (!prevEntry) {
        manualBox[existing.id] = entry;
      } else {
        addBoxEntry(prevEntry, entry);
      }
    }

    const boxTotalPts = Object.values(manualBox).reduce(
      (sum, entry) => sum + entry.pts,
      0
    );
    const finalHomeScore = boxTotalPts > 0 ? boxTotalPts : item.homeScore;

    const list = patchesByGame.get(resolvedGameId) ?? [];
    list.push({
      targetGameId: resolvedGameId,
      targetMatchId: item.targetMatchId,
      mergeMode: item.mergeMode ?? 'replace',
      awayTeamName: item.awayTeamName.trim(),
      teamUnit: item.teamUnit,
      manualBox,
      hasBox: Object.keys(manualBox).length > 0,
      homeScore: finalHomeScore,
      awayScore: item.awayScore,
    });
    patchesByGame.set(resolvedGameId, list);
  }

  const updatedGameIds: string[] = [];
  let appliedItemCount = 0;

  const nextGames = prev.games.map((g) => {
    const gamePatches = patchesByGame.get(g.id);
    if (!gamePatches || gamePatches.length === 0) return g;

    updatedGameIds.push(g.id);
    appliedItemCount += gamePatches.length;
    const workingMatches = [...getGameMatches(g)];
    let lastCreatedMatchIdx = -1;

    for (const patch of gamePatches) {
      let targetIdx = -1;
      if (patch.targetMatchId !== '__new__') {
        targetIdx = workingMatches.findIndex((m) => m.id === patch.targetMatchId);
      } else if (patch.mergeMode === 'add' && lastCreatedMatchIdx !== -1) {
        targetIdx = lastCreatedMatchIdx;
      }

      if (targetIdx !== -1) {
        const cur = workingMatches[targetIdx];
        if (patch.mergeMode === 'add') {
          const curSummary = computeMatchSummary(cur);
          const mergedBox = mergeBoxScoreMaps(
            cur.manualBoxScore,
            patch.hasBox ? patch.manualBox : undefined
          );
          const mergedBoxPts = mergedBox
            ? Object.values(mergedBox).reduce((sum, e) => sum + e.pts, 0)
            : 0;
          const nextHomeScore =
            mergedBoxPts > 0 && hasNonEmptyManualBox(cur.manualBoxScore)
              ? mergedBoxPts
              : curSummary.homeScore + patch.homeScore;
          const nextAwayScore = curSummary.awayScore + patch.awayScore;
          const meaningfulCurOpp =
            cur.opponent && cur.opponent !== '対戦相手' ? cur.opponent : '';

          workingMatches[targetIdx] = {
            ...cur,
            opponent: meaningfulCurOpp || patch.awayTeamName || cur.opponent,
            teamUnit: cur.teamUnit || patch.teamUnit,
            manualBoxScore: mergedBox,
            homeScore: nextHomeScore,
            awayScore: nextAwayScore,
          };
        } else {
          workingMatches[targetIdx] = {
            ...cur,
            opponent: patch.awayTeamName || cur.opponent,
            teamUnit: patch.teamUnit || cur.teamUnit,
            manualBoxScore: patch.hasBox
              ? patch.manualBox
              : cur.manualBoxScore,
            homeScore: patch.homeScore,
            awayScore: patch.awayScore,
          };
        }
      } else {
        workingMatches.push({
          id: makeMatchId(),
          label: `${workingMatches.length + 1}試合目`,
          teamUnit: patch.teamUnit,
          opponent: patch.awayTeamName || g.opponent,
          homeScore: patch.homeScore,
          awayScore: patch.awayScore,
          videos: [],
          events: [],
          manualBoxScore: patch.hasBox ? patch.manualBox : undefined,
        });
        lastCreatedMatchIdx = workingMatches.length - 1;
      }
    }

    return syncGameFromMatches(g, workingMatches, computeMatchSummary);
  });

  const existingIds = new Set(prev.players.map((p) => p.id));
  const mergedPlayers = [
    ...prev.players,
    ...addedPlayers.filter((p) => !existingIds.has(p.id)),
  ];

  return {
    nextData: {
      ...prev,
      players: mergedPlayers,
      games: nextGames,
    },
    addedPlayers,
    updatedGameIds,
    appliedItemCount,
  };
}
