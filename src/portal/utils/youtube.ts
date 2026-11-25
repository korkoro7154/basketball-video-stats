import type {
  GameCategory,
  GameMatch,
  GameRecord,
  GameVideoClip,
  PortalData,
  PracticeVideo,
  TeamUnit,
} from '../types';

export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();

    if (host.includes('youtu.be')) {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const segments = url.pathname.split('/').filter(Boolean);
      const markerIdx = segments.findIndex((seg) =>
        ['embed', 'shorts', 'live', 'v'].includes(seg)
      );
      if (markerIdx !== -1 && segments[markerIdx + 1]) {
        const candidate = segments[markerIdx + 1];
        return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    const regex = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/;
    const match = trimmed.match(regex);
    return match ? match[1] : null;
  }

  return null;
}

export function extractYouTubePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^(PL|UU|OL|RD)[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const listId = url.searchParams.get('list');
    if (listId && listId.trim().length > 4) {
      return listId.trim();
    }
  } catch {
    const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  }

  const studioMatch = trimmed.match(/\/playlist\/((?:PL|UU|OL|FL)[a-zA-Z0-9_-]{10,})/);
  return studioMatch ? studioMatch[1] : null;
}

function collectSortedUniqueMatches(input: string, patterns: RegExp[]): string[] {
  if (!input.trim()) return [];

  const hits: Array<{ id: string; offset: number }> = [];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const id = match[1]?.trim();
      if (!id) continue;
      const baseIndex = match.index ?? 0;
      const innerOffset = match[0].indexOf(id);
      hits.push({
        id,
        offset: baseIndex + Math.max(0, innerOffset),
      });
    }
  }

  hits.sort((a, b) => a.offset - b.offset);

  const seen = new Set<string>();
  const results: string[] = [];
  for (const hit of hits) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      results.push(hit.id);
    }
  }
  return results;
}

export function extractYouTubePlaylistIdsFromHtml(html: string): string[] {
  return collectSortedUniqueMatches(html, [
    /(?:[?&]|&amp;)list=((?:PL|UU|OLAK5uy_|FL)[a-zA-Z0-9_-]{10,})/g,
    /(?:\\\/|\\u002[fF]|\/)playlist(?:\\\/|\\u002[fF]|\/)((?:PL|UU|OLAK5uy_|FL)[a-zA-Z0-9_-]{10,})/g,
    /href=["'][^"']*(?:[?&]|&amp;)list=([a-zA-Z0-9_-]{12,})/g,
  ]);
}

export function extractAllYouTubePlaylistIds(input: string): string[] {
  return collectSortedUniqueMatches(input, [
    /(?:[?&]|&amp;)list=([a-zA-Z0-9_-]{12,})/g,
    /\/playlist\/((?:PL|UU|OLAK5uy_|FL)[a-zA-Z0-9_-]{10,})/g,
    /(?:^|[\s,;])((?:PL[a-zA-Z0-9_-]{16,34}|OLAK5uy_[a-zA-Z0-9_-]{20,}|UU[a-zA-Z0-9_-]{22}))(?=$|[\s,;])/g,
  ]);
}

export function getYouTubeThumbnail(videoId: string): string | null {
  if (!videoId || videoId.startsWith('demo_')) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

export function parseTimeString(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10));
  }

  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

let ytHelperSeq = 0;

function createDefaultId(prefix: string): string {
  ytHelperSeq += 1;
  const rand =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ytHelperSeq}_${rand}`;
}

function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

function toHalfWidthAlnum(text: string): string {
  return text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

export function inferClipLabelFromTitle(
  title: string,
  index: number,
  total: number
): string {
  const normalized = toHalfWidthDigits(title).trim();

  const hasMatchIdentifier =
    /(?:\d+\s*試合目|第\s*\d+\s*試合|game\s*\d+|[a-zA-Z]\s*\d+\s*試合)/i.test(
      normalized
    );
  if (hasMatchIdentifier) {
    const trimmed = title.trim();
    return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed;
  }

  if (/(?:^|[^\d])1\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*1\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '1Q';
  }
  if (/(?:^|[^\d])2\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*2\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '2Q';
  }
  if (/(?:^|[^\d])3\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*3\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '3Q';
  }
  if (/(?:^|[^\d])4\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*4\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '4Q';
  }
  if (/(?:^|[^a-zA-Z])OT(?:\d+)?(?:$|[^a-zA-Z])|延長/i.test(normalized)) {
    return 'OT';
  }
  if (/前半/.test(normalized)) {
    return '前半';
  }
  if (/後半/.test(normalized)) {
    return '後半';
  }

  if (total === 1) {
    return '試合動画';
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return `動画${index + 1}`;
  }
  return trimmed.length > 14 ? `${trimmed.slice(0, 14)}…` : trimmed;
}

function formatIsoDate(year: string, monthNum: number, dayNum: number): string | null {
  const yearNum = parseInt(year, 10);
  if (
    !Number.isInteger(yearNum) ||
    monthNum < 1 ||
    monthNum > 12 ||
    dayNum < 1 ||
    dayNum > 31
  ) {
    return null;
  }
  const check = new Date(Date.UTC(yearNum, monthNum - 1, dayNum));
  if (
    check.getUTCFullYear() !== yearNum ||
    check.getUTCMonth() + 1 !== monthNum ||
    check.getUTCDate() !== dayNum
  ) {
    return null;
  }
  return `${year}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
}

