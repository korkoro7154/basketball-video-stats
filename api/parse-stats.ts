export interface ParsedStatsPayloadInput {
  body: unknown;
  authHeader: string | null;
  env: {
    geminiApiKey: string;
    firebaseApiKey: string;
  };
}

export interface ParsedOcrPlayerPayload {
  number: string;
  name: string;
  pts: number;
  threePm: number;
  threePa: number;
  twoPm: number;
  twoPa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
  pf: number;
}

export interface ParsedStatsPayloadOutput {
  imageType: 'box_score' | 'shot_chart' | 'team_summary' | 'unknown';
  screenshotDate: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  players: ParsedOcrPlayerPayload[];
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64_LENGTH = 8 * 1024 * 1024;
const GEMINI_MODELS = [
  { name: 'gemini-3.8-flash', disableThinking: false, timeoutMs: 7_000 },
  { name: 'gemini-3-flash-preview', disableThinking: true, timeoutMs: 14_000 },
  { name: 'gemini-3.7-flash', disableThinking: false, timeoutMs: 7_000 },
  { name: 'gemini-3.5-flash', disableThinking: false, timeoutMs: 9_000 },
  { name: 'gemini-3.5-flash-lite', disableThinking: false, timeoutMs: 12_000 },
] as const;

const modelCooldownUntil = new Map<string, number>();

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    imageType: {
      type: 'STRING',
      enum: ['box_score', 'shot_chart', 'team_summary', 'unknown'],
    },
    screenshotDate: { type: 'STRING' },
    homeTeamName: { type: 'STRING' },
    awayTeamName: { type: 'STRING' },
    homeScore: { type: 'INTEGER' },
    awayScore: { type: 'INTEGER' },
    players: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          number: { type: 'STRING' },
          name: { type: 'STRING' },
          pts: { type: 'INTEGER' },
          threePm: { type: 'INTEGER' },
          threePa: { type: 'INTEGER' },
          twoPm: { type: 'INTEGER' },
          twoPa: { type: 'INTEGER' },
          ftm: { type: 'INTEGER' },
          fta: { type: 'INTEGER' },
          oreb: { type: 'INTEGER' },
          dreb: { type: 'INTEGER' },
          ast: { type: 'INTEGER' },
          stl: { type: 'INTEGER' },
          blk: { type: 'INTEGER' },
          to: { type: 'INTEGER' },
          pf: { type: 'INTEGER' },
        },
        required: [
          'number',
          'name',
          'pts',
          'threePm',
          'threePa',
          'twoPm',
          'twoPa',
          'ftm',
          'fta',
          'oreb',
          'dreb',
          'ast',
          'stl',
          'blk',
          'to',
          'pf',
        ],
      },
    },
  },
  required: [
    'imageType',
    'screenshotDate',
    'homeTeamName',
    'awayTeamName',
    'homeScore',
    'awayScore',
    'players',
  ],
};

function toNonNegInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

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

function buildExtractionPrompt(teamNameHint: string): string {
  const hintLine = teamNameHint
    ? `Home team hint: "${teamNameHint}" (top table).`
    : 'Home team is the top table.';

  return [
    'Extract Japanese basketball stats from this screenshot into JSON.',
    hintLine,
    'imageType: "box_score" (player stats table), "shot_chart" (court map, players=[]), "team_summary" (score card without player rows, players=[]), or "unknown".',
    'For box_score: extract ONLY the top/home team player rows into players[] (exclude Team/Coaches and TOTALS rows).',
    'Read homeScore from top TOTALS PTS, awayScore from bottom TOTALS PTS, awayTeamName from bottom table title, and screenshotDate as "MM-DD" if visible (else "").',
    'Columns left-to-right: No, Name, GS, PTS, 3P(M,A,%), 2P(M,A,%), DK, FT(M,A,%), RBD(OR,DR,TOT), AST, STL, BLK, TO, PF. Note 3P comes BEFORE 2P. Ignore %, GS, DK, RBD TOT, TF, OF, FO, DFL, DQ, MIN. Keep printed Japanese names and jersey numbers as strings.',
  ].join('\n');
}

