import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Upload,
  X,
} from 'lucide-react';
import type { GameMatch, GameRecord, Player, TeamUnit } from '../types';
import { formatMatchDisplayTitle, getGameMatches } from '../utils/matches';
import {
  extractDateAndOpponentHintsFromFileName,
  findBestMatchingGameForItem,
  hydrateOcrPlayersWithRoster,
  mergeEditableOcrPlayerRows,
  normalizeJerseyNumber,
  resolvePlayerFromRoster,
} from '../utils/stats';
import type {
  EditableOcrPlayer,
  OcrMergeMode,
  OcrSaveBatchItem,
  OcrSaveBatchPayload,
} from '../utils/stats';
import {
  prepareScreenshotForOcr,
  sendPreparedScreenshotToOcr,
} from '../services/statsOcrApi';
import type {
  OcrSourceKind,
  ParsedStatsResult,
  PreparedScreenshot,
} from '../services/statsOcrApi';
import './StatsScreenshotImporter.css';

export type {
  EditableOcrPlayer,
  OcrMergeMode,
  OcrSaveBatchItem,
  OcrSaveBatchPayload,
};

interface PreviewOcrItem {
  itemId: string;
  fileName: string;
  thumbDataUrl?: string;
  targetGameId: string;
  targetMatchId: string | '__new__';
  mergeMode: OcrMergeMode;
  imageType: ParsedStatsResult['imageType'];
  sourceKind: OcrSourceKind;
  quarterLabel: string;
  detectedMmDd: string;
  autoMatchedGame: boolean;
  awayTeamName: string;
  teamUnit: TeamUnit;
  homeScore: number;
  awayScore: number;
  rows: EditableOcrPlayer[];
}

interface IncomingImageEntry {
  file: File;
  pathHint: string;
}

interface SavedGameSummary {
  id: string;
  title: string;
  count: number;
  matchSummary: string;
}

interface StatsScreenshotImporterProps {
  activeGame: GameRecord;
  activeMatches: GameMatch[];
  activeMatch: GameMatch | null;
  games: GameRecord[];
  players: Player[];
  teamName: string;
  onApplyParsedStats: (payload: OcrSaveBatchPayload) => Promise<boolean>;
  onChangeTargetGame: (gameId: string) => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'danger') => void;
  onOpenGameDetail: (gameId?: string) => void;
}

type NumericFieldKey =
  | 'twoPm'
  | 'twoPa'
  | 'threePm'
  | 'threePa'
  | 'ftm'
  | 'fta'
  | 'oreb'
  | 'dreb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'to'
  | 'pf';

const NUMERIC_COLUMNS: Array<{ key: NumericFieldKey; label: string }> = [
  { key: 'twoPm', label: '2P成' },
  { key: 'twoPa', label: '2P打' },
  { key: 'threePm', label: '3P成' },
  { key: 'threePa', label: '3P打' },
  { key: 'ftm', label: 'FT成' },
  { key: 'fta', label: 'FT打' },
  { key: 'oreb', label: 'OR' },
  { key: 'dreb', label: 'DR' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'to', label: 'TO' },
  { key: 'pf', label: 'PF' },
];

interface WebkitEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (
    successCallback: (file: File) => void,
    errorCallback?: (err: unknown) => void
  ) => void;
  createReader?: () => {
    readEntries: (
      successCallback: (entries: WebkitEntryLike[]) => void,
      errorCallback?: (err: unknown) => void
    ) => void;
  };
}

let ocrSeq = 0;

