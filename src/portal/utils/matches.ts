import type {
  GameMatch,
  GameRecord,
  GameStatEvent,
  GameVideoClip,
  PlayerBoxScoreEntry,
  TeamUnit,
} from '../types';

let matchSeq = 0;

/** Creates a unique match ID with fallback for non-HTTPS environments. */
export function createMatchId(prefix = 'match'): string {
  matchSeq += 1;
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${matchSeq}_${rand}`;
}

function toHalfWidthAlnum(text: string): string {
  return text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

/** Checks whether a manual box-score map contains any non-zero stat entry. */
export function hasNonEmptyManualBox(
  box?: Record<string, PlayerBoxScoreEntry>
): boolean {
  if (!box) return false;
  return Object.values(box).some(
    (e) =>
      e.pts > 0 ||
      e.fgm > 0 ||
      e.fga > 0 ||
      e.tpm > 0 ||
      e.tpa > 0 ||
      e.ftm > 0 ||
      e.fta > 0 ||
      e.oreb > 0 ||
      e.dreb > 0 ||
      e.ast > 0 ||
      e.stl > 0 ||
      e.blk > 0 ||
      e.to > 0 ||
      e.pf > 0
  );
}

/** Detects A/B squad marker from a video label or match title. */
export function detectTeamUnitFromText(text: string): TeamUnit {
  const norm = toHalfWidthAlnum(text).trim();
  if (!norm) return '';
  if (/(?:^|[\s_\-（(])[Aa](?:チーム|戦|(?=$|[\s_\-）)0-9試合]))/.test(norm)) {
    return 'A';
  }
  if (/(?:^|[\s_\-（(])[Bb](?:チーム|戦|(?=$|[\s_\-）)0-9試合]))/.test(norm)) {
    return 'B';
  }
  return '';
}

/** Parses quarter sequence info and strips trailing quarter/half tokens from a clip label. */
export function detectQuarterInfo(label: string): {
  quarterNum: number | null;
  isMultiQuarter: boolean;
  prefix: string;
  hadSplitToken: boolean;
} {
  const norm = toHalfWidthAlnum(label).trim();
  const isMultiQuarter =
    /[1]\s*[-〜~・]\s*[2-4]\s*Q/i.test(norm) || /フル|全Q|丸々/i.test(norm);

  if (isMultiQuarter) {
    const prefix = norm
      .replace(/(?:1\s*[-〜~・]\s*[2-4]\s*Q|フル|全Q|丸々)/gi, '')
      .replace(/[-_・/:\s]+$/, '')
      .trim();
    return { quarterNum: null, isMultiQuarter: true, prefix, hadSplitToken: false };
  }

  let quarterNum: number | null = null;
  if (/(?:^|[^\d])1\s*(?:Q|クオーター|クォーター)|第\s*1\s*(?:Q|ピリオド)/i.test(norm)) {
    quarterNum = 1;
  } else if (/(?:^|[^\d])2\s*(?:Q|クオーター|クォーター)|第\s*2\s*(?:Q|ピリオド)/i.test(norm)) {
    quarterNum = 2;
  } else if (/(?:^|[^\d])3\s*(?:Q|クオーター|クォーター)|第\s*3\s*(?:Q|ピリオド)/i.test(norm)) {
    quarterNum = 3;
  } else if (/(?:^|[^\d])4\s*(?:Q|クオーター|クォーター)|第\s*4\s*(?:Q|ピリオド)/i.test(norm)) {
    quarterNum = 4;
  } else if (/(?:^|[^a-zA-Z])OT(?:\d+)?(?:$|[^a-zA-Z])|延長/i.test(norm)) {
    quarterNum = 5;
  }

  const strippedQuarter = norm
    .replace(
      /(?:第?\s*[1-4]\s*(?:Q|クオーター|クォーター|ピリオド)|OT(?:\d+)?|延長)(?:\s*(?:前半|後半|[（(][^）)]*[）)]))?\s*$/i,
      ''
    )
    .trim();
  const strippedHalf = strippedQuarter.replace(/(?:前半|後半)\s*$/, '').trim();
  const hadHalfSuffix = strippedHalf !== strippedQuarter;
  const prefix = strippedHalf.replace(/[-_・/:\s]+$/, '').trim();

  return {
    quarterNum,
    isMultiQuarter: false,
    prefix,
    hadSplitToken: quarterNum !== null || hadHalfSuffix,
  };
}

/** Strips legacy per-clip score fields when storing clips inside GameMatch. */
export function stripLegacyStatsFromClip(clip: GameVideoClip): GameVideoClip {
  return {
    id: clip.id,
    label: clip.label,
    ...(clip.youtubeTitle ? { youtubeTitle: clip.youtubeTitle } : {}),
    youtubeId: clip.youtubeId,
    youtubeUrl: clip.youtubeUrl,
  };
}

function hasClipLegacyStats(clip: GameVideoClip): boolean {
  return (
    hasNonEmptyManualBox(clip.manualBoxScore) ||
    (clip.homeScore ?? 0) > 0 ||
    (clip.awayScore ?? 0) > 0
  );
}

/**
 * Automatically groups sequential video clips into GameMatch buckets.
 * Preserves any legacy per-clip or top-level game stats without loss.
 */
export function autoGroupClipsIntoMatches(
  clips: GameVideoClip[],
  defaultOpponent: string,
  legacyGame?: GameRecord
): GameMatch[] {
  const safeOpponent = defaultOpponent.trim() || '対戦相手';

  if (clips.length === 0) {
    return [
      {
        id: legacyGame ? `match_${legacyGame.id}_0` : createMatchId(),
        label: '1試合目',
        teamUnit: '',
        opponent: safeOpponent,
        homeScore: legacyGame?.homeScore ?? 0,
        awayScore: legacyGame?.awayScore ?? 0,
        videos: [],
        events: legacyGame?.events ?? [],
        manualBoxScore: legacyGame?.manualBoxScore,
      },
    ];
  }

  interface ClipGroup {
    clips: GameVideoClip[];
    prefix: string;
    hasQuarterPrefix: boolean;
    maxQuarter: number;
    hasMultiQuarter: boolean;
    hasLegacyClipStats: boolean;
  }

  const groups: ClipGroup[] = [];

  for (const clip of clips) {
    const info = detectQuarterInfo(clip.label);
    const clipHasStats = hasClipLegacyStats(clip);
    const current = groups[groups.length - 1];

    let startNew = false;
    if (!current) {
      startNew = true;
    } else if (info.isMultiQuarter || current.hasMultiQuarter) {
      startNew = true;
    } else if (clipHasStats && current.hasLegacyClipStats) {
      startNew = true;
    } else if (
      info.prefix &&
      current.prefix &&
      info.hadSplitToken &&
      current.hasQuarterPrefix
    ) {
      startNew = info.prefix !== current.prefix;
    } else if (info.quarterNum === null) {
      startNew = true;
    } else if (info.quarterNum === 1 && current.maxQuarter >= 2) {
      startNew = true;
    }

    if (startNew) {
      groups.push({
        clips: [clip],
        prefix: info.hadSplitToken ? info.prefix : '',
        hasQuarterPrefix: info.hadSplitToken,
        maxQuarter: info.quarterNum ?? 0,
        hasMultiQuarter: info.isMultiQuarter,
        hasLegacyClipStats: clipHasStats,
      });
    } else {
      current.clips.push(clip);
      if (info.quarterNum !== null && info.quarterNum > current.maxQuarter) {
        current.maxQuarter = info.quarterNum;
      }
      if (!current.prefix && info.hadSplitToken && info.prefix) {
        current.prefix = info.prefix;
      }
      if (clipHasStats) {
        current.hasLegacyClipStats = true;
      }
    }
  }

  const anyClipHasStats = clips.some((c) => hasClipLegacyStats(c));
  const legacyEvents = legacyGame?.events ?? [];
  const untaggedLegacyEvents = legacyEvents.filter((e) => !e.videoClipId);

  return groups.map((grp, idx) => {
    const clipIds = new Set(grp.clips.map((c) => c.id));
    const groupEvents: GameStatEvent[] = [
      ...legacyEvents.filter((e) => e.videoClipId && clipIds.has(e.videoClipId)),
      ...(idx === 0 ? untaggedLegacyEvents : []),
    ];

    const clipWithStats = grp.clips.find((c) => hasClipLegacyStats(c));
    let homeScore = clipWithStats?.homeScore ?? 0;
    let awayScore = clipWithStats?.awayScore ?? 0;
    let manualBoxScore = clipWithStats?.manualBoxScore;

    if (!anyClipHasStats && idx === 0 && legacyGame) {
      if (hasNonEmptyManualBox(legacyGame.manualBoxScore)) {
        manualBoxScore = legacyGame.manualBoxScore;
      }
      if (homeScore === 0 && legacyGame.homeScore > 0) {
        homeScore = legacyGame.homeScore;
      }
      if (awayScore === 0 && legacyGame.awayScore > 0) {
        awayScore = legacyGame.awayScore;
      }
    }

    const joinedLabels = grp.clips.map((c) => c.label).join(' ');
    const teamUnit = detectTeamUnitFromText(
      grp.prefix ? `${grp.prefix} ${joinedLabels}` : joinedLabels
    );
    const label = grp.prefix || `${idx + 1}試合目`;

    return {
      id: legacyGame ? `match_${legacyGame.id}_${idx}` : createMatchId(),
      label,
      teamUnit,
      opponent: safeOpponent,
      homeScore,
      awayScore,
      videos: grp.clips.map(stripLegacyStatsFromClip),
      events: groupEvents,
      manualBoxScore,
    };
  });
}

/** Returns a GameRecord's matches, auto-migrating legacy clip-based records seamlessly. */
export function getGameMatches(game: GameRecord): GameMatch[] {
  if (Array.isArray(game.matches) && game.matches.length > 0) {
    return game.matches;
  }
  return autoGroupClipsIntoMatches(game.videos, game.opponent, game);
}

/** Formats a match pill label with optional A/B team prefix without duplicating it. */
export function formatMatchDisplayTitle(match: GameMatch): string {
  const base = match.label.trim() || '試合';
  const unit = match.teamUnit;
  if (!unit || unit === 'その他') return base;
  const startsWithUnit =
    base.toUpperCase().startsWith(`${unit} `) ||
    base.toUpperCase().startsWith(`${unit}チーム`) ||
    base.toUpperCase() === unit;
  return startsWithUnit ? base : `${unit} ${base}`;
}

/** Synchronizes a GameRecord's derived top-level videos and total scores from its matches. */
export function syncGameFromMatches(
  game: GameRecord,
  matches: GameMatch[],
  computeMatchScoreFn: (match: GameMatch) => {
    homeScore: number;
    awayScore: number;
    hasStats: boolean;
  }
): GameRecord {
  const normalizedMatches = matches.map((m) => ({
    ...m,
    videos: m.videos.map(stripLegacyStatsFromClip),
  }));
  const flattenedVideos = normalizedMatches.flatMap((m) => m.videos);

  let totalHome = 0;
  let totalAway = 0;
  for (const m of normalizedMatches) {
    const sum = computeMatchScoreFn(m);
    if (sum.hasStats) {
      totalHome += sum.homeScore;
      totalAway += sum.awayScore;
    }
  }

  return {
    ...game,
    matches: normalizedMatches,
    videos: flattenedVideos,
    homeScore: totalHome,
    awayScore: totalAway,
    events: [],
    manualBoxScore: undefined,
  };
}

/** Sums two player box-score maps cleanly per player. */
export function mergeBoxScoreMaps(
  a?: Record<string, PlayerBoxScoreEntry>,
  b?: Record<string, PlayerBoxScoreEntry>
): Record<string, PlayerBoxScoreEntry> | undefined {
  const hasA = hasNonEmptyManualBox(a);
  const hasB = hasNonEmptyManualBox(b);
  if (!hasA && !hasB) return undefined;
  if (hasA && !hasB) return a;
  if (!hasA && hasB) return b;

  const out: Record<string, PlayerBoxScoreEntry> = {};
  for (const [id, entry] of Object.entries(a ?? {})) {
    out[id] = { ...entry };
  }
  for (const [id, entry] of Object.entries(b ?? {})) {
    const prev = out[id];
    if (!prev) {
      out[id] = { ...entry };
    } else {
      out[id] = {
        playerId: id,
        pts: prev.pts + entry.pts,
        fgm: prev.fgm + entry.fgm,
        fga: prev.fga + entry.fga,
        tpm: prev.tpm + entry.tpm,
        tpa: prev.tpa + entry.tpa,
        ftm: prev.ftm + entry.ftm,
        fta: prev.fta + entry.fta,
        oreb: prev.oreb + entry.oreb,
        dreb: prev.dreb + entry.dreb,
        ast: prev.ast + entry.ast,
        stl: prev.stl + entry.stl,
        blk: prev.blk + entry.blk,
        to: prev.to + entry.to,
        pf: prev.pf + entry.pf,
      };
    }
  }
  return out;
}

/** Merges matches[matchIndex] into the previous match cleanly without dropping videos or stats. */
export function mergeMatchWithPrevious(
  matches: GameMatch[],
  matchIndex: number
): GameMatch[] {
  if (matchIndex <= 0 || matchIndex >= matches.length) return matches;
  const prev = matches[matchIndex - 1];
  const curr = matches[matchIndex];

  const merged: GameMatch = {
    ...prev,
    teamUnit: prev.teamUnit || curr.teamUnit,
    videos: [...prev.videos, ...curr.videos],
    events: [...prev.events, ...curr.events],
    manualBoxScore: mergeBoxScoreMaps(prev.manualBoxScore, curr.manualBoxScore),
    homeScore: prev.homeScore + curr.homeScore,
    awayScore: prev.awayScore + curr.awayScore,
  };

  return [
    ...matches.slice(0, matchIndex - 1),
    merged,
    ...matches.slice(matchIndex + 1),
  ];
}

/** Moves a video clip (and its tagged events) into another match or creates a new match. */
export function moveClipToMatch(
  matches: GameMatch[],
  fromMatchId: string,
  clipId: string,
  toMatchId: string | '__new__',
  defaultOpponent: string
): GameMatch[] {
  if (fromMatchId === toMatchId) return matches;
  const fromIdx = matches.findIndex((m) => m.id === fromMatchId);
  if (fromIdx === -1) return matches;

  const fromMatch = matches[fromIdx];
  const clip = fromMatch.videos.find((v) => v.id === clipId);
  if (!clip) return matches;

  const movedEvents = fromMatch.events.filter((ev) => ev.videoClipId === clipId);
  const remainingEvents = fromMatch.events.filter(
    (ev) => ev.videoClipId !== clipId
  );
  const updatedFrom: GameMatch = {
    ...fromMatch,
    videos: fromMatch.videos.filter((v) => v.id !== clipId),
    events: remainingEvents,
  };

  let nextMatches = matches.map((m, idx) => (idx === fromIdx ? updatedFrom : m));

  if (toMatchId === '__new__') {
    const newMatch: GameMatch = {
      id: createMatchId(),
      label: `${matches.length + 1}試合目`,
      teamUnit: detectTeamUnitFromText(clip.label) || fromMatch.teamUnit || '',
      opponent: fromMatch.opponent || defaultOpponent || '対戦相手',
      homeScore: 0,
      awayScore: 0,
      videos: [clip],
      events: movedEvents,
    };
    nextMatches = [
      ...nextMatches.slice(0, fromIdx + 1),
      newMatch,
      ...nextMatches.slice(fromIdx + 1),
    ];
  } else {
    nextMatches = nextMatches.map((m) =>
      m.id === toMatchId
        ? {
            ...m,
            videos: [...m.videos, clip],
            events: [...m.events, ...movedEvents],
          }
        : m
    );
  }

  return nextMatches.filter((m, idx) => {
    if (m.videos.length > 0) return true;
    const hasMatchStats =
      hasNonEmptyManualBox(m.manualBoxScore) ||
      m.events.length > 0 ||
      m.homeScore > 0 ||
      m.awayScore > 0;
    if (hasMatchStats) return true;
    return idx === 0 && nextMatches.length === 1;
  });
}

/** Moves a video clip up (-1) or down (+1) inside a match. */
export function reorderClipInMatch(
  matches: GameMatch[],
  matchId: string,
  clipIndex: number,
  delta: -1 | 1
): GameMatch[] {
  const targetIdx = clipIndex + delta;
  return matches.map((m) => {
    if (m.id !== matchId) return m;
    if (
      clipIndex < 0 ||
      clipIndex >= m.videos.length ||
      targetIdx < 0 ||
      targetIdx >= m.videos.length
    ) {
      return m;
    }
    const nextVideos = [...m.videos];
    const [picked] = nextVideos.splice(clipIndex, 1);
    nextVideos.splice(targetIdx, 0, picked);
    return { ...m, videos: nextVideos };
  });
}

/** Appends an empty match container to the day's match list. */
export function addEmptyMatch(
  matches: GameMatch[],
  defaultOpponent: string
): GameMatch[] {
  const next: GameMatch = {
    id: createMatchId(),
    label: `${matches.length + 1}試合目`,
    teamUnit: '',
    opponent: defaultOpponent.trim() || '対戦相手',
    homeScore: 0,
    awayScore: 0,
    videos: [],
    events: [],
  };
  return [...matches, next];
}

export interface AiOrganizedMatchInput {
  label: string;
  teamUnit: TeamUnit;
  opponent: string;
  clips: Array<{ id: string; label: string }>;
}

/** Builds a compact quarter/clip label summary (e.g. "1Q・2Q") for a match. */
export function formatMatchClipSummary(match: GameMatch): string {
  const labels = match.videos
    .map((v) => v.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return '';
  if (labels.length <= 3) return labels.join('・');
  return `${labels.slice(0, 3).join('・')}…`;
}

/** Fills missing clip youtubeTitle fields from a fetched youtubeId -> title map. */
export function applyFetchedYouTubeTitlesToMatches(
  matches: GameMatch[],
  titlesByVideoId: Record<string, string>
): GameMatch[] {
  let changed = false;
  const next = matches.map((m) => {
    let matchChanged = false;
    const nextVideos = m.videos.map((v) => {
      if (v.youtubeTitle && v.youtubeTitle.trim()) return v;
      const fetched = titlesByVideoId[v.youtubeId]?.trim();
      if (!fetched) return v;
      matchChanged = true;
      changed = true;
      return { ...v, youtubeTitle: fetched };
    });
    return matchChanged ? { ...m, videos: nextVideos } : m;
  });
  return changed ? next : matches;
}

function matchHasStats(m: GameMatch): boolean {
  return (
    hasNonEmptyManualBox(m.manualBoxScore) ||
    m.events.length > 0 ||
    m.homeScore > 0 ||
    m.awayScore > 0
  );
}

/** Moves stats (scores, manualBoxScore, events) from one match to another, removing the emptied slot if video-less. */
export function moveMatchStatsToTarget(
  matches: GameMatch[],
  fromMatchId: string,
  toMatchId: string
): GameMatch[] {
  if (fromMatchId === toMatchId) return matches;
  const fromMatch = matches.find((m) => m.id === fromMatchId);
  const toExists = matches.some((m) => m.id === toMatchId);
  if (!fromMatch || !toExists) return matches;

  const updated = matches.map((m) => {
    if (m.id === toMatchId) {
      return {
        ...m,
        homeScore: fromMatch.homeScore,
        awayScore: fromMatch.awayScore,
        events: [...fromMatch.events],
        manualBoxScore: fromMatch.manualBoxScore
          ? { ...fromMatch.manualBoxScore }
          : undefined,
      };
    }
    if (m.id === fromMatchId) {
      return {
        ...m,
        homeScore: 0,
        awayScore: 0,
        events: [],
        manualBoxScore: undefined,
      };
    }
    return m;
  });

  return updated.filter((m, idx) => {
    if (m.id === fromMatchId && m.videos.length === 0 && updated.length > 1) {
      return false;
    }
    return (
      m.videos.length > 0 ||
      matchHasStats(m) ||
      (idx === 0 && updated.length === 1)
    );
  });
}

/**
 * Reorganizes clips into AI-suggested matches while preserving clip youtubeTitles
 * and existing match stats without dropping, duplicating, or mis-summing box scores.
 */
export function applyAiOrganizedMatches(
  existingMatches: GameMatch[],
  aiGroups: AiOrganizedMatchInput[],
  defaultOpponent: string,
  fetchedTitles?: Record<string, string>
): GameMatch[] {
  const clipById = new Map<string, GameVideoClip>();
  const clipOriginMatchId = new Map<string, string>();
  const oldMatchById = new Map<string, GameMatch>();

  for (const m of existingMatches) {
    oldMatchById.set(m.id, m);
    for (const v of m.videos) {
      const clean = stripLegacyStatsFromClip(v);
      const fetched = fetchedTitles?.[v.youtubeId]?.trim();
      clipById.set(
        v.id,
        !clean.youtubeTitle && fetched ? { ...clean, youtubeTitle: fetched } : clean
      );
      clipOriginMatchId.set(v.id, m.id);
    }
  }

  const usedClipIds = new Set<string>();
  const safeDefaultOpponent = defaultOpponent.trim() || '対戦相手';

  const rawGroups: Array<{
    label: string;
    teamUnit: TeamUnit;
    opponent: string;
    videos: GameVideoClip[];
  }> = [];

  for (const grp of aiGroups) {
    const resolvedClips: GameVideoClip[] = [];
    for (const entry of grp.clips) {
      if (!entry.id || usedClipIds.has(entry.id)) continue;
      const orig = clipById.get(entry.id);
      if (!orig) continue;
      usedClipIds.add(entry.id);
      const nextLabel = entry.label.trim() || orig.label;
      resolvedClips.push({ ...orig, label: nextLabel });
    }
    if (resolvedClips.length === 0) continue;

    const matchIndex = rawGroups.length + 1;
    const normalizedUnit: TeamUnit =
      grp.teamUnit === 'A' || grp.teamUnit === 'B' || grp.teamUnit === 'その他'
        ? grp.teamUnit
        : '';

    rawGroups.push({
      label: grp.label.trim() || `${matchIndex}試合目`,
      teamUnit: normalizedUnit,
      opponent: grp.opponent.trim() || safeDefaultOpponent,
      videos: resolvedClips,
    });
  }

  // Guarantee zero clips are dropped even if omitted by AI response.
  const leftoverClips: GameVideoClip[] = [];
  for (const [id, clip] of clipById.entries()) {
    if (!usedClipIds.has(id)) {
      leftoverClips.push(clip);
    }
  }
  if (leftoverClips.length > 0) {
    if (rawGroups.length > 0) {
      const last = rawGroups[rawGroups.length - 1];
      rawGroups[rawGroups.length - 1] = {
        ...last,
        videos: [...last.videos, ...leftoverClips],
      };
    } else {
      rawGroups.push({
        label: '1試合目',
        teamUnit: '',
        opponent: safeDefaultOpponent,
        videos: leftoverClips,
      });
    }
  }

  const orderedStatMatches = existingMatches.filter(matchHasStats);
  const hasMultiStatCollision = rawGroups.some((g) => {
    const statSrcIds = new Set<string>();
    for (const clip of g.videos) {
      const srcId = clipOriginMatchId.get(clip.id);
      const src = srcId ? oldMatchById.get(srcId) : undefined;
      if (srcId && src && matchHasStats(src)) {
        statSrcIds.add(srcId);
      }
    }
    return statSrcIds.size >= 2;
  });
  const hasOrphanStats = existingMatches.some(
    (m) => m.videos.length === 0 && matchHasStats(m)
  );
  const needsSequentialStatRealign = hasMultiStatCollision || hasOrphanStats;

  const usedMatchIds = new Set<string>();
  const pickUniqueMatchId = (preferred?: string): string => {
    if (preferred && !usedMatchIds.has(preferred)) {
      usedMatchIds.add(preferred);
      return preferred;
    }
    const fresh = createMatchId();
    usedMatchIds.add(fresh);
    return fresh;
  };

  if (needsSequentialStatRealign) {
    const aligned: GameMatch[] = rawGroups.map((g, idx) => {
      const statSrc = orderedStatMatches[idx];
      const originCandidateId = g.videos[0]
        ? clipOriginMatchId.get(g.videos[0].id)
        : undefined;
      return {
        id: pickUniqueMatchId(statSrc?.id ?? originCandidateId),
        label: g.label,
        teamUnit: g.teamUnit,
        opponent: g.opponent,
        homeScore: statSrc?.homeScore ?? 0,
        awayScore: statSrc?.awayScore ?? 0,
        videos: g.videos,
        events: statSrc ? [...statSrc.events] : [],
        ...(statSrc?.manualBoxScore
          ? { manualBoxScore: { ...statSrc.manualBoxScore } }
          : {}),
      };
    });

    for (const overflow of orderedStatMatches.slice(rawGroups.length)) {
      aligned.push({
        ...overflow,
        id: pickUniqueMatchId(overflow.id),
        videos: [],
      });
    }
    return aligned;
  }

  const claimedMatchIds = new Set<string>();
  const result: GameMatch[] = [];

  for (const g of rawGroups) {
    const resolvedClipIdSet = new Set(g.videos.map((c) => c.id));
    const srcMatchIds: string[] = [];
    for (const c of g.videos) {
      const mId = clipOriginMatchId.get(c.id);
      if (mId && !srcMatchIds.includes(mId)) {
        srcMatchIds.push(mId);
      }
    }

    let firstClaimedId: string | null = null;
    let homeScore = 0;
    let awayScore = 0;
    let manualBoxScore: Record<string, PlayerBoxScoreEntry> | undefined;
    const events: GameStatEvent[] = [];

    for (const srcId of srcMatchIds) {
      const src = oldMatchById.get(srcId);
      if (!src) continue;

      if (!claimedMatchIds.has(srcId)) {
        claimedMatchIds.add(srcId);
        if (firstClaimedId === null) {
          firstClaimedId = src.id;
        }
        if (matchHasStats(src)) {
          homeScore += src.homeScore;
          awayScore += src.awayScore;
          manualBoxScore = mergeBoxScoreMaps(manualBoxScore, src.manualBoxScore);
        }
        for (const ev of src.events) {
          if (
            !ev.videoClipId ||
            !clipById.has(ev.videoClipId) ||
            resolvedClipIdSet.has(ev.videoClipId)
          ) {
            events.push(ev);
          }
        }
      } else {
        for (const ev of src.events) {
          if (ev.videoClipId && resolvedClipIdSet.has(ev.videoClipId)) {
            events.push(ev);
          }
        }
      }
    }

    result.push({
      id: pickUniqueMatchId(firstClaimedId ?? undefined),
      label: g.label,
      teamUnit: g.teamUnit,
      opponent: g.opponent,
      homeScore,
      awayScore,
      videos: g.videos,
      events,
      ...(manualBoxScore ? { manualBoxScore } : {}),
    });
  }

  for (const old of existingMatches) {
    if (claimedMatchIds.has(old.id)) continue;
    if (!matchHasStats(old)) continue;
    result.push({
      ...old,
      id: pickUniqueMatchId(old.id),
      videos: [],
    });
  }

  return result;
}

export interface GameOrganizationStatus {
  matchCount: number;
  videoCount: number;
  hasStats: boolean;
  missingYoutubeTitleCount: number;
  needsReview: boolean;
  reasons: string[];
  matchPreview: string;
}

function hasQuarterOrderOrDuplicateIssue(match: GameMatch): boolean {
  let prevQuarter = -1;
  const nonHalfQuarterCounts = new Map<number, number>();

  for (const clip of match.videos) {
    const info = detectQuarterInfo(clip.label);
    if (info.quarterNum === null) continue;
    if (info.quarterNum < prevQuarter) {
      return true;
    }
    prevQuarter = info.quarterNum;

    if (!/前半|後半/.test(clip.label)) {
      const nextCount = (nonHalfQuarterCounts.get(info.quarterNum) ?? 0) + 1;
      if (nextCount >= 2) {
        return true;
      }
      nonHalfQuarterCounts.set(info.quarterNum, nextCount);
    }
  }
  return false;
}

/** Inspects a GameRecord and flags days that likely need AI video/match reorganization. */
export function inspectGameOrganizationStatus(
  game: GameRecord
): GameOrganizationStatus {
  const matches = getGameMatches(game);
  const allClips = matches.flatMap((m) => m.videos);
  const videoCount = allClips.length;
  const hasStats = matches.some((m) => matchHasStats(m));
  const missingYoutubeTitleCount = allClips.filter(
    (c) => !c.youtubeTitle && Boolean(c.youtubeId) && !c.youtubeId.startsWith('demo_')
  ).length;

  let matchPreview = '';
  if (!(videoCount === 0 && matches.length <= 1)) {
    const head = matches
      .slice(0, 4)
      .map((m) => `${formatMatchDisplayTitle(m)}(${m.videos.length}本)`)
      .join(' / ');
    matchPreview =
      matches.length > 4 ? `${head} 他${matches.length - 4}試合` : head;
  }

  const reasons: string[] = [];
  if (videoCount > 0) {
    const maxClipsInOneMatch = Math.max(
      0,
      ...matches.map((m) => m.videos.length)
    );
    if (maxClipsInOneMatch >= 5) {
      reasons.push(`1試合に${maxClipsInOneMatch}本集中`);
    }

    const hasPlaceholderLabel = allClips.some((c) => {
      const lbl = c.label.trim();
      return (
        /^動画\s*\d+$/.test(lbl) ||
        /^clip\s*\d*$/i.test(lbl) ||
        (videoCount >= 2 && lbl === '試合動画')
      );
    });
    if (hasPlaceholderLabel) {
      reasons.push('仮ラベルあり');
    }

    if (missingYoutubeTitleCount > 0) {
      reasons.push(`元タイトル未取得(${missingYoutubeTitleCount}本)`);
    }

    const hasPlaceholderOpponent = matches.some((m) => {
      const opp = m.opponent.trim();
      return !opp || opp === '対戦相手' || opp === '練習試合';
    });
    if (hasPlaceholderOpponent) {
      reasons.push('対戦相手が未設定');
    }

    const isFragmentedByQuarter =
      matches.length >= 4 &&
      matches.every((m) => m.videos.length === 1) &&
      matches.filter(
        (m) => detectQuarterInfo(m.videos[0].label).quarterNum !== null
      ).length >= 3;
    if (isFragmentedByQuarter) {
      reasons.push('1本ずつ細切れ');
    }

    if (matches.some((m) => hasQuarterOrderOrDuplicateIssue(m))) {
      reasons.push('クォーター順ズレ');
    }

    if (matches.length > 1 && matches.some((m) => m.videos.length === 0)) {
      reasons.push('空の試合枠あり');
    }
  }

  return {
    matchCount: matches.length,
    videoCount,
    hasStats,
    missingYoutubeTitleCount,
    needsReview: videoCount > 0 && reasons.length > 0,
    reasons,
    matchPreview,
  };
}