async function callGeminiVision(
  geminiApiKey: string,
  mimeType: string,
  imageBase64: string,
  teamNameHint: string,
  skipModels: Set<string>
): Promise<{
  status: number;
  rawText?: string;
  failedModels?: string[];
  errorMessage?: string;
}> {
  const contents = [
    {
      role: 'user',
      parts: [
        { text: buildExtractionPrompt(teamNameHint) },
        {
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        },
      ],
    },
  ];

  const now = Date.now();
  const notSkipped = GEMINI_MODELS.filter((m) => !skipModels.has(m.name));
  const readyNotSkipped = notSkipped.filter(
    (m) => (modelCooldownUntil.get(m.name) ?? 0) <= now
  );
  const coolingNotSkipped = notSkipped.filter(
    (m) => (modelCooldownUntil.get(m.name) ?? 0) > now
  );
  const skippedFallback = GEMINI_MODELS.filter((m) => skipModels.has(m.name));
  const candidates = [
    ...readyNotSkipped,
    ...coolingNotSkipped,
    ...skippedFallback,
  ];
  const failedModels: string[] = [];
  const deadline = now + 38_000;

  for (let i = 0; i < candidates.length; i += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 3_000) {
      return {
        status: 504,
        errorMessage: '読み取りがタイムアウトしました。もう一度お試しください。',
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
        responseSchema: RESPONSE_SCHEMA,
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
      console.error('Gemini vision fetch error:', model, errMsg);
      failedModels.push(model);
      modelCooldownUntil.set(model, Date.now() + 30_000);
      if (i < candidates.length - 1) {
        continue;
      }
      return {
        status: 504,
        errorMessage: '読み取りがタイムアウトしました。もう一度お試しください。',
      };
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('Gemini vision HTTP error:', model, res.status, errBody.slice(0, 300));
      if (res.status === 429) {
        failedModels.push(model);
        const cooldownMs = errBody.toLowerCase().includes('per day')
          ? 10 * 60_000
          : 20_000;
        modelCooldownUntil.set(model, Date.now() + cooldownMs);
      } else if (res.status === 503) {
        failedModels.push(model);
        modelCooldownUntil.set(model, Date.now() + 20_000);
      } else if (res.status >= 500) {
        failedModels.push(model);
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
            '読み取り回数の上限に達しました。少し時間をおいてからお試しください。',
        };
      }
      return {
        status: 502,
        errorMessage: `スクショ解析サービスとの通信に失敗しました (HTTP ${res.status})。`,
      };
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { status: 200, rawText: text, failedModels };
  }

  return {
    status: 502,
    errorMessage: 'スクショ解析モデルを呼び出せませんでした。',
  };
}

