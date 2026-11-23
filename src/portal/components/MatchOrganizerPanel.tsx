import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Film,
  FolderKanban,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
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
  mergeMatchWithPrevious,
  moveClipToMatch,
  moveMatchStatsToTarget,
  reorderClipInMatch,
} from '../utils/matches';
import { computeMatchSummary } from '../utils/stats';
import {
  fetchYouTubeVideoTitles,
  organizeMatchesWithAi,
} from '../services/matchOrganizeApi';

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
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {!open ? (
        <p className="card-date top-gap">
          1Q前半/後半の合体・順番ズレの動画移動・A/Bチーム・相手名の編集ができます
        </p>
      ) : (
        <div className="match-org-body">
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
