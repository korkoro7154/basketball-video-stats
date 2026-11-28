import { useState } from 'react';
import {
  Trophy,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Calendar,
  Smartphone,
  PlayCircle,
  ClipboardEdit,
} from 'lucide-react';
import type { GameRecord } from '../types';
import { computeGameScores, getGameResult } from '../utils/stats';

function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const matchStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = Boolean(
    (window.navigator as Navigator & { standalone?: boolean }).standalone
  );
  return matchStandalone || iosStandalone;
}

interface HomeViewProps {
  games: GameRecord[];
  onOpenGame: (gameId: string) => void;
  onSearchGames: (query: string) => void;
  onGoToAdmin: () => void;
}

export function HomeView({
  games,
  onOpenGame,
  onSearchGames,
  onGoToAdmin,
}: HomeViewProps) {
  const [quickQuery, setQuickQuery] = useState('');
  const [isStandalone] = useState<boolean>(() => isRunningStandalone());
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

  const sortedGames = [...games].sort((a, b) => b.date.localeCompare(a.date));

  const latestGame = sortedGames[0] ?? null;
  const totalGameVideos = games.reduce(
    (sum, g) =>
      sum +
      (Array.isArray(g.matches) && g.matches.length > 0
        ? g.matches.reduce((mSum, m) => mSum + m.videos.length, 0)
        : g.videos.length),
    0
  );

  const summary = sortedGames.reduce(
    (acc, g) => {
      const sc = computeGameScores(g, 'ALL');
      acc.wins += sc.wins;
      acc.losses += sc.losses;
      acc.draws += sc.draws;
      return acc;
    },
    { wins: 0, losses: 0, draws: 0 }
  );

  const handleQuickSearch = () => {
    onSearchGames(quickQuery.trim());
  };

  return (
    <div className="portal-section-stack">
      {/* チーム概要サマリー */}
      <section className="portal-hero-card">
        <div className="hero-top-row">
          <div>
            <div className="hero-eyebrow">TEAM PORTAL</div>
            <h2 className="hero-heading">チームの最新まとめ</h2>
          </div>
          <button
            type="button"
            className="btn-outline-sm"
            onClick={onGoToAdmin}
          >
            <ClipboardEdit size={14} /> 記録・管理
          </button>
        </div>

        <div className="kpi-grid-3">
          <div className="kpi-box">
            <span className="kpi-label">戦績</span>
            <strong className="kpi-value">
              {summary.wins}勝 {summary.losses}敗
            </strong>
          </div>
          <div className="kpi-box">
            <span className="kpi-label">登録試合</span>
            <strong className="kpi-value">{games.length}試合</strong>
          </div>
          <div className="kpi-box">
            <span className="kpi-label">試合動画</span>
            <strong className="kpi-value">{totalGameVideos}本</strong>
          </div>
        </div>
      </section>

      {/* クイック検索 */}
      <section className="portal-card">
        <div className="quick-search-row">
          <div className="input-with-icon flex-1">
            <Search size={16} />
            <input
              type="text"
              className="portal-input"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuickSearch();
              }}
              placeholder="対戦相手・大会名・日付で検索..."
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-soft-sm btn-block"
          onClick={handleQuickSearch}
        >
          <Trophy size={14} /> 試合から探す
        </button>
      </section>

      {/* 最新の試合 */}
      <section className="portal-block">
        <div className="block-header">
          <h3 className="block-title">
            <Trophy size={17} className="accent-icon" />
            最新の試合
          </h3>
          <button
            type="button"
            className="link-more"
            onClick={() => onSearchGames('')}
          >
            すべて見る <ChevronRight size={15} />
          </button>
        </div>

        {latestGame ? (
          (() => {
            const {
              homeScore,
              awayScore,
              hasStats,
              recordedMatchCount,
              totalMatchCount,
              wins,
              losses,
            } = computeGameScores(latestGame, 'ALL');
            const res = getGameResult(homeScore, awayScore);
            return (
              <button
                type="button"
                className="game-card game-card-featured"
                onClick={() => onOpenGame(latestGame.id)}
              >
                <div className="game-card-top">
                  <span className="chip-category">{latestGame.category}</span>
                  <span className="card-date">
                    <Calendar size={12} /> {latestGame.date}
                  </span>
                </div>
                <div className="game-card-title">{latestGame.title}</div>
                <div className="game-card-score-row">
                  <div className="score-team-wrap">
                    <span className="vs-label">vs {latestGame.opponent}</span>
                    {hasStats ? (
                      recordedMatchCount > 1 ? (
                        <span className="score-big">
                          <span className="score-home">{wins}勝</span>
                          <span className="score-dash">・</span>
                          <span>{losses}敗</span>
                        </span>
                      ) : (
                        <span className="score-big">
                          <span className="score-home">{homeScore}</span>
                          <span className="score-dash">-</span>
                          <span>{awayScore}</span>
                        </span>
                      )
                    ) : null}
                  </div>
                  {hasStats ? (
                    recordedMatchCount > 1 ? (
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
                <div className="game-card-foot">
                  <span>
                    <PlayCircle size={14} />{' '}
                    {totalMatchCount > 1
                      ? `全${totalMatchCount}試合・動画 ${latestGame.videos.length}本`
                      : `動画 ${latestGame.videos.length}本`}
                  </span>
                  <span className="tap-guide">
                    動画・スタッツを見る <ChevronRight size={14} />
                  </span>
                </div>
              </button>
            );
          })()
        ) : (
          <div className="empty-box">まだ試合が登録されていません</div>
        )}
      </section>

      {/* スマホのホーム画面に追加する案内（ブラウザ閲覧時のみ表示） */}
      {!isStandalone && (
        <section className="portal-card pwa-install-card">
          <button
            type="button"
            className="pwa-install-toggle"
            onClick={() => setInstallGuideOpen((v) => !v)}
          >
            <img
              src="/icon-192.png"
              alt="駒場バスケ部アイコン"
              className="pwa-install-icon"
            />
            <span className="pwa-install-texts">
              <span className="pwa-install-title">
                <Smartphone size={14} className="accent-icon" />
                <span>スマホのホーム画面に追加する</span>
              </span>
              <span className="pwa-install-sub">
                1タップで開けるアプリアイコンを設置できます
              </span>
            </span>
            {installGuideOpen ? (
              <ChevronUp size={16} className="chevron-muted" />
            ) : (
              <ChevronDown size={16} className="chevron-muted" />
            )}
          </button>

          {installGuideOpen && (
            <div className="pwa-install-body">
              <div className="pwa-install-step-box">
                <strong>iPhone（Safari）の手順</strong>
                <ol>
                  <li>画面下の共有ボタン（四角に上矢印 ↑）をタップ</li>
                  <li>「ホーム画面に追加」を選択</li>
                  <li>右上の「追加」をタップ</li>
                </ol>
              </div>
              <div className="pwa-install-step-box">
                <strong>Android（Chrome）の手順</strong>
                <ol>
                  <li>右上のメニュー（⋮）をタップ</li>
                  <li>「ホーム画面に追加」または「アプリをインストール」を選択</li>
                  <li>「追加」をタップ</li>
                </ol>
              </div>
              <p className="pwa-install-note">
                LINEの中で開いている場合は、右下のマークから Safari / Chrome
                で開き直してから追加してください。
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
