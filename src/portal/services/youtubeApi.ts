import { firebaseApiKey } from '../firebase';

export interface YouTubePlaylistSummary {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  itemCount: number;
  thumbnailUrl: string | null;
  privacyStatus: string;
}

export interface YouTubePlaylistVideoItem {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  position: number;
  thumbnailUrl: string | null;
}

interface RawPlaylistItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: {
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  contentDetails?: {
    itemCount?: number;
  };
  status?: {
    privacyStatus?: string;
  };
}

interface RawPlaylistVideoItem {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    position?: number;
    resourceId?: {
      videoId?: string;
    };
    thumbnails?: {
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  contentDetails?: {
    videoId?: string;
    videoPublishedAt?: string;
  };
}

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
const dedicatedYouTubeApiKey = (import.meta.env.VITE_YOUTUBE_API_KEY || '').trim();
export const hasDedicatedYouTubeApiKey = Boolean(dedicatedYouTubeApiKey);

function buildYouTubeError(status: number, bodyText: string): Error {
  const lower = bodyText.toLowerCase();

  if (
    lower.includes('accessnotconfigured') ||
    lower.includes('has not been used') ||
    lower.includes('service_disabled')
  ) {
    return new Error(
      'Google Cloud で「YouTube Data API v3」がまだ有効になっていません。Google Cloud Console で有効化してからもう一度お試しください。'
    );
  }
  if (
    lower.includes('api_key_service_blocked') ||
    lower.includes('are blocked')
  ) {
    return new Error(
      'Firebase用キーの制限によりYouTube取得がブロックされました。Google認証（YouTube参照の許可）を通して再取得してください。'
    );
  }
  if (status === 401) {
    return new Error(
      'YouTube認証の有効期限が切れました。もう一度読み込みをお試しください。'
    );
  }
  if (status === 404 || lower.includes('playlistnotfound')) {
    return new Error(
      '再生リストが見つかりませんでした。URLが正しいか、「限定公開」または「公開」設定になっているか確認してください。'
    );
  }
  if (status === 403) {
    if (lower.includes('playlistforbidden')) {
      return new Error(
        '非公開の再生リストは読み込めません（「限定公開」または「公開」に設定されているかご確認ください）。'
      );
    }
    return new Error(
      'YouTubeデータの取得権限がありません。YouTube Data API v3 の有効化またはアカウント権限をご確認ください。'
    );
  }

  return new Error(`YouTube情報の取得に失敗しました (HTTP ${status})`);
}

async function fetchYouTubeJson<T>(
  url: string,
  accessToken?: string
): Promise<T> {
  const headers: Record<string, string> = {};
  let finalUrl = url;

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else {
    const apiKey = dedicatedYouTubeApiKey || firebaseApiKey;
    if (!apiKey) {
      throw new Error('YouTube API用の設定キーが見つかりません。');
    }
    const sep = url.includes('?') ? '&' : '?';
    finalUrl = `${url}${sep}key=${encodeURIComponent(apiKey)}`;
  }

  const res = await fetch(finalUrl, { headers });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw buildYouTubeError(res.status, bodyText);
  }
  return (await res.json()) as T;
}

function mapPlaylistSummary(raw: RawPlaylistItem): YouTubePlaylistSummary {
  const thumb =
    raw.snippet?.thumbnails?.medium?.url ??
    raw.snippet?.thumbnails?.default?.url ??
    null;
  return {
    id: raw.id || '',
    title: raw.snippet?.title || '名称未設定の再生リスト',
    description: raw.snippet?.description || '',
    publishedAt: raw.snippet?.publishedAt || '',
    itemCount: raw.contentDetails?.itemCount ?? 0,
    thumbnailUrl: thumb,
    privacyStatus: raw.status?.privacyStatus || 'public',
  };
}

export async function fetchMyYouTubePlaylists(
  accessToken: string
): Promise<YouTubePlaylistSummary[]> {
  const results: YouTubePlaylistSummary[] = [];
  let pageToken = '';

  for (let page = 0; page < 4; page += 1) {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `${YT_API_BASE}/playlists?part=snippet,contentDetails,status&mine=true&maxResults=50${tokenParam}`;
    const json = await fetchYouTubeJson<{
      items?: RawPlaylistItem[];
      nextPageToken?: string;
    }>(url, accessToken);

    (json.items ?? []).forEach((item) => {
      if (item.id) {
        results.push(mapPlaylistSummary(item));
      }
    });

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }

  return results;
}

