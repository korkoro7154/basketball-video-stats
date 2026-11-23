import process from 'node:process';

export interface OrganizeMatchesClipInput {
  id: string;
  label: string;
  youtubeId: string;
  youtubeTitle?: string;
}

export interface AiOrganizedMatchOutput {
  label: string;
  teamUnit: 'A' | 'B' | 'その他' | '';
  opponent: string;
  clips: Array<{ id: string; label: string }>;
}

export interface OrganizeMatchesPayloadInput {
  body: unknown;
  authHeader: string | null;
  env: {
    geminiApiKey: string;
    firebaseApiKey: string;
  };
}

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const MAX_CLIPS = 60;

const ORGANIZE_MODELS = [
  { name: 'gemini-3-flash-preview', disableThinking: true, timeoutMs: 14_000 },
  { name: 'gemini-3.8-flash', disableThinking: false, timeoutMs: 8_000 },
  { name: 'gemini-3.5-flash-lite', disableThinking: false, timeoutMs: 10_000 },
  { name: 'gemini-3.1-flash-lite', disableThinking: true, timeoutMs: 10_000 },
] as const;

const modelCooldownUntil = new Map<string, number>();

const ORGANIZE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    matches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          teamUnit: {
            type: 'STRING',
            enum: ['A', 'B', 'その他', '指定なし'],
          },
          opponent: { type: 'STRING' },
          clips: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' },
                label: { type: 'STRING' },
              },
              required: ['id', 'label'],
            },
          },
        },
        required: ['label', 'teamUnit', 'opponent', 'clips'],
      },
    },
  },
  required: ['matches'],
};

async function verifyFirebaseIdToken(
  idToken: string,
  firebaseApiKey: string
): Promise<boolean> {
  if (!idToken) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        firebaseApiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return false;
    const json = (await res.json()) as { users?: unknown[] };
    return Array.isArray(json.users) && json.users.length > 0;
  } catch {
    return false;
  }
}