function extractDateMatchFromNormalized(
  normalized: string,
  fallbackYear?: string
): { isoDate: string; rawMatch: string } | null {
  for (const match of normalized.matchAll(
    /(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})(?:日)?/g
  )) {
    const formatted = formatIsoDate(
      match[1],
      parseInt(match[2], 10),
      parseInt(match[3], 10)
    );
    if (formatted) {
      return { isoDate: formatted, rawMatch: match[0] };
    }
  }

  for (const match of normalized.matchAll(
    /(?:^|[^\d])((20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]))(?=$|[^\d])/g
  )) {
    const formatted = formatIsoDate(
      match[2],
      parseInt(match[3], 10),
      parseInt(match[4], 10)
    );
    if (formatted) {
      return { isoDate: formatted, rawMatch: match[1] };
    }
  }

  if (fallbackYear) {
    for (const match of normalized.matchAll(
      /(?:^|[^\d])((\d{1,2})\s*[/月]\s*(\d{1,2})(?:日)?)(?=$|[^\d])/g
    )) {
      const formatted = formatIsoDate(
        fallbackYear,
        parseInt(match[2], 10),
        parseInt(match[3], 10)
      );
      if (formatted) {
        return { isoDate: formatted, rawMatch: match[1] };
      }
    }
  }

  return null;
}

export function inferDateFromText(text: string, fallbackIso: string): string {
  const normalized = toHalfWidthDigits(text);
  const year = /^20\d{2}/.test(fallbackIso)
    ? fallbackIso.slice(0, 4)
    : String(new Date().getFullYear());
  const matched = extractDateMatchFromNormalized(normalized, year);
  if (matched) {
    return matched.isoDate;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(fallbackIso)) {
    return fallbackIso.slice(0, 10);
  }
  return new Date().toISOString().split('T')[0];
}

export interface ParsedGameVideoTitle {
  date: string | null;
  resolvedDate: string;
  opponent: string;
  teamUnit: TeamUnit;
  gameNumber: number | null;
  quarterLabel: string | null;
}

function stripTrailingOpponentDecorators(text: string): string {
  let out = text.replace(/[-_・:：\s]+$/, '').trim();
  if (out.length > 1 && out.endsWith('戦')) {
    out = out.slice(0, -1).replace(/[-_・:：\s]+$/, '').trim();
  }
  return out;
}

