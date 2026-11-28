import type {
  GameMatch,
  GameRecord,
  Player,
  PlayerBoxScoreEntry,
  PortalData,
  PortalRevision,
  PortalRevisionStats,
  PracticeVideo,
} from '../types';
import { DEFAULT_OWNER_EMAIL } from '../data/sampleData.ts';
import {
  formatMatchDisplayTitle,
  getGameMatches,
  hasNonEmptyManualBox,
} from './matches.ts';
import { computeMatchSummary } from './stats.ts';

export const MAX_REVISIONS_KEEP = 30;
export const MAX_DIFF_CHANGES = 10;

export interface PortalDiffSummary {
  hasChanges: boolean;
  actionSummary: string;
  changes: string[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isHistoryModeSearch(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return params.get('mode') === 'history';
  } catch {
    return false;
  }
}

export function buildPortalUrlWithoutHistoryMode(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete('mode');
    const search = url.search;
    return `${url.pathname}${search}${url.hash}` || '/';
  } catch {
    return '/';
  }
}

export function isOwnerEmail(
  email: string | null | undefined,
  data?: Pick<PortalData, 'ownerEmails'> | null
): boolean {
  if (!email) return false;
  const target = normalizeEmail(email);
  if (!target) return false;
  if (target === normalizeEmail(DEFAULT_OWNER_EMAIL)) return true;
  if (!data || !Array.isArray(data.ownerEmails)) return false;
  return data.ownerEmails.some((owner) => normalizeEmail(owner) === target);
}

export function computePortalRevisionStats(
  data: PortalData
): PortalRevisionStats {
  let matches = 0;
  let scoredMatches = 0;

  for (const game of data.games) {
    const gameMatches = getGameMatches(game);
    matches += gameMatches.length;
    for (const match of gameMatches) {
      if (computeMatchSummary(match).hasStats) {
        scoredMatches += 1;
      }
    }
  }

  return {
    gameDays: data.games.length,
    matches,
    scoredMatches,
    players: data.players.length,
    practices: data.practices.length,
  };
}

export function formatRevisionDateJst(isoString: string): string {
  if (!isoString) return '日時不明';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;

  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}/${map.month}/${map.day}(${map.weekday}) ${map.hour}:${map.minute}:${map.second}`;
}

export function createRevisionId(nowMs = Date.now()): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `rev_${nowMs}_${rand}`;
}

function canonicalSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const entries = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalSerialize(obj[k])}`
    );
    return `{${entries.join(',')}}`;
  }
  return 'null';
}

function isNonZeroBoxEntry(entry: PlayerBoxScoreEntry): boolean {
  return (
    entry.pts > 0 ||
    entry.fgm > 0 ||
    entry.fga > 0 ||
    entry.tpm > 0 ||
    entry.tpa > 0 ||
    entry.ftm > 0 ||
    entry.fta > 0 ||
    entry.oreb > 0 ||
    entry.dreb > 0 ||
    entry.ast > 0 ||
    entry.stl > 0 ||
    entry.blk > 0 ||
    entry.to > 0 ||
    entry.pf > 0
  );
}

function canonicalManualBox(
  box?: Record<string, PlayerBoxScoreEntry>
): string {
  if (!hasNonEmptyManualBox(box) || !box) return '';
  const cleaned: Record<string, PlayerBoxScoreEntry> = {};
  for (const key of Object.keys(box).sort()) {
    const entry = box[key];
    if (entry && isNonZeroBoxEntry(entry)) {
      cleaned[key] = entry;
    }
  }
  return canonicalSerialize(cleaned);
}

function formatGameDayLabel(game: GameRecord): string {
  const date = (game.date || '').trim();
  const title = (game.title || '').trim();
  if (date && title) {
    return title.includes(date) ? title : `${date} ${title}`;
  }
  return title || date || '試合日';
}

function formatMatchLabel(match: GameMatch): string {
  const display = formatMatchDisplayTitle(match);
  const opponent = (match.opponent || '').trim();
  if (opponent && opponent !== '対戦相手' && !display.includes(opponent)) {
    return `${display}（vs ${opponent}）`;
  }
  return display;
}

function countTotalVideosInMatches(matches: GameMatch[]): number {
  return matches.reduce((sum, m) => sum + m.videos.length, 0);
}

function matchVideosSignature(matches: GameMatch[]): string {
  return canonicalSerialize(
    matches.map((m) => ({
      id: m.id,
      videos: m.videos.map((v) => ({
        id: v.id,
        label: v.label,
        youtubeId: v.youtubeId,
        youtubeUrl: v.youtubeUrl,
        youtubeTitle: v.youtubeTitle ?? '',
      })),
    }))
  );
}

