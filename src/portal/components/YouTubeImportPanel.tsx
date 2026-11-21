import { useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Link2,
  ListVideo,
  PlaySquare,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { GameRecord, PortalData, PracticeVideo } from '../types';
import { requestYouTubeAccessToken } from '../firebase';
import {
  fetchMyYouTubePlaylists,
  fetchPlaylistsByIds,
  fetchPlaylistVideos,
  hasDedicatedYouTubeApiKey,
} from '../services/youtubeApi';
import type {
  YouTubePlaylistSummary,
  YouTubePlaylistVideoItem,
} from '../services/youtubeApi';
import {
  extractAllYouTubePlaylistIds,
  extractHashtagsFromText,
  extractYouTubePlaylistId,
  extractYouTubePlaylistIdsFromHtml,
  extractYouTubeVideoId,
  inferClipLabelFromTitle,
  inferDateFromText,
  inferOpponentFromTitle,
  inferPlaylistKind,
  parseTimeString,
} from '../utils/youtube';

interface YouTubeImportPanelProps {
  data: PortalData;
  onUpdateData: (updater: (prev: PortalData) => PortalData) => void;
  onNotify: (message: string, tone?: 'success' | 'info' | 'danger') => void;
  onSelectActiveGame: (gameId: string) => void;
}

const YT_TOKEN_STORAGE_KEY = 'portal_yt_access_token';
const YT_EMAIL_STORAGE_KEY = 'portal_yt_account_email';

function readSessionItem(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeSessionItem(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function clearSessionAuth(): void {
  try {
    window.sessionStorage.removeItem(YT_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(YT_EMAIL_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

let ytSeq = 0;

function createYtClientId(prefix: string): string {
  ytSeq += 1;
  return `${prefix}_${ytSeq}_${crypto.randomUUID().slice(0, 8)}`;
}

function getPrivacyLabel(status: string): string {
  switch (status) {
    case 'unlisted':
      return '限定公開';
    case 'private':
      return '非公開';
    default:
      return '公開';
  }
}

interface PlaylistChecklistBoxProps {
  items: YouTubePlaylistSummary[];
  selectedIds: string[];
  kindOverrides: Record<string, 'game' | 'practice'>;
  data: PortalData;
  importing: boolean;
  progressText: string;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleId: (id: string) => void;
  onChangeKind: (id: string, kind: 'game' | 'practice') => void;
  onImport: () => void;
  children?: React.ReactNode;
}

function PlaylistChecklistBox({
  items,
  selectedIds,
  kindOverrides,
  data,
  importing,
  progressText,
  onSelectAll,
  onClearSelection,
  onToggleId,
  onChangeKind,
  onImport,
  children,
}: PlaylistChecklistBoxProps) {
  return (
    <div className="demo-playlist-box">
      <div className="row-between">
        <span className="field-caption">
          取得した再生リスト（{selectedIds.length}/{items.length}件選択中）
        </span>
        <div className="yt-select-actions">
          <button type="button" className="link-more" onClick={onSelectAll}>
            全選択
          </button>
          <button type="button" className="link-more" onClick={onClearSelection}>
            解除
          </button>
        </div>
      </div>

      {items.map((pl) => {
        const checked = selectedIds.includes(pl.id);
        const kind = kindOverrides[pl.id] ?? inferPlaylistKind(pl.title);
        const isSynced =
          data.games.some((g) => g.youtubePlaylistId === pl.id) ||
          data.practices.some((p) => p.youtubePlaylistId === pl.id);

        return (
          <div key={pl.id} className="demo-playlist-item">
            <input
              type="checkbox"
              checked={checked}
              aria-label={`${pl.title}を選択`}
              onChange={() => onToggleId(pl.id)}
            />
            <div className="demo-pl-info">
              <div className="demo-pl-badges">
                <span className="yt-privacy-badge">
                  {getPrivacyLabel(pl.privacyStatus)}
                </span>
                {isSynced && <span className="yt-synced-badge">登録済み</span>}
                <span className="card-date">{pl.itemCount}本</span>
              </div>
              <strong>{pl.title}</strong>
              <div className="yt-kind-switch">
                <button
                  type="button"
                  className={`yt-kind-pill ${kind === 'game' ? 'is-active' : ''}`}
                  onClick={() => onChangeKind(pl.id, 'game')}
                >
                  試合として取込
                </button>
                <button
                  type="button"
                  className={`yt-kind-pill ${kind === 'practice' ? 'is-active' : ''}`}
                  onClick={() => onChangeKind(pl.id, 'practice')}
                >
                  練習として取込
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {children}

      <button
        type="button"
        className="btn-accent btn-block"
        disabled={importing || selectedIds.length === 0}
        onClick={onImport}
      >
        {importing
          ? progressText || '取り込み中...'
          : `選択した ${selectedIds.length} 件をまとめて取り込む`}
      </button>
    </div>
  );
}

export function YouTubeImportPanel({
  data,
  onUpdateData,
  onNotify,
  onSelectActiveGame,
}: YouTubeImportPanelProps) {
  // 1. YouTubeアカウント連携状態
  const [ytToken, setYtToken] = useState(() =>
    readSessionItem(YT_TOKEN_STORAGE_KEY)
  );
  const [ytAccountEmail, setYtAccountEmail] = useState(() =>
    readSessionItem(YT_EMAIL_STORAGE_KEY)
  );
  const [playlists, setPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [kindOverrides, setKindOverrides] = useState<
    Record<string, 'game' | 'practice'>
  >({});
  const [loadingSync, setLoadingSync] = useState(false);
  const [importingBatch, setImportingBatch] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [apiError, setApiError] = useState('');
  const [showApiGuide, setShowApiGuide] = useState(false);

  // 2. 再生リストURLまとめて一括取り込み（文章や表ごと貼り付けOK）
  const [bulkText, setBulkText] = useState('');
  const [bulkPlaylists, setBulkPlaylists] = useState<YouTubePlaylistSummary[]>([]);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkKindOverrides, setBulkKindOverrides] = useState<
    Record<string, 'game' | 'practice'>
  >({});
  const [bulkPracticeTags, setBulkPracticeTags] = useState<string[]>([]);
  const [loadingBulkFetch, setLoadingBulkFetch] = useState(false);
  const [importingBulk, setImportingBulk] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkError, setBulkError] = useState('');

  const detectedBulkIds = extractAllYouTubePlaylistIds(bulkText);

  // 3. 1本ずつURL登録
  const [singleKind, setSingleKind] = useState<'game' | 'practice'>('practice');
  const [singleTargetGameId, setSingleTargetGameId] = useState('__new__');
  const [singleClipLabel, setSingleClipLabel] = useState('1Q');
  const [singleUrlInput, setSingleUrlInput] = useState('');
  const [singleTitle, setSingleTitle] = useState('');
  const [singleDate, setSingleDate] = useState(
    () => new Date().toISOString().split('T')[0]
  );
  const [singleOpponent, setSingleOpponent] = useState('');
  const [singleSelectedTags, setSingleSelectedTags] = useState<string[]>(['#速攻']);
  const [singleMemo, setSingleMemo] = useState('');
  const [singleMomentTime, setSingleMomentTime] = useState('');
  const [singleMomentLabel, setSingleMomentLabel] = useState('');

  const buildSelectionDefaults = (items: YouTubePlaylistSummary[]) => {
    const nextKinds: Record<string, 'game' | 'practice'> = {};
    const unregisteredIds: string[] = [];

    items.forEach((pl) => {
      nextKinds[pl.id] = inferPlaylistKind(pl.title);
      const alreadyExists =
        data.games.some((g) => g.youtubePlaylistId === pl.id) ||
        data.practices.some((p) => p.youtubePlaylistId === pl.id);
      if (!alreadyExists) {
        unregisteredIds.push(pl.id);
      }
    });

    return {
      nextKinds,
      initialSelected:
        unregisteredIds.length > 0 ? unregisteredIds : items.map((i) => i.id),
    };
  };

  const applyFetchedPlaylists = (items: YouTubePlaylistSummary[]) => {
    const { nextKinds, initialSelected } = buildSelectionDefaults(items);
    setPlaylists(items);
    setKindOverrides(nextKinds);
    setSelectedIds(initialSelected);
  };

  const ensureYouTubeAccessToken = async (
    forceRefresh = false
  ): Promise<string> => {
    const cached = forceRefresh
      ? ''
      : ytToken || readSessionItem(YT_TOKEN_STORAGE_KEY);
    if (cached) {
      if (!ytToken) setYtToken(cached);
      return cached;
    }
    const { accessToken, accountEmail } = await requestYouTubeAccessToken();
    setYtToken(accessToken);
    setYtAccountEmail(accountEmail);
    writeSessionItem(YT_TOKEN_STORAGE_KEY, accessToken);
    writeSessionItem(YT_EMAIL_STORAGE_KEY, accountEmail);
    return accessToken;
  };

  const handleConnectYouTubeAccount = async () => {
    setLoadingSync(true);
    setApiError('');
    try {
      const accessToken = await ensureYouTubeAccessToken(true);
      const list = await fetchMyYouTubePlaylists(accessToken);
      applyFetchedPlaylists(list);
      if (list.length === 0) {
        onNotify('このYouTubeアカウントに再生リストが見つかりませんでした', 'info');
      } else {
        onNotify(`再生リスト ${list.length}件を読み込みました`, 'success');
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'YouTube連携に失敗しました。';
      setApiError(msg);
      if (msg.includes('YouTube Data API v3')) {
        setShowApiGuide(true);
      }
    } finally {
      setLoadingSync(false);
    }
  };

  const handleReloadMyPlaylists = async () => {
    if (!ytToken) {
      await handleConnectYouTubeAccount();
      return;
    }
    setLoadingSync(true);
    setApiError('');
    try {
      const list = await fetchMyYouTubePlaylists(ytToken);
      applyFetchedPlaylists(list);
      onNotify(`再生リスト ${list.length}件を再読み込みしました`, 'success');
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : '再生リストの再読み込みに失敗しました。';
      if (msg.includes('有効期限が切れました')) {
        clearSessionAuth();
        setYtToken('');
      }
      setApiError(msg);
    } finally {
      setLoadingSync(false);
    }
  };

  const mergeFetchedPlaylistsIntoPortal = (
    bundles: Array<{
      playlist: YouTubePlaylistSummary;
      kind: 'game' | 'practice';
      videos: YouTubePlaylistVideoItem[];
      opponentOverride?: string;
      tagsOverride?: string[];
    }>
  ) => {
    let addedGames = 0;
    let updatedGames = 0;
    let addedPractices = 0;
    let latestGameId = '';

    onUpdateData((prev) => {
      const nextGames = [...prev.games];
      const nextPractices = [...prev.practices];

      bundles.forEach(({ playlist, kind, videos, opponentOverride, tagsOverride }) => {
        if (videos.length === 0) return;

        if (kind === 'game') {
          const existingIdx = nextGames.findIndex(
            (g) => g.youtubePlaylistId === playlist.id
          );

          if (existingIdx !== -1) {
            const existing = nextGames[existingIdx];
            const existingVideoIds = new Set(existing.videos.map((v) => v.youtubeId));
            const newClips = videos
              .filter((v) => !existingVideoIds.has(v.videoId))
              .map((v, idx) => ({
                id: createYtClientId('clip'),
                label: inferClipLabelFromTitle(
                  v.title,
                  existing.videos.length + idx,
                  existing.videos.length + videos.length
                ),
                youtubeId: v.videoId,
                youtubeUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
              }));

            if (newClips.length > 0) {
              nextGames[existingIdx] = {
                ...existing,
                videos: [...existing.videos, ...newClips],
              };
              updatedGames += 1;
            }
            latestGameId = existing.id;
          } else {
            const gameId = createYtClientId('game');
            const newGame: GameRecord = {
              id: gameId,
              title: playlist.title,
              date: inferDateFromText(
                `${playlist.title} ${playlist.description}`,
                playlist.publishedAt
              ),
              opponent:
                opponentOverride?.trim() || inferOpponentFromTitle(playlist.title),
              category: '練習試合',
              homeScore: 0,
              awayScore: 0,
              youtubePlaylistId: playlist.id,
              notes: playlist.description ? playlist.description.slice(0, 180) : undefined,
              videos: videos.map((v, idx) => ({
                id: createYtClientId('clip'),
                label: inferClipLabelFromTitle(v.title, idx, videos.length),
                youtubeId: v.videoId,
                youtubeUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
              })),
              events: [],
            };
            nextGames.unshift(newGame);
            addedGames += 1;
            latestGameId = gameId;
          }
        } else {
          const existingVideoIds = new Set(nextPractices.map((p) => p.youtubeId));
          const fallbackTag = prev.practiceTags[0] || '#速攻';

          videos.forEach((v) => {
            if (existingVideoIds.has(v.videoId)) return;
            existingVideoIds.add(v.videoId);

            const autoTags = extractHashtagsFromText(
              `${playlist.title} ${v.title} ${v.description}`,
              prev.practiceTags
            );
            const finalTags =
              tagsOverride && tagsOverride.length > 0
                ? Array.from(new Set([...tagsOverride, ...autoTags]))
                : autoTags.length > 0
                  ? autoTags
                  : [fallbackTag];

            const newPractice: PracticeVideo = {
              id: createYtClientId('prac'),
              title: v.title,
              date: inferDateFromText(
                `${v.title} ${playlist.title}`,
                v.publishedAt || playlist.publishedAt
              ),
              youtubeId: v.videoId,
              youtubeUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
              youtubePlaylistId: playlist.id,
              tags: finalTags,
              memo: v.description
                ? v.description.slice(0, 180)
                : `${playlist.title} から取り込み`,
              moments: [],
            };
            nextPractices.unshift(newPractice);
            addedPractices += 1;
          });
        }
      });

      return {
        ...prev,
        games: nextGames,
        practices: nextPractices,
      };
    });

    if (latestGameId) {
      onSelectActiveGame(latestGameId);
    }

    if (addedGames === 0 && updatedGames === 0 && addedPractices === 0) {
      onNotify('新しい動画はありませんでした（すべて取り込み済みです）', 'info');
    } else {
      const parts: string[] = [];
      if (addedGames > 0) parts.push(`試合 ${addedGames}件追加`);
      if (updatedGames > 0) parts.push(`試合 ${updatedGames}件更新`);
      if (addedPractices > 0) parts.push(`練習 ${addedPractices}本追加`);
      onNotify(`取り込み完了：${parts.join(' / ')}`, 'success');
    }
  };

  const runWithBulkTokenRetry = async <T,>(
    fn: (token: string | undefined) => Promise<T>
  ): Promise<T> => {
    let tokenToUse: string | undefined =
      ytToken || readSessionItem(YT_TOKEN_STORAGE_KEY) || undefined;
    if (!tokenToUse && !hasDedicatedYouTubeApiKey) {
      tokenToUse = await ensureYouTubeAccessToken();
    }

    try {
      return await fn(tokenToUse);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (tokenToUse && msg.includes('有効期限が切れました')) {
        clearSessionAuth();
        setYtToken('');
        const freshToken = await ensureYouTubeAccessToken(true);
        return await fn(freshToken);
      }
      throw err;
    }
  };

  const importPlaylistSelection = async (options: {
    targets: YouTubePlaylistSummary[];
    overrides: Record<string, 'game' | 'practice'>;
    practiceTagsOverride?: string[];
    setImporting: (val: boolean) => void;
    setProgress: (val: string) => void;
    setError: (val: string) => void;
    onDone?: () => void;
  }) => {
    const {
      targets,
      overrides,
      practiceTagsOverride,
      setImporting,
      setProgress,
      setError,
      onDone,
    } = options;

    if (targets.length === 0) {
      onNotify('取り込む再生リストを1つ以上選んでください', 'danger');
      return;
    }

    setImporting(true);
    setError('');
    try {
      let tokenToUse: string | undefined =
        ytToken || readSessionItem(YT_TOKEN_STORAGE_KEY) || undefined;
      if (!tokenToUse && !hasDedicatedYouTubeApiKey) {
        tokenToUse = await ensureYouTubeAccessToken();
      }

      const bundles: Array<{
        playlist: YouTubePlaylistSummary;
        kind: 'game' | 'practice';
        videos: YouTubePlaylistVideoItem[];
        tagsOverride?: string[];
      }> = [];
      let skippedCount = 0;

      for (let i = 0; i < targets.length; i += 1) {
        const pl = targets[i];
        setProgress(`動画を取得中... (${i + 1}/${targets.length})`);

        let videos: YouTubePlaylistVideoItem[] = [];
        try {
          videos = await fetchPlaylistVideos(pl.id, tokenToUse);
        } catch (vidErr: unknown) {
          const vidMsg = vidErr instanceof Error ? vidErr.message : '';
          if (tokenToUse && vidMsg.includes('有効期限が切れました')) {
            clearSessionAuth();
            setYtToken('');
            tokenToUse = await ensureYouTubeAccessToken(true);
            videos = await fetchPlaylistVideos(pl.id, tokenToUse);
          } else if (
            vidMsg.includes('非公開') ||
            vidMsg.includes('見つかりませんでした')
          ) {
            skippedCount += 1;
            continue;
          } else {
            throw vidErr;
          }
        }

        const kind = overrides[pl.id] ?? inferPlaylistKind(pl.title);
        bundles.push({
          playlist: pl,
          kind,
          videos,
          tagsOverride:
            kind === 'practice' &&
            practiceTagsOverride &&
            practiceTagsOverride.length > 0
              ? practiceTagsOverride
              : undefined,
        });
      }

      if (bundles.length > 0) {
        mergeFetchedPlaylistsIntoPortal(bundles);
      }
      if (skippedCount > 0) {
        onNotify(
          `${skippedCount}件の再生リストは非公開または取得不可のためスキップしました`,
          'info'
        );
      }
      onDone?.();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : '再生リストの取り込みに失敗しました。';
      setError(msg);
      if (msg.includes('YouTube Data API v3')) {
        setShowApiGuide(true);
      }
    } finally {
      setImporting(false);
      setProgress('');
    }
  };

  const handleBatchImportSelected = async () => {
    const targets = playlists.filter((pl) => selectedIds.includes(pl.id));
    await importPlaylistSelection({
      targets,
      overrides: kindOverrides,
      setImporting: setImportingBatch,
      setProgress: setImportProgress,
      setError: setApiError,
    });
  };

  const handleBulkPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    if (!html) return;

    const plainIds = extractAllYouTubePlaylistIds(plain);
    const htmlIds = extractYouTubePlaylistIdsFromHtml(html);
    const plainSet = new Set(plainIds);
    const hasExtraInHtml = htmlIds.some((id) => !plainSet.has(id));
    if (!hasExtraInHtml) return;

    e.preventDefault();
    const existingSet = new Set(extractAllYouTubePlaylistIds(bulkText));
    const combinedIds = Array.from(new Set([...plainIds, ...htmlIds]));
    const newIds = combinedIds.filter((id) => !existingSet.has(id));

    if (newIds.length === 0) {
      onNotify('すでに欄内に入力済みの再生リストです', 'info');
      return;
    }

    const newLines = newIds.map(
      (id) => `https://www.youtube.com/playlist?list=${id}`
    );
    setBulkText((prev) =>
      prev.trim()
        ? `${prev.trimEnd()}\n${newLines.join('\n')}`
        : newLines.join('\n')
    );
    onNotify(`${newIds.length}件の再生リストURLを自動抽出しました`, 'success');
  };

  const handleLoadBulkPlaylists = async (e: React.FormEvent) => {
    e.preventDefault();
    if (detectedBulkIds.length === 0) {
      onNotify(
        '再生リストのURLまたは再生リストを含む文章を貼り付けてください',
        'danger'
      );
      return;
    }

    setLoadingBulkFetch(true);
    setBulkError('');
    try {
      const found = await runWithBulkTokenRetry((token) =>
        fetchPlaylistsByIds(detectedBulkIds, token)
      );
      if (found.length === 0) {
        setBulkPlaylists([]);
        setBulkSelectedIds([]);
        setBulkError(
          '再生リストを読み込めませんでした。URLが正しいか、「限定公開」または「公開」設定になっているかご確認ください。'
        );
        return;
      }

      const { nextKinds, initialSelected } = buildSelectionDefaults(found);
      setBulkPlaylists(found);
      setBulkKindOverrides(nextKinds);
      setBulkSelectedIds(initialSelected);

      if (found.length < detectedBulkIds.length) {
        const skipped = detectedBulkIds.length - found.length;
        onNotify(
          `${found.length}件の再生リストを読み込みました（非公開・無効 ${skipped}件をスキップ）`,
          'info'
        );
      } else {
        onNotify(`${found.length}件の再生リストを読み込みました`, 'success');
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : '再生リストの読み込みに失敗しました。';
      setBulkError(msg);
      if (msg.includes('YouTube Data API v3')) {
        setShowApiGuide(true);
      }
    } finally {
      setLoadingBulkFetch(false);
    }
  };

  const handleImportSelectedBulkPlaylists = async () => {
    const targets = bulkPlaylists.filter((pl) => bulkSelectedIds.includes(pl.id));
    await importPlaylistSelection({
      targets,
      overrides: bulkKindOverrides,
      practiceTagsOverride: bulkPracticeTags,
      setImporting: setImportingBulk,
      setProgress: setBulkProgress,
      setError: setBulkError,
      onDone: () => {
        setBulkText('');
        setBulkPlaylists([]);
        setBulkSelectedIds([]);
        setBulkError('');
      },
    });
  };

  const handleClearBulk = () => {
    setBulkText('');
    setBulkPlaylists([]);
    setBulkSelectedIds([]);
    setBulkError('');
  };

  const handleAddSingleUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const videoId = extractYouTubeVideoId(singleUrlInput);
    const playlistId = extractYouTubePlaylistId(singleUrlInput);

    if (!videoId && !playlistId) {
      onNotify('有効なYouTube URLを入力してください', 'danger');
      return;
    }

    if (singleKind === 'game') {
      if (singleTargetGameId !== '__new__') {
        const targetExists = data.games.some((g) => g.id === singleTargetGameId);
        if (targetExists && videoId) {
          onUpdateData((prev) => ({
            ...prev,
            games: prev.games.map((g) => {
              if (g.id !== singleTargetGameId) return g;
              return {
                ...g,
                videos: [
                  ...g.videos,
                  {
                    id: createYtClientId('clip'),
                    label: singleClipLabel.trim() || `動画${g.videos.length + 1}`,
                    youtubeId: videoId,
                    youtubeUrl: singleUrlInput.trim(),
                  },
                ],
              };
            }),
          }));
          onSelectActiveGame(singleTargetGameId);
          onNotify('既存の試合に動画を追加しました', 'success');
          setSingleUrlInput('');
          return;
        }
      }

      const opp = singleOpponent.trim() || '対戦相手';
      const title = singleTitle.trim() || `vs ${opp}`;
      const newGameId = createYtClientId('game');
      const newGame: GameRecord = {
        id: newGameId,
        title,
        date: singleDate,
        opponent: opp,
        category: '練習試合',
        homeScore: 0,
        awayScore: 0,
        youtubePlaylistId: playlistId || undefined,
        videos: [
          {
            id: createYtClientId('clip'),
            label: singleClipLabel.trim() || '試合動画',
            youtubeId: videoId || `demo_${newGameId}`,
            youtubeUrl: singleUrlInput.trim(),
          },
        ],
        events: [],
      };
      onUpdateData((prev) => ({
        ...prev,
        games: [newGame, ...prev.games],
      }));
      onSelectActiveGame(newGame.id);
      onNotify('YouTube試合動画を追加しました', 'success');
    } else {
      if (!videoId) {
        onNotify('練習動画のURL（1本の動画リンク）を入力してください', 'danger');
        return;
      }
      const momentSec = singleMomentTime.trim()
        ? parseTimeString(singleMomentTime)
        : 0;
      const newPractice: PracticeVideo = {
        id: createYtClientId('prac'),
        title: singleTitle.trim() || `練習動画 (${singleDate})`,
        date: singleDate,
        youtubeId: videoId,
        youtubeUrl: singleUrlInput.trim(),
        youtubePlaylistId: playlistId || undefined,
        tags:
          singleSelectedTags.length > 0 ? singleSelectedTags : ['#速攻'],
        memo: singleMemo.trim() || undefined,
        moments: singleMomentLabel.trim()
          ? [
              {
                id: createYtClientId('pm'),
                timestampSec: momentSec,
                label: singleMomentLabel.trim(),
              },
            ]
          : [],
      };
      onUpdateData((prev) => ({
        ...prev,
        practices: [newPractice, ...prev.practices],
      }));
      onNotify('練習動画を追加しました', 'success');
    }

    setSingleUrlInput('');
    setSingleTitle('');
    setSingleOpponent('');
    setSingleMemo('');
    setSingleMomentTime('');
    setSingleMomentLabel('');
  };

  return (
    <div className="portal-section-stack">
      {/* ================================================= */}
      {/* ① YouTubeアカウント連携（全再生リスト一括取り込み） */}
      {/* ================================================= */}
      <section className="portal-card">
        <div className="block-title-row">
          <PlaySquare size={18} className="accent-icon" />
          <h3>部活YouTubeから再生リスト一括取り込み</h3>
        </div>
        <p className="table-helper-text">
          部活のYouTubeアカウントを連携すると、試合ごとに分けている再生リストと中の動画（1Q〜4Qなど）をまとめて取り込めます。
        </p>

        {!ytToken ? (
          <button
            type="button"
            className="btn-accent btn-block"
            disabled={loadingSync}
            onClick={() => void handleConnectYouTubeAccount()}
          >
            <ListVideo size={17} />
            {loadingSync
              ? 'YouTubeに接続中...'
              : '部活のYouTubeアカウントを連携して取得'}
          </button>
        ) : (
          <div className="yt-connected-bar">
            <div className="yt-connected-info">
              <span className="yt-connected-badge">連携済み</span>
              <span className="yt-connected-email">
                {ytAccountEmail || 'YouTubeアカウント'}
              </span>
            </div>
            <div className="yt-connected-actions">
              <button
                type="button"
                className="btn-soft-sm"
                disabled={loadingSync}
                onClick={() => void handleReloadMyPlaylists()}
              >
                <RefreshCw size={13} /> 再読込
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={loadingSync}
                onClick={() => void handleConnectYouTubeAccount()}
              >
                変更
              </button>
            </div>
          </div>
        )}

        {apiError && (
          <div className="portal-auth-error">
            <AlertCircle size={16} />
            <span>{apiError}</span>
          </div>
        )}

        <div>
          <button
            type="button"
            className="yt-guide-toggle"
            onClick={() => setShowApiGuide((v) => !v)}
          >
            <span>初回のみ：YouTube Data API v3 の有効化手順</span>
            {showApiGuide ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showApiGuide && (
            <ol className="yt-guide-steps">
              <li>
                Firebase画面の「プロジェクトの設定」右上にある「Google Cloud で表示」を開きます。
              </li>
              <li>
                上の検索欄で「YouTube Data API v3」を検索して開き、青い「有効にする」を押します。
              </li>
              <li>
                連携時に「Googleで確認されていません」が出た場合は、Google Cloudの「APIとサービス → OAuth同意画面 → 対象（テストユーザー）」に部活のYouTubeアドレスを追加します。
              </li>
            </ol>
          )}
        </div>

        {playlists.length > 0 && (
          <PlaylistChecklistBox
            items={playlists}
            selectedIds={selectedIds}
            kindOverrides={kindOverrides}
            data={data}
            importing={importingBatch}
            progressText={importProgress}
            onSelectAll={() => setSelectedIds(playlists.map((p) => p.id))}
            onClearSelection={() => setSelectedIds([])}
            onToggleId={(id) =>
              setSelectedIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id]
              )
            }
            onChangeKind={(id, kind) =>
              setKindOverrides((prev) => ({ ...prev, [id]: kind }))
            }
            onImport={() => void handleBatchImportSelected()}
          />
        )}
      </section>

      {/* ================================================= */}
      {/* ② 再生リストURLをまとめて一括取り込み             */}
      {/* ================================================= */}
      <section className="portal-card">
        <div className="block-title-row">
          <ListVideo size={18} className="accent-icon" />
          <h3>再生リストURLをまとめて一括取り込み</h3>
        </div>
        <p className="table-helper-text">
          LINEのノート・トークやスプレッドシート・メモなどの文章ごとまとめて貼り付けるだけで、中の再生リストURLを全部自動で抜き出して一括取り込みできます（限定公開・公開に対応／1本〜何十本でもOK）。
        </p>

        <form onSubmit={(e) => void handleLoadBulkPlaylists(e)} className="portal-auth-form">
          <label className="field-label">
            <span>再生リストURL（まとめて何行でもOK） *</span>
            <textarea
              className="portal-textarea"
              rows={4}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              onPaste={handleBulkPaste}
              placeholder={
                'ここに再生リストURLをまとめて貼り付け（文章が混ざっていてもOK）\nhttps://www.youtube.com/playlist?list=...'
              }
            />
          </label>

          <div className="yt-bulk-detect-row">
            <span
              className={`yt-detect-badge ${
                detectedBulkIds.length > 0 ? 'is-found' : ''
              }`}
            >
              検出した再生リスト：{detectedBulkIds.length}件
            </span>
            {(bulkText || bulkPlaylists.length > 0) && (
              <button
                type="button"
                className="link-more"
                onClick={handleClearBulk}
              >
                クリア
              </button>
            )}
          </div>

          <button
            type="submit"
            className="btn-accent btn-block"
            disabled={loadingBulkFetch || detectedBulkIds.length === 0}
          >
            <ListVideo size={17} />
            {loadingBulkFetch
              ? '再生リストを読み込み中...'
              : detectedBulkIds.length > 0
                ? `検出した ${detectedBulkIds.length} 件のリストを読み込む`
                : '再生リストを読み込む'}
          </button>
        </form>

        {bulkError && (
          <div className="portal-auth-error">
            <AlertCircle size={16} />
            <span>{bulkError}</span>
          </div>
        )}

        {bulkPlaylists.length > 0 && (
          <PlaylistChecklistBox
            items={bulkPlaylists}
            selectedIds={bulkSelectedIds}
            kindOverrides={bulkKindOverrides}
            data={data}
            importing={importingBulk}
            progressText={bulkProgress}
            onSelectAll={() =>
              setBulkSelectedIds(bulkPlaylists.map((p) => p.id))
            }
            onClearSelection={() => setBulkSelectedIds([])}
            onToggleId={(id) =>
              setBulkSelectedIds((prev) =>
                prev.includes(id)
                  ? prev.filter((item) => item !== id)
                  : [...prev, id]
              )
            }
            onChangeKind={(id, kind) =>
              setBulkKindOverrides((prev) => ({ ...prev, [id]: kind }))
            }
            onImport={() => void handleImportSelectedBulkPlaylists()}
          >
            {bulkPlaylists.some(
              (pl) =>
                bulkSelectedIds.includes(pl.id) &&
                (bulkKindOverrides[pl.id] ?? inferPlaylistKind(pl.title)) ===
                  'practice'
            ) && (
              <div className="field-label">
                <span>練習に付けるタグ（任意）</span>
                <div className="chip-wrap">
                  {data.practiceTags.map((tag) => {
                    const active = bulkPracticeTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`filter-chip ${active ? 'is-active' : ''}`}
                        onClick={() =>
                          setBulkPracticeTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag]
                          )
                        }
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </PlaylistChecklistBox>
        )}
      </section>

      {/* ================================================= */}
      {/* ③ 動画URLを1本ずつ登録（設定不要ですぐ使える）      */}
      {/* ================================================= */}
      <section className="portal-card">
        <div className="block-title-row">
          <Link2 size={18} className="accent-icon" />
          <h3>動画URLを1本ずつ登録</h3>
        </div>

        <div className="subtab-bar">
          <button
            type="button"
            className={`subtab-btn ${singleKind === 'practice' ? 'is-active' : ''}`}
            onClick={() => setSingleKind('practice')}
          >
            練習動画として登録
          </button>
          <button
            type="button"
            className={`subtab-btn ${singleKind === 'game' ? 'is-active' : ''}`}
            onClick={() => setSingleKind('game')}
          >
            試合動画として登録
          </button>
        </div>

        <form onSubmit={handleAddSingleUrl} className="portal-auth-form">
          <label className="field-label">
            <span>YouTube URL *</span>
            <input
              type="url"
              className="portal-input"
              value={singleUrlInput}
              onChange={(e) => setSingleUrlInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>

          {singleKind === 'game' && (
            <>
              <label className="field-label">
                <span>登録先の試合</span>
                <select
                  className="portal-select"
                  value={singleTargetGameId}
                  onChange={(e) => setSingleTargetGameId(e.target.value)}
                >
                  <option value="__new__">＋ 新しい試合として登録</option>
                  {data.games.map((g) => (
                    <option key={g.id} value={g.id}>
                      既存の試合に追加：{g.date} vs {g.opponent}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-label">
                <span>動画ラベル（例：1Q, 2Q, 前半, 試合動画）</span>
                <input
                  type="text"
                  className="portal-input"
                  value={singleClipLabel}
                  onChange={(e) => setSingleClipLabel(e.target.value)}
                  placeholder="1Q"
                />
              </label>
            </>
          )}

          {(singleKind === 'practice' || singleTargetGameId === '__new__') && (
            <>
              <div className="two-col-row">
                <label className="field-label">
                  <span>日付</span>
                  <input
                    type="date"
                    className="portal-input"
                    value={singleDate}
                    onChange={(e) => setSingleDate(e.target.value)}
                  />
                </label>

                {singleKind === 'game' && (
                  <label className="field-label">
                    <span>対戦相手</span>
                    <input
                      type="text"
                      className="portal-input"
                      value={singleOpponent}
                      onChange={(e) => setSingleOpponent(e.target.value)}
                      placeholder="例：城北高校"
                    />
                  </label>
                )}
              </div>

              <label className="field-label">
                <span>タイトル</span>
                <input
                  type="text"
                  className="portal-input"
                  value={singleTitle}
                  onChange={(e) => setSingleTitle(e.target.value)}
                  placeholder={
                    singleKind === 'game'
                      ? '例：練習試合 1本目'
                      : '例：ゾーンプレス対策ドリル'
                  }
                />
              </label>
            </>
          )}

          {singleKind === 'practice' && (
            <>
              <div className="field-label">
                <span>タグ（タップで選択）</span>
                <div className="chip-wrap">
                  {data.practiceTags.map((tag) => {
                    const active = singleSelectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`filter-chip ${active ? 'is-active' : ''}`}
                        onClick={() =>
                          setSingleSelectedTags((prev) =>
                            prev.includes(tag)
                              ? prev.filter((t) => t !== tag)
                              : [...prev, tag]
                          )
                        }
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="field-label">
                <span>メモ（任意）</span>
                <input
                  type="text"
                  className="portal-input"
                  value={singleMemo}
                  onChange={(e) => setSingleMemo(e.target.value)}
                  placeholder="意識すべきポイントなど"
                />
              </label>

              <div className="two-col-row">
                <label className="field-label">
                  <span>見どころ時刻（例 01:25）</span>
                  <input
                    type="text"
                    className="portal-input"
                    value={singleMomentTime}
                    onChange={(e) => setSingleMomentTime(e.target.value)}
                    placeholder="01:25"
                  />
                </label>
                <label className="field-label">
                  <span>見どころ内容</span>
                  <input
                    type="text"
                    className="portal-input"
                    value={singleMomentLabel}
                    onChange={(e) => setSingleMomentLabel(e.target.value)}
                    placeholder="例：ナイス合わせ"
                  />
                </label>
              </div>
            </>
          )}

          <button type="submit" className="btn-accent btn-block">
            <Plus size={17} /> 登録する
          </button>
        </form>
      </section>
    </div>
  );
}
