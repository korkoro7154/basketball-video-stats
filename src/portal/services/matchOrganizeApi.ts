import { auth } from '../firebase';
import type { AiOrganizedMatchInput } from '../utils/matches';

async function postOrganizeMatchesApi<T>(payload: Record<string, unknown>): Promise<T> {
  const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  let res: Response;
  try {
    res = await fetch('/api/organize-matches', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err: unknown) {
    throw new Error(
      'サーバーに接続できませんでした。通信状況をご確認ください。',
      { cause: err }
    );
  }

  const rawText = await res.text().catch(() => '');
  let json: Record<string, unknown>;
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const serverMsg = typeof json.error === 'string' ? json.error : '';
    throw new Error(
      serverMsg || `YouTube・AI処理に失敗しました (HTTP ${res.status})。`
    );
  }

  return json as unknown as T;
}

/** Fetches original YouTube titles in batch for clips imported before youtubeTitle was saved. */
export async function fetchYouTubeVideoTitles(
  videoIds: string[],
  youtubeAccessToken?: string
): Promise<Record<string, string>> {
  const res = await postOrganizeMatchesApi<{ titles?: Record<string, string> }>({
    mode: 'fetch-titles',
    videoIds,
    youtubeAccessToken: youtubeAccessToken ?? '',
  });
  return res.titles ?? {};
}

/** Sends clips (and optional existing YouTube titles) to Gemini to group matches, quarters, A/B, and opponents. */
export async function organizeMatchesWithAi(input: {
  gameTitle: string;
  gameDate: string;
  defaultOpponent: string;
  clips: Array<{
    id: string;
    label: string;
    youtubeId: string;
    youtubeTitle?: string;
  }>;
  youtubeAccessToken?: string;
}): Promise<{
  matches: AiOrganizedMatchInput[];
  fetchedTitles: Record<string, string>;
}> {
  const res = await postOrganizeMatchesApi<{
    matches?: AiOrganizedMatchInput[];
    fetchedTitles?: Record<string, string>;
  }>({
    mode: 'organize',
    gameTitle: input.gameTitle,
    gameDate: input.gameDate,
    defaultOpponent: input.defaultOpponent,
    clips: input.clips.map((c) => ({
      id: c.id,
      label: c.label,
      youtubeId: c.youtubeId,
      youtubeTitle: c.youtubeTitle ?? '',
    })),
    youtubeAccessToken: input.youtubeAccessToken ?? '',
  });
  return {
    matches: Array.isArray(res.matches) ? res.matches : [],
    fetchedTitles: res.fetchedTitles ?? {},
  };
}