function matchMetadataSignature(matches: GameMatch[]): string {
  return canonicalSerialize(
    matches.map((m) => ({
      id: m.id,
      label: m.label,
      teamUnit: m.teamUnit ?? '',
      opponent: m.opponent,
    }))
  );
}

function diffGameRecord(bGame: GameRecord, aGame: GameRecord): string[] {
  const changes: string[] = [];
  const dayLabel = formatGameDayLabel(aGame);

  const metaChangedFields: string[] = [];
  if (bGame.title !== aGame.title) metaChangedFields.push('タイトル');
  if (bGame.date !== aGame.date) metaChangedFields.push('日付');
  if (bGame.category !== aGame.category) metaChangedFields.push('カテゴリ');
  if ((bGame.notes ?? '') !== (aGame.notes ?? '')) metaChangedFields.push('メモ');

  if (metaChangedFields.length === 1) {
    const field = metaChangedFields[0];
    if (field === 'タイトル') {
      changes.push(
        `「${dayLabel}」のタイトルを変更（${bGame.title} → ${aGame.title}）`
      );
    } else if (field === '日付') {
      changes.push(
        `「${dayLabel}」の日付を変更（${bGame.date} → ${aGame.date}）`
      );
    } else if (field === 'カテゴリ') {
      changes.push(
        `「${dayLabel}」のカテゴリを変更（${bGame.category} → ${aGame.category}）`
      );
    } else {
      changes.push(`「${dayLabel}」のメモを更新`);
    }
  } else if (metaChangedFields.length > 1) {
    changes.push(
      `「${dayLabel}」の基本情報を変更（${metaChangedFields.join('・')}）`
    );
  }

  if (Boolean(bGame.isOrganized) !== Boolean(aGame.isOrganized)) {
    changes.push(
      `「${dayLabel}」を${aGame.isOrganized ? '整理済み' : '未整理'}に変更`
    );
  }

  const bMatches = getGameMatches(bGame);
  const aMatches = getGameMatches(aGame);
  const bMatchMap = new Map(bMatches.map((m) => [m.id, m]));
  const aMatchMap = new Map(aMatches.map((m) => [m.id, m]));

  for (const aM of aMatches) {
    const bM = bMatchMap.get(aM.id);
    const mLabel = formatMatchLabel(aM);
    const aSum = computeMatchSummary(aM);
    const aScoreText = `${aSum.homeScore}-${aSum.awayScore}`;

    if (!bM) {
      if (aSum.hasStats) {
        changes.push(
          `「${dayLabel}」に ${mLabel} のスコア・スタッツを登録（${aScoreText}）`
        );
      }
      continue;
    }

    const bSum = computeMatchSummary(bM);
    const bScoreText = `${bSum.homeScore}-${bSum.awayScore}`;
    const scoreChanged =
      bSum.homeScore !== aSum.homeScore || bSum.awayScore !== aSum.awayScore;
    const boxChanged =
      canonicalManualBox(bM.manualBoxScore) !==
      canonicalManualBox(aM.manualBoxScore);
    const eventsChanged =
      canonicalSerialize(bM.events) !== canonicalSerialize(aM.events);

    if (!bSum.hasStats && aSum.hasStats) {
      changes.push(
        `「${dayLabel}」${mLabel} にスコア・スタッツを登録（${aScoreText}）`
      );
    } else if (bSum.hasStats && !aSum.hasStats) {
      changes.push(
        `「${dayLabel}」${mLabel} のスコア・スタッツを削除（${bScoreText}）`
      );
    } else if (scoreChanged && (boxChanged || eventsChanged)) {
      changes.push(
        `「${dayLabel}」${mLabel} のスコア・ボックススコアを更新（${bScoreText} → ${aScoreText}）`
      );
    } else if (scoreChanged) {
      changes.push(
        `「${dayLabel}」${mLabel} のスコアを変更（${bScoreText} → ${aScoreText}）`
      );
    } else if (boxChanged) {
      changes.push(`「${dayLabel}」${mLabel} のボックススコアを変更`);
    } else if (eventsChanged) {
      changes.push(
        `「${dayLabel}」${mLabel} のプレイ履歴を変更（${bM.events.length}件 → ${aM.events.length}件）`
      );
    }
  }

  for (const bM of bMatches) {
    if (aMatchMap.has(bM.id)) continue;
    const bSum = computeMatchSummary(bM);
    if (bSum.hasStats) {
      changes.push(
        `「${dayLabel}」から ${formatMatchLabel(bM)} のスコア・スタッツを削除（${bSum.homeScore}-${bSum.awayScore}）`
      );
    }
  }

  const bVideoCount = countTotalVideosInMatches(bMatches);
  const aVideoCount = countTotalVideosInMatches(aMatches);
  if (bMatches.length !== aMatches.length || bVideoCount !== aVideoCount) {
    changes.push(
      `「${dayLabel}」の試合・動画構成を変更（${bMatches.length}試合・動画${bVideoCount}本 → ${aMatches.length}試合・動画${aVideoCount}本）`
    );
  } else if (matchVideosSignature(bMatches) !== matchVideosSignature(aMatches)) {
    changes.push(
      `「${dayLabel}」の動画構成・ラベルを変更（${aMatches.length}試合・動画${aVideoCount}本）`
    );
  } else if (
    matchMetadataSignature(bMatches) !== matchMetadataSignature(aMatches)
  ) {
    changes.push(`「${dayLabel}」の試合名・対戦相手・区分を変更`);
  }

  if (changes.length === 0) {
    changes.push(`「${dayLabel}」の内容を更新`);
  }

  return changes;
}