export async function fetchPlaylistById(
  playlistId: string,
  accessToken?: string
): Promise<YouTubePlaylistSummary> {
  const url = `${YT_API_BASE}/playlists?part=snippet,contentDetails,status&id=${encodeURIComponent(
    playlistId
  )}`;
  const json = await fetchYouTubeJson<{ items?: RawPlaylistItem[] }>(
    url,
    accessToken
  );
  const first = json.items?.[0];
  if (!first || !first.id) {
    throw new Error(
      '再生リストが見つかりませんでした。URLが正しいか、公開設定（公開または限定公開）をご確認ください。'
    );
  }
  return mapPlaylistSummary(first);
}

export async function fetchPlaylistsByIds(
  playlistIds: string[],
  accessToken?: string
): Promise<YouTubePlaylistSummary[]> {
  const uniqueIds = Array.from(
    new Set(playlistIds.map((id) => id.trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) return [];

  const byId = new Map<string, YouTubePlaylistSummary>();

  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const idParam = chunk.map((id) => encodeURIComponent(id)).join(',');
    const url = `${YT_API_BASE}/playlists?part=snippet,contentDetails,status&id=${idParam}`;
    const json = await fetchYouTubeJson<{ items?: RawPlaylistItem[] }>(
      url,
      accessToken
    );

    (json.items ?? []).forEach((item) => {
      if (item.id) {
        byId.set(item.id, mapPlaylistSummary(item));
      }
    });
  }

  return uniqueIds
    .map((id) => byId.get(id))
    .filter((pl): pl is YouTubePlaylistSummary => Boolean(pl));
}

export interface FetchPlaylistVideosOptions {
  maxPages?: number;
  shouldStopAfterPage?: (
    pageItems: YouTubePlaylistVideoItem[],
    allItemsSoFar: YouTubePlaylistVideoItem[],
    pageIndex: number
  ) => boolean;
  onPageFetched?: (info: {
    pageIndex: number;
    fetchedCount: number;
    hasMore: boolean;
  }) => void;
}

export async function fetchPlaylistVideos(
  playlistId: string,
  accessToken?: string,
  options?: FetchPlaylistVideosOptions
): Promise<YouTubePlaylistVideoItem[]> {
  const items: YouTubePlaylistVideoItem[] = [];
  const maxPages = Math.max(1, options?.maxPages ?? 4);
  let pageToken = '';

  for (let page = 0; page < maxPages; page += 1) {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `${YT_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(
      playlistId
    )}&maxResults=50${tokenParam}`;
    const json = await fetchYouTubeJson<{
      items?: RawPlaylistVideoItem[];
      nextPageToken?: string;
    }>(url, accessToken);

    const pageItems: YouTubePlaylistVideoItem[] = [];
    (json.items ?? []).forEach((raw) => {
      const videoId =
        raw.contentDetails?.videoId ?? raw.snippet?.resourceId?.videoId ?? '';
      const title = raw.snippet?.title ?? '';
      if (!videoId || title === 'Deleted video' || title === 'Private video') {
        return;
      }
      const thumb =
        raw.snippet?.thumbnails?.medium?.url ??
        raw.snippet?.thumbnails?.default?.url ??
        null;
      pageItems.push({
        videoId,
        title: title || '動画',
        description: raw.snippet?.description ?? '',
        publishedAt:
          raw.contentDetails?.videoPublishedAt ?? raw.snippet?.publishedAt ?? '',
        position: raw.snippet?.position ?? items.length + pageItems.length,
        thumbnailUrl: thumb,
      });
    });

    items.push(...pageItems);
    const hasMore = Boolean(json.nextPageToken);
    options?.onPageFetched?.({
      pageIndex: page,
      fetchedCount: items.length,
      hasMore,
    });

    if (!json.nextPageToken) break;
    if (options?.shouldStopAfterPage?.(pageItems, items, page)) {
      break;
    }
    pageToken = json.nextPageToken;
  }

  return items.sort((a, b) => a.position - b.position);
}