function createOcrId(prefix: string): string {
  ocrSeq += 1;
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ocrSeq}_${rand}`;
}

function isImageFileCandidate(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name);
}

async function readAllDirectoryEntries(
  entry: WebkitEntryLike
): Promise<WebkitEntryLike[]> {
  if (!entry.createReader) return [];
  const reader = entry.createReader();
  const all: WebkitEntryLike[] = [];
  while (true) {
    const batch = await new Promise<WebkitEntryLike[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([])
      );
    });
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

async function collectFilesFromWebkitEntry(
  entry: WebkitEntryLike,
  parentPath = ''
): Promise<IncomingImageEntry[]> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) => {
      entry.file!(
        (f) => resolve(f),
        () => resolve(null)
      );
    });
    if (!file || !isImageFileCandidate(file)) return [];
    return [{ file, pathHint: parentPath || entry.fullPath || '' }];
  }
  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries(entry);
    const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const nested = await Promise.all(
      children.map((child) => collectFilesFromWebkitEntry(child, nextPath))
    );
    return nested.flat();
  }
  return [];
}

async function extractImageEntriesFromDataTransfer(
  dt: DataTransfer
): Promise<IncomingImageEntry[]> {
  const items = Array.from(dt.items ?? []);
  const webkitEntries = items
    .map((item) => {
      const maybeWithEntry = item as DataTransferItem & {
        webkitGetAsEntry?: () => unknown;
      };
      const entry =
        typeof maybeWithEntry.webkitGetAsEntry === 'function'
          ? maybeWithEntry.webkitGetAsEntry()
          : null;
      return entry as WebkitEntryLike | null;
    })
    .filter((entry): entry is WebkitEntryLike => entry !== null);

  if (webkitEntries.length > 0) {
    const collected = await Promise.all(
      webkitEntries.map((entry) => collectFilesFromWebkitEntry(entry))
    );
    const flat = collected.flat();
    if (flat.length > 0) return flat;
  }

  return Array.from(dt.files ?? [])
    .filter(isImageFileCandidate)
    .map((file) => ({ file, pathHint: '' }));
}

function calcRowPts(row: EditableOcrPlayer): number {
  return row.twoPm * 2 + row.threePm * 3 + row.ftm;
}

function hasRowMismatch(row: EditableOcrPlayer): boolean {
  return (
    row.reportedPts !== calcRowPts(row) ||
    row.twoPa < row.twoPm ||
    row.threePa < row.threePm ||
    row.fta < row.ftm
  );
}

function evaluateItemStatus(item: PreviewOcrItem): {
  totalCalcPts: number;
  anyRowWarn: boolean;
  totalMismatch: boolean;
} {
  const totalCalcPts = item.rows.reduce((sum, r) => sum + calcRowPts(r), 0);
  const anyRowWarn = item.rows.some((r) => hasRowMismatch(r));
  const totalMismatch =
    item.rows.length > 0 && totalCalcPts !== item.homeScore;
  return { totalCalcPts, anyRowWarn, totalMismatch };
}

function resolveTargetGame(
  item: PreviewOcrItem,
  games: GameRecord[],
  fallbackGame: GameRecord
): GameRecord {
  return games.find((g) => g.id === item.targetGameId) ?? fallbackGame;
}

function resolveTargetMatchId(
  item: PreviewOcrItem,
  matches: GameMatch[]
): string | '__new__' {
  if (item.targetMatchId === '__new__') return '__new__';
  if (item.targetMatchId && matches.some((m) => m.id === item.targetMatchId)) {
    return item.targetMatchId;
  }
  return matches[0]?.id ?? '__new__';
}

function resolveTeamUnit(
  item: PreviewOcrItem,
  resolvedMatchId: string | '__new__',
  matches: GameMatch[]
): TeamUnit {
  if (item.teamUnit) return item.teamUnit;
  if (resolvedMatchId === '__new__') return '';
  return matches.find((m) => m.id === resolvedMatchId)?.teamUnit ?? '';
}

function isUsableStatsImageType(
  imageType: ParsedStatsResult['imageType']
): boolean {
  return imageType === 'box_score' || imageType === 'paper_scoresheet';
}

function isOpponentCompatible(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb || na === '対戦相手' || nb === '対戦相手') return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

export function StatsScreenshotImporter({
  activeGame,
  activeMatch,
  games,
  players,
  teamName,
  onApplyParsedStats,
  onChangeTargetGame,
  onNotify,
  onOpenGameDetail,
}: StatsScreenshotImporterProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [includePaperScoresheets, setIncludePaperScoresheets] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [ocrWarning, setOcrWarning] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [previewItems, setPreviewItems] = useState<PreviewOcrItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [autoMatchNotice, setAutoMatchNotice] = useState('');
  const [failedFiles, setFailedFiles] = useState<
    Array<{ file: File; pathHint: string; error: string }>
  >([]);
  const [lastSavedInfo, setLastSavedInfo] = useState<{
    totalCount: number;
    savedGames: SavedGameSummary[];
  } | null>(null);
  const [batchMeta, setBatchMeta] = useState<{
    skippedCount: number;
    failedCount: number;
  }>({ skippedCount: 0, failedCount: 0 });
  const [autoAddMissing, setAutoAddMissing] = useState(true);

  const handleReset = () => {
    setPreviewItems([]);
    setExpandedIds({});
    setFailedFiles([]);
    setAutoMatchNotice('');
    setBatchMeta({ skippedCount: 0, failedCount: 0 });
    setProgressText('');
    setOcrWarning('');
    setOcrError('');
  };

  const waitMs = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  const buildPreviewItem = (
    entry: { fileName: string; pathHint: string; data: ParsedStatsResult },
    assignment: {
      targetGame: GameRecord;
      autoMatchedGame: boolean;
      detectedMmDd: string;
      targetMatchId: string | '__new__';
      defaultTeamUnit: TeamUnit;
      mergeMode: OcrMergeMode;
    }
  ): PreviewOcrItem => ({
    itemId: createOcrId('ocr_item'),
    fileName: entry.fileName,
    thumbDataUrl: entry.data.thumbDataUrl,
    targetGameId: assignment.targetGame.id,
    targetMatchId: assignment.targetMatchId,
    mergeMode: assignment.mergeMode,
    imageType: entry.data.imageType,
    sourceKind:
      entry.data.sourceKind ??
      (entry.data.imageType === 'paper_scoresheet'
        ? 'jba_scoresheet'
        : 'app_screenshot'),
    quarterLabel: entry.data.quarterLabel ?? '',
    detectedMmDd: assignment.detectedMmDd,
    autoMatchedGame: assignment.autoMatchedGame,
    awayTeamName:
      entry.data.awayTeamName || assignment.targetGame.opponent || '対戦相手',
    teamUnit: assignment.defaultTeamUnit,
    homeScore: entry.data.homeScore,
    awayScore: entry.data.awayScore,
    rows: hydrateOcrPlayersWithRoster(entry.data.players, players, createOcrId),
  });

  const assignEntriesToPreviewItems = (
    usable: Array<{
      fileName: string;
      pathHint: string;
      data: ParsedStatsResult;
    }>,
    seedItems: PreviewOcrItem[]
  ): {
    items: PreviewOcrItem[];
    matchedGames: GameRecord[];
  } => {
    const usedMatchesByGame = new Map<string, Set<string>>();
    const lastQuarterTimelineByGame = new Map<
      string,
      { targetMatchId: string | '__new__'; opponent: string; teamUnit: TeamUnit }
    >();

    for (const existing of seedItems) {
      const set = usedMatchesByGame.get(existing.targetGameId) ?? new Set<string>();
      if (existing.targetMatchId !== '__new__') {
        set.add(existing.targetMatchId);
      }
      usedMatchesByGame.set(existing.targetGameId, set);
      if (existing.sourceKind === 'quarter_timeline') {
        lastQuarterTimelineByGame.set(existing.targetGameId, {
          targetMatchId: existing.targetMatchId,
          opponent: existing.awayTeamName,
          teamUnit: existing.teamUnit,
        });
      }
    }

    const matchedGamesMap = new Map<string, GameRecord>();
    const createdItems: PreviewOcrItem[] = [];

    for (const entry of usable) {
      const matchInfo = findBestMatchingGameForItem(games, {
        screenshotDate: entry.data.screenshotDate,
        awayTeamName: entry.data.awayTeamName,
        fileName: entry.fileName,
        pathHint: entry.pathHint,
      });
      const targetGame = matchInfo.game ?? activeGame;
      const autoMatchedGame = Boolean(matchInfo.game);
      if (matchInfo.game) {
        matchedGamesMap.set(matchInfo.game.id, matchInfo.game);
      }

      const targetMatches = getGameMatches(targetGame);
      const usedSet = usedMatchesByGame.get(targetGame.id) ?? new Set<string>();
      const sourceKind: OcrSourceKind =
        entry.data.sourceKind ??
        (entry.data.imageType === 'paper_scoresheet'
          ? 'jba_scoresheet'
          : 'app_screenshot');
      const prevTimeline = lastQuarterTimelineByGame.get(targetGame.id);

      let targetMatchId: string | '__new__' = '__new__';
      let defaultTeamUnit: TeamUnit = '';
      let mergeMode: OcrMergeMode = 'replace';

      if (
        sourceKind === 'quarter_timeline' &&
        prevTimeline &&
        isOpponentCompatible(prevTimeline.opponent, entry.data.awayTeamName)
      ) {
        targetMatchId = prevTimeline.targetMatchId;
        defaultTeamUnit = prevTimeline.teamUnit;
        mergeMode = 'add';
      } else {
        const preferredStartIdx =
          targetGame.id === activeGame.id && activeMatch && usedSet.size === 0
            ? Math.max(
                0,
                targetMatches.findIndex((m) => m.id === activeMatch.id)
              )
            : 0;
        const rotatedMatches = [
          ...targetMatches.slice(preferredStartIdx),
          ...targetMatches.slice(0, preferredStartIdx),
        ];

        const oppMatch = entry.data.awayTeamName
          ? rotatedMatches.find(
              (m) =>
                !usedSet.has(m.id) &&
                isOpponentCompatible(m.opponent, entry.data.awayTeamName)
            )
          : undefined;
        const nextUnused = rotatedMatches.find((m) => !usedSet.has(m.id));
        const chosenMatch = oppMatch ?? nextUnused ?? null;

        if (chosenMatch) {
          targetMatchId = chosenMatch.id;
          defaultTeamUnit = chosenMatch.teamUnit ?? '';
          usedSet.add(chosenMatch.id);
          usedMatchesByGame.set(targetGame.id, usedSet);
        }
      }

      const detectedMmDd =
        matchInfo.mmddHint ||
        extractDateAndOpponentHintsFromFileName(entry.fileName).mmdd;

      const built = buildPreviewItem(entry, {
        targetGame,
        autoMatchedGame,
        detectedMmDd,
        targetMatchId,
        defaultTeamUnit,
        mergeMode,
      });
      createdItems.push(built);

      if (sourceKind === 'quarter_timeline') {
        lastQuarterTimelineByGame.set(targetGame.id, {
          targetMatchId: built.targetMatchId,
          opponent: built.awayTeamName,
          teamUnit: built.teamUnit,
        });
      }
    }

    return {
      items: createdItems,
      matchedGames: Array.from(matchedGamesMap.values()),
    };
  };

  const runOcrBatch = async (
    entriesToScan: IncomingImageEntry[],
    options?: { skipPreFilter?: boolean }
  ) => {
    type PreparedEntry = {
      index: number;
      file: File;
      fileName: string;
      pathHint: string;
      prepared: PreparedScreenshot;
    };
    type FileOutcome =
      | {
          ok: true;
          file: File;
          fileName: string;
          pathHint: string;
          data: ParsedStatsResult;
        }
      | {
          ok: false;
          file: File;
          fileName: string;
          pathHint: string;
          error: string;
        };

    const outcomes: FileOutcome[] = new Array<FileOutcome>(entriesToScan.length);
    const preparedEntries: PreparedEntry[] = [];

    for (let i = 0; i < entriesToScan.length; i += 1) {
      const { file, pathHint } = entriesToScan[i];
      setProgressText(
        `画像を事前仕分け中... (${i + 1}/${entriesToScan.length}枚)`
      );
      try {
        const prepared = await prepareScreenshotForOcr(file);
        preparedEntries.push({
          index: i,
          file,
          fileName: file.name,
          pathHint,
          prepared,
        });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : '画像の読み込みに失敗しました。';
        outcomes[i] = {
          ok: false,
          file,
          fileName: file.name,
          pathHint,
          error: msg,
        };
      }
    }

    const whiteItems = preparedEntries.filter(
      (entry) => entry.prepared.whiteRatio >= 0.45
    );
    const darkItems = preparedEntries.filter(
      (entry) => entry.prepared.whiteRatio < 0.45
    );
    const canPreSkip =
      !options?.skipPreFilter &&
      entriesToScan.length >= 2 &&
      whiteItems.length > 0 &&
      darkItems.length > 0;
    const candidatesToSend = canPreSkip ? whiteItems : preparedEntries;
    const preSkippedCount = canPreSkip ? darkItems.length : 0;

    if (canPreSkip) {
      darkItems.forEach((entry) => {
        outcomes[entry.index] = {
          ok: true,
          file: entry.file,
          fileName: entry.fileName,
          pathHint: entry.pathHint,
          data: {
            imageType: 'shot_chart',
            sourceKind: 'other',
            quarterLabel: '',
            homeTeamName: '',
            awayTeamName: '',
            homeScore: 0,
            awayScore: 0,
            players: [],
            thumbDataUrl: entry.prepared.thumbDataUrl || undefined,
          },
        };
      });
    }

    let cursor = 0;
    let doneCount = 0;
    let foundStatsCount = 0;

    const formatSendProgress = () => {
      const skipSuffix =
        preSkippedCount > 0 ? `・対象外${preSkippedCount}枚スキップ済` : '';
      return `スタッツを解析中... (${doneCount}/${candidatesToSend.length}枚${skipSuffix}・検出${foundStatsCount}件)`;
    };

    if (candidatesToSend.length > 0) {
      setProgressText(formatSendProgress());
    }

    const failedModelsThisBatch = new Set<string>();

    const sendWithRetry = async (
      entry: PreparedEntry
    ): Promise<ParsedStatsResult> => {
      try {
        return await sendPreparedScreenshotToOcr(
          entry.prepared,
          teamName,
          Array.from(failedModelsThisBatch)
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        const shouldRetry =
          msg.includes('上限に達しました') ||
          msg.includes('タイムアウト') ||
          msg.includes('通信に失敗しました');
        if (!shouldRetry) {
          throw err;
        }
        await waitMs(4000);
        return sendPreparedScreenshotToOcr(
          entry.prepared,
          teamName,
          Array.from(failedModelsThisBatch)
        );
      }
    };

    const runWorker = async () => {
      while (cursor < candidatesToSend.length) {
        const candidate = candidatesToSend[cursor];
        cursor += 1;
        try {
          const data = await sendWithRetry(candidate);
          if (Array.isArray(data.failedModels)) {
            for (const m of data.failedModels) {
              failedModelsThisBatch.add(m);
            }
          }
          outcomes[candidate.index] = {
            ok: true,
            file: candidate.file,
            fileName: candidate.fileName,
            pathHint: candidate.pathHint,
            data,
          };
          if (isUsableStatsImageType(data.imageType)) {
            foundStatsCount += 1;
          }
        } catch (err: unknown) {
          const msg =
            err instanceof Error
              ? err.message
              : 'スクショの読み取りに失敗しました。';
          outcomes[candidate.index] = {
            ok: false,
            file: candidate.file,
            fileName: candidate.fileName,
            pathHint: candidate.pathHint,
            error: msg,
          };
        } finally {
          doneCount += 1;
          setProgressText(formatSendProgress());
        }
      }
    };

    const workerCount = Math.min(2, candidatesToSend.length);
    if (workerCount > 0) {
      await Promise.all(
        Array.from({ length: workerCount }, () => runWorker())
      );
    }

    const successes = outcomes.filter(
      (o): o is Extract<FileOutcome, { ok: true }> => o.ok
    );
    const failures = outcomes.filter(
      (o): o is Extract<FileOutcome, { ok: false }> => !o.ok
    );

    const statsItems = successes.filter((s) =>
      isUsableStatsImageType(s.data.imageType)
    );
    const teamSummaryItems = successes.filter(
      (s) =>
        s.data.imageType === 'team_summary' &&
        (s.data.homeScore > 0 || s.data.awayScore > 0)
    );
    const usable = statsItems.length > 0 ? statsItems : teamSummaryItems;
    const skippedCount = successes.length - usable.length;
    const nextFailed = failures.map((f) => ({
      file: f.file,
      pathHint: f.pathHint,
      error: f.error,
    }));

    return {
      successes,
      usable,
      skippedCount,
      preSkippedCount,
      failedEntries: nextFailed,
    };
  };

  const processIncomingFiles = async (entries: IncomingImageEntry[]) => {
    if (entries.length === 0 || parsing || saving) return;

    const sortedEntries = [...entries].sort((a, b) =>
      a.file.name.localeCompare(b.file.name, 'ja', { numeric: true })
    );

    setParsing(true);
    setOcrWarning('');
    setOcrError('');
    setLastSavedInfo(null);
    setAutoMatchNotice('');
    setPreviewItems([]);
    setExpandedIds({});
    setFailedFiles([]);
    setBatchMeta({ skippedCount: 0, failedCount: 0 });
    setProgressText(`画像を事前仕分け中... (0/${sortedEntries.length}枚)`);

    try {
      const result = await runOcrBatch(sortedEntries, {
        skipPreFilter: includePaperScoresheets,
      });
      const {
        successes,
        usable,
        skippedCount,
        preSkippedCount,
        failedEntries,
      } = result;
      setFailedFiles(failedEntries);

      if (usable.length === 0) {
        if (sortedEntries.length === 1) {
          if (failedEntries.length === 1) {
            setOcrError(failedEntries[0].error);
            return;
          }
          if (successes[0]?.data.imageType === 'shot_chart') {
            setOcrWarning(
              'シュートチャートの画像が選ばれました。ボックススコアまたは紙のスコアシートの画像を選んでください。'
            );
            return;
          }
          setOcrWarning(
            'スタッツ表・スコアシートが見つかりませんでした。文字や表がはっきり写っている画像をお試しください。'
          );
          return;
        }

        const activeCount = sortedEntries.length - preSkippedCount;
        if (failedEntries.length === activeCount && failedEntries[0]) {
          setOcrError(failedEntries[0].error);
          return;
        }
        const paperHint =
          !includePaperScoresheets && preSkippedCount > 0
            ? ' 紙のスコアシートが含まれている場合は「紙のスコアシートも含める（事前スキップOFF）」にチェックを入れてお試しください。'
            : '';
        setOcrWarning(
          `選んだ ${sortedEntries.length}枚の中にボックススコア／紙スコアシートが見つかりませんでした（対象外 ${skippedCount}枚をスキップ）。${paperHint}`
        );
        return;
      }

      const { items: builtItems, matchedGames } = assignEntriesToPreviewItems(
        usable,
        []
      );

      if (matchedGames.length === 1 && matchedGames[0].id !== activeGame.id) {
        onChangeTargetGame(matchedGames[0].id);
        setAutoMatchNotice(
          `写真の日付・相手名から「${matchedGames[0].title}」を自動で選びました（各カードから個別に変更もできます）`
        );
      } else if (matchedGames.length > 1) {
        setAutoMatchNotice(
          `写真の日付・相手名から ${matchedGames.length}日分の試合へ自動で仕分けました（各カードで調整してまとめて保存できます）`
        );
      } else if (matchedGames.length === 1) {
        setAutoMatchNotice(
          `写真の日付・相手名から「${matchedGames[0].title}」に自動紐づけしました`
        );
      }

      const nextExpanded: Record<string, boolean> = {};
      builtItems.forEach((item) => {
        const st = evaluateItemStatus(item);
        nextExpanded[item.itemId] =
          builtItems.length === 1 ||
          item.imageType === 'paper_scoresheet' ||
          st.anyRowWarn ||
          st.totalMismatch;
      });

      setPreviewItems(builtItems);
      setExpandedIds(nextExpanded);
      setBatchMeta({ skippedCount, failedCount: failedEntries.length });
      setAutoAddMissing(true);
      onNotify(
        `スタッツ ${builtItems.length}件を読み取りました`,
        'success'
      );
    } catch (err: unknown) {
      setOcrError(
        err instanceof Error && err.message
          ? err.message
          : 'スクショの読み取り中にエラーが発生しました。'
      );
    } finally {
      setParsing(false);
      setProgressText('');
    }
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(e.target.files ?? []).filter(
      isImageFileCandidate
    );
    e.target.value = '';
    if (selectedFiles.length === 0) return;
    await processIncomingFiles(
      selectedFiles.map((file) => ({ file, pathHint: '' }))
    );
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (parsing || saving) return;
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (parsing || saving) return;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (parsing || saving) return;

    const entries = await extractImageEntriesFromDataTransfer(e.dataTransfer);
    if (entries.length === 0) {
      setOcrWarning(
        'ドロップされた中に画像ファイル（JPG / PNG / WebP など）が見つかりませんでした。'
      );
      return;
    }
    await processIncomingFiles(entries);
  };

  const handleRetryFailedFiles = async () => {
    if (failedFiles.length === 0 || parsing || saving) return;

    const retryTargets: IncomingImageEntry[] = failedFiles.map((f) => ({
      file: f.file,
      pathHint: f.pathHint,
    }));
    setParsing(true);
    setOcrWarning('');
    setOcrError('');
    setProgressText(`失敗分を再読み取り中... (0/${retryTargets.length}枚)`);

    try {
      const result = await runOcrBatch(retryTargets, { skipPreFilter: true });
      const { items: addedItems } = assignEntriesToPreviewItems(
        result.usable,
        previewItems
      );

      if (addedItems.length > 0) {
        setPreviewItems((prev) => [...prev, ...addedItems]);
        setExpandedIds((prev) => {
          const next = { ...prev };
          addedItems.forEach((item) => {
            const st = evaluateItemStatus(item);
            next[item.itemId] =
              item.imageType === 'paper_scoresheet' ||
              st.anyRowWarn ||
              st.totalMismatch;
          });
          return next;
        });
        onNotify(
          `再読み取りで ${addedItems.length}件を追加しました`,
          'success'
        );
      } else if (result.failedEntries[0]) {
        setOcrWarning(
          `再読み取りに失敗しました（${result.failedEntries[0].error}）`
        );
      }

      setFailedFiles(result.failedEntries);
      setBatchMeta((prev) => ({
        skippedCount: prev.skippedCount + result.skippedCount,
        failedCount: result.failedEntries.length,
      }));
    } catch (err: unknown) {
      setOcrError(
        err instanceof Error && err.message
          ? err.message
          : '再読み取り中にエラーが発生しました。'
      );
    } finally {
      setParsing(false);
      setProgressText('');
    }
  };

  const updateItemField = (
    itemId: string,
    patch: Partial<
      Pick<
        PreviewOcrItem,
        | 'targetGameId'
        | 'targetMatchId'
        | 'mergeMode'
        | 'awayTeamName'
        | 'teamUnit'
        | 'homeScore'
        | 'awayScore'
      >
    >
  ) => {
    setPreviewItems((prev) =>
      prev.map((item) => (item.itemId === itemId ? { ...item, ...patch } : item))
    );
  };

  const handleChangeItemTargetGame = (itemId: string, nextGameId: string) => {
    const nextGame = games.find((g) => g.id === nextGameId);
    const nextMatches = nextGame ? getGameMatches(nextGame) : [];
    const firstMatch = nextMatches[0] ?? null;
    updateItemField(itemId, {
      targetGameId: nextGameId,
      targetMatchId: firstMatch ? firstMatch.id : '__new__',
      teamUnit: firstMatch?.teamUnit ?? '',
    });
  };

  const updateRowField = (
    itemId: string,
    rowId: string,
    field: 'number' | 'name' | NumericFieldKey,
    rawVal: string
  ) => {
    setPreviewItems((prev) =>
      prev.map((item) => {
        if (item.itemId !== itemId) return item;
        return {
          ...item,
          rows: item.rows.map((r) => {
            if (r.id !== rowId) return r;
            if (field === 'number') {
              const normalizedNum = normalizeJerseyNumber(rawVal);
              const matched = normalizedNum
                ? resolvePlayerFromRoster(
                    { number: normalizedNum, name: '' },
                    players
                  )
                : undefined;
              return {
                ...r,
                number: rawVal,
                name: !r.name.trim() && matched ? matched.name : r.name,
              };
            }
            if (field === 'name') {
              return { ...r, name: rawVal };
            }
            const num = Math.max(0, Math.round(Number(rawVal) || 0));
            return { ...r, [field]: num };
          }),
        };
      })
    );
  };

  const addBlankPreviewRow = (itemId: string) => {
    setPreviewItems((prev) =>
      prev.map((item) => {
        if (item.itemId !== itemId) return item;
        const blankRow: EditableOcrPlayer = {
          id: createOcrId('ocr_row'),
          reportedPts: 0,
          number: '',
          name: '',
          twoPm: 0,
          twoPa: 0,
          threePm: 0,
          threePa: 0,
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
        return { ...item, rows: [...item.rows, blankRow] };
      })
    );
  };

  const removePreviewRow = (itemId: string, rowId: string) => {
    setPreviewItems((prev) =>
      prev.map((item) => {
        if (item.itemId !== itemId) return item;
        return {
          ...item,
          rows: item.rows.filter((r) => r.id !== rowId),
        };
      })
    );
  };

  const removePreviewItem = (itemId: string) => {
    setPreviewItems((prev) => prev.filter((item) => item.itemId !== itemId));
  };

  const findPrecedingSameGameIndex = (idx: number): number => {
    const current = previewItems[idx];
    if (!current) return -1;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (previewItems[i].targetGameId === current.targetGameId) {
        return i;
      }
    }
    return -1;
  };

  const handleMergeWithPreviousSameGame = (itemId: string) => {
    const idx = previewItems.findIndex((item) => item.itemId === itemId);
    if (idx <= 0) return;
    const prevIdx = findPrecedingSameGameIndex(idx);
    if (prevIdx === -1) return;

    const base = previewItems[prevIdx];
    const incoming = previewItems[idx];
    const mergedRows = mergeEditableOcrPlayerRows(
      base.rows,
      incoming.rows,
      players
    );
    const mergedQuarters = [base.quarterLabel, incoming.quarterLabel]
      .filter(Boolean)
      .join('+');

    const mergedItem: PreviewOcrItem = {
      ...base,
      fileName: `${base.fileName} ＋ ${incoming.fileName}`,
      quarterLabel: mergedQuarters,
      imageType:
        base.imageType === 'paper_scoresheet' ||
        incoming.imageType === 'paper_scoresheet'
          ? 'paper_scoresheet'
          : base.imageType,
      awayTeamName:
        base.awayTeamName && base.awayTeamName !== '対戦相手'
          ? base.awayTeamName
          : incoming.awayTeamName,
      teamUnit: base.teamUnit || incoming.teamUnit,
      homeScore: base.homeScore + incoming.homeScore,
      awayScore: base.awayScore + incoming.awayScore,
      rows: mergedRows,
    };

    setPreviewItems((prev) =>
      prev
        .filter((it) => it.itemId !== incoming.itemId)
        .map((it) => (it.itemId === base.itemId ? mergedItem : it))
    );
    setExpandedIds((prev) => ({
      ...prev,
      [base.itemId]: true,
    }));
    onNotify('同じ試合のカードを1つに合算しました', 'success');
  };

  const handleConfirmSave = async () => {
    if (previewItems.length === 0 || saving) return;

    const resolvedItems: OcrSaveBatchItem[] = [];
    const summaryMap = new Map<
      string,
      { id: string; title: string; count: number; matchLabels: Set<string> }
    >();

    for (const item of previewItems) {
      const targetGame = resolveTargetGame(item, games, activeGame);
      const targetMatches = getGameMatches(targetGame);
      const resolvedMatchId = resolveTargetMatchId(item, targetMatches);
      const resolvedMatch =
        resolvedMatchId !== '__new__'
          ? targetMatches.find((m) => m.id === resolvedMatchId)
          : undefined;
      const matchIndex =
        resolvedMatchId !== '__new__'
          ? targetMatches.findIndex((m) => m.id === resolvedMatchId)
          : -1;
      const matchLabel =
        resolvedMatch && matchIndex !== -1
          ? `${matchIndex + 1}. ${formatMatchDisplayTitle(resolvedMatch)}`
          : '新規試合';

      resolvedItems.push({
        targetGameId: targetGame.id,
        targetMatchId: resolvedMatchId,
        mergeMode: item.mergeMode,
        awayTeamName: item.awayTeamName.trim() || targetGame.opponent,
        teamUnit: resolveTeamUnit(item, resolvedMatchId, targetMatches),
        homeScore: item.homeScore,
        awayScore: item.awayScore,
        rows: item.rows,
      });

      const entry = summaryMap.get(targetGame.id) ?? {
        id: targetGame.id,
        title: targetGame.title,
        count: 0,
        matchLabels: new Set<string>(),
      };
      entry.count += 1;
      entry.matchLabels.add(
        item.mergeMode === 'add' ? `${matchLabel}(合算)` : matchLabel
      );
      summaryMap.set(targetGame.id, entry);
    }

    const savedGames: SavedGameSummary[] = Array.from(summaryMap.values()).map(
      (entry) => ({
        id: entry.id,
        title: entry.title,
        count: entry.count,
        matchSummary: Array.from(entry.matchLabels).join('、'),
      })
    );
    const totalCount = resolvedItems.length;

    setSaving(true);
    setOcrError('');
    try {
      const ok = await onApplyParsedStats({
        items: resolvedItems,
        autoAddMissingPlayers: autoAddMissing,
      });

      if (ok) {
        if (savedGames.length === 1 && savedGames[0].id !== activeGame.id) {
          onChangeTargetGame(savedGames[0].id);
        }
        handleReset();
        setLastSavedInfo({
          totalCount,
          savedGames,
        });
      } else {
        setOcrError(
          '保存に失敗しました。通信状況を確認してもう一度「保存する」を押してください。'
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const uniqueUnmatchedCount = (() => {
    const seenKeys = new Set<string>();
    let count = 0;
    for (const item of previewItems) {
      for (const r of item.rows) {
        if (resolvePlayerFromRoster(r, players)) continue;
        const num = normalizeJerseyNumber(r.number);
        const norm = r.name.replace(/[\s\u3000]+/g, '').toLowerCase();
        const key = num ? `num:${num}` : norm ? `name:${norm}` : r.id;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          count += 1;
        }
      }
    }
    return count;
  })();

  const hasDuplicateReplaceTargets = (() => {
    const seenTargets = new Set<string>();
    for (const item of previewItems) {
      const targetGame = resolveTargetGame(item, games, activeGame);
      const targetMatches = getGameMatches(targetGame);
      const resolvedMatchId = resolveTargetMatchId(item, targetMatches);
      if (resolvedMatchId === '__new__') continue;
      const key = `${targetGame.id}::${resolvedMatchId}`;
      if (seenTargets.has(key) && item.mergeMode === 'replace') {
        return true;
      }
      seenTargets.add(key);
    }
    return false;
  })();

  const targetDaySummaries = (() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    for (const item of previewItems) {
      const g = resolveTargetGame(item, games, activeGame);
      const cur = map.get(g.id) ?? { id: g.id, title: g.title, count: 0 };
      cur.count += 1;
      map.set(g.id, cur);
    }
    return Array.from(map.values());
  })();

  const saveBtnLabel = saving
    ? '保存中...'
    : targetDaySummaries.length > 1
      ? `${targetDaySummaries.length}日分（計${previewItems.length}件）をまとめて保存する`
      : previewItems.length > 1
        ? `${previewItems.length}件をまとめて保存する`
        : 'この内容で保存する';

  const autoAddCheckbox = uniqueUnmatchedCount > 0 && (
    <label className="ocr-checkbox-row">
      <input
        type="checkbox"
        checked={autoAddMissing}
        onChange={(e) => setAutoAddMissing(e.target.checked)}
      />
      <span>
        未登録の選手（{uniqueUnmatchedCount}名）を選手名簿にも自動追加する
      </span>
    </label>
  );

  return (
    <section className="portal-card">
      <div className="block-title-row">
        <Camera size={18} className="accent-icon" />
        <h3>スクショ・スコアシート自動読み取り</h3>
      </div>
      <p className="table-helper-text">
        LINEアルバムの複数日分の写真やフォルダ、紙のスコアシート（JBA公式・クォーター別シート）もまとめて読み取れます。日付・相手名から各日の試合へ自動仕分けし、1回で一括保存できます。
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="ocr-hidden-input"
        onChange={(e) => void handleFileSelected(e)}
      />

      <div
        className={`ocr-dropzone ${isDragOver ? 'is-dragover' : ''} ${
          parsing || saving ? 'is-disabled' : ''
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
      >
        <button
          type="button"
          className="btn-accent btn-block"
          disabled={parsing || saving}
          onClick={() => fileInputRef.current?.click()}
        >
          {parsing ? (
            <>
              <Loader2 size={17} className="ocr-spin" />{' '}
              {progressText || '画像を読み取り中...'}
            </>
          ) : (
            <>
              <Camera size={17} /> 写真・スコアシートを選んで読み取る（複数枚OK）
            </>
          )}
        </button>

        <div className="ocr-dropzone-hint">
          <Upload size={14} />
          <span>
            ここに複数の写真やフォルダをそのままドラッグ＆ドロップすることもできます
          </span>
        </div>

        <div className="ocr-paper-toggle-box">
          <label className="ocr-checkbox-row">
            <input
              type="checkbox"
              checked={includePaperScoresheets}
              disabled={parsing || saving}
              onChange={(e) => setIncludePaperScoresheets(e.target.checked)}
            />
            <span>紙のスコアシートも含める（事前スキップOFF）</span>
          </label>
          <p className="ocr-paper-toggle-help">
            手書きのJBAスコアシートやクォーター別シートを読み取る時はONにしてください（全枚をAIへ送信します）
          </p>
        </div>
      </div>

      {parsing && progressText && (
        <p className="ocr-progress-text">{progressText}</p>
      )}

      {ocrWarning && (
        <div className="admin-warn-note ocr-alert-flex">
          <AlertTriangle size={16} />
          <span>{ocrWarning}</span>
        </div>
      )}

      {ocrError && (
        <div className="portal-auth-error">
          <AlertTriangle size={16} />
          <span>{ocrError}</span>
        </div>
      )}

      {lastSavedInfo && previewItems.length === 0 && (
        <div className="ocr-saved-banner">
          <div className="ocr-saved-title">
            <CheckCircle2 size={16} />
            <span>
              {lastSavedInfo.savedGames.length > 1
                ? `${lastSavedInfo.savedGames.length}日分（計${lastSavedInfo.totalCount}件）のスタッツをまとめて保存しました`
                : `${lastSavedInfo.totalCount}件のスタッツを「${
                    lastSavedInfo.savedGames[0]?.title ?? activeGame.title
                  }」に保存しました`}
            </span>
          </div>
          {lastSavedInfo.savedGames.map((sg) => (
            <p key={sg.id} className="ocr-saved-sub">
              ・{sg.title}（{sg.count}件）：{sg.matchSummary}
            </p>
          ))}
          <div className="ocr-saved-links">
            {lastSavedInfo.savedGames.map((sg) => (
              <button
                key={sg.id}
                type="button"
                className="btn-accent btn-block"
                onClick={() => onOpenGameDetail(sg.id)}
              >
                {lastSavedInfo.savedGames.length > 1
                  ? `「${sg.title}」の動画・スタッツを見る`
                  : 'この日の動画・スタッツを見る'}
              </button>
            ))}
          </div>
        </div>
      )}

      {previewItems.length > 0 && (
        <div className="ocr-batch-list">
          <div className="row-between">
            <span className="field-caption">
              スタッツ {previewItems.length}件を検出
              {batchMeta.skippedCount > 0
                ? `（対象外 ${batchMeta.skippedCount}枚スキップ）`
                : ''}
              {batchMeta.failedCount > 0
                ? `（読取失敗 ${batchMeta.failedCount}枚）`
                : ''}
            </span>
            {failedFiles.length > 0 && (
              <button
                type="button"
                className="btn-soft-sm"
                disabled={parsing || saving}
                onClick={() => void handleRetryFailedFiles()}
              >
                <RotateCcw size={13} /> 失敗した {failedFiles.length}枚だけ再読み取り
              </button>
            )}
          </div>

          <div className="ocr-unsaved-bar">
            <div className="ocr-unsaved-head">
              <AlertTriangle size={15} />
              <span>
                まだ保存されていません（保存先：
                {targetDaySummaries.length > 1
                  ? `${targetDaySummaries.length}日分`
                  : targetDaySummaries[0]?.title ?? activeGame.title}
                ）
              </span>
            </div>
            {autoMatchNotice && (
              <div className="ocr-auto-match-note">{autoMatchNotice}</div>
            )}
            <div className="ocr-day-summary-pills">
              {targetDaySummaries.map((d) => (
                <span key={d.id} className="ocr-day-summary-pill">
                  {d.title}（{d.count}件）
                </span>
              ))}
            </div>
            {hasDuplicateReplaceTargets && (
              <div className="admin-warn-note">
                同じ試合に「上書き保存」のカードが複数あります。別の試合へ切り替えるか、2枚目以降の保存方法を「同じ試合へ合算（加算）」または「前のカードと合算」にしてください。
              </div>
            )}
            {autoAddCheckbox}
            <button
              type="button"
              className="btn-accent btn-block"
              disabled={parsing || saving}
              onClick={() => void handleConfirmSave()}
            >
              {saving ? (
                <Loader2 size={15} className="ocr-spin" />
              ) : (
                <Save size={15} />
              )}{' '}
              {saveBtnLabel}
            </button>
          </div>

          {previewItems.map((item, idx) => {
            const { totalCalcPts, anyRowWarn, totalMismatch } =
              evaluateItemStatus(item);
            const hasWarning = anyRowWarn || totalMismatch;
            const expanded = Boolean(expandedIds[item.itemId]);
            const targetGame = resolveTargetGame(item, games, activeGame);
            const targetMatches = getGameMatches(targetGame);
            const resolvedMatchId = resolveTargetMatchId(item, targetMatches);
            const effectiveTeamUnit = resolveTeamUnit(
              item,
              resolvedMatchId,
              targetMatches
            );
            const isPaper = item.imageType === 'paper_scoresheet';
            const prevSameGameIdx = findPrecedingSameGameIndex(idx);
            const prevSameGameItem =
              prevSameGameIdx !== -1 ? previewItems[prevSameGameIdx] : null;

            return (
              <div key={item.itemId} className="ocr-preview-card">
                <div className="ocr-item-head">
                  <div className="ocr-item-meta">
                    {item.thumbDataUrl && (
                      <img
                        src={item.thumbDataUrl}
                        alt={item.fileName}
                        className="ocr-thumb"
                      />
                    )}
                    <div className="ocr-item-title-col">
                      <span className="ocr-filename">{item.fileName}</span>
                      <div className="ocr-badge-row">
                        <span
                          className={`ocr-status-badge ${
                            hasWarning ? 'is-warn' : 'is-ok'
                          }`}
                        >
                          {hasWarning ? (
                            <>
                              <AlertTriangle size={12} /> 要確認
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={12} /> 計算OK（{item.rows.length}名）
                            </>
                          )}
                        </span>
                        {item.quarterLabel && (
                          <span className="ocr-quarter-badge">
                            {item.quarterLabel}
                          </span>
                        )}
                        {item.mergeMode === 'add' && (
                          <span className="ocr-add-badge">＋合算保存</span>
                        )}
                        {item.detectedMmDd && (
                          <span className="ocr-date-badge">
                            日付: {item.detectedMmDd}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    aria-label={`${item.fileName}を除外`}
                    onClick={() => removePreviewItem(item.itemId)}
                  >
                    <X size={15} />
                  </button>
                </div>

                {isPaper && (
                  <div className="ocr-paper-badge">
                    📄 紙スコアシート（手書きのため数値をご確認ください）
                  </div>
                )}

                {games.length > 1 && (
                  <label className="field-label">
                    <span>
                      保存先の試合日（再生リスト）
                      {item.autoMatchedGame ? ' ・自動判定' : ''}
                    </span>
                    <select
                      className="portal-select"
                      value={targetGame.id}
                      onChange={(e) =>
                        handleChangeItemTargetGame(item.itemId, e.target.value)
                      }
                    >
                      {games.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.date} {g.title}（全{getGameMatches(g).length}試合）
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="ocr-target-grid">
                  <label className="field-label">
                    <span>保存先の試合</span>
                    <select
                      className="portal-select"
                      value={resolvedMatchId}
                      onChange={(e) =>
                        updateItemField(item.itemId, {
                          targetMatchId: e.target.value,
                        })
                      }
                    >
                      {targetMatches.map((m, mIdx) => (
                        <option key={m.id} value={m.id}>
                          {mIdx + 1}. {formatMatchDisplayTitle(m)}（動画
                          {m.videos.length}本）
                        </option>
                      ))}
                      <option value="__new__">＋ 新しい試合として追加</option>
                    </select>
                  </label>

                  <label className="field-label">
                    <span>保存方法</span>
                    <select
                      className="portal-select"
                      value={item.mergeMode}
                      onChange={(e) =>
                        updateItemField(item.itemId, {
                          mergeMode: e.target.value as OcrMergeMode,
                        })
                      }
                    >
                      <option value="replace">上書き保存（1試合分）</option>
                      <option value="add">
                        同じ試合へ合算（1Q+2Q等の加算）
                      </option>
                    </select>
                  </label>
                </div>

                {prevSameGameItem && (
                  <button
                    type="button"
                    className="ocr-merge-card-btn"
                    onClick={() => handleMergeWithPreviousSameGame(item.itemId)}
                  >
                    <Layers size={14} /> 前のカード（
                    {prevSameGameItem.quarterLabel || prevSameGameItem.fileName}
                    ）と合算して1試合にまとめる
                  </button>
                )}

                <div className="ocr-score-grid">
                  <label className="field-label">
                    <span>対戦相手</span>
                    <input
                      type="text"
                      className="portal-input"
                      value={item.awayTeamName}
                      onChange={(e) =>
                        updateItemField(item.itemId, {
                          awayTeamName: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field-label">
                    <span>チーム（A / B）</span>
                    <select
                      className="portal-select"
                      value={effectiveTeamUnit}
                      onChange={(e) =>
                        updateItemField(item.itemId, {
                          teamUnit: e.target.value as TeamUnit,
                        })
                      }
                    >
                      <option value="">指定なし</option>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="その他">その他</option>
                    </select>
                  </label>
                </div>

                <div className="ocr-score-grid">
                  <label className="field-label">
                    <span>自チーム得点</span>
                    <input
                      type="number"
                      min={0}
                      className="portal-input"
                      value={item.homeScore}
                      onChange={(e) =>
                        updateItemField(item.itemId, {
                          homeScore: Math.max(
                            0,
                            Math.round(Number(e.target.value) || 0)
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field-label">
                    <span>相手（{item.awayTeamName}）得点</span>
                    <input
                      type="number"
                      min={0}
                      className="portal-input"
                      value={item.awayScore}
                      onChange={(e) =>
                        updateItemField(item.itemId, {
                          awayScore: Math.max(
                            0,
                            Math.round(Number(e.target.value) || 0)
                          ),
                        })
                      }
                    />
                  </label>
                </div>

                {totalMismatch && (
                  <div className="admin-warn-note">
                    選手合計（{totalCalcPts}点）と上の得点（{item.homeScore}点）がずれています。保存時は選手合計で反映されます。
                  </div>
                )}

                {item.rows.length === 0 ? (
                  <div className="empty-box">
                    選手別の行はなかったため、スコアのみ保存できます。
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ocr-toggle-table-btn"
                      onClick={() =>
                        setExpandedIds((prev) => ({
                          ...prev,
                          [item.itemId]: !expanded,
                        }))
                      }
                    >
                      <span>選手別の数値を編集（{item.rows.length}名）</span>
                      {expanded ? (
                        <ChevronUp size={15} />
                      ) : (
                        <ChevronDown size={15} />
                      )}
                    </button>

                    {expanded && (
                      <>
                        <div className="table-scroll-x">
                          <table className="ocr-edit-table">
                            <thead>
                              <tr>
                                <th className="sticky-col">No / 選手名</th>
                                <th>PTS</th>
                                {NUMERIC_COLUMNS.map((col) => (
                                  <th key={col.key}>{col.label}</th>
                                ))}
                                <th>削除</th>
                              </tr>
                            </thead>
                            <tbody>
                              {item.rows.map((row) => {
                                const matched = Boolean(
                                  resolvePlayerFromRoster(row, players)
                                );
                                const warn = hasRowMismatch(row);
                                const pts = calcRowPts(row);
                                return (
                                  <tr
                                    key={row.id}
                                    className={warn ? 'ocr-row-warn' : ''}
                                  >
                                    <td className="sticky-col">
                                      <div className="ocr-player-cell">
                                        <input
                                          type="text"
                                          className="ocr-num-input ocr-jersey-input"
                                          value={row.number}
                                          aria-label="背番号"
                                          onChange={(e) =>
                                            updateRowField(
                                              item.itemId,
                                              row.id,
                                              'number',
                                              e.target.value
                                            )
                                          }
                                        />
                                        <input
                                          type="text"
                                          className="ocr-name-input"
                                          value={row.name}
                                          aria-label="選手名"
                                          onChange={(e) =>
                                            updateRowField(
                                              item.itemId,
                                              row.id,
                                              'name',
                                              e.target.value
                                            )
                                          }
                                        />
                                        {!matched && (
                                          <span className="ocr-new-badge">
                                            新規
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="cell-pts">{pts}</td>
                                    {NUMERIC_COLUMNS.map((col) => (
                                      <td key={col.key}>
                                        <input
                                          type="number"
                                          min={0}
                                          className="ocr-num-input"
                                          value={row[col.key]}
                                          aria-label={`${row.name} ${col.label}`}
                                          onChange={(e) =>
                                            updateRowField(
                                              item.itemId,
                                              row.id,
                                              col.key,
                                              e.target.value
                                            )
                                          }
                                        />
                                      </td>
                                    ))}
                                    <td>
                                      <button
                                        type="button"
                                        className="btn-icon-danger"
                                        aria-label={`${row.name}の行を削除`}
                                        onClick={() =>
                                          removePreviewRow(item.itemId, row.id)
                                        }
                                      >
                                        <X size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <button
                          type="button"
                          className="ocr-add-row-btn"
                          onClick={() => addBlankPreviewRow(item.itemId)}
                        >
                          <Plus size={13} /> 選手行を追加
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {autoAddCheckbox}

          <div className="two-col-row">
            <button
              type="button"
              className="btn-ghost"
              disabled={parsing || saving}
              onClick={handleReset}
            >
              <RotateCcw size={15} /> やり直す
            </button>
            <button
              type="button"
              className="btn-accent"
              disabled={parsing || saving}
              onClick={() => void handleConfirmSave()}
            >
              {saving ? (
                <Loader2 size={15} className="ocr-spin" />
              ) : (
                <Save size={15} />
              )}{' '}
              {saveBtnLabel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