function formatPracticeLabel(p: PracticeVideo): string {
  const date = (p.date || '').trim();
  const title = (p.title || '').trim() || '練習動画';
  return date ? `${date} ${title}` : title;
}

function diffPractice(bP: PracticeVideo, aP: PracticeVideo): string {
  const fields: string[] = [];
  if (bP.title !== aP.title) fields.push('タイトル');
  if (bP.date !== aP.date) fields.push('日付');
  if (bP.youtubeId !== aP.youtubeId || bP.youtubeUrl !== aP.youtubeUrl) {
    fields.push('動画URL');
  }
  if (canonicalSerialize(bP.tags) !== canonicalSerialize(aP.tags)) {
    fields.push('タグ');
  }
  if (canonicalSerialize(bP.moments) !== canonicalSerialize(aP.moments)) {
    fields.push('見どころ');
  }
  if ((bP.memo ?? '') !== (aP.memo ?? '')) {
    fields.push('メモ');
  }
  const title = (aP.title || bP.title || '練習動画').trim();
  if (fields.length === 0) {
    return `練習動画「${title}」を更新`;
  }
  return `練習動画「${title}」を更新（${fields.join('・')}）`;
}

function formatPlayerLabel(player: Player): string {
  const num = (player.number || '').trim();
  const name = (player.name || '').trim() || '名前なし';
  return num ? `#${num} ${name}` : name;
}

function summarizeEmailSetDiff(
  beforeList: string[],
  afterList: string[],
  kindLabel: string
): string[] {
  const beforeMap = new Map<string, string>();
  const afterMap = new Map<string, string>();
  for (const raw of beforeList) {
    const norm = normalizeEmail(raw);
    if (norm && !beforeMap.has(norm)) beforeMap.set(norm, norm);
  }
  for (const raw of afterList) {
    const norm = normalizeEmail(raw);
    if (norm && !afterMap.has(norm)) afterMap.set(norm, norm);
  }

  const added = Array.from(afterMap.keys()).filter((e) => !beforeMap.has(e));
  const removed = Array.from(beforeMap.keys()).filter((e) => !afterMap.has(e));
  const lines: string[] = [];

  if (added.length > 0) {
    const preview =
      added.length <= 2
        ? added.join('、')
        : `${added.slice(0, 2).join('、')} ほか${added.length - 2}件`;
    lines.push(`${kindLabel}を追加（${added.length}件：${preview}）`);
  }
  if (removed.length > 0) {
    const preview =
      removed.length <= 2
        ? removed.join('、')
        : `${removed.slice(0, 2).join('、')} ほか${removed.length - 2}件`;
    lines.push(`${kindLabel}を削除（${removed.length}件：${preview}）`);
  }

  return lines;
}

