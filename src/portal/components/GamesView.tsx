import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Play,
  Search,
  Trophy,
  Video,
  X,
} from 'lucide-react';
import type {
  GameCategory,
  GameRecord,
  GameStatEvent,
  Player,
  QuarterLabel,
} from '../types';
import {
  STAT_META,
  computeGameBoxScore,
  computeGameScores,
  computeMatchSummary,
  getGameResult,
} from '../utils/stats';
import { formatMatchDisplayTitle, getGameMatches } from '../utils/matches';
import { formatSeconds } from '../utils/youtube';
import { YouTubeEmbed } from './YouTubeEmbed';
import type { YouTubeEmbedHandle } from './YouTubeEmbed';

interface GamesViewProps {
  games: GameRecord[];
  players: Player[];
  selectedGameId: string | null;
  onSelectGame: (gameId: string | null) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onUpdateGameVideoUrl: (gameId: string, clipId: string, youtubeUrl: string) => void;
}

const CATEGORY_FILTERS: Array<'すべて' | GameCategory> = [
  'すべて',
  '公式戦',
  '練習試合',
  'カップ戦',
];

export function GamesView({
  games,
  players,
  selectedGameId,
  onSelectGame,
  searchQuery,
  onSearchQueryChange,
  onUpdateGameVideoUrl,
}: GamesViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<'すべて' | GameCategory>('すべて');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [statsScope, setStatsScope] = useState<'match' | 'all'>('match');
  const [detailTab, setDetailTab] = useState<'boxscore' | 'timeline'>('boxscore');
  const [quarterFilter, setQuarterFilter] = useState<'ALL' | QuarterLabel>('ALL');
  const playerRef = useRef<YouTubeEmbedHandle | null>(null);
  const [selectedPlayerHighlight, setSelectedPlayerHighlight] = useState<{
    playerName: string;
    events: GameStatEvent[];
  } | null>(null);

  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) ?? null,
    [games, selectedGameId]
  );

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...games]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((g) => {
        if (categoryFilter !== 'すべて' && g.category !== categoryFilter) {
          return false;
        }
        if (!q) return true;
        return (
          g.title.toLowerCase().includes(q) ||
          g.opponent.toLowerCase().includes(q) ||
          g.date.includes(q) ||
          (g.notes || '').toLowerCase().includes(q) ||
          getGameMatches(g).some(
            (m) =>
              m.opponent.toLowerCase().includes(q) ||
              m.label.toLowerCase().includes(q) ||
              (m.teamUnit ?? '').toLowerCase().includes(q)
          )
        );
      });
  }, [games, categoryFilter, searchQuery]);

  const jumpToGameEvent = (game: GameRecord, event: GameStatEvent) => {
    const matches = getGameMatches(game);
    const matchIdx = matches.findIndex((m) =>
      m.events.some((ev) => ev.id === event.id)
    );
    if (matchIdx !== -1) {
      setActiveMatchIndex(matchIdx);
      const targetMatch = matches[matchIdx];
      if (event.videoClipId) {
        const clipIdx = targetMatch.videos.findIndex(
          (v) => v.id === event.videoClipId
        );
        if (clipIdx !== -1) {
          setActiveVideoIndex(clipIdx);
        }
      } else {
        setActiveVideoIndex(0);
      }
    }

    const target = Math.max(0, event.timestampSec - 5);
    playerRef.current?.seekTo(target);
  };

  if (!selectedGame) {
    return (
      <div className="portal-section-stack">
        <div className="portal-card">
          <div className="input-with-icon">
            <Search size={16} />
            <input
              type="text"
              className="portal-input"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="対戦相手・大会名・日付で検索..."
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-input-btn"
                onClick={() => onSearchQueryChange('')}
                aria-label="検索をクリア"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="chip-scroll-row">
            {CATEGORY_FILTERS.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`filter-chip ${categoryFilter === cat ? 'is-active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="list-count-bar">
          <span>
            試合一覧（{filteredGames.length}件）
          </span>
        </div>

        {filteredGames.length === 0 ? (
          <div className="empty-box">該当する試合が見つかりません</div>
        ) : (
          <div className="card-list">
            {filteredGames.map((game) => {
              const matches = getGameMatches(game);
              const {
                homeScore,
                awayScore,
                hasStats,
                recordedMatchCount,
                totalMatchCount,
                wins,
                losses,
              } = computeGameScores(game, 'ALL');
              const res = getGameResult(homeScore, awayScore);
              const distinctOpponents = Array.from(
                new Set(matches.map((m) => m.opponent).filter(Boolean))
              );
              const opponentLine =
                distinctOpponents.length > 1
                  ? `vs ${distinctOpponents.join('・')}`
                  : `vs ${distinctOpponents[0] || game.opponent}`;

              return (
                <button
                  key={game.id}
                  type="button"
                  className="game-card"
                  onClick={() => onSelectGame(game.id)}
                >
                  <div className="game-card-top">
                    <span className="chip-category">{game.category}</span>
                    <span className="card-date">
                      <Calendar size={12} /> {game.date}
                    </span>
                  </div>
                  <div className="game-card-title">{game.title}</div>
                  <div className="game-card-score-row">
                    <div className="score-team-wrap">
                      <span className="vs-label">{opponentLine}</span>
                      {hasStats ? (
                        recordedMatchCount > 1 ? (
                          <span className="score-big">
                            <span className="score-home">{wins}勝</span>
                            <span className="score-dash">・</span>
                            <span>{losses}敗</span>
                          </span>
                        ) : totalMatchCount <= 1 ? (
                          <span className="score-big">
                            <span className="score-home">{homeScore}</span>
                            <span className="score-dash">-</span>
                            <span>{awayScore}</span>
                          </span>
                        ) : null
                      ) : null}
                    </div>
                    {hasStats ? (
                      totalMatchCount > 1 ? (
                        <span className="chip-category">
                          {recordedMatchCount}/{totalMatchCount}試合記録
                        </span>
                      ) : (
                        <span className={`result-pill result-${res}`}>
                          {res === 'W' ? 'WIN' : res === 'L' ? 'LOSE' : 'DRAW'}
                        </span>
                      )
                    ) : (
                      <span className="video-only-pill">動画のみ（未記録）</span>
                    )}
                  </div>
                  {matches.length > 1 && (
                    <div className="day-match-pills">
                      {matches.slice(0, 4).map((m) => {
                        const mSum = computeMatchSummary(m);
                        return (
                          <span key={m.id} className="day-match-pill">
                            {formatMatchDisplayTitle(m)}{' '}
                            {mSum.hasStats
                              ? `${mSum.homeScore}-${mSum.awayScore}`
                              : '未'}
                          </span>
                        );
                      })}
                      {matches.length > 4 && (
                        <span className="day-match-pill">
                          +{matches.length - 4}試合
                        </span>
                      )}
                    </div>
                  )}
                  {game.notes && <p className="card-note-preview">{game.notes}</p>}
                  <div className="game-card-foot">
                    <span>
                      <Video size={14} />{' '}
                      {totalMatchCount > 1
                        ? `全${totalMatchCount}試合・動画 ${game.videos.length}本`
                        : `動画 ${game.videos.length}本`}
                      {game.youtubePlaylistId ? '（再生リスト）' : ''}
                    </span>
                    <span className="tap-guide">
                      詳細を開く <ChevronRight size={14} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const matches = getGameMatches(selectedGame);
  const safeMatchIdx =
    activeMatchIndex >= 0 && activeMatchIndex < matches.length
      ? activeMatchIndex
      : 0;
  const activeMatch = matches[safeMatchIdx] ?? matches[0] ?? null;
  const matchVideos = activeMatch?.videos ?? [];
  const safeVideoIdx =
    activeVideoIndex >= 0 && activeVideoIndex < matchVideos.length
      ? activeVideoIndex
      : 0;
  const activeClip = matchVideos[safeVideoIdx] ?? matchVideos[0] ?? null;

  const scopeArg =
    matches.length > 1 && statsScope === 'match' && activeMatch
      ? activeMatch.id
      : 'ALL';
  const {
    homeScore,
    awayScore,
    hasStats: scoreHasStats,
    wins,
    losses,
  } = computeGameScores(selectedGame, scopeArg);
  const allDayScores = computeGameScores(selectedGame, 'ALL');
  const result = getGameResult(homeScore, awayScore);
  const {
    rows,
    teamTotals,
    isManual,
    hasStats: boxHasStats,
  } = computeGameBoxScore(selectedGame, players, scopeArg);

  const playerMap = new Map(players.map((p) => [p.id, p]));
  const clipLabelMap = new Map(
    matches.flatMap((m) => m.videos.map((v) => [v.id, v.label] as const))
  );
  const matchTitleByEventId = new Map<string, string>();
  matches.forEach((m) => {
    const t = formatMatchDisplayTitle(m);
    m.events.forEach((ev) => matchTitleByEventId.set(ev.id, t));
  });
  const scopedEvents =
    scopeArg === 'ALL'
      ? matches.flatMap((m) => m.events)
      : (activeMatch?.events ?? []);
  const visibleEvents = [...scopedEvents]
    .filter((e) => quarterFilter === 'ALL' || e.quarter === quarterFilter)
    .sort((a, b) => a.timestampSec - b.timestampSec);

  const openPlayerEvents = (playerId: string, playerName: string) => {
    const pEvents = scopedEvents
      .filter((e) => e.team === 'home' && e.playerId === playerId)
      .sort((a, b) => a.timestampSec - b.timestampSec);
    if (pEvents.length === 0) return;
    setSelectedPlayerHighlight({ playerName, events: pEvents });
  };

  return (
    <div className="portal-section-stack">
      {/* 詳細ヘッダー */}
      <div className="detail-top-bar">
        <button
          type="button"
          className="btn-back"
          onClick={() => onSelectGame(null)}
        >
          <ArrowLeft size={16} /> 試合一覧
        </button>

        <div className="detail-score-pill">
          {scoreHasStats ? (
            scopeArg === 'ALL' && matches.length > 1 ? (
              <span className="detail-score-text">
                全{matches.length}試合 {wins}勝{losses}敗
              </span>
            ) : (
              <>
                <span className={`result-dot result-${result}`}>{result}</span>
                <span className="detail-score-text">
                  {homeScore} - {awayScore}
                </span>
              </>
            )
          ) : (
            <span className="video-only-pill">未記録</span>
          )}
        </div>
      </div>

      {/* 試合日タイトル */}
      <div className="detail-title-card">
        <div className="game-card-top">
          <span className="chip-category">{selectedGame.category}</span>
          <span className="card-date">
            <Calendar size={12} /> {selectedGame.date}
          </span>
        </div>
        <h2 className="detail-main-title">
          {selectedGame.title}
          {matches.length <= 1 && activeMatch?.opponent
            ? `（vs ${activeMatch.opponent}）`
            : `（全${matches.length}試合）`}
        </h2>
        {selectedGame.notes && <p className="detail-note">{selectedGame.notes}</p>}
      </div>

      {/* 第2層：各試合タブ */}
      {matches.length > 1 && (
        <section className="portal-card">
          <span className="field-caption">試合を選ぶ（全{matches.length}試合）</span>
          <div className="clip-tab-row top-gap">
            {matches.map((m, idx) => {
              const mSum = computeMatchSummary(m);
              const title = formatMatchDisplayTitle(m);
              const distinctOpp =
                m.opponent &&
                m.opponent !== '対戦相手' &&
                !selectedGame.title.includes(m.opponent);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`clip-pill ${idx === safeMatchIdx ? 'is-active' : ''}`}
                  onClick={() => {
                    setActiveMatchIndex(idx);
                    setActiveVideoIndex(0);
                    setSelectedPlayerHighlight(null);
                    playerRef.current?.reset();
                  }}
                >
                  <span>
                    {title}
                    {distinctOpp ? ` vs ${m.opponent}` : ''}
                  </span>
                  {mSum.hasStats && (
                    <span className="clip-score-mini">
                      {mSum.homeScore}-{mSum.awayScore}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 第3層：YouTube動画プレイヤー */}
      <section className="portal-card no-pad-top">
        {activeClip ? (
          <YouTubeEmbed
            videoId={activeClip.youtubeId}
            title={`${activeMatch?.opponent || selectedGame.opponent}戦 - ${activeClip.label}`}
            subtitle={
              activeMatch
                ? `${formatMatchDisplayTitle(activeMatch)}${activeMatch.opponent ? ` (vs ${activeMatch.opponent})` : ''} / ${activeClip.label}`
                : activeClip.label
            }
            playerRef={playerRef}
            onReplaceUrl={(url) =>
              onUpdateGameVideoUrl(selectedGame.id, activeClip.id, url)
            }
          />
        ) : (
          <div className="empty-box">この試合には動画がまだ登録されていません</div>
        )}

        {matchVideos.length > 1 && (
          <div className="clip-tab-row">
            {matchVideos.map((clip, idx) => (
              <button
                key={clip.id}
                type="button"
                className={`clip-pill ${idx === safeVideoIdx ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveVideoIndex(idx);
                  setSelectedPlayerHighlight(null);
                  playerRef.current?.reset();
                }}
              >
                <Play size={12} /> {clip.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 下部：スタッツ表 / プレイ履歴 */}
      <section className="portal-card">
        {matches.length > 1 && activeMatch && (
          <div className="scope-pill-bar">
            <button
              type="button"
              className={`scope-pill-btn ${statsScope === 'match' ? 'is-active' : ''}`}
              onClick={() => {
                setStatsScope('match');
                setSelectedPlayerHighlight(null);
              }}
            >
              この試合（{formatMatchDisplayTitle(activeMatch)}）
            </button>
            <button
              type="button"
              className={`scope-pill-btn ${statsScope === 'all' ? 'is-active' : ''}`}
              onClick={() => {
                setStatsScope('all');
                setSelectedPlayerHighlight(null);
              }}
            >
              この日の合計（全{matches.length}試合）
            </button>
          </div>
        )}

        {scopeArg !== 'ALL' && activeMatch && scoreHasStats && (
          <div className="match-score-banner">
            <span>
              {formatMatchDisplayTitle(activeMatch)} vs {activeMatch.opponent}
            </span>
            <div className="match-score-banner-right">
              <strong>
                {homeScore} - {awayScore}
              </strong>
              <span className={`result-pill result-${result}`}>
                {result === 'W' ? 'WIN' : result === 'L' ? 'LOSE' : 'DRAW'}
              </span>
            </div>
          </div>
        )}

        <div className="subtab-bar">
          <button
            type="button"
            className={`subtab-btn ${detailTab === 'boxscore' ? 'is-active' : ''}`}
            onClick={() => setDetailTab('boxscore')}
          >
            <Trophy size={15} /> スタッツ表
          </button>
          <button
            type="button"
            className={`subtab-btn ${detailTab === 'timeline' ? 'is-active' : ''}`}
            onClick={() => setDetailTab('timeline')}
          >
            <Play size={15} /> プレイ履歴（{scopedEvents.length}）
          </button>
        </div>

        {detailTab === 'boxscore' ? (
          !boxHasStats ? (
            scopeArg !== 'ALL' && allDayScores.hasStats ? (
              <div className="empty-box">
                <p style={{ margin: '0 0 10px' }}>
                  この試合（{activeMatch ? formatMatchDisplayTitle(activeMatch) : ''}）のスタッツは未記録ですが、この日の他の試合（
                  {allDayScores.recordedMatchCount}試合）に記録があります。
                </p>
                <button
                  type="button"
                  className="btn-soft-sm"
                  onClick={() => {
                    setStatsScope('all');
                    setSelectedPlayerHighlight(null);
                  }}
                >
                  この日の合計スタッツを見る
                </button>
              </div>
            ) : (
              <div className="empty-box">
                {scopeArg !== 'ALL'
                  ? 'この試合のスタッツはまだ記録されていません（記録・管理タブから登録できます）'
                  : 'この日のスタッツはまだ記録されていません'}
              </div>
            )
          ) : (
            <div className="boxscore-wrap">
              {!isManual && scopedEvents.length > 0 && (
                <p className="table-helper-text">
                  ※ 選手名をタップすると、その選手のプレイシーン一覧から動画ジャンプできます
                </p>
              )}

              <div className="table-scroll-x">
                <table className="portal-stats-table">
                  <thead>
                    <tr>
                      <th className="sticky-col">選手</th>
                      <th>PTS</th>
                      <th>REB</th>
                      <th>AST</th>
                      <th>FG</th>
                      <th>FG%</th>
                      <th>3P</th>
                      <th>3P%</th>
                      <th>FT</th>
                      <th>FT%</th>
                      <th>OR</th>
                      <th>DR</th>
                      <th>STL</th>
                      <th>BLK</th>
                      <th>TO</th>
                      <th>PF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const hasPlayerEvents =
                        !isManual &&
                        scopedEvents.some(
                          (e) => e.team === 'home' && e.playerId === r.playerId
                        );
                      return (
                      <tr key={r.playerId}>
                        <td className="sticky-col">
                          {hasPlayerEvents ? (
                            <button
                              type="button"
                              className="player-jump-link"
                              onClick={() =>
                                openPlayerEvents(r.playerId, `#${r.number} ${r.name}`)
                              }
                            >
                              <span className="jersey-num">#{r.number}</span>
                              <span>{r.name}</span>
                            </button>
                          ) : (
                            <div className="player-static-cell">
                              <span className="jersey-num">#{r.number}</span>
                              <span>{r.name}</span>
                            </div>
                          )}
                        </td>
                        <td className="cell-pts">{r.pts}</td>
                        <td>{r.reb}</td>
                        <td>{r.ast}</td>
                        <td>
                          {r.fgm}-{r.fga}
                        </td>
                        <td>{r.fga > 0 ? `${r.fgPercent}%` : '-'}</td>
                        <td>
                          {r.tpm}-{r.tpa}
                        </td>
                        <td>{r.tpa > 0 ? `${r.tpPercent}%` : '-'}</td>
                        <td>
                          {r.ftm}-{r.fta}
                        </td>
                        <td>{r.fta > 0 ? `${r.ftPercent}%` : '-'}</td>
                        <td>{r.oreb}</td>
                        <td>{r.dreb}</td>
                        <td>{r.stl}</td>
                        <td>{r.blk}</td>
                        <td>{r.to}</td>
                        <td>{r.pf}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sticky-col total-label">チーム合計</td>
                    <td className="cell-pts">{teamTotals.pts}</td>
                    <td>{teamTotals.reb}</td>
                    <td>{teamTotals.ast}</td>
                    <td>
                      {teamTotals.fgm}-{teamTotals.fga}
                    </td>
                    <td>{teamTotals.fga > 0 ? `${teamTotals.fgPercent}%` : '-'}</td>
                    <td>
                      {teamTotals.tpm}-{teamTotals.tpa}
                    </td>
                    <td>{teamTotals.tpa > 0 ? `${teamTotals.tpPercent}%` : '-'}</td>
                    <td>
                      {teamTotals.ftm}-{teamTotals.fta}
                    </td>
                    <td>{teamTotals.fta > 0 ? `${teamTotals.ftPercent}%` : '-'}</td>
                    <td>{teamTotals.oreb}</td>
                    <td>{teamTotals.dreb}</td>
                    <td>{teamTotals.stl}</td>
                    <td>{teamTotals.blk}</td>
                    <td>{teamTotals.to}</td>
                    <td>{teamTotals.pf}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {selectedPlayerHighlight && (
              <div className="highlight-drawer">
                <div className="highlight-drawer-head">
                  <strong>{selectedPlayerHighlight.playerName} のプレイ動画一覧</strong>
                  <button
                    type="button"
                    className="clear-input-btn"
                    onClick={() => setSelectedPlayerHighlight(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="highlight-chip-list">
                  {selectedPlayerHighlight.events.map((ev) => {
                    const matchTitle =
                      scopeArg === 'ALL' ? matchTitleByEventId.get(ev.id) : undefined;
                    const clipLabel = ev.videoClipId
                      ? clipLabelMap.get(ev.videoClipId)
                      : undefined;
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className="highlight-jump-chip"
                        onClick={() => jumpToGameEvent(selectedGame, ev)}
                      >
                        <Play size={12} fill="currentColor" />
                        <span>
                          {matchTitle ? `${matchTitle} ` : ''}
                          {clipLabel ? `${clipLabel} ` : ''}
                          {ev.quarter} {formatSeconds(ev.timestampSec)}
                        </span>
                        <span className="chip-stat-label">
                          {STAT_META[ev.type].label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          )
        ) : (
          <div className="timeline-wrap">
            <div className="chip-scroll-row">
              {(['ALL', '1Q', '2Q', '3Q', '4Q', 'OT'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`filter-chip ${quarterFilter === q ? 'is-active' : ''}`}
                  onClick={() => setQuarterFilter(q)}
                >
                  {q === 'ALL' ? '全Q' : q}
                </button>
              ))}
            </div>

            {visibleEvents.length === 0 ? (
              <div className="empty-box">
                {scopedEvents.length === 0
                  ? 'まだこの動画の時刻付きプレイ履歴はありません。'
                  : '該当するクオーターのプレイがありません。'}
              </div>
            ) : (
              <div className="event-timeline-list">
                {visibleEvents.map((ev) => {
                  const player = ev.playerId ? playerMap.get(ev.playerId) : null;
                  const meta = STAT_META[ev.type];
                  const matchTitle =
                    scopeArg === 'ALL' ? matchTitleByEventId.get(ev.id) : undefined;
                  const clipLabel = ev.videoClipId
                    ? clipLabelMap.get(ev.videoClipId)
                    : undefined;
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className="timeline-row"
                      onClick={() => jumpToGameEvent(selectedGame, ev)}
                    >
                      <span className="timeline-time">
                        <Play size={11} fill="currentColor" />
                        {matchTitle ? `${matchTitle} ` : ''}
                        {clipLabel ? `${clipLabel} ` : ''}
                        {ev.quarter} {formatSeconds(ev.timestampSec)}
                      </span>
                      <span className="timeline-who">
                        {ev.team === 'away'
                          ? '相手チーム'
                          : player
                            ? `#${player.number} ${player.name}`
                            : '自チーム'}
                      </span>
                      <span className={`stat-badge tone-${meta.tone}`}>
                        {meta.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
