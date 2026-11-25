import { useState } from 'react';
import {
  Trophy,
  Video,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Calendar,
  Smartphone,
  Tag,
  PlayCircle,
  ClipboardEdit,
} from 'lucide-react';
import type { GameRecord, PracticeVideo } from '../types';
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
  practices: PracticeVideo[];
  onOpenGame: (gameId: string) => void;
  onOpenPractice: (practiceId: string) => void;
  onSearchGames: (query: string) => void;
  onSearchPractices: (query: string) => void;
  onGoToAdmin: () => void;
}

export function HomeView({
  games,
  practices,
  onOpenGame,
  onOpenPractice,
  onSearchGames,
  onSearchPractices,
  onGoToAdmin,
}: HomeViewProps) {
  const [quickQuery, setQuickQuery] = useState('');
  const [isStandalone] = useState<boolean>(() => isRunningStandalone());
  const [installGuideOpen, setInstallGuideOpen] = useState(false);

  const sortedGames = [...games].sort((a, b) => b.date.localeCompare(a.date));
  const sortedPractices = [...practices].sort((a, b) => b.date.localeCompare(a.date));

  const latestGame = sortedGames[0] ?? null;
  const recentPractices = sortedPractices.slice(0, 3);

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

  const handleQuickSearch = (target: 'games' | 'practices') => {
    const q = quickQuery.trim();
    if (target === 'games') onSearchGames(q);
    else onSearchPractices(q);
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
            <span className="kpi-label">練習動画</span>
            <strong className="kpi-value">{practices.length}本</strong>
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
                if (e.key === 'Enter') handleQuickSearch('games');
              }}
              placeholder="対戦相手やタグ（#速攻など）で検索..."
            />
          </div>
        </div>
        <div className="quick-search-actions">
          <button
            type="button"
            className="btn-soft-sm"
            onClick={() => handleQuickSearch('games')}
          >
            <Trophy size={14} /> 試合から探す
          </button>
          <button
            type="button"
            className="btn-soft-sm"
            onClick={() => handleQuickSearch('practices')}
          >
            <Video size={14} /> 練習動画から探す
          </button>
        </div>
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

      {/* 新着の練習動画 */}
      <section className="portal-block">
        <div className="block-header">
          <h3 className="block-title">
            <Video size={17} className="accent-icon" />
            新着の練習動画
          </h3>
          <button
            type="button"
            className="link-more"
            onClick={() => onSearchPractices('')}
          >
            すべて見る <ChevronRight size={15} />
          </button>
        </div>

        {recentPractices.length === 0 ? (
          <div className="empty-box">まだ練習動画が登録されていません</div>
        ) : (
          <div className="practice-compact-list">
            {recentPractices.map((prac) => (
              <button
                key={prac.id}
                type="button"
                className="practice-compact-item"
                onClick={() => onOpenPractice(prac.id)}
              >
                <div className="practice-compact-main">
                  <div className="practice-compact-meta">
                    <span className="card-date">
                      <Calendar size={12} /> {prac.date}
                    </span>
                    <span className="moment-count">
                      見どころ {prac.moments.length}件
                    </span>
                  </div>
                  <div className="practice-compact-title">{prac.title}</div>
                  <div className="tag-row">
                    {prac.tags.map((tag) => (
                      <span key={tag} className="tag-pill">
                        <Tag size={10} /> {tag.replace(/^#/, '')}
                      </span>
                    ))}
                  </div>
                </div>
                <ChevronRight size={18} className="chevron-muted" />
              </button>
            ))}
          </div>
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