export function summarizePortalDiff(
  before: PortalData,
  after: PortalData
): PortalDiffSummary {
  if (canonicalSerialize(before) === canonicalSerialize(after)) {
    return {
      hasChanges: false,
      actionSummary: '',
      changes: [],
    };
  }

  const allChanges: string[] = [];

  // 1. 試合日 (games)
  const bGamesMap = new Map(before.games.map((g) => [g.id, g]));
  const aGamesMap = new Map(after.games.map((g) => [g.id, g]));
  const addedGames = after.games.filter((g) => !bGamesMap.has(g.id));
  const deletedGames = before.games.filter((g) => !aGamesMap.has(g.id));

  for (const g of addedGames) {
    const matches = getGameMatches(g);
    const videos = countTotalVideosInMatches(matches);
    allChanges.push(
      `試合日を追加：${formatGameDayLabel(g)}（${matches.length}試合・動画${videos}本）`
    );
  }

  for (const g of deletedGames) {
    allChanges.push(`試合日を削除：${formatGameDayLabel(g)}`);
  }

  for (const aGame of after.games) {
    const bGame = bGamesMap.get(aGame.id);
    if (!bGame) continue;
    if (canonicalSerialize(bGame) === canonicalSerialize(aGame)) continue;
    allChanges.push(...diffGameRecord(bGame, aGame));
  }

  // 2. 練習動画 (practices)
  const bPracticeMap = new Map(before.practices.map((p) => [p.id, p]));
  const aPracticeMap = new Map(after.practices.map((p) => [p.id, p]));
  const addedPractices = after.practices.filter((p) => !bPracticeMap.has(p.id));
  const deletedPractices = before.practices.filter(
    (p) => !aPracticeMap.has(p.id)
  );

  if (addedPractices.length > 0 && addedPractices.length <= 3) {
    for (const p of addedPractices) {
      allChanges.push(`練習動画を追加：${formatPracticeLabel(p)}`);
    }
  } else if (addedPractices.length > 3) {
    const preview = addedPractices
      .slice(0, 2)
      .map(formatPracticeLabel)
      .join('、');
    allChanges.push(
      `練習動画を${addedPractices.length}件追加（${preview} ほか${addedPractices.length - 2}件）`
    );
  }

  if (deletedPractices.length > 0 && deletedPractices.length <= 3) {
    for (const p of deletedPractices) {
      allChanges.push(`練習動画を削除：${formatPracticeLabel(p)}`);
    }
  } else if (deletedPractices.length > 3) {
    const preview = deletedPractices
      .slice(0, 2)
      .map(formatPracticeLabel)
      .join('、');
    allChanges.push(
      `練習動画を${deletedPractices.length}件削除（${preview} ほか${deletedPractices.length - 2}件）`
    );
  }

  for (const aP of after.practices) {
    const bP = bPracticeMap.get(aP.id);
    if (!bP) continue;
    if (canonicalSerialize(bP) === canonicalSerialize(aP)) continue;
    allChanges.push(diffPractice(bP, aP));
  }

  // 3. 選手名簿 (players)
  const bPlayerMap = new Map(before.players.map((p) => [p.id, p]));
  const aPlayerMap = new Map(after.players.map((p) => [p.id, p]));
  const addedPlayers = after.players.filter((p) => !bPlayerMap.has(p.id));
  const removedPlayers = before.players.filter((p) => !aPlayerMap.has(p.id));
  const modifiedPlayers: Array<{ before: Player; after: Player }> = [];

  for (const aP of after.players) {
    const bP = bPlayerMap.get(aP.id);
    if (!bP) continue;
    if (canonicalSerialize(bP) !== canonicalSerialize(aP)) {
      modifiedPlayers.push({ before: bP, after: aP });
    }
  }

  if (addedPlayers.length > 0 && addedPlayers.length <= 3) {
    allChanges.push(
      `選手を追加：${addedPlayers.map(formatPlayerLabel).join('、')}`
    );
  } else if (addedPlayers.length > 3) {
    allChanges.push(
      `選手を${addedPlayers.length}名追加（${addedPlayers.slice(0, 3).map(formatPlayerLabel).join('、')} ほか${addedPlayers.length - 3}名）`
    );
  }

  if (removedPlayers.length > 0 && removedPlayers.length <= 3) {
    allChanges.push(
      `選手を削除：${removedPlayers.map(formatPlayerLabel).join('、')}`
    );
  } else if (removedPlayers.length > 3) {
    allChanges.push(
      `選手を${removedPlayers.length}名削除（${removedPlayers.slice(0, 3).map(formatPlayerLabel).join('、')} ほか${removedPlayers.length - 3}名）`
    );
  }

  if (modifiedPlayers.length > 0 && modifiedPlayers.length <= 3) {
    for (const pair of modifiedPlayers) {
      const bLbl = formatPlayerLabel(pair.before);
      const aLbl = formatPlayerLabel(pair.after);
      allChanges.push(
        bLbl !== aLbl
          ? `選手情報を変更：${bLbl} → ${aLbl}`
          : `選手情報を変更：${aLbl}（学年・ポジション等）`
      );
    }
  } else if (modifiedPlayers.length > 3) {
    allChanges.push(`選手情報を${modifiedPlayers.length}名変更`);
  }

  // 4. 基本設定・権限
  if (before.teamName !== after.teamName) {
    allChanges.push(`チーム名を変更（${before.teamName} → ${after.teamName}）`);
  }
  if (before.adminPin !== after.adminPin) {
    allChanges.push('管理者PINを変更');
  }

  if (
    canonicalSerialize(before.practiceTags) !==
    canonicalSerialize(after.practiceTags)
  ) {
    const bTagSet = new Set(before.practiceTags);
    const aTagSet = new Set(after.practiceTags);
    const addedTags = after.practiceTags.filter((t) => !bTagSet.has(t));
    const removedTags = before.practiceTags.filter((t) => !aTagSet.has(t));
    if (addedTags.length > 0) {
      allChanges.push(`練習タグを追加：${addedTags.join('、')}`);
    }
    if (removedTags.length > 0) {
      allChanges.push(`練習タグを削除：${removedTags.join('、')}`);
    }
    if (addedTags.length === 0 && removedTags.length === 0) {
      allChanges.push('練習タグの並び順を変更');
    }
  }

  allChanges.push(
    ...summarizeEmailSetDiff(
      before.ownerEmails,
      after.ownerEmails,
      'オーナー権限'
    )
  );
  allChanges.push(
    ...summarizeEmailSetDiff(
      before.allowedEmails,
      after.allowedEmails,
      'ログイン許可メンバー'
    )
  );

  // 5. 並び順のみ変更等のフォールバック
  if (allChanges.length === 0) {
    const bGameIds = before.games.map((g) => g.id);
    const aGameIds = after.games.map((g) => g.id);
    const bPracIds = before.practices.map((p) => p.id);
    const aPracIds = after.practices.map((p) => p.id);
    const bPlayerIds = before.players.map((p) => p.id);
    const aPlayerIds = after.players.map((p) => p.id);

    if (canonicalSerialize(bGameIds) !== canonicalSerialize(aGameIds)) {
      allChanges.push('試合日の並び順を変更');
    }
    if (canonicalSerialize(bPracIds) !== canonicalSerialize(aPracIds)) {
      allChanges.push('練習動画の並び順を変更');
    }
    if (canonicalSerialize(bPlayerIds) !== canonicalSerialize(aPlayerIds)) {
      allChanges.push('選手名簿の並び順を変更');
    }
    if (allChanges.length === 0) {
      allChanges.push('ポータルデータを更新');
    }
  }

  const cappedChanges =
    allChanges.length > MAX_DIFF_CHANGES
      ? [
          ...allChanges.slice(0, MAX_DIFF_CHANGES - 1),
          `ほか ${allChanges.length - (MAX_DIFF_CHANGES - 1)} 件の変更`,
        ]
      : allChanges;

  let actionSummary = allChanges[0];
  if (allChanges.length > 1) {
    if (addedGames.length >= 2 && allChanges.length === addedGames.length) {
      actionSummary = `試合日を${addedGames.length}日追加`;
    } else if (
      deletedGames.length >= 2 &&
      allChanges.length === deletedGames.length
    ) {
      actionSummary = `試合日を${deletedGames.length}日削除`;
    } else {
      actionSummary = `${allChanges[0]} ほか${allChanges.length - 1}件`;
    }
  }

  return {
    hasChanges: true,
    actionSummary,
    changes: cappedChanges,
  };
}