function extractOpponentAndUnitFromFragment(
  rawFragment: string,
  allowMultiWord: boolean
): { opponent: string; teamUnit: TeamUnit } {
  let working = rawFragment
    .replace(/[（(]\s*[）)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let teamUnit: TeamUnit = '';

  const parenUnitMatch = working.match(/[（(]\s*([AB])(?:チーム|戦)?\s*[）)]/i);
  if (parenUnitMatch) {
    teamUnit = parenUnitMatch[1].toUpperCase() as 'A' | 'B';
    working = working
      .replace(parenUnitMatch[0], ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const spacedUnitMatch = working.match(/^(.+?)\s+([AB])(?:チーム|戦)?(?:\s+.*)?$/i);
  if (spacedUnitMatch) {
    if (!teamUnit) {
      teamUnit = spacedUnitMatch[2].toUpperCase() as 'A' | 'B';
    }
    const base = stripTrailingOpponentDecorators(spacedUnitMatch[1]);
    return {
      opponent: base || '対戦相手',
      teamUnit,
    };
  }

  const leadingUnitMatch = working.match(/^([AB])(?:チーム|戦)?\s+([^\s].*)$/i);
  if (leadingUnitMatch) {
    if (!teamUnit) {
      teamUnit = leadingUnitMatch[1].toUpperCase() as 'A' | 'B';
    }
    working = leadingUnitMatch[2].trim();
  }

  const candidateBase = allowMultiWord
    ? working
    : (working.split(/\s+/)[0] ?? '');
  const attachedUnitMatch = candidateBase.match(/^(.+?[^A-Za-z])([AB])(?:チーム|戦)?$/i);
  if (attachedUnitMatch) {
    if (!teamUnit) {
      teamUnit = attachedUnitMatch[2].toUpperCase() as 'A' | 'B';
    }
    const base = stripTrailingOpponentDecorators(attachedUnitMatch[1]);
    return {
      opponent: base || '対戦相手',
      teamUnit,
    };
  }

  const cleaned = stripTrailingOpponentDecorators(candidateBase);
  return {
    opponent: cleaned || '対戦相手',
    teamUnit,
  };
}

export function parseGameVideoTitle(
  title: string,
  fallbackIso = ''
): ParsedGameVideoTitle {
  const norm = toHalfWidthAlnum(title).replace(/\u3000/g, ' ').trim();
  const fallbackYear = /^20\d{2}/.test(fallbackIso)
    ? fallbackIso.slice(0, 4)
    : String(new Date().getFullYear());

  let working = norm;

  // 1. 日付抽出＆除去
  let date: string | null = null;
  const dateMatch = extractDateMatchFromNormalized(working, fallbackYear);
  if (dateMatch) {
    date = dateMatch.isoDate;
    working = working.replace(dateMatch.rawMatch, ' ');
  }
  const resolvedDate = date ?? inferDateFromText('', fallbackIso);

  // 2. 試合番号抽出＆除去（①〜⑳、第N試合、N試合目、GameN）
  let gameNumber: number | null = null;
  const circledMatch = working.match(/[\u2460-\u2473]/);
  if (circledMatch) {
    gameNumber = circledMatch[0].charCodeAt(0) - 0x2460 + 1;
    working = working.replace(circledMatch[0], ' ');
  } else {
    const textNumMatch = working.match(
      /(?:第\s*(\d{1,2})\s*試合|(\d{1,2})\s*試合目|(?:^|[^a-zA-Z])game\s*(\d{1,2})(?=$|[^a-zA-Z\d]))/i
    );
    if (textNumMatch) {
      const rawNum = textNumMatch[1] ?? textNumMatch[2] ?? textNumMatch[3];
      if (rawNum) {
        gameNumber = parseInt(rawNum, 10);
      }
      working = working.replace(textNumMatch[0], ' ');
    }
  }

  // 3. クォーター表記抽出＆除去
  let quarterLabel: string | null = null;
  const qPatterns: Array<{ pattern: RegExp; buildLabel: (m: RegExpMatchArray) => string }> = [
    {
      pattern: /(?:^|[^\d])([1-4])\s*(?:Q|クオーター|クォーター)/i,
      buildLabel: (m) => `${m[1]}Q`,
    },
    {
      pattern: /第\s*([1-4])\s*(?:Q|ピリオド)/i,
      buildLabel: (m) => `${m[1]}Q`,
    },
    {
      pattern: /(?:^|[^a-zA-Z])(OT(?:\d+)?)(?=$|[^a-zA-Z])|延長/i,
      buildLabel: () => 'OT',
    },
    {
      pattern: /前半/,
      buildLabel: () => '前半',
    },
    {
      pattern: /後半/,
      buildLabel: () => '後半',
    },
  ];
  for (const { pattern, buildLabel } of qPatterns) {
    const qMatch = working.match(pattern);
    if (qMatch) {
      quarterLabel = buildLabel(qMatch);
      working = working.replace(qMatch[0], ' ');
      break;
    }
  }

  working = working.replace(/\s+/g, ' ').trim();

  // 4. 対戦相手・チーム区分抽出
  let opponent = '対戦相手';
  let teamUnit: TeamUnit = '';

  const vsRegex = /vs\.?/i;
  const taiRegex = /対(?![策象応抗])/;
  const vsMatch = working.match(vsRegex) ?? working.match(taiRegex);

  if (vsMatch && vsMatch.index !== undefined) {
    const beforeVs = working.slice(0, vsMatch.index).trim();
    const rawAfterFull = working.slice(vsMatch.index + vsMatch[0].length);
    const rawAfter = rawAfterFull.split(/[/｜|【】]/)[0].trim();

    if (rawAfter) {
      const extracted = extractOpponentAndUnitFromFragment(rawAfter, false);
      opponent = extracted.opponent;
      teamUnit = extracted.teamUnit;
    }

    if (!teamUnit && beforeVs) {
      const beforeUnitMatch = beforeVs.match(
        /(?:^|[^A-Za-z])([AB])(?:チーム|戦)?(?=$|[\s】）)\-_・])/i
      );
      if (beforeUnitMatch) {
        teamUnit = beforeUnitMatch[1].toUpperCase() as 'A' | 'B';
      }
    }
  } else {
    const withoutBrackets = working
      .replace(/【[^】]*】/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/^[@＠]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (withoutBrackets) {
      const extracted = extractOpponentAndUnitFromFragment(withoutBrackets, true);
      opponent = extracted.opponent;
      teamUnit = extracted.teamUnit;
    }

    if (!teamUnit) {
      const bracketUnitMatch = working.match(
        /[【[（(]\s*([AB])(?:チーム|戦)?\s*[】\]）)]/i
      );
      if (bracketUnitMatch) {
        teamUnit = bracketUnitMatch[1].toUpperCase() as 'A' | 'B';
      }
    }
  }

  return {
    date,
    resolvedDate,
    opponent: opponent || '対戦相手',
    teamUnit,
    gameNumber,
    quarterLabel,
  };
}

export function inferOpponentFromTitle(title: string): string {
  const cleaned = title.trim();
  if (!cleaned) return '対戦相手';
  return parseGameVideoTitle(cleaned).opponent;
}

export function inferPlaylistKind(title: string): 'game' | 'practice' {
  const lower = title.toLowerCase();
  if (lower.includes('練習試合')) {
    return 'game';
  }
  const practiceKeywords = [
    '練習',
    'ドリル',
    'トレーニング',
    '自主練',
    'シューティング',
    'メニュー',
    'practice',
  ];
  return practiceKeywords.some((kw) => lower.includes(kw)) ? 'practice' : 'game';
}

export function extractHashtagsFromText(
  text: string,
  knownTags: string[]
): string[] {
  const found = new Set<string>();
  const hashMatches = text.match(/#[^\s#\u3000]+/g) ?? [];
  hashMatches.forEach((tag) => found.add(tag.trim()));

  const lower = text.toLowerCase();
  knownTags.forEach((tag) => {
    const bare = tag.replace(/^#/, '').trim();
    if (bare && lower.includes(bare.toLowerCase())) {
      found.add(tag.startsWith('#') ? tag : `#${tag}`);
    }
  });

  return Array.from(found);
}

/** Collects every YouTube video ID across all GameRecord.videos and GameMatch.videos. */
export function collectRegisteredGameVideoIds(
  games: ReadonlyArray<GameRecord>
): Set<string> {
  const ids = new Set<string>();
  for (const game of games) {
    for (const v of game.videos) {
      if (v.youtubeId) ids.add(v.youtubeId);
    }
    if (Array.isArray(game.matches)) {
      for (const m of game.matches) {
        for (const v of m.videos) {
          if (v.youtubeId) ids.add(v.youtubeId);
        }
      }
    }
  }
  return ids;
}

/** Collects every YouTube video ID across all PracticeVideo entries. */
export function collectRegisteredPracticeVideoIds(
  practices: ReadonlyArray<PracticeVideo>
): Set<string> {
  const ids = new Set<string>();
  for (const p of practices) {
    if (p.youtubeId) ids.add(p.youtubeId);
  }
  return ids;
}

/** Collects all registered YouTube video IDs across both games and practices. */
export function collectAllRegisteredVideoIds(
  data: Pick<PortalData, 'games' | 'practices'>
): Set<string> {
  const ids = collectRegisteredGameVideoIds(data.games);
  for (const pId of collectRegisteredPracticeVideoIds(data.practices)) {
    ids.add(pId);
  }
  return ids;
}

export interface PlaylistVideoSourceItem {
  videoId: string;
  title: string;
  description?: string;
  publishedAt: string;
  position: number;
  thumbnailUrl?: string | null;
}

export interface ParsedPlaylistVideoEntry {
  video: PlaylistVideoSourceItem;
  parsed: ParsedGameVideoTitle;
  alreadyRegistered: boolean;
}

export interface DateGroupedPlaylistDay {
  date: string;
  opponents: string[];
  entries: ParsedPlaylistVideoEntry[];
  totalCount: number;
  unregisteredCount: number;
  allRegistered: boolean;
}

function getQuarterSortRank(quarterLabel: string | null): number {
  switch (quarterLabel) {
    case '1Q':
      return 1;
    case '前半':
      return 1.5;
    case '2Q':
      return 2;
    case '3Q':
      return 3;
    case '後半':
      return 3.5;
    case '4Q':
      return 4;
    case 'OT':
      return 5;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function detectPlaylistDescendingByDate(
  items: ReadonlyArray<{ resolvedDate: string }>
): boolean {
  if (items.length < 2) return false;
  const firstDate = items[0].resolvedDate;
  const lastDate = items[items.length - 1].resolvedDate;
  if (firstDate > lastDate) return true;
  if (firstDate < lastDate) return false;

  let asc = 0;
  let desc = 0;
  for (let i = 1; i < items.length; i += 1) {
    const prev = items[i - 1].resolvedDate;
    const curr = items[i].resolvedDate;
    if (prev > curr) desc += 1;
    else if (prev < curr) asc += 1;
  }
  return desc > asc;
}

/**
 * Stops pagination early on newest-first playlists once fetched pages reach videos
 * strictly older than `sinceDate`.
 */
export function shouldStopFetchingOlderPages(
  pageItems: ReadonlyArray<PlaylistVideoSourceItem>,
  allItemsSoFar: ReadonlyArray<PlaylistVideoSourceItem>,
  sinceDate: string
): boolean {
  const cleanSince = sinceDate.trim();
  if (!cleanSince || pageItems.length === 0 || allItemsSoFar.length === 0) {
    return false;
  }

  const allDates = allItemsSoFar.map(
    (v) => parseGameVideoTitle(v.title, v.publishedAt).resolvedDate
  );
  const firstDate = allDates[0];
  const lastDate = allDates[allDates.length - 1];
  if (firstDate < lastDate) {
    // Ascending (oldest-first) playlist: do not cut off early
    return false;
  }

  const pageDates = pageItems.map(
    (v) => parseGameVideoTitle(v.title, v.publishedAt).resolvedDate
  );
  let trailingOlderCount = 0;
  for (let i = pageDates.length - 1; i >= 0; i -= 1) {
    if (pageDates[i] < cleanSince) {
      trailingOlderCount += 1;
    } else {
      break;
    }
  }

  return trailingOlderCount === pageDates.length || trailingOlderCount >= 5;
}

function sortDayEntriesAscending(
  entries: ParsedPlaylistVideoEntry[],
  isPlaylistDescending: boolean
): ParsedPlaylistVideoEntry[] {
  if (entries.length <= 1) return entries;

  const byPosition = [...entries].sort(
    (a, b) => a.video.position - b.video.position
  );

  let ascPairs = 0;
  let descPairs = 0;
  for (let i = 0; i < byPosition.length; i += 1) {
    for (let j = i + 1; j < byPosition.length; j += 1) {
      const a = byPosition[i].parsed;
      const b = byPosition[j].parsed;
      if (a.opponent !== b.opponent || a.teamUnit !== b.teamUnit) continue;

      if (a.gameNumber !== null && b.gameNumber !== null && a.gameNumber !== b.gameNumber) {
        if (a.gameNumber < b.gameNumber) ascPairs += 1;
        else descPairs += 1;
      } else if (
        a.gameNumber === b.gameNumber &&
        a.quarterLabel &&
        b.quarterLabel
      ) {
        const ra = getQuarterSortRank(a.quarterLabel);
        const rb = getQuarterSortRank(b.quarterLabel);
        if (ra < rb) ascPairs += 1;
        else if (ra > rb) descPairs += 1;
      }
    }
  }

  const isDayDescending =
    descPairs > ascPairs
      ? true
      : ascPairs > descPairs
        ? false
        : isPlaylistDescending;

  const baseOrdered = isDayDescending ? [...byPosition].reverse() : byPosition;

  const allHaveUniqueGameNumbers =
    baseOrdered.every((e) => e.parsed.gameNumber !== null) &&
    new Set(baseOrdered.map((e) => e.parsed.gameNumber)).size === baseOrdered.length;

  if (allHaveUniqueGameNumbers) {
    return [...baseOrdered].sort(
      (a, b) => (a.parsed.gameNumber ?? 0) - (b.parsed.gameNumber ?? 0)
    );
  }

  // Sort within consecutive blocks sharing the same (opponent, teamUnit)
  const result: ParsedPlaylistVideoEntry[] = [];
  let blockStart = 0;
  while (blockStart < baseOrdered.length) {
    const head = baseOrdered[blockStart].parsed;
    let blockEnd = blockStart + 1;
    while (
      blockEnd < baseOrdered.length &&
      baseOrdered[blockEnd].parsed.opponent === head.opponent &&
      baseOrdered[blockEnd].parsed.teamUnit === head.teamUnit
    ) {
      blockEnd += 1;
    }

    const block = baseOrdered
      .slice(blockStart, blockEnd)
      .map((entry, idx) => ({ entry, idx }))
      .sort((a, b) => {
        const numA = a.entry.parsed.gameNumber ?? Number.POSITIVE_INFINITY;
        const numB = b.entry.parsed.gameNumber ?? Number.POSITIVE_INFINITY;
        if (numA !== numB) return numA - numB;

        const qA = getQuarterSortRank(a.entry.parsed.quarterLabel);
        const qB = getQuarterSortRank(b.entry.parsed.quarterLabel);
        if (qA !== qB) return qA - qB;

        return a.idx - b.idx;
      })
      .map((item) => item.entry);

    result.push(...block);
    blockStart = blockEnd;
  }

  return result;
}

/**
 * Parses, filters by `sinceDate`, groups by date, sorts each day chronologically (① → ②),
 * and annotates cross-portal duplicate status.
 */
export function groupPlaylistVideosByDate(
  videos: ReadonlyArray<PlaylistVideoSourceItem>,
  options: {
    sinceDate?: string;
    registeredVideoIds?: ReadonlySet<string>;
  } = {}
): {
  groups: DateGroupedPlaylistDay[];
  filteredOutCount: number;
  totalInputCount: number;
} {
  const cleanSince = (options.sinceDate ?? '').trim();
  const registeredIds = options.registeredVideoIds ?? new Set<string>();

  const seenVideoIds = new Set<string>();
  const uniqueVideos = [...videos]
    .sort((a, b) => a.position - b.position)
    .filter((v) => {
      if (!v.videoId || seenVideoIds.has(v.videoId)) return false;
      seenVideoIds.add(v.videoId);
      return true;
    });

  const parsedEntries: ParsedPlaylistVideoEntry[] = uniqueVideos.map((video) => ({
    video,
    parsed: parseGameVideoTitle(video.title, video.publishedAt),
    alreadyRegistered: registeredIds.has(video.videoId),
  }));

  const isPlaylistDescending = detectPlaylistDescendingByDate(
    parsedEntries.map((e) => e.parsed)
  );

  let filteredOutCount = 0;
  const byDate = new Map<string, ParsedPlaylistVideoEntry[]>();

  for (const entry of parsedEntries) {
    if (cleanSince && entry.parsed.resolvedDate < cleanSince) {
      filteredOutCount += 1;
      continue;
    }
    const list = byDate.get(entry.parsed.resolvedDate);
    if (list) {
      list.push(entry);
    } else {
      byDate.set(entry.parsed.resolvedDate, [entry]);
    }
  }

  const groups: DateGroupedPlaylistDay[] = Array.from(byDate.entries())
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
    .map(([date, dayEntries]) => {
      const sortedEntries = sortDayEntriesAscending(
        dayEntries,
        isPlaylistDescending
      );
      const opponents = Array.from(
        new Set(
          sortedEntries
            .map((e) => e.parsed.opponent)
            .filter((opp) => opp && opp !== '対戦相手')
        )
      );
      const unregisteredCount = sortedEntries.filter(
        (e) => !e.alreadyRegistered
      ).length;

      return {
        date,
        opponents: opponents.length > 0 ? opponents : ['対戦相手'],
        entries: sortedEntries,
        totalCount: sortedEntries.length,
        unregisteredCount,
        allRegistered: unregisteredCount === 0,
      };
    });

  return {
    groups,
    filteredOutCount,
    totalInputCount: uniqueVideos.length,
  };
}

/** Converts parsed entries into 3-layer GameMatch[] containers (1 full-game video = 1 match). */
export function buildMatchesFromParsedEntries(
  entries: ReadonlyArray<ParsedPlaylistVideoEntry>,
  options: {
    defaultOpponent?: string;
    existingMatches?: ReadonlyArray<GameMatch>;
    createId?: (prefix: string) => string;
    clipIdsByVideoId?: Readonly<Record<string, string>>;
  } = {}
): GameMatch[] {
  const createId = options.createId ?? createDefaultId;
  const clipIdsByVideoId = options.clipIdsByVideoId;
  const fallbackOpponent = options.defaultOpponent?.trim() || '対戦相手';

  const countByOppUnit = new Map<string, number>();
  for (const m of options.existingMatches ?? []) {
    const key = `${m.opponent}__${m.teamUnit ?? ''}`;
    countByOppUnit.set(key, (countByOppUnit.get(key) ?? 0) + 1);
  }

  const nextNumberForKey = (opponent: string, teamUnit: TeamUnit): number => {
    const key = `${opponent}__${teamUnit}`;
    const next = (countByOppUnit.get(key) ?? 0) + 1;
    countByOppUnit.set(key, next);
    return next;
  };

  interface MatchBucket {
    opponent: string;
    teamUnit: TeamUnit;
    gameNumber: number | null;
    clips: GameVideoClip[];
    lastQuarterRank: number;
    hasQuarterClips: boolean;
  }

  const buckets: MatchBucket[] = [];

  for (const entry of entries) {
    const { video, parsed } = entry;
    const opp = parsed.opponent || fallbackOpponent;
    const unit = parsed.teamUnit;
    const qLabel = parsed.quarterLabel;
    const qRank = getQuarterSortRank(qLabel);

    const clip: GameVideoClip = {
      id: clipIdsByVideoId?.[video.videoId] || createId('clip'),
      label: qLabel ?? '試合動画',
      youtubeTitle: video.title,
      youtubeId: video.videoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
    };

    const prev = buckets[buckets.length - 1];
    const canJoinPrevious =
      Boolean(prev) &&
      prev.hasQuarterClips &&
      qLabel !== null &&
      prev.opponent === opp &&
      prev.teamUnit === unit &&
      prev.gameNumber === parsed.gameNumber &&
      qRank > prev.lastQuarterRank;

    if (canJoinPrevious && prev) {
      prev.clips.push(clip);
      prev.lastQuarterRank = qRank;
    } else {
      buckets.push({
        opponent: opp,
        teamUnit: unit,
        gameNumber: parsed.gameNumber,
        clips: [clip],
        lastQuarterRank: qRank,
        hasQuarterClips: qLabel !== null,
      });
    }
  }

  return buckets.map((bucket) => {
    const fallbackNum = nextNumberForKey(bucket.opponent, bucket.teamUnit);
    const label =
      bucket.gameNumber !== null
        ? `${bucket.gameNumber}試合目`
        : `${fallbackNum}試合目`;

    return {
      id: createId('match'),
      label,
      teamUnit: bucket.teamUnit,
      opponent: bucket.opponent,
      homeScore: 0,
      awayScore: 0,
      videos: bucket.clips,
      events: [],
    };
  });
}

function formatShortMonthDay(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

function inferCategoryFromPlaylistTitle(title: string): GameCategory {
  if (title.includes('公式戦')) return '公式戦';
  if (title.includes('カップ')) return 'カップ戦';
  return '練習試合';
}

function defaultGetMatches(game: GameRecord): GameMatch[] {
  if (Array.isArray(game.matches) && game.matches.length > 0) {
    return game.matches;
  }
  return [
    {
      id: `match_${game.id}_0`,
      label: '1試合目',
      teamUnit: '',
      opponent: game.opponent,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      videos: game.videos,
      events: game.events,
      manualBoxScore: game.manualBoxScore,
    },
  ];
}

function defaultSyncGame(game: GameRecord, matches: GameMatch[]): GameRecord {
  return {
    ...game,
    matches,
    videos: matches.flatMap((m) => m.videos),
    events: [],
    manualBoxScore: undefined,
  };
}

export interface SummaryAiOrganizedMatch {
  label: string;
  teamUnit: TeamUnit;
  opponent: string;
  clips: Array<{ id: string; label: string }>;
}

/** Finds the best matching existing GameRecord index for a given date/opponent/playlist title. */
export function findMatchingSummaryGameIndex(
  games: ReadonlyArray<GameRecord>,
  date: string,
  opponents: ReadonlyArray<string>,
  playlistTitle: string,
  getMatchesFn: (game: GameRecord) => GameMatch[] = defaultGetMatches
): number {
  const sameDateIndices = games
    .map((g, idx) => (g.date === date ? idx : -1))
    .filter((idx) => idx !== -1);

  if (sameDateIndices.length === 0) return -1;

  const cleanTitle = playlistTitle.trim();
  const oppSet = new Set(opponents);
  return (
    sameDateIndices.find((idx) => {
      const g = games[idx];
      if (cleanTitle && g.notes?.includes(cleanTitle)) return true;
      if (oppSet.has(g.opponent)) return true;
      return getMatchesFn(g).some((m) => oppSet.has(m.opponent));
    }) ?? sameDateIndices[0]
  );
}

/**
 * Merges selected date-grouped summary playlist days into `prevGames`,
 * appending only unregistered videos to matching dates and preventing duplicate
 * youtubeIds across the entire game list.
 */
export function mergeSummaryDateGroupsIntoGames(params: {
  prevGames: ReadonlyArray<GameRecord>;
  groups: ReadonlyArray<DateGroupedPlaylistDay>;
  playlistTitle: string;
  createId?: (prefix: string) => string;
  getMatchesFn?: (game: GameRecord) => GameMatch[];
  syncGameFn?: (game: GameRecord, matches: GameMatch[]) => GameRecord;
  clipIdsByVideoId?: Readonly<Record<string, string>>;
  aiResultsByDate?: Readonly<
    Record<
      string,
      {
        matches: SummaryAiOrganizedMatch[];
        fetchedTitles?: Record<string, string>;
      }
    >
  >;
  applyAiMatchesFn?: (
    existingMatches: GameMatch[],
    aiGroups: SummaryAiOrganizedMatch[],
    defaultOpponent: string,
    fetchedTitles?: Record<string, string>
  ) => GameMatch[];
}): {
  nextGames: GameRecord[];
  addedGames: number;
  updatedGames: number;
  addedVideos: number;
  skippedDays: number;
  skippedDuplicateVideos: number;
  latestGameId: string;
} {
  const createId = params.createId ?? createDefaultId;
  const getMatchesFn = params.getMatchesFn ?? defaultGetMatches;
  const syncGameFn = params.syncGameFn ?? defaultSyncGame;
  const applyAiMatchesFn = params.applyAiMatchesFn;
  const cleanTitle = params.playlistTitle.trim();

  const registeredIds = collectRegisteredGameVideoIds(params.prevGames);
  const nextGames = [...params.prevGames];

  // Process oldest selected day first so newest day ends up at the top of nextGames
  const orderedGroups = [...params.groups].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  let addedGames = 0;
  let updatedGames = 0;
  let addedVideos = 0;
  let skippedDays = 0;
  let skippedDuplicateVideos = 0;
  let latestGameId = '';

  for (const group of orderedGroups) {
    const unregistered: ParsedPlaylistVideoEntry[] = [];
    for (const entry of group.entries) {
      const vid = entry.video.videoId;
      if (!vid || registeredIds.has(vid)) {
        skippedDuplicateVideos += 1;
        continue;
      }
      registeredIds.add(vid);
      unregistered.push(entry);
    }

    if (unregistered.length === 0) {
      skippedDays += 1;
      continue;
    }

    addedVideos += unregistered.length;

    const aiResult = params.aiResultsByDate?.[group.date];
    const hasUsableAi =
      Boolean(applyAiMatchesFn) &&
      Boolean(aiResult && aiResult.matches.length > 0);

    const preferredIdx = findMatchingSummaryGameIndex(
      nextGames,
      group.date,
      group.opponents,
      cleanTitle,
      getMatchesFn
    );

    if (preferredIdx !== -1) {
      const existing = nextGames[preferredIdx];
      const existingMatches = getMatchesFn(existing);
      const appendedMatches = buildMatchesFromParsedEntries(unregistered, {
        defaultOpponent: existing.opponent,
        existingMatches,
        createId,
        clipIdsByVideoId: params.clipIdsByVideoId,
      });
      const stagedMatches = [...existingMatches, ...appendedMatches];
      const finalMatches =
        hasUsableAi && applyAiMatchesFn && aiResult
          ? applyAiMatchesFn(
              stagedMatches,
              aiResult.matches,
              existing.opponent,
              aiResult.fetchedTitles
            )
          : stagedMatches;
      nextGames[preferredIdx] = syncGameFn(existing, finalMatches);
      updatedGames += 1;
      latestGameId = existing.id;
    } else {
      const fallbackOpp = group.opponents[0] || '対戦相手';
      const seedMatches = buildMatchesFromParsedEntries(unregistered, {
        defaultOpponent: fallbackOpp,
        createId,
        clipIdsByVideoId: params.clipIdsByVideoId,
      });
      const matches =
        hasUsableAi && applyAiMatchesFn && aiResult
          ? applyAiMatchesFn(
              seedMatches,
              aiResult.matches,
              fallbackOpp,
              aiResult.fetchedTitles
            )
          : seedMatches;
      const distinctOpponents = Array.from(
        new Set(matches.map((m) => m.opponent).filter(Boolean))
      );
      const oppLabel = distinctOpponents.join('・') || '対戦相手';
      const dateShort = formatShortMonthDay(group.date);
      const baseTitle = cleanTitle || '練習試合';
      const gameId = createId('game');

      const newGame: GameRecord = {
        id: gameId,
        title: `${baseTitle}（${dateShort}）`,
        date: group.date,
        opponent: oppLabel,
        category: inferCategoryFromPlaylistTitle(cleanTitle),
        homeScore: 0,
        awayScore: 0,
        matches,
        videos: matches.flatMap((m) => m.videos),
        events: [],
        ...(cleanTitle ? { notes: `「${cleanTitle}」より取り込み` } : {}),
      };
      nextGames.unshift(newGame);
      addedGames += 1;
      latestGameId = gameId;
    }
  }

  return {
    nextGames,
    addedGames,
    updatedGames,
    addedVideos,
    skippedDays,
    skippedDuplicateVideos,
    latestGameId,
  };
}
