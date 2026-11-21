import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Calendar,
  Play,
  Search,
  Tag,
  Video,
  X,
} from 'lucide-react';
import type { PracticeVideo } from '../types';
import { formatSeconds, getYouTubeThumbnail } from '../utils/youtube';
import { YouTubeEmbed } from './YouTubeEmbed';
import type { YouTubeEmbedHandle } from './YouTubeEmbed';

interface PracticesViewProps {
  practices: PracticeVideo[];
  practiceTags: string[];
  selectedPracticeId: string | null;
  onSelectPractice: (practiceId: string | null) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onUpdatePracticeUrl: (practiceId: string, youtubeUrl: string) => void;
}

export function PracticesView({
  practices,
  practiceTags,
  selectedPracticeId,
  onSelectPractice,
  searchQuery,
  onSearchQueryChange,
  onUpdatePracticeUrl,
}: PracticesViewProps) {
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const playerRef = useRef<YouTubeEmbedHandle | null>(null);

  const selectedPractice = useMemo(
    () => practices.find((p) => p.id === selectedPracticeId) ?? null,
    [practices, selectedPracticeId]
  );

  const allAvailableTags = useMemo(() => {
    const set = new Set<string>(practiceTags);
    practices.forEach((p) => p.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [practices, practiceTags]);

  const filteredPractices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...practices]
      .sort((a, b) =>
        sortOrder === 'desc'
          ? b.date.localeCompare(a.date)
          : a.date.localeCompare(b.date)
      )
      .filter((p) => {
        if (selectedTag !== 'ALL' && !p.tags.includes(selectedTag)) {
          return false;
        }
        if (!q) return true;
        return (
          p.title.toLowerCase().includes(q) ||
          p.date.includes(q) ||
          (p.memo || '').toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
        );
      });
  }, [practices, sortOrder, selectedTag, searchQuery]);

  if (!selectedPractice) {
    return (
      <div className="portal-section-stack">
        <div className="portal-card">
          <div className="search-sort-row">
            <div className="input-with-icon flex-1">
              <Search size={16} />
              <input
                type="text"
                className="portal-input"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="タイトル・日付・#タグで検索..."
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
            <button
              type="button"
              className="btn-sort"
              onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
            >
              <ArrowUpDown size={14} />
              {sortOrder === 'desc' ? '新しい順' : '古い順'}
            </button>
          </div>

          <div className="chip-scroll-row">
            <button
              type="button"
              className={`filter-chip ${selectedTag === 'ALL' ? 'is-active' : ''}`}
              onClick={() => setSelectedTag('ALL')}
            >
              すべて
            </button>
            {allAvailableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`filter-chip ${selectedTag === tag ? 'is-active' : ''}`}
                onClick={() => setSelectedTag((prev) => (prev === tag ? 'ALL' : tag))}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="list-count-bar">
          <span>練習動画一覧（{filteredPractices.length}件）</span>
        </div>

        {filteredPractices.length === 0 ? (
          <div className="empty-box">条件に一致する練習動画がありません</div>
        ) : (
          <div className="card-list">
            {filteredPractices.map((prac) => {
              const thumbUrl = getYouTubeThumbnail(prac.youtubeId);
              return (
                <button
                  key={prac.id}
                  type="button"
                  className="practice-card"
                  onClick={() => onSelectPractice(prac.id)}
                >
                  <div className="practice-thumb-box">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={prac.title}
                        className="practice-thumb-img"
                      />
                    ) : (
                      <div className="practice-thumb-demo">
                        <Play size={22} fill="currentColor" />
                      </div>
                    )}
                  </div>

                  <div className="practice-card-body">
                    <div className="practice-compact-meta">
                      <span className="card-date">
                        <Calendar size={12} /> {prac.date}
                      </span>
                      {prac.moments.length > 0 && (
                        <span className="moment-count">
                          見どころ {prac.moments.length}件
                        </span>
                      )}
                    </div>
                    <div className="practice-card-title">{prac.title}</div>
                    <div className="tag-row">
                      {prac.tags.map((tag) => (
                        <span key={tag} className="tag-pill">
                          <Tag size={10} /> {tag.replace(/^#/, '')}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="portal-section-stack">
      <div className="detail-top-bar">
        <button
          type="button"
          className="btn-back"
          onClick={() => onSelectPractice(null)}
        >
          <ArrowLeft size={16} /> 練習一覧
        </button>

        <span className="card-date">
          <Calendar size={13} /> {selectedPractice.date}
        </span>
      </div>

      {/* 上部：YouTube埋め込み再生 */}
      <section className="portal-card no-pad-top">
        <YouTubeEmbed
          videoId={selectedPractice.youtubeId}
          title={selectedPractice.title}
          subtitle={selectedPractice.date}
          playerRef={playerRef}
          onReplaceUrl={(url) => onUpdatePracticeUrl(selectedPractice.id, url)}
        />
      </section>

      {/* 詳細情報・見どころリスト */}
      <section className="portal-card">
        <h2 className="detail-main-title">{selectedPractice.title}</h2>

        <div className="tag-row detail-tags">
          {selectedPractice.tags.map((tag) => (
            <span key={tag} className="tag-pill">
              <Tag size={11} /> {tag.replace(/^#/, '')}
            </span>
          ))}
        </div>

        {selectedPractice.memo && (
          <div className="practice-memo-box">
            <div className="memo-label">
              <Video size={14} /> コーチ・マネージャーメモ
            </div>
            <p>{selectedPractice.memo}</p>
          </div>
        )}

        <div className="moments-section">
          <h3 className="moments-heading">
            見どころタイムスタンプ（タップで動画ジャンプ）
          </h3>
          {selectedPractice.moments.length === 0 ? (
            <div className="empty-box">見どころ時刻はまだ登録されていません</div>
          ) : (
            <div className="moment-list">
              {selectedPractice.moments.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="moment-item"
                  onClick={() => playerRef.current?.seekTo(m.timestampSec)}
                >
                  <span className="moment-time-badge">
                    <Play size={11} fill="currentColor" />
                    {formatSeconds(m.timestampSec)}
                  </span>
                  <span className="moment-label">{m.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
