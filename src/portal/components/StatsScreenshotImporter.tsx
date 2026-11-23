import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import type { GameMatch, GameRecord, Player, TeamUnit } from '../types';
import { formatMatchDisplayTitle, getGameMatches } from '../utils/matches';
import {
  prepareScreenshotForOcr,
  sendPreparedScreenshotToOcr,
} from '../services/statsOcrApi';
import type {
  ParsedStatsResult,
  PreparedScreenshot,
} from '../services/statsOcrApi';

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

export interface OcrSaveBatchPayload {
  items: Array<{
    targetMatchId: string | '__new__';
    awayTeamName: string;
    teamUnit: TeamUnit;
    homeScore: number;
    awayScore: number;
    rows: EditableOcrPlayer[];
  }>;
  autoAddMissingPlayers: boolean;
}

interface PreviewOcrItem {
  itemId: string;
  fileName: string;
  thumbDataUrl?: string;
  targetMatchId: string | '__new__';
  awayTeamName: string;
  teamUnit: TeamUnit;
  homeScore: number;
  awayScore: number;
  rows: EditableOcrPlayer[];
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
  onOpenGameDetail: () => void;
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

let ocrSeq = 0;

function createOcrId(prefix: string): string {
  ocrSeq += 1;
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ocrSeq}_${rand}`;
}

function normalizeNameForMatch(name: string): string {
  return name.replace(/[\s\u3000]+/g, '').toLowerCase();
}

function isMatchedInRoster(row: EditableOcrPlayer, roster: Player[]): boolean {
  const num = row.number.trim();
  const norm = normalizeNameForMatch(row.name);
  if (num && roster.some((p) => p.number.trim() === num)) return true;
  if (norm && roster.some((p) => normalizeNameForMatch(p.name) === norm)) {
    return true;
  }
  return false;
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

function resolveTargetMatchId(
  item: PreviewOcrItem,
  idx: number,
  matches: GameMatch[]
): string | '__new__' {
  if (item.targetMatchId === '__new__') return '__new__';
  if (item.targetMatchId && matches.some((m) => m.id === item.targetMatchId)) {
    return item.targetMatchId;
  }
  return matches[idx]?.id ?? '__new__';
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

function extractMmDdFromFilename(name: string): string {
  const match = name.match(/(?:^|[^0-9])(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:$|[^0-9])/);
  if (!match) return '';
  return `${match[1]}-${match[2]}`;
}

function findBestMatchingGame(
  games: GameRecord[],
  mmddHint: string,
  opponentHints: string[]
): GameRecord | null {
  const cleanedHints = Array.from(
    new Set(
      opponentHints
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 2 && s !== '対戦相手')
    )
  );
  if (!mmddHint && cleanedHints.length === 0) return null;

  let monthTitleRe: RegExp | null = null;
  if (mmddHint) {
    const [mm, dd] = mmddHint.split('-').map((v) => parseInt(v, 10));
    if (mm >= 1 && dd >= 1) {
      monthTitleRe = new RegExp(`(?:^|[^0-9])${mm}/${dd}(?:$|[^0-9])`);
    }
  }

  let bestGame: GameRecord | null = null;
  let bestScore = 0;
  let tiedTop = false;

  for (const g of games) {
    let score = 0;
    if (mmddHint) {
      if (g.date.endsWith(`-${mmddHint}`) || (monthTitleRe && monthTitleRe.test(g.title))) {
        score += 10;
      }
    }
    const haystack = [
      g.title,
      g.opponent,
      ...getGameMatches(g).map((m) => m.opponent),
    ]
      .join(' ')
      .toLowerCase();
    for (const hint of cleanedHints) {
      if (haystack.includes(hint)) {
        score += 3;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestGame = g;
      tiedTop = false;
    } else if (score > 0 && score === bestScore) {
      tiedTop = true;
    }
  }

  if (bestScore >= 10) return bestGame;
  if (!mmddHint && bestScore >= 3 && !tiedTop) return bestGame;
  return null;
}

export function StatsScreenshotImporter({
  activeGame,
  activeMatches,
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
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [ocrWarning, setOcrWarning] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [previewItems, setPreviewItems] = useState<PreviewOcrItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [autoMatchedGameTitle, setAutoMatchedGameTitle] = useState('');
  const [failedFiles, setFailedFiles] = useState<
    Array<{ file: File; error: string }>
  >([]);
  const [lastSavedInfo, setLastSavedInfo] = useState<{
    count: number;
    gameTitle: string;
    clipSummary: string;
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
    setAutoMatchedGameTitle('');
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
    fileName: string,
    data: ParsedStatsResult,
    targetMatchId: string | '__new__',
    defaultTeamUnit: TeamUnit,
    fallbackOpponent: string
  ): PreviewOcrItem => ({
    itemId: createOcrId('ocr_item'),
    fileName,
    thumbDataUrl: data.thumbDataUrl,
    targetMatchId,
    awayTeamName: data.awayTeamName || fallbackOpponent,
    teamUnit: defaultTeamUnit,
    homeScore: data.homeScore,
    awayScore: data.awayScore,
    rows: data.players.map((p) => ({
      id: createOcrId('ocr_row'),
      reportedPts: p.pts,
      number: p.number,
      name: p.name,
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
    })),
  });

  const runOcrBatch = async (
    filesToScan: File[],
    options?: { skipPreFilter?: boolean }
  ) => {
    type PreparedEntry = {
      index: number;
      file: File;
      fileName: string;
      prepared: PreparedScreenshot;
    };
    type FileOutcome =
      | { ok: true; file: File; fileName: string; data: ParsedStatsResult }
      | { ok: false; file: File; fileName: string; error: string };

    const outcomes: FileOutcome[] = new Array<FileOutcome>(filesToScan.length);
    const preparedEntries: PreparedEntry[] = [];

    for (let i = 0; i < filesToScan.length; i += 1) {
      const file = filesToScan[i];
      setProgressText(
        `画像を事前仕分け中... (${i + 1}/${filesToScan.length}枚)`
      );
      try {
        const prepared = await prepareScreenshotForOcr(file);
        preparedEntries.push({ index: i, file, fileName: file.name, prepared });
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : '画像の読み込みに失敗しました。';
        outcomes[i] = { ok: false, file, fileName: file.name, error: msg };
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
      filesToScan.length >= 2 &&
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
          data: {
            imageType: 'shot_chart',
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
    let foundBoxCount = 0;

    const formatSendProgress = () => {
      const skipSuffix =
        preSkippedCount > 0 ? `・対象外${preSkippedCount}枚スキップ済` : '';
      return `ボックススコアを解析中... (${doneCount}/${candidatesToSend.length}枚${skipSuffix}・検出${foundBoxCount}件)`;
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
            data,
          };
          if (data.imageType === 'box_score') {
            foundBoxCount += 1;
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

    const boxItems = successes.filter((s) => s.data.imageType === 'box_score');
    const teamSummaryItems = successes.filter(
      (s) =>
        s.data.imageType === 'team_summary' &&
        (s.data.homeScore > 0 || s.data.awayScore > 0)
    );
    const usable = boxItems.length > 0 ? boxItems : teamSummaryItems;
    const skippedCount = successes.length - usable.length;
    const nextFailed = failures.map((f) => ({
      file: f.file,
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

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const sortedFiles = [...selectedFiles].sort((a, b) =>
      a.name.localeCompare(b.name, 'ja', { numeric: true })
    );

    setParsing(true);
    setOcrWarning('');
    setOcrError('');
    setLastSavedInfo(null);
    setAutoMatchedGameTitle('');
    setPreviewItems([]);
    setExpandedIds({});
    setFailedFiles([]);
    setBatchMeta({ skippedCount: 0, failedCount: 0 });
    setProgressText(`画像を事前仕分け中... (0/${sortedFiles.length}枚)`);

    try {
      const result = await runOcrBatch(sortedFiles);
      const {
        successes,
        usable,
        skippedCount,
        preSkippedCount,
        failedEntries,
      } = result;
      setFailedFiles(failedEntries);

      if (usable.length === 0) {
        if (sortedFiles.length === 1) {
          if (failedEntries.length === 1) {
            setOcrError(failedEntries[0].error);
            return;
          }
          if (successes[0]?.data.imageType === 'shot_chart') {
            setOcrWarning(
              'シュートチャートの画像が選ばれました。選手一覧の表が載っている「ボックススコア」のスクショを選んでください。'
            );
            return;
          }
          setOcrWarning(
            'ボックススコアの表が見つかりませんでした。選手の一覧表がはっきり写っているスクショをお試しください。'
          );
          return;
        }

        const activeCount = sortedFiles.length - preSkippedCount;
        if (failedEntries.length === activeCount && failedEntries[0]) {
          setOcrError(failedEntries[0].error);
          return;
        }
        setOcrWarning(
          `選んだ ${sortedFiles.length}枚の中にボックススコアが見つかりませんでした（シュートチャート等 ${skippedCount}枚をスキップ）。`
        );
        return;
      }

      const mmddHint =
        usable.map((u) => u.data.screenshotDate || '').find(Boolean) ||
        sortedFiles.map((f) => extractMmDdFromFilename(f.name)).find(Boolean) ||
        '';
      const opponentHints = usable
        .map((u) => u.data.awayTeamName)
        .filter(Boolean);
      const matchedGame = findBestMatchingGame(games, mmddHint, opponentHints);
      const effectiveGame = matchedGame ?? activeGame;
      const effectiveMatches = matchedGame
        ? getGameMatches(matchedGame)
        : activeMatches;

      if (matchedGame && matchedGame.id !== activeGame.id) {
        onChangeTargetGame(matchedGame.id);
        setAutoMatchedGameTitle(matchedGame.title);
      }

      const activeMatchIdx =
        effectiveGame.id === activeGame.id && activeMatch
          ? effectiveMatches.findIndex((m) => m.id === activeMatch.id)
          : 0;
      const startIdx = activeMatchIdx >= 0 ? activeMatchIdx : 0;

      const builtItems: PreviewOcrItem[] = usable.map((entry, idx) => {
        const assignedMatch = effectiveMatches[startIdx + idx] ?? null;
        return buildPreviewItem(
          entry.fileName,
          entry.data,
          assignedMatch ? assignedMatch.id : '__new__',
          assignedMatch?.teamUnit ?? '',
          effectiveGame.opponent
        );
      });

      const nextExpanded: Record<string, boolean> = {};
      builtItems.forEach((item) => {
        const st = evaluateItemStatus(item);
        nextExpanded[item.itemId] =
          builtItems.length === 1 || st.anyRowWarn || st.totalMismatch;
      });

      setPreviewItems(builtItems);
      setExpandedIds(nextExpanded);
      setBatchMeta({ skippedCount, failedCount: failedEntries.length });
      setAutoAddMissing(true);
      onNotify(
        `ボックススコア ${builtItems.length}件を読み取りました`,
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

  const handleRetryFailedFiles = async () => {
    if (failedFiles.length === 0 || parsing || saving) return;

    const retryTargets = failedFiles.map((f) => f.file);
    setParsing(true);
    setOcrWarning('');
    setOcrError('');
    setProgressText(`失敗分を再読み取り中... (0/${retryTargets.length}枚)`);

    try {
      const result = await runOcrBatch(retryTargets, { skipPreFilter: true });
      const activeMatchIdx = activeMatch
        ? activeMatches.findIndex((m) => m.id === activeMatch.id)
        : 0;
      const startIdx = activeMatchIdx >= 0 ? activeMatchIdx : 0;

      const addedItems: PreviewOcrItem[] = result.usable.map((entry, idx) => {
        const assignedMatch =
          activeMatches[startIdx + previewItems.length + idx] ?? null;
        return buildPreviewItem(
          entry.fileName,
          entry.data,
          assignedMatch ? assignedMatch.id : '__new__',
          assignedMatch?.teamUnit ?? '',
          activeGame.opponent
        );
      });

      if (addedItems.length > 0) {
        setPreviewItems((prev) => [...prev, ...addedItems]);
        setExpandedIds((prev) => {
          const next = { ...prev };
          addedItems.forEach((item) => {
            const st = evaluateItemStatus(item);
            next[item.itemId] = st.anyRowWarn || st.totalMismatch;
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
        'targetMatchId' | 'awayTeamName' | 'teamUnit' | 'homeScore' | 'awayScore'
      >
    >
  ) => {
    setPreviewItems((prev) =>
      prev.map((item) => (item.itemId === itemId ? { ...item, ...patch } : item))
    );
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
            if (field === 'number' || field === 'name') {
              return { ...r, [field]: rawVal };
            }
            const num = Math.max(0, Math.round(Number(rawVal) || 0));
            return { ...r, [field]: num };
          }),
        };
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

  const handleConfirmSave = async () => {
    if (previewItems.length === 0 || saving) return;
    const matchLabelMap = new Map(
      activeMatches.map((m, i) => [m.id, `${i + 1}. ${formatMatchDisplayTitle(m)}`])
    );
    const resolvedItems = previewItems.map((item, idx) => {
      const targetMatchId = resolveTargetMatchId(item, idx, activeMatches);
      return {
        targetMatchId,
        awayTeamName: item.awayTeamName.trim() || activeGame.opponent,
        teamUnit: resolveTeamUnit(item, targetMatchId, activeMatches),
        homeScore: item.homeScore,
        awayScore: item.awayScore,
        rows: item.rows,
      };
    });
    const chosenLabels = Array.from(
      new Set(
        resolvedItems.map((item) =>
          item.targetMatchId === '__new__'
            ? '新規試合'
            : (matchLabelMap.get(item.targetMatchId) ?? '選択試合')
        )
      )
    );
    const clipSummary = chosenLabels.join('、');
    const savedCount = resolvedItems.length;
    const savedGameTitle = activeGame.title;

    setSaving(true);
    setOcrError('');
    try {
      const ok = await onApplyParsedStats({
        items: resolvedItems,
        autoAddMissingPlayers: autoAddMissing,
      });

      if (ok) {
        handleReset();
        setLastSavedInfo({
          count: savedCount,
          gameTitle: savedGameTitle,
          clipSummary,
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
        if (isMatchedInRoster(r, players)) continue;
        const num = r.number.trim();
        const norm = normalizeNameForMatch(r.name);
        const key = num ? `num:${num}` : norm ? `name:${norm}` : r.id;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          count += 1;
        }
      }
    }
    return count;
  })();

  const hasDuplicateTargetMatches = (() => {
    const used = new Set<string>();
    for (let idx = 0; idx < previewItems.length; idx += 1) {
      const resolved = resolveTargetMatchId(previewItems[idx], idx, activeMatches);
      if (resolved === '__new__') continue;
      if (used.has(resolved)) return true;
      used.add(resolved);
    }
    return false;
  })();

  const saveBtnLabel = saving
    ? '保存中...'
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
        <h3>スクショからスタッツ自動読み取り</h3>
      </div>
      <p className="table-helper-text">
        アルバムの写真を何枚でもまとめて選べます。シュートチャート等は自動でスキップし、ボックススコアだけを読み取って一覧表示します。
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="ocr-hidden-input"
        onChange={(e) => void handleFileSelected(e)}
      />

      <button
        type="button"
        className="btn-accent btn-block"
        disabled={parsing || saving}
        onClick={() => fileInputRef.current?.click()}
      >
        {parsing ? (
          <>
            <Loader2 size={17} className="ocr-spin" />{' '}
            {progressText || 'スクショを読み取り中...'}
          </>
        ) : (
          <>
            <Camera size={17} /> スクショを選んで読み取る（複数枚まとめてOK）
          </>
        )}
      </button>

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
              {lastSavedInfo.count}件のスタッツを「{lastSavedInfo.gameTitle}」に保存しました
            </span>
          </div>
          <p className="ocr-saved-sub">保存先：{lastSavedInfo.clipSummary}</p>
          <button
            type="button"
            className="btn-accent btn-block"
            onClick={onOpenGameDetail}
          >
            この日の動画・スタッツを見る
          </button>
        </div>
      )}

      {previewItems.length > 0 && (
        <div className="ocr-batch-list">
          <div className="row-between">
            <span className="field-caption">
              ボックススコア {previewItems.length}件を検出
              {batchMeta.skippedCount > 0
                ? `（シュートチャート等 ${batchMeta.skippedCount}枚スキップ）`
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
              <span>まだ保存されていません（保存先：{activeGame.title}）</span>
            </div>
            {autoMatchedGameTitle === activeGame.title && (
              <div className="ocr-auto-match-note">
                写真の日付・相手名から「{autoMatchedGameTitle}」を自動で選びました（下から変更もできます）
              </div>
            )}
            {games.length > 1 && (
              <label className="field-label">
                <span>保存先の試合日（再生リスト・変更可）</span>
                <select
                  className="portal-select"
                  value={activeGame.id}
                  onChange={(e) => {
                    setLastSavedInfo(null);
                    setAutoMatchedGameTitle('');
                    onChangeTargetGame(e.target.value);
                  }}
                >
                  {games.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.date} {g.title}（全{getGameMatches(g).length}試合）
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hasDuplicateTargetMatches && (
              <div className="admin-warn-note">
                同じ試合が保存先に複数選ばれています。カード内の「保存先の試合」を別の試合（または「＋ 新しい試合として追加」）に切り替えてください。
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
            const resolvedMatchId = resolveTargetMatchId(item, idx, activeMatches);
            const effectiveTeamUnit = resolveTeamUnit(
              item,
              resolvedMatchId,
              activeMatches
            );

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
                    {activeMatches.map((m, mIdx) => (
                      <option key={m.id} value={m.id}>
                        {mIdx + 1}. {formatMatchDisplayTitle(m)}（動画{m.videos.length}本）
                      </option>
                    ))}
                    <option value="__new__">＋ 新しい試合として追加</option>
                  </select>
                </label>

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
                              const matched = isMatchedInRoster(row, players);
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
                                        <span className="ocr-new-badge">新規</span>
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