async function fetchOembedTitle(videoId: string): Promise<string> {
  try {
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`,
      { signal: AbortSignal.timeout(4_500) }
    );
    if (!res.ok) return '';
    const json = (await res.json()) as { title?: unknown };
    return typeof json.title === 'string' ? json.title.trim() : '';
  } catch {
    return '';
  }
}

export async function fetchYouTubeTitlesBatch(
  videoIds: string[],
  youtubeAccessToken?: string
): Promise<Record<string, string>> {
  const uniqueIds = Array.from(
    new Set(
      videoIds
        .map((id) => id.trim())
        .filter((id) => !id.startsWith('demo_') && YOUTUBE_ID_RE.test(id))
    )
  ).slice(0, MAX_CLIPS);

  const titles: Record<string, string> = {};
  if (uniqueIds.length === 0) return titles;

  let cursor = 0;
  const workerCount = Math.min(6, uniqueIds.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < uniqueIds.length) {
        const idx = cursor;
        cursor += 1;
        const vid = uniqueIds[idx];
        const title = await fetchOembedTitle(vid);
        if (title) {
          titles[vid] = title;
        }
      }
    })
  );

  const missingIds = uniqueIds.filter((id) => !titles[id]);
  const token = youtubeAccessToken?.trim() ?? '';
  if (missingIds.length > 0 && token) {
    for (let i = 0; i < missingIds.length; i += 50) {
      const chunk = missingIds.slice(i, i + 50);
      try {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk
            .map((id) => encodeURIComponent(id))
            .join(',')}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(5_000),
          }
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          items?: Array<{ id?: string; snippet?: { title?: string } }>;
        };
        for (const item of json.items ?? []) {
          const vid = item.id?.trim() ?? '';
          const title = item.snippet?.title?.trim() ?? '';
          if (vid && title && !titles[vid]) {
            titles[vid] = title;
          }
        }
      } catch {
        // Best-effort fallback for private/unlisted videos
      }
    }
  }

  return titles;
}

function buildOrganizePrompt(input: {
  gameTitle: string;
  gameDate: string;
  defaultOpponent: string;
  clips: Array<{
    index: number;
    id: string;
    currentLabel: string;
    youtubeTitle: string;
  }>;
}): string {
  return [
    'You organize a Japanese high school basketball team playlist into individual matches and quarters.',
    `Playlist / day title: "${input.gameTitle || '(none)'}"`,
    `Date: "${input.gameDate || '(none)'}"`,
    `Default opponent: "${input.defaultOpponent || '対戦相手'}"`,
    '',
    'Domain rules for this team:',
    '1. One YouTube playlist represents 1 practice/tournament day with 1 or more separate games (matches) played on that day.',
    '2. Common video patterns:',
    '   - 1 match split into quarter clips: e.g., 1Q + 2Q, or 1Q〜4Q -> group them into ONE match.',
    '   - Split halves/segments of a quarter: e.g., "1Q前半", "1Q後半", "2Q" -> belong to the SAME match.',
    '   - A single video containing 2 quarters or a full scrimmage (e.g., "1・2Q", "1-2Q", "フル", "1回戦", "1試合目", "A戦1", "B戦1" with no quarter split) -> treat each full-game clip as its OWN match.',
    '3. Keep clips in playlist order unless two segments clearly form consecutive parts of the same quarter.',
    '4. For each match:',
    '   - "label": concise match name such as "1試合目", "2試合目", "A1試合目", etc. Never return empty.',
    '   - "teamUnit": detect squad "A", "B", "その他", or "指定なし" if unclear.',
    '   - "opponent": extract that match\'s opponent school name (especially important on 3校戦 days when A校 and B校 differ); otherwise fall back to Default opponent.',
    '5. For each clip inside "clips":',
    '   - "id": MUST be copied verbatim from the input clip "id".',
    '   - "label": short clear quarter/clip label for mobile pills, e.g. "1Q", "2Q", "3Q", "4Q", "1Q前半", "1Q後半", "1-2Q", "前半", "後半", "OT", or "試合動画". Keep it under 12 characters whenever possible.',
    '6. CRITICAL: Every single input clip "id" must appear EXACTLY ONCE across all output matches (no omissions, no duplicates, no invented IDs).',
    '',
    'Input clips (in playlist order):',
    JSON.stringify(input.clips),
  ].join('\n');
}

async function callGeminiOrganize(
  geminiApiKey: string,
  prompt: string
): Promise<{ status: number; rawText?: string; errorMessage?: string }> {
  const contents = [{ role: 'user', parts: [{ text: prompt }] }];
  const now = Date.now();
  const readyModels = ORGANIZE_MODELS.filter(
    (m) => (modelCooldownUntil.get(m.name) ?? 0) <= now
  );
  const candidates = readyModels.length > 0 ? readyModels : [...ORGANIZE_MODELS];
  const deadline = now + 28_000;

  for (let i = 0; i < candidates.length; i += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 3_000) {
      return {
        status: 504,
        errorMessage: 'AI自動整理がタイムアウトしました。もう一度お試しください。',
      };
    }

    const modelCfg = candidates[i];
    const model = modelCfg.name;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const payload = {
      contents,
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: ORGANIZE_RESPONSE_SCHEMA,
        ...(modelCfg.disableThinking
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiApiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.min(modelCfg.timeoutMs, remainingMs)),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Gemini organize fetch error:', model, errMsg);
      modelCooldownUntil.set(model, Date.now() + 30_000);
      if (i < candidates.length - 1) {
        continue;
      }
      return {
        status: 504,
        errorMessage: 'AI自動整理がタイムアウトしました。もう一度お試しください。',
      };
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('Gemini organize HTTP error:', model, res.status, errBody.slice(0, 300));
      if (res.status === 429) {
        const cooldownMs = errBody.toLowerCase().includes('per day')
          ? 10 * 60_000
          : 20_000;
        modelCooldownUntil.set(model, Date.now() + cooldownMs);
      } else if (res.status === 503) {
        modelCooldownUntil.set(model, Date.now() + 20_000);
      }

      const canFallback =
        res.status === 404 || res.status === 429 || res.status >= 500;
      if (canFallback && i < candidates.length - 1) {
        continue;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return {
          status: res.status,
          errorMessage:
            'Gemini APIキーが無効または制限されています。キー設定をご確認ください。',
        };
      }
      if (res.status === 429) {
        return {
          status: 429,
          errorMessage:
            'AI利用回数の上限に達しました。少し時間をおいてからお試しください。',
        };
      }
      return {
        status: 502,
        errorMessage: `AI整理サービスとの通信に失敗しました (HTTP ${res.status})。`,
      };
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { status: 200, rawText: text };
  }

  return {
    status: 502,
    errorMessage: 'AI整理モデルを呼び出せませんでした。',
  };
}

function sanitizeAiMatches(
  parsed: unknown,
  inputClips: OrganizeMatchesClipInput[],
  defaultOpponent: string
): AiOrganizedMatchOutput[] {
  const inputById = new Map<string, OrganizeMatchesClipInput>();
  for (const c of inputClips) {
    inputById.set(c.id, c);
  }
  const usedIds = new Set<string>();
  const out: AiOrganizedMatchOutput[] = [];
  const safeDefaultOpponent = defaultOpponent.trim() || '対戦相手';

  const rec =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const rawMatches = Array.isArray(rec.matches) ? rec.matches : [];

  for (const item of rawMatches) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    const rawClips = Array.isArray(m.clips) ? m.clips : [];
    const resolvedClips: Array<{ id: string; label: string }> = [];

    for (const rawClip of rawClips) {
      if (typeof rawClip !== 'object' || rawClip === null) continue;
      const cRec = rawClip as Record<string, unknown>;
      const id = String(cRec.id ?? '').trim();
      if (!id || usedIds.has(id) || !inputById.has(id)) continue;
      usedIds.add(id);
      const orig = inputById.get(id)!;
      const label = String(cRec.label ?? '').trim() || orig.label || '動画';
      resolvedClips.push({ id, label });
    }

    if (resolvedClips.length === 0) continue;

    const rawUnit = String(m.teamUnit ?? '').trim().toUpperCase();
    const teamUnit: AiOrganizedMatchOutput['teamUnit'] =
      rawUnit === 'A'
        ? 'A'
        : rawUnit === 'B'
          ? 'B'
          : m.teamUnit === 'その他'
            ? 'その他'
            : '';

    const matchIndex = out.length + 1;
    out.push({
      label: String(m.label ?? '').trim() || `${matchIndex}試合目`,
      teamUnit,
      opponent: String(m.opponent ?? '').trim() || safeDefaultOpponent,
      clips: resolvedClips,
    });
  }

  const dropped: Array<{ id: string; label: string }> = [];
  for (const c of inputClips) {
    if (!usedIds.has(c.id)) {
      dropped.push({ id: c.id, label: c.label || '動画' });
    }
  }
  if (dropped.length > 0) {
    if (out.length > 0) {
      out[out.length - 1].clips.push(...dropped);
    } else {
      out.push({
        label: '1試合目',
        teamUnit: '',
        opponent: safeDefaultOpponent,
        clips: dropped,
      });
    }
  }

  return out;
}

export async function handleOrganizeMatchesPayload(
  input: OrganizeMatchesPayloadInput
): Promise<{ status: number; data: Record<string, unknown> }> {
  const firebaseApiKey = input.env.firebaseApiKey.trim();
  if (firebaseApiKey) {
    const authHeader = input.authHeader?.trim() ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const valid = await verifyFirebaseIdToken(token, firebaseApiKey);
    if (!valid) {
      return {
        status: 401,
        data: {
          error: 'ログイン情報の確認に失敗しました。再ログインしてお試しください。',
        },
      };
    }
  }

  if (typeof input.body !== 'object' || input.body === null) {
    return {
      status: 400,
      data: { error: 'リクエストデータが正しく送信されませんでした。' },
    };
  }

  const bodyRec = input.body as Record<string, unknown>;
  const mode = typeof bodyRec.mode === 'string' ? bodyRec.mode.trim() : 'organize';
  const youtubeAccessToken =
    typeof bodyRec.youtubeAccessToken === 'string'
      ? bodyRec.youtubeAccessToken.trim()
      : undefined;

  if (mode === 'fetch-titles') {
    const rawIds = Array.isArray(bodyRec.videoIds) ? bodyRec.videoIds : [];
    const videoIds = rawIds
      .filter((v): v is string => typeof v === 'string')
      .slice(0, MAX_CLIPS);
    const titles = await fetchYouTubeTitlesBatch(videoIds, youtubeAccessToken);
    return { status: 200, data: { titles } };
  }

  if (mode !== 'organize') {
    return {
      status: 400,
      data: { error: 'サポートされていない処理モードです。' },
    };
  }

  const geminiApiKey = input.env.geminiApiKey.trim();
  if (!geminiApiKey) {
    return {
      status: 503,
      data: {
        error: 'AI整理用の Gemini APIキー（GEMINI_API_KEY）がまだ設定されていません。',
      },
    };
  }

  const rawClips = Array.isArray(bodyRec.clips) ? bodyRec.clips : [];
  const clips: OrganizeMatchesClipInput[] = [];
  const seenClipIds = new Set<string>();
  for (const item of rawClips) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    const label = typeof rec.label === 'string' ? rec.label.trim() : '';
    const youtubeId = typeof rec.youtubeId === 'string' ? rec.youtubeId.trim() : '';
    const youtubeTitle =
      typeof rec.youtubeTitle === 'string' ? rec.youtubeTitle.trim() : '';
    if (!id || seenClipIds.has(id)) continue;
    seenClipIds.add(id);
    clips.push({
      id,
      label,
      youtubeId,
      ...(youtubeTitle ? { youtubeTitle } : {}),
    });
    if (clips.length >= MAX_CLIPS) break;
  }

  if (clips.length === 0) {
    return {
      status: 400,
      data: { error: '整理する動画が見つかりませんでした。' },
    };
  }

  const missingTitleVideoIds = clips
    .filter((c) => !c.youtubeTitle && c.youtubeId && !c.youtubeId.startsWith('demo_'))
    .map((c) => c.youtubeId);

  const fetchedTitles =
    missingTitleVideoIds.length > 0
      ? await fetchYouTubeTitlesBatch(missingTitleVideoIds, youtubeAccessToken)
      : {};

  const enrichedClips = clips.map((c, idx) => ({
    index: idx + 1,
    id: c.id,
    currentLabel: c.label || `動画${idx + 1}`,
    youtubeTitle: c.youtubeTitle || fetchedTitles[c.youtubeId] || '',
  }));

  const gameTitle =
    typeof bodyRec.gameTitle === 'string' ? bodyRec.gameTitle.trim().slice(0, 120) : '';
  const gameDate =
    typeof bodyRec.gameDate === 'string' ? bodyRec.gameDate.trim().slice(0, 30) : '';
  const defaultOpponent =
    typeof bodyRec.defaultOpponent === 'string'
      ? bodyRec.defaultOpponent.trim().slice(0, 80)
      : '';

  const prompt = buildOrganizePrompt({
    gameTitle,
    gameDate,
    defaultOpponent,
    clips: enrichedClips,
  });

  const geminiRes = await callGeminiOrganize(geminiApiKey, prompt);
  if (geminiRes.status !== 200 || !geminiRes.rawText) {
    return {
      status: geminiRes.status,
      data: {
        error: geminiRes.errorMessage || 'AIによる試合・動画の自動整理に失敗しました。',
      },
    };
  }

  try {
    const parsedJson = JSON.parse(geminiRes.rawText) as unknown;
    const matches = sanitizeAiMatches(parsedJson, clips, defaultOpponent);
    return {
      status: 200,
      data: { matches, fetchedTitles },
    };
  } catch {
    return {
      status: 502,
      data: {
        error: 'AI整理結果の読み取りに失敗しました。もう一度お試しください。',
      },
    };
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'リクエスト形式が正しくありません。' },
      { status: 400 }
    );
  }

  const result = await handleOrganizeMatchesPayload({
    body,
    authHeader: request.headers.get('authorization'),
    env: {
      geminiApiKey: process.env.GEMINI_API_KEY ?? '',
      firebaseApiKey: process.env.VITE_FIREBASE_API_KEY ?? '',
    },
  });

  return Response.json(result.data, { status: result.status });
}
