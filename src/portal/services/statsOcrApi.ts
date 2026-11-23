import { auth } from '../firebase';

export interface ParsedOcrPlayer {
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

export interface ParsedStatsResult {
  imageType: 'box_score' | 'shot_chart' | 'team_summary' | 'unknown';
  screenshotDate?: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  players: ParsedOcrPlayer[];
  thumbDataUrl?: string;
  failedModels?: string[];
}

export interface PreparedScreenshot {
  imageBase64: string;
  mimeType: string;
  thumbDataUrl: string;
  whiteRatio: number;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('画像の読み込みに失敗しました。別の画像でお試しください。'));
    img.src = url;
  });
}

/**
 * Compresses an uploaded screenshot, builds a preview thumbnail,
 * and measures the bright-white pixel ratio for local box-score pre-filtering.
 */
export async function prepareScreenshotForOcr(
  file: File
): Promise<PreparedScreenshot> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      throw new Error('画像サイズを取得できませんでした。');
    }

    const maxSide = 1500;
    const scale = Math.max(width, height) > maxSide ? maxSide / Math.max(width, height) : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('画像処理用のキャンバスを作成できませんでした。');
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const commaIdx = dataUrl.indexOf(',');
    const imageBase64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;

    const thumbMax = 180;
    const thumbScale =
      Math.max(width, height) > thumbMax ? thumbMax / Math.max(width, height) : 1;
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = Math.max(1, Math.round(width * thumbScale));
    thumbCanvas.height = Math.max(1, Math.round(height * thumbScale));
    const thumbCtx = thumbCanvas.getContext('2d');
    let thumbDataUrl = '';
    let whiteRatio = 0;
    if (thumbCtx) {
      thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const { data } = thumbCtx.getImageData(
        0,
        0,
        thumbCanvas.width,
        thumbCanvas.height
      );
      let whiteCount = 0;
      const totalPixels = thumbCanvas.width * thumbCanvas.height;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] >= 225 && data[i + 1] >= 225 && data[i + 2] >= 225) {
          whiteCount += 1;
        }
      }
      whiteRatio = totalPixels > 0 ? whiteCount / totalPixels : 0;
      thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);
    }

    return {
      imageBase64,
      mimeType: 'image/jpeg',
      thumbDataUrl,
      whiteRatio,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Sends a pre-encoded screenshot payload to the /api/parse-stats OCR endpoint. */
export async function sendPreparedScreenshotToOcr(
  prepared: PreparedScreenshot,
  teamNameHint?: string,
  skipModels?: string[]
): Promise<ParsedStatsResult> {
  const { imageBase64, mimeType, thumbDataUrl } = prepared;
  const idToken = auth?.currentUser ? await auth.currentUser.getIdToken() : '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }

  let res: Response;
  try {
    res = await fetch('/api/parse-stats', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        imageBase64,
        mimeType,
        teamNameHint: teamNameHint ?? '',
        skipModels: skipModels ?? [],
      }),
    });
  } catch (err: unknown) {
    throw new Error(
      '読み取りサーバーに接続できませんでした。通信状況をご確認ください。',
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
      serverMsg || `スクショの読み取りに失敗しました (HTTP ${res.status})。`
    );
  }

  return {
    ...(json as unknown as ParsedStatsResult),
    thumbDataUrl: thumbDataUrl || undefined,
  };
}

/** Prepares and parses a single screenshot file via /api/parse-stats. */
export async function parseBoxScoreScreenshot(
  file: File,
  teamNameHint?: string
): Promise<ParsedStatsResult> {
  const prepared = await prepareScreenshotForOcr(file);
  return sendPreparedScreenshotToOcr(prepared, teamNameHint);
}
