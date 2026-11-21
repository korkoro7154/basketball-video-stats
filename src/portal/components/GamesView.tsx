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
  getGameResult,
} from '../utils/stats';
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
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
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
          (g.notes || '').toLowerCase().includes(q)
        );
      });
  }, [games, categoryFilter, searchQuery]);

  const jumpToGameEvent = (game: GameRecord, event: GameStatEvent) => {
    const matchedIdx = game.videos.findIndex((v) => v.label === event.quarter);
    if (matchedIdx !== -1) {
      setActiveVideoIndex(matchedIdx);
    } else if (event.quarter === '3Q' || event.quarter === '4Q') {
      const secondHalfIdx = game.videos.findIndex((v) => v.label === '後半');
      if (secondHalfIdx !== -1) setActiveVideoIndex(secondHalfIdx);
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
              const { homeScore, awayScore } = computeGameScores(game);
              const res = getGameResult(homeScore, awayScore);
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
                      <span className="vs-label">vs {game.opponent}</span>
                      <span className="score-big">
                        <span className="score-home">{homeScore}</span>
                        <span className="score-dash">-</span>
                        <span>{awayScore}</span>
                      </span>
                    </div>
                    <span className={`result-pill result-${res}`}>
                      {res === 'W' ? 'WIN' : res === 'L' ? 'LOSE' : 'DRAW'}
                    </span>
                  </div>
                  {game.notes && <p className="card-note-preview">{game.notes}</p>}
                  <div className="game-card-foot">
                    <span>
                      <Video size={14} /> 動画 {game.videos.length}本
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

  const { homeScore, awayScore } = computeGameScores(selectedGame);
  const result = getGameResult(homeScore, awayScore);
  const activeClip = selectedGame.videos[activeVideoIndex] ?? selectedGame.videos[0] ?? null;
  const { rows, teamTotals, isManual } = computeGameBoxScore(selectedGame, players);

  const playerMap = new Map(players.map((p) => [p.id, p]));
  const visibleEvents = [...selectedGame.events]
    .filter((e) => quarterFilter === 'ALL' || e.quarter === quarterFilter)
    .sort((a, b) => a.timestampSec - b.timestampSec);

  const openPlayerEvents = (playerId: string, playerName: string) => {
    const pEvents = selectedGame.events
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
          <span className={`result-dot result-${result}`}>
            {result}
          </span>
          <span className="detail-score-text">
            {homeScore} - {awayScore}
          </span>
        </div>
      </div>

      {/* 試合タイトル */}
      <div className="detail-title-card">
        <div className="game-card-top">
          <span className="chip-category">{selectedGame.category}</span>
          <span className="card-date">
            <Calendar size={12} /> {selectedGame.date}
          </span>
        </div>
        <h2 className="detail-main-title">
          {selectedGame.title}（vs {selectedGame.opponent}）
        </h2>
        {selectedGame.notes && <p className="detail-note">{selectedGame.notes}</p>}
      </div>

      {/* 上部：YouTube動画プレイヤー */}
      <section className="portal-card no-pad-top">
        {activeClip ? (
          <YouTubeEmbed
            videoId={activeClip.youtubeId}
            title={`${selectedGame.opponent}戦 - ${activeClip.label}`}
            subtitle={activeClip.label}
            playerRef={playerRef}
            onReplaceUrl={(url) =>
              onUpdateGameVideoUrl(selectedGame.id, activeClip.id, url)
            }
          />
        ) : (
          <div className="empty-box">この試合には動画がまだ登録されていません</div>
        )}

        {selectedGame.videos.length > 1 && (
          <div className="clip-tab-row">
            {selectedGame.videos.map((clip, idx) => (
              <button
                key={clip.id}
                type="button"
                className={`clip-pill ${idx === activeVideoIndex ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveVideoIndex(idx);
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
            <Play size={15} /> プレイ履歴（{selectedGame.events.length}）
          </button>
        </div>

        {detailTab === 'boxscore' ? (
          <div className="boxscore-wrap">
            {!isManual && selectedGame.events.length > 0 && (
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
                      selectedGame.events.some(
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
                  {selectedPlayerHighlight.events.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      className="highlight-jump-chip"
                      onClick={() => jumpToGameEvent(selectedGame, ev)}
                    >
                      <Play size={12} fill="currentColor" />
                      <span>
                        {ev.quarter} {formatSeconds(ev.timestampSec)}
                      </span>
                      <span className="chip-stat-label">
                        {STAT_META[ev.type].label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
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
                {selectedGame.events.length === 0
                  ? 'この試合は試合後まとめ入力のため、時刻付きプレイ履歴はありません。'
                  : '該当するクオーターのプレイがありません。'}
              </div>
            ) : (
              <div className="event-timeline-list">
                {visibleEvents.map((ev) => {
                  const player = ev.playerId ? playerMap.get(ev.playerId) : null;
                  const meta = STAT_META[ev.type];
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      className="timeline-row"
                      onClick={() => jumpToGameEvent(selectedGame, ev)}
                    >
                      <span className="timeline-time">
                        <Play size={11} fill="currentColor" />
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