function normalizeScreenshotDate(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const match = s.match(/(?:^|[-/.年\s])(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*日?/);
  if (!match) return '';
  const m = parseInt(match[1], 10);
  const d = parseInt(match[2], 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

function sanitizeParsedOutput(parsed: unknown): ParsedStatsPayloadOutput {
  const rec =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};

  const rawType = String(rec.imageType ?? 'unknown');
  const imageType: ParsedStatsPayloadOutput['imageType'] =
    rawType === 'box_score' ||
    rawType === 'shot_chart' ||
    rawType === 'team_summary'
      ? rawType
      : 'unknown';

  const rawPlayers = Array.isArray(rec.players) ? rec.players : [];
  const players: ParsedOcrPlayerPayload[] = [];

  for (const item of rawPlayers) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;
    const number = String(p.number ?? '').trim();
    const name = String(p.name ?? '').trim();
    const lowerName = name.toLowerCase();

    if (
      (!number && !name) ||
      lowerName.includes('total') ||
      lowerName.includes('team/coach')
    ) {
      continue;
    }

    const threePm = toNonNegInt(p.threePm);
    const threePa = Math.max(threePm, toNonNegInt(p.threePa));
    const twoPm = toNonNegInt(p.twoPm);
    const twoPa = Math.max(twoPm, toNonNegInt(p.twoPa));
    const ftm = toNonNegInt(p.ftm);
    const fta = Math.max(ftm, toNonNegInt(p.fta));

    players.push({
      number,
      name,
      pts: toNonNegInt(p.pts),
      threePm,
      threePa,
      twoPm,
      twoPa,
      ftm,
      fta,
      oreb: toNonNegInt(p.oreb),
      dreb: toNonNegInt(p.dreb),
      ast: toNonNegInt(p.ast),
      stl: toNonNegInt(p.stl),
      blk: toNonNegInt(p.blk),
      to: toNonNegInt(p.to),
      pf: toNonNegInt(p.pf),
    });
  }

  return {
    imageType,
    screenshotDate: normalizeScreenshotDate(rec.screenshotDate),
    homeTeamName: String(rec.homeTeamName ?? '').trim(),
    awayTeamName: String(rec.awayTeamName ?? '').trim(),
    homeScore: toNonNegInt(rec.homeScore),
    awayScore: toNonNegInt(rec.awayScore),
    players,
  };
}

export async function handleParseStatsPayload(
  input: ParsedStatsPayloadInput
): Promise<{ status: number; data: Record<string, unknown> }> {
  const geminiApiKey = input.env.geminiApiKey.trim();
  if (!geminiApiKey) {
    return {
      status: 503,
      data: {
        error:
          'スクショ読み取り用の Gemini APIキー（GEMINI_API_KEY）がまだ設定されていません。',
      },
    };
  }

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
      data: { error: '画像データが正しく送信されませんでした。' },
    };
  }

  const bodyRec = input.body as Record<string, unknown>;
  let imageBase64 =
    typeof bodyRec.imageBase64 === 'string' ? bodyRec.imageBase64.trim() : '';
  const dataUrlPrefixMatch = imageBase64.match(/^data:[^;]+;base64,/i);
  if (dataUrlPrefixMatch) {
    imageBase64 = imageBase64.slice(dataUrlPrefixMatch[0].length);
  }

  const mimeType =
    typeof bodyRec.mimeType === 'string' ? bodyRec.mimeType.trim().toLowerCase() : '';
  const teamNameHint =
    typeof bodyRec.teamNameHint === 'string'
      ? bodyRec.teamNameHint.trim().slice(0, 80)
      : '';
  const rawSkipModels = Array.isArray(bodyRec.skipModels)
    ? bodyRec.skipModels
    : [];
  const skipModels = new Set(
    rawSkipModels
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .map((m) => m.trim())
  );

  if (!imageBase64) {
    return {
      status: 400,
      data: { error: '画像データが空です。スクショを選び直してください。' },
    };
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return {
      status: 400,
      data: {
        error: '画像サイズが大きすぎます。別のスクショでお試しください。',
      },
    };
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      status: 400,
      data: {
        error:
          '対応していない画像形式です（JPG / PNG / WebP に対応しています）。',
      },
    };
  }

  const geminiRes = await callGeminiVision(
    geminiApiKey,
    mimeType,
    imageBase64,
    teamNameHint,
    skipModels
  );
  if (geminiRes.status !== 200 || !geminiRes.rawText) {
    return {
      status: geminiRes.status,
      data: {
        error:
          geminiRes.errorMessage || 'スクショからスタッツを読み取れませんでした。',
      },
    };
  }

  try {
    const parsedJson = JSON.parse(geminiRes.rawText) as unknown;
    const cleaned = sanitizeParsedOutput(parsedJson);
    return {
      status: 200,
      data: {
        ...(cleaned as unknown as Record<string, unknown>),
        ...(geminiRes.failedModels && geminiRes.failedModels.length > 0
          ? { failedModels: geminiRes.failedModels }
          : {}),
      },
    };
  } catch {
    return {
      status: 502,
      data: {
        error:
          '読み取り結果の解析に失敗しました。見やすいスクショでもう一度お試しください。',
      },
    };
  }
}

function getEnvVar(name: string): string {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.[name] ?? '';
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

  const result = await handleParseStatsPayload({
    body,
    authHeader: request.headers.get('authorization'),
    env: {
      geminiApiKey: getEnvVar('GEMINI_API_KEY'),
      firebaseApiKey: getEnvVar('VITE_FIREBASE_API_KEY'),
    },
  });

  return Response.json(result.data, { status: result.status });
}