export function buildPortalRevision(params: {
  id?: string;
  createdAt?: string;
  actorEmail: string;
  actorName: string;
  before: PortalData;
  after: PortalData;
  overrideActionSummary?: string;
  overrideChanges?: string[];
}): PortalRevision | null {
  const diff = summarizePortalDiff(params.before, params.after);
  if (!params.overrideActionSummary && !diff.hasChanges) {
    return null;
  }

  const beforeSnapshot = JSON.parse(
    JSON.stringify(params.before)
  ) as PortalData;

  const rawChanges = params.overrideChanges ?? diff.changes;
  const changes =
    rawChanges.length > MAX_DIFF_CHANGES
      ? [
          ...rawChanges.slice(0, MAX_DIFF_CHANGES - 1),
          `ほか ${rawChanges.length - (MAX_DIFF_CHANGES - 1)} 件の変更`,
        ]
      : rawChanges.length > 0
        ? rawChanges
        : ['復元実行前の状態を自動保存'];

  return {
    id: params.id ?? createRevisionId(),
    createdAt: params.createdAt ?? new Date().toISOString(),
    actorEmail: (params.actorEmail || '').trim(),
    actorName:
      (params.actorName || '').trim() ||
      (params.actorEmail || '').trim() ||
      '不明なユーザー',
    actionSummary: params.overrideActionSummary ?? diff.actionSummary,
    changes,
    beforeSnapshot,
    afterStats: computePortalRevisionStats(params.after),
  };
}
