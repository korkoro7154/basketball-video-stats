import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Film,
  FolderKanban,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { GameMatch, GameRecord, TeamUnit } from '../types';
import {
  addEmptyMatch,
  applyAiOrganizedMatches,
  applyFetchedYouTubeTitlesToMatches,
  formatMatchClipSummary,
  formatMatchDisplayTitle,
  getGameMatches,
  inspectGameOrganizationStatus,
  mergeMatchWithPrevious,
  moveClipToMatch,
  moveMatchStatsToTarget,
  reorderClipInMatch,
} from '../utils/matches';
import type { AiOrganizedMatchInput } from '../utils/matches';
import { computeMatchSummary } from '../utils/stats';
import { canUseLocalSandbox } from '../utils/sandbox';
import {
  fetchYouTubeVideoTitles,
  organizeMatchesWithAi,
} from '../services/matchOrganizeApi';
import './MatchOrganizerPanel.css';

const YT_TOKEN_STORAGE_KEY = 'portal_yt_access_token';

function getStoredYouTubeAccessToken(): string {
  try {
    return window.sessionStorage.getItem(YT_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface MatchOrganizerPanelProps {
  activeGame: GameRecord;
  matches: GameMatch[];
  onCommitMatches: (nextMatches: GameMatch[]) => void;
  onToggleOrganized: (organized: boolean) => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'danger') => void;
}

function DraftTextInput({
  value,
  placeholder,
  className,
  ariaLabel,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  const flush = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onCommit(trimmed);
    } else if (!trimmed) {
      setDraft(value);
    }
  };

  return (
    <input
      type="text"
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/**
 * Collapsible organizer for grouping, splitting, reordering, and labeling matches & clips within a match day.
 */
export function MatchOrganizerPanel({
  activeGame,
  matches,
  onCommitMatches,
  onToggleOrganized,
  onNotify,
}: MatchOrganizerPanelProps) {
  const [open, setOpen] = useState(false);
  const [fetchingTitles, setFetchingTitles] = useState(false);
  const [organizingAi, setOrganizingAi] = useState(false);
  const [statsTargetByMatchId, setStatsTargetByMatchId] = useState<
    Record<string, string>
  >({});
  const attemptedVideoIdsRef = useRef<Set<string>>(new Set());
  const matchesRef = useRef(matches);
  const activeGameIdRef = useRef(activeGame.id);

  useEffect(() => {
    matchesRef.current = matches;
    activeGameIdRef.current = activeGame.id;
  }, [matches, activeGame.id]);

  useEffect(() => {
    if (!open) return;
    const missingIds = Array.from(
      new Set(
        matches
          .flatMap((m) => m.videos)
          .filter(
            (v) =>
              !v.youtubeTitle &&
              v.youtubeId &&
              !v.youtubeId.startsWith('demo_') &&
              !attemptedVideoIdsRef.current.has(v.youtubeId)
          )
          .map((v) => v.youtubeId)
      )
    );
    if (missingIds.length === 0) return;

    for (const id of missingIds) {
      attemptedVideoIdsRef.current.add(id);
    }
    const targetGameId = activeGame.id;
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setFetchingTitles(true);
      try {
        const titles = await fetchYouTubeVideoTitles(
          missingIds,
          getStoredYouTubeAccessToken() || undefined
        );
        if (cancelled || activeGameIdRef.current !== targetGameId) return;
        const nextMatches = applyFetchedYouTubeTitlesToMatches(
          matchesRef.current,
          titles
        );
        if (nextMatches !== matchesRef.current) {
          onCommitMatches(nextMatches);
        }
      } catch {
        // Silent best-effort fetch
      } finally {
        if (!cancelled) {
          setFetchingTitles(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, activeGame.id, matches, onCommitMatches]);

  const totalClipsCount = matches.reduce((sum, m) => sum + m.videos.length, 0);

  const handleAiAutoOrganize = async () => {
    const clips = matches.flatMap((m) => m.videos);
    if (clips.length === 0 || organizingAi) return;
    setOrganizingAi(true);
    try {
      const res = await organizeMatchesWithAi({
        gameTitle: activeGame.title,
        gameDate: activeGame.date,
        defaultOpponent: activeGame.opponent,
        clips: clips.map((c) => ({
          id: c.id,
          label: c.label,
          youtubeId: c.youtubeId,
          youtubeTitle: c.youtubeTitle,
        })),
        youtubeAccessToken: getStoredYouTubeAccessToken() || undefined,
      });
      if (res.matches.length === 0) {
        onNotify('AIで整理できる構成が見つかりませんでした', 'info');
        return;
      }
      const nextMatches = applyAiOrganizedMatches(
        matchesRef.current,
        res.matches,
        activeGame.opponent,
        res.fetchedTitles
      );
      onCommitMatches(nextMatches);
      onNotify(
        `AIが全${clips.length}本の動画を${nextMatches.length}試合に自動整理しました`,
        'success'
      );
    } catch (err: unknown) {
      onNotify(
        err instanceof Error ? err.message : 'AI自動整理に失敗しました',
        'danger'
      );
    } finally {
      setOrganizingAi(false);
    }
  };

  const updateMatch = (
    matchId: string,
    patch: Partial<Pick<GameMatch, 'label' | 'teamUnit' | 'opponent'>>
  ) => {
    const next = matches.map((m) => (m.id === matchId ? { ...m, ...patch } : m));
    onCommitMatches(next);
  };

  const updateClipLabel = (matchId: string, clipId: string, label: string) => {
    const next = matches.map((m) =>
      m.id === matchId
        ? {
            ...m,
            videos: m.videos.map((v) => (v.id === clipId ? { ...v, label } : v)),
          }
        : m
    );
    onCommitMatches(next);
  };

  const handleMergeUp = (mIdx: number) => {
    if (mIdx <= 0) return;
    const prev = matches[mIdx - 1];
    const curr = matches[mIdx];
    const prevSum = computeMatchSummary(prev);
    const currSum = computeMatchSummary(curr);
    if (
      prevSum.hasStats &&
      currSum.hasStats &&
      !window.confirm(
        `「${formatMatchDisplayTitle(prev)}（${prevSum.homeScore}-${prevSum.awayScore}）」と「${formatMatchDisplayTitle(curr)}（${currSum.homeScore}-${currSum.awayScore}）」の両方にスタッツが入っています。\n\nこのまま合体すると2試合分のスタッツが足し算されます。合体しますか？`
      )
    ) {
      return;
    }
    const next = mergeMatchWithPrevious(matches, mIdx);
    onCommitMatches(next);
    onNotify(
      `「${formatMatchDisplayTitle(curr)}」を「${formatMatchDisplayTitle(prev)}」と合体しました`,
      'success'
    );
  };

  const handleMoveClip = (
    fromMatchId: string,
    clipId: string,
    toMatchId: string | '__new__'
  ) => {
    const fromMatch = matches.find((m) => m.id === fromMatchId);
    const fromSum = fromMatch ? computeMatchSummary(fromMatch) : null;
    const willLeaveOrphanStats =
      Boolean(fromMatch) &&
      fromMatch!.videos.length === 1 &&
      Boolean(fromSum?.hasStats);

    const next = moveClipToMatch(
      matches,
      fromMatchId,
      clipId,
      toMatchId,
      activeGame.opponent
    );
    onCommitMatches(next);

    if (willLeaveOrphanStats && fromMatch && fromSum) {
      onNotify(
        `動画を移動しました（元の「${formatMatchDisplayTitle(fromMatch)}」はスタッツ ${fromSum.homeScore}-${fromSum.awayScore} を守るため残っています。下の試合へ移すか削除できます）`,
        'info'
      );
    } else {
      onNotify(
        toMatchId === '__new__'
          ? '動画を新しい試合に分けました'
          : '動画を別の試合へ移動しました',
        'success'
      );
    }
  };

  const handleResetSingleMatchStats = (match: GameMatch) => {
    const title = formatMatchDisplayTitle(match);
    if (match.videos.length === 0 && matches.length > 1) {
      if (!window.confirm(`「${title}」のスタッツと空の試合枠を削除しますか？`)) {
        return;
      }
      onCommitMatches(matches.filter((m) => m.id !== match.id));
      onNotify('空になった試合枠とスタッツを削除しました', 'info');
      return;
    }
    if (
      !window.confirm(
        `「${title}」のスタッツ記録だけをリセットしますか？（※動画は残ります）`
      )
    ) {
      return;
    }
    const next = matches.map((m) =>
      m.id === match.id
        ? {
            ...m,
            homeScore: 0,
            awayScore: 0,
            events: [],
            manualBoxScore: undefined,
          }
        : m
    );
    onCommitMatches(next);
    onNotify('この試合のスタッツをリセットしました', 'info');
  };

  const handleMoveStatsAndRemove = (fromMatch: GameMatch, toMatchId: string) => {
    const targetMatch = matches.find((m) => m.id === toMatchId);
    if (!targetMatch) return;
    const targetSum = computeMatchSummary(targetMatch);
    if (
      targetSum.hasStats &&
      !window.confirm(
        `「${formatMatchDisplayTitle(targetMatch)}」にはすでにスタッツ（${targetSum.homeScore}-${targetSum.awayScore}）が入っています。上書きして移動しますか？`
      )
    ) {
      return;
    }
    onCommitMatches(moveMatchStatsToTarget(matches, fromMatch.id, toMatchId));
    onNotify(
      `スタッツを「${formatMatchDisplayTitle(targetMatch)}」へ移し、空の枠を削除しました`,
      'success'
    );
  };

  const handleDeleteMatchWithConfirm = (match: GameMatch) => {
    if (matches.length <= 1 || match.videos.length > 0) return;
    const sum = computeMatchSummary(match);
    if (sum.hasStats) {
      if (
        !window.confirm(
          `「${formatMatchDisplayTitle(match)}」の試合枠とスタッツ（${sum.homeScore}-${sum.awayScore}）を削除しますか？`
        )
      ) {
        return;
      }
      onCommitMatches(matches.filter((m) => m.id !== match.id));
      onNotify('空になった試合枠とスタッツを削除しました', 'info');
      return;
    }
    onCommitMatches(matches.filter((m) => m.id !== match.id));
    onNotify('空の試合枠を削除しました', 'info');
  };

  return (
    <section className="portal-card">
      <button
        type="button"
        className="ocr-toggle-table-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="match-org-toggle-left">
          <FolderKanban size={15} className="accent-icon" />
          <span>試合と動画の整理（全{matches.length}試合）</span>
        </span>
        {activeGame.isOrganized && (
          <span className="match-org-done-badge">整理済み</span>
        )}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {!open ? (
        <p className="card-date top-gap">
          1Q前半/後半の合体・順番ズレの動画移動・A/Bチーム・相手名の編集ができます
        </p>
      ) : (
        <div className="match-org-body">
          <label
            className={`match-org-done-bar ${
              activeGame.isOrganized ? 'is-done' : ''
            }`}
          >
            <input
              type="checkbox"
              className="match-org-done-check"
              checked={Boolean(activeGame.isOrganized)}
              onChange={(e) => onToggleOrganized(e.target.checked)}
            />
            <span className="match-org-done-texts">
              <span className="match-org-done-title">
                この試合日を「整理済み」にする
              </span>
              <span className="match-org-done-sub">
                {activeGame.isOrganized
                  ? '整理済み（一括AI整理の対象から自動除外されます）'
                  : '確認・整理が終わったらチェックを入れてください'}
              </span>
            </span>
          </label>

          <div className="row-between">
            <p className="table-helper-text">
              再生リスト内の動画を同じ試合にまとめたり、別の試合へ動かしたりできます（YouTube側は変わりません）。
            </p>
            <div className="match-org-toolbar-actions">
              <button
                type="button"
                className="btn-soft-sm"
                disabled={organizingAi || totalClipsCount === 0}
                onClick={() => void handleAiAutoOrganize()}
              >
                {organizingAi ? (
                  <Loader2 size={14} className="ocr-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {organizingAi ? 'AI整理中...' : 'AIで自動整理'}
              </button>
              <button
                type="button"
                className="btn-soft-sm"
                disabled={organizingAi}
                onClick={() => {
                  onCommitMatches(addEmptyMatch(matches, activeGame.opponent));
                  onNotify('新しい試合枠を追加しました', 'success');
                }}
              >
                <Plus size={14} /> 試合枠を追加
              </button>
            </div>
          </div>

          {matches.map((m, mIdx) => {
            const sum = computeMatchSummary(m);
            const clipSummary = formatMatchClipSummary(m);
            const isOrphanStatsCard = m.videos.length === 0 && sum.hasStats;
            const canDeleteVideoless =
              matches.length > 1 && m.videos.length === 0;
            const videoMatches = isOrphanStatsCard
              ? matches.filter((cand) => cand.id !== m.id && cand.videos.length > 0)
              : [];
            const afterVideoMatches = isOrphanStatsCard
              ? matches.slice(mIdx + 1).filter((cand) => cand.videos.length > 0)
              : [];
            const preferredTarget =
              afterVideoMatches.find(
                (cand) => !computeMatchSummary(cand).hasStats
              ) ??
              afterVideoMatches[0] ??
              videoMatches.find((cand) => !computeMatchSummary(cand).hasStats) ??
              videoMatches[0];
            const chosenTargetId = videoMatches.some(
              (cand) => cand.id === statsTargetByMatchId[m.id]
            )
              ? statsTargetByMatchId[m.id]
              : (preferredTarget?.id ?? '');

            return (
              <div key={m.id} className="match-org-card">
                <div className="match-org-header">
                  <div className="match-org-title-wrap">
                    <span className="step-num">{mIdx + 1}</span>
                    <strong>{formatMatchDisplayTitle(m)}</strong>
                    {clipSummary && (
                      <span className="match-org-quarter-badge">{clipSummary}</span>
                    )}
                    {isOrphanStatsCard && (
                      <span className="match-org-empty-video-badge">
                        動画なし・スタッツのみ
                      </span>
                    )}
                    {sum.hasStats && (
                      <span className="chip-category">
                        {sum.homeScore}-{sum.awayScore}
                      </span>
                    )}
                  </div>
                  <div className="match-org-actions">
                    {mIdx > 0 && m.videos.length > 0 && (
                      <button
                        type="button"
                        className="btn-soft-sm"
                        onClick={() => handleMergeUp(mIdx)}
                      >
                        <Layers size={13} /> 上の試合と合体
                      </button>
                    )}
                    {sum.hasStats && (
                      <button
                        type="button"
                        className="btn-soft-sm"
                        onClick={() => handleResetSingleMatchStats(m)}
                      >
                        <RotateCcw size={13} /> 記録リセット
                      </button>
                    )}
                    {canDeleteVideoless && (
                      <button
                        type="button"
                        className="btn-icon-danger"
                        aria-label={`${m.label}を削除`}
                        onClick={() => handleDeleteMatchWithConfirm(m)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="match-org-fields">
                  <label className="field-label">
                    <span>試合名</span>
                    <DraftTextInput
                      key={`${m.id}_label_${m.label}`}
                      className="portal-input"
                      value={m.label}
                      placeholder="1試合目"
                      ariaLabel={`${m.label}の試合名`}
                      onCommit={(val) => updateMatch(m.id, { label: val })}
                    />
                  </label>
                  <label className="field-label">
                    <span>チーム</span>
                    <select
                      className="portal-select"
                      value={m.teamUnit ?? ''}
                      onChange={(e) =>
                        updateMatch(m.id, {
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
                  <label className="field-label match-org-opp-field">
                    <span>対戦相手</span>
                    <DraftTextInput
                      key={`${m.id}_opp_${m.opponent}`}
                      className="portal-input"
                      value={m.opponent}
                      placeholder="対戦相手"
                      ariaLabel={`${m.label}の対戦相手`}
                      onCommit={(val) => updateMatch(m.id, { opponent: val })}
                    />
                  </label>
                </div>

                <div className="match-org-videos">
                  {m.videos.length === 0 ? (
                    isOrphanStatsCard ? (
                      <div className="match-org-orphan-box">
                        <p className="match-org-orphan-text">
                          動画は移動済みです（スタッツ {sum.homeScore}-{sum.awayScore}{' '}
                          が残っています）。下の別の試合にスタッツを移すか、不要なら枠ごと削除できます。
                        </p>
                        <div className="match-org-orphan-actions">
                          {videoMatches.length > 0 && (
                            <>
                              <select
                                className="portal-select match-org-orphan-select"
                                aria-label={`${m.label}のスタッツ移動先`}
                                value={chosenTargetId}
                                onChange={(e) =>
                                  setStatsTargetByMatchId((prev) => ({
                                    ...prev,
                                    [m.id]: e.target.value,
                                  }))
                                }
                              >
                                {videoMatches.map((cand) => {
                                  const idxInAll = matches.findIndex(
                                    (x) => x.id === cand.id
                                  );
                                  const candQ = formatMatchClipSummary(cand);
                                  const candSum = computeMatchSummary(cand);
                                  return (
                                    <option key={cand.id} value={cand.id}>
                                      {idxInAll + 1}. {formatMatchDisplayTitle(cand)}
                                      {candQ ? ` [${candQ}]` : ''}
                                      {candSum.hasStats
                                        ? ` (${candSum.homeScore}-${candSum.awayScore})`
                                        : ' (未記録)'}
                                    </option>
                                  );
                                })}
                              </select>
                              <button
                                type="button"
                                className="btn-soft-sm match-org-orphan-move-btn"
                                disabled={!chosenTargetId}
                                onClick={() =>
                                  handleMoveStatsAndRemove(m, chosenTargetId)
                                }
                              >
                                <ArrowDownToLine size={13} /> この試合へ移して枠を消す
                              </button>
                            </>
                          )}
                          {canDeleteVideoless && (
                            <button
                              type="button"
                              className="btn-soft-sm"
                              onClick={() => handleDeleteMatchWithConfirm(m)}
                            >
                              <Trash2 size={13} /> 枠とスタッツを削除
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="card-date">動画なし（スタッツのみの試合）</div>
                    )
                  ) : (
                    m.videos.map((clip, vIdx) => (
                      <div key={clip.id} className="match-org-video-row">
                        <div className="match-org-clip-meta">
                          <span className="match-org-clip-pos">
                            現在: {formatMatchDisplayTitle(m)}・
                            {clip.label || `動画${vIdx + 1}`}
                          </span>
                          <span className="match-org-yt-title">
                            <Film size={12} />
                            <span>
                              {clip.youtubeTitle
                                ? clip.youtubeTitle
                                : fetchingTitles
                                  ? 'YouTubeタイトルを取得中...'
                                  : 'YouTubeタイトル未取得'}
                            </span>
                          </span>
                        </div>
                        <div className="match-org-clip-edit-row">
                          <DraftTextInput
                            key={`${clip.id}_label_${clip.label}`}
                            className="portal-input match-org-clip-label"
                            value={clip.label}
                            placeholder="例: 1Q / 1Q前半 / 1-2Q"
                            ariaLabel={`動画${vIdx + 1}のラベル`}
                            onCommit={(val) => updateClipLabel(m.id, clip.id, val)}
                          />
                          <div className="match-org-clip-controls">
                            {m.videos.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  className="mini-step-btn"
                                  disabled={vIdx === 0}
                                  aria-label="動画を上へ"
                                  onClick={() =>
                                    onCommitMatches(
                                      reorderClipInMatch(matches, m.id, vIdx, -1)
                                    )
                                  }
                                >
                                  <ArrowUp size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="mini-step-btn"
                                  disabled={vIdx === m.videos.length - 1}
                                  aria-label="動画を下へ"
                                  onClick={() =>
                                    onCommitMatches(
                                      reorderClipInMatch(matches, m.id, vIdx, 1)
                                    )
                                  }
                                >
                                  <ArrowDown size={13} />
                                </button>
                              </>
                            )}
                            <select
                              className="portal-select match-org-move-select"
                              value={m.id}
                              aria-label={`${clip.label}の移動先`}
                              onChange={(e) =>
                                handleMoveClip(m.id, clip.id, e.target.value)
                              }
                            >
                              {matches.map((targetM, targetIdx) => {
                                const targetQ = formatMatchClipSummary(targetM);
                                return (
                                  <option key={targetM.id} value={targetM.id}>
                                    {targetIdx + 1}. {formatMatchDisplayTitle(targetM)}
                                    {targetQ ? ` [${targetQ}]` : ''}
                                  </option>
                                );
                              })}
                              <option value="__new__">＋ 新しい試合に分離</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export interface BulkMatchOrganizerPanelProps {
  games: GameRecord[];
  activeGameId?: string;
  onApplyAiMatchesForGame: (
    gameId: string,
    aiMatches: AiOrganizedMatchInput[],
    fetchedTitles?: Record<string, string>
  ) => Promise<{ ok: boolean; beforeCount: number; afterCount: number }>;
  onToggleGameOrganized: (gameId: string, organized: boolean) => void;
  onSelectGame: (gameId: string) => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'danger') => void;
}

interface BulkRowResult {
  state: 'processing' | 'done' | 'error' | 'skipped';
  message: string;
}

/**
 * Collapsible panel for selectively batch-running AI video/match organization across past game days.
 */
export function BulkMatchOrganizerPanel({
  games,
  activeGameId,
  onApplyAiMatchesForGame,
  onToggleGameOrganized,
  onSelectGame,
  onNotify,
}: BulkMatchOrganizerPanelProps) {
  const [open, setOpen] = useState(false);
  const [customSelectedIds, setCustomSelectedIds] = useState<string[] | null>(
    null
  );
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [rowResults, setRowResults] = useState<Record<string, BulkRowResult>>(
    {}
  );
  const cancelRequestedRef = useRef(false);
  const sandboxAvailable = canUseLocalSandbox({
    isDev: import.meta.env.DEV,
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
  });

  const rows = useMemo(
    () =>
      games.map((game) => ({
        game,
        status: inspectGameOrganizationStatus(game),
      })),
    [games]
  );

  const selectableIds = useMemo(
    () => rows.filter((r) => r.status.videoCount > 0).map((r) => r.game.id),
    [rows]
  );
  const selectableIdSet = useMemo(
    () => new Set(selectableIds),
    [selectableIds]
  );
  const defaultCandidateIds = useMemo(
    () => rows.filter((r) => r.status.needsReview).map((r) => r.game.id),
    [rows]
  );
  const noStatsIds = useMemo(
    () =>
      rows
        .filter((r) => r.status.videoCount > 0 && !r.status.hasStats)
        .map((r) => r.game.id),
    [rows]
  );
  const organizedCount = useMemo(
    () => rows.filter((r) => r.status.isOrganized).length,
    [rows]
  );
  const unorganizedSelectableIds = useMemo(
    () =>
      rows
        .filter((r) => r.status.videoCount > 0 && !r.status.isOrganized)
        .map((r) => r.game.id),
    [rows]
  );

  const effectiveSelectedIds = useMemo(
    () =>
      (customSelectedIds ?? defaultCandidateIds).filter((id) =>
        selectableIdSet.has(id)
      ),
    [customSelectedIds, defaultCandidateIds, selectableIdSet]
  );
  const selectedIdSet = useMemo(
    () => new Set(effectiveSelectedIds),
    [effectiveSelectedIds]
  );

  const handleToggleGameId = (gameId: string) => {
    if (running || !selectableIdSet.has(gameId)) return;
    const next = selectedIdSet.has(gameId)
      ? effectiveSelectedIds.filter((id) => id !== gameId)
      : [...effectiveSelectedIds, gameId];
    setCustomSelectedIds(next);
  };

  const handleToggleOrganizedInBulk = (gameId: string, organized: boolean) => {
    if (running) return;
    onToggleGameOrganized(gameId, organized);
    if (organized && selectedIdSet.has(gameId)) {
      setCustomSelectedIds(effectiveSelectedIds.filter((id) => id !== gameId));
    }
  };

  const handleRequestCancel = () => {
    cancelRequestedRef.current = true;
    setCancelling(true);
  };

  const handleRunBulkAiOrganize = async () => {
    if (running || effectiveSelectedIds.length === 0) return;

    const targetRows = rows.filter((r) => selectedIdSet.has(r.game.id));
    if (targetRows.length === 0) return;

    cancelRequestedRef.current = false;
    setRunning(true);
    setCancelling(false);
    setProgressText('');
    setRowResults({});

    const succeededIds = new Set<string>();
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let cancelled = false;
    const accessToken = getStoredYouTubeAccessToken() || undefined;

    for (let i = 0; i < targetRows.length; i += 1) {
      if (cancelRequestedRef.current) {
        cancelled = true;
        break;
      }

      const { game } = targetRows[i];
      setProgressText(
        `AI整理中... (${i + 1} / ${targetRows.length}日目：${game.date} ${game.title})`
      );
      setRowResults((prev) => ({
        ...prev,
        [game.id]: { state: 'processing', message: '整理中...' },
      }));

      try {
        const matches = getGameMatches(game);
        const clips = matches.flatMap((m) => m.videos);
        if (clips.length === 0) {
          skippedCount += 1;
          setRowResults((prev) => ({
            ...prev,
            [game.id]: {
              state: 'skipped',
              message: 'スキップ（動画なし）',
            },
          }));
          continue;
        }

        const res = await organizeMatchesWithAi({
          gameTitle: game.title,
          gameDate: game.date,
          defaultOpponent: game.opponent,
          clips: clips.map((c) => ({
            id: c.id,
            label: c.label,
            youtubeId: c.youtubeId,
            youtubeTitle: c.youtubeTitle,
          })),
          youtubeAccessToken: accessToken,
        });

        if (res.matches.length === 0) {
          failedCount += 1;
          setRowResults((prev) => ({
            ...prev,
            [game.id]: {
              state: 'error',
              message: 'エラー: AIで整理できる構成が見つかりませんでした',
            },
          }));
          continue;
        }

        const applied = await onApplyAiMatchesForGame(
          game.id,
          res.matches,
          res.fetchedTitles
        );
        if (!applied.ok) {
          failedCount += 1;
          setRowResults((prev) => ({
            ...prev,
            [game.id]: {
              state: 'error',
              message: 'エラー: 整理結果の保存に失敗しました',
            },
          }));
          continue;
        }

        succeededIds.add(game.id);
        successCount += 1;
        const resultLabel =
          applied.beforeCount !== applied.afterCount
            ? `整理完了（${applied.beforeCount}試合 → ${applied.afterCount}試合）`
            : `整理完了（${applied.afterCount}試合・ラベル更新）`;
        setRowResults((prev) => ({
          ...prev,
          [game.id]: { state: 'done', message: resultLabel },
        }));
      } catch (err: unknown) {
        failedCount += 1;
        const msg =
          err instanceof Error ? err.message : 'AI自動整理に失敗しました';
        setRowResults((prev) => ({
          ...prev,
          [game.id]: { state: 'error', message: `エラー: ${msg}` },
        }));
      }

      if (i < targetRows.length - 1 && !cancelRequestedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
      }
    }

    setRunning(false);
    setCancelling(false);
    setProgressText('');

    if (succeededIds.size > 0) {
      setCustomSelectedIds(
        effectiveSelectedIds.filter((id) => !succeededIds.has(id))
      );
    }

    const parts: string[] = [];
    if (successCount > 0) parts.push(`${successCount}日分を整理`);
    if (failedCount > 0) parts.push(`${failedCount}日分失敗`);
    if (skippedCount > 0) parts.push(`${skippedCount}日分スキップ`);

    if (cancelled) {
      onNotify(
        `途中で中断しました（${parts.join(' / ') || '完了なし'}）`,
        failedCount > 0 ? 'danger' : 'info'
      );
    } else if (failedCount > 0 && successCount === 0) {
      onNotify(`一括AI整理に失敗しました（${parts.join(' / ')}）`, 'danger');
    } else if (failedCount > 0) {
      onNotify(`一括AI整理完了（${parts.join(' / ')}）`, 'info');
    } else {
      onNotify(`一括AI整理完了：${parts.join(' / ')}`, 'success');
    }
  };

  return (
    <section className="portal-card">
      <button
        type="button"
        className="ocr-toggle-table-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="match-org-toggle-left">
          <Sparkles size={15} className="accent-icon" />
          <span>過去の試合日をまとめてAI整理</span>
        </span>
        <span
          className={`bulk-org-badge ${
            defaultCandidateIds.length === 0 ? 'is-clean' : ''
          }`}
        >
          {defaultCandidateIds.length > 0
            ? `未整理候補 ${defaultCandidateIds.length}日`
            : `全${games.length}日`}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {!open ? (
        <p className="card-date top-gap">
          バラバラな過去の試合日だけチェックして、ボタン1回でまとめてAI整理できます（整頓済みの日やスタッツは守れます）
        </p>
      ) : (
        <div className="match-org-body">
          <div className="bulk-org-safety-note">
            <ShieldCheck size={16} />
            <span>
              {sandboxAvailable
                ? 'すでに登録したスコア・スタッツは消さずに守ります。先に試したいときは画面上の「テストモード」をONにしてからお試しください。'
                : 'すでに登録したスコア・スタッツは消さずに守ります。'}
            </span>
          </div>

          <div className="bulk-org-toolbar">
            <div className="bulk-org-summary-meta">
              <span className="bulk-org-count">
                選択中: {effectiveSelectedIds.length} / 対象{selectableIds.length}日
              </span>
              <span className="bulk-org-organized-count">
                整理済み: {organizedCount} / 全{rows.length}日
              </span>
            </div>
            <div className="bulk-org-quick-actions">
              <button
                type="button"
                className="bulk-org-quick-btn"
                disabled={running || defaultCandidateIds.length === 0}
                onClick={() => setCustomSelectedIds(defaultCandidateIds)}
              >
                未整理候補だけ
              </button>
              <button
                type="button"
                className="bulk-org-quick-btn"
                disabled={running || unorganizedSelectableIds.length === 0}
                onClick={() => setCustomSelectedIds(unorganizedSelectableIds)}
              >
                未整理すべて
              </button>
              <button
                type="button"
                className="bulk-org-quick-btn"
                disabled={running || noStatsIds.length === 0}
                onClick={() => setCustomSelectedIds(noStatsIds)}
              >
                スタッツ未記録のみ
              </button>
              <button
                type="button"
                className="bulk-org-quick-btn"
                disabled={running || selectableIds.length === 0}
                onClick={() => setCustomSelectedIds(selectableIds)}
              >
                全選択
              </button>
              <button
                type="button"
                className="bulk-org-quick-btn"
                disabled={running || effectiveSelectedIds.length === 0}
                onClick={() => setCustomSelectedIds([])}
              >
                解除
              </button>
            </div>
          </div>

          <div className="bulk-org-list">
            {rows.map(({ game, status }) => {
              const isEmpty = status.videoCount === 0;
              const checked = !isEmpty && selectedIdSet.has(game.id);
              const result = rowResults[game.id];

              return (
                <div
                  key={game.id}
                  className={`bulk-org-item ${checked ? 'is-selected' : ''} ${
                    status.isOrganized ? 'is-organized' : ''
                  } ${isEmpty ? 'is-empty' : ''}`}
                >
                  <div className="bulk-org-item-head">
                    <input
                      type="checkbox"
                      className="bulk-org-check"
                      checked={checked}
                      disabled={isEmpty || running}
                      aria-label={`${game.date} ${game.title}を選択`}
                      onChange={() => handleToggleGameId(game.id)}
                    />
                    <div className="bulk-org-item-main">
                      <div className="bulk-org-title-row">
                        <span className="bulk-org-date">{game.date}</span>
                        <span className="bulk-org-title">{game.title}</span>
                        {isEmpty ? (
                          <span className="bulk-org-state-badge is-empty">
                            動画なし
                          </span>
                        ) : status.isOrganized ? (
                          <span className="bulk-org-state-badge is-done">
                            整理済み
                          </span>
                        ) : status.needsReview ? (
                          <span className="bulk-org-state-badge is-review">
                            要整理候補
                          </span>
                        ) : (
                          <span className="bulk-org-state-badge is-ok">
                            整頓済みっぽい
                          </span>
                        )}
                        {status.hasStats && (
                          <span className="bulk-org-stats-badge">
                            スタッツあり
                          </span>
                        )}
                      </div>

                      <div className="bulk-org-meta-line">
                        <span>
                          全{status.matchCount}試合・動画{status.videoCount}本
                        </span>
                        {status.matchPreview && (
                          <span className="bulk-org-preview">
                            {status.matchPreview}
                          </span>
                        )}
                      </div>

                      {!status.isOrganized && status.reasons.length > 0 && (
                        <div className="bulk-org-reasons">
                          {status.reasons.map((reason) => (
                            <span key={reason} className="bulk-org-reason-chip">
                              {reason}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="bulk-org-item-actions">
                      <label
                        className={`bulk-org-done-toggle ${
                          status.isOrganized ? 'is-done' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={status.isOrganized}
                          disabled={running}
                          aria-label={`${game.date} ${game.title}を整理済みにする`}
                          onChange={(e) =>
                            handleToggleOrganizedInBulk(
                              game.id,
                              e.target.checked
                            )
                          }
                        />
                        <span>整理済み</span>
                      </label>
                      <button
                        type="button"
                        className={`bulk-org-open-btn ${
                          game.id === activeGameId ? 'is-current' : ''
                        }`}
                        onClick={() => onSelectGame(game.id)}
                      >
                        開く
                      </button>
                    </div>
                  </div>

                  {result && (
                    <div
                      className={`bulk-org-result-row is-${result.state}`}
                    >
                      {result.state === 'processing' && (
                        <Loader2 size={13} className="ocr-spin" />
                      )}
                      {result.state === 'done' && <CheckCircle2 size={13} />}
                      {(result.state === 'error' ||
                        result.state === 'skipped') && (
                        <AlertCircle size={13} />
                      )}
                      <span>{result.message}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bulk-org-footer">
            {running ? (
              <div className="bulk-org-running-bar">
                <span className="bulk-org-running-text">
                  <Loader2 size={14} className="ocr-spin" />
                  <span>{progressText || 'AI整理を実行中...'}</span>
                </span>
                <button
                  type="button"
                  className="bulk-org-cancel-btn"
                  disabled={cancelling}
                  onClick={handleRequestCancel}
                >
                  {cancelling ? '中断中...' : 'ここで中断'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-accent btn-block"
                disabled={effectiveSelectedIds.length === 0}
                onClick={() => void handleRunBulkAiOrganize()}
              >
                <Sparkles size={16} />
                {effectiveSelectedIds.length > 0
                  ? `選択した ${effectiveSelectedIds.length} 日分をまとめてAI整理`
                  : '整理する試合日をチェックしてください'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
