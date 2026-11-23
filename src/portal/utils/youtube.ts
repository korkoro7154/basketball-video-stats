export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();

    if (host.includes('youtu.be')) {
      const id = url.pathname.replace(/^\//, '').split('/')[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const segments = url.pathname.split('/').filter(Boolean);
      const markerIdx = segments.findIndex((seg) =>
        ['embed', 'shorts', 'live', 'v'].includes(seg)
      );
      if (markerIdx !== -1 && segments[markerIdx + 1]) {
        const candidate = segments[markerIdx + 1];
        return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    const regex = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/;
    const match = trimmed.match(regex);
    return match ? match[1] : null;
  }

  return null;
}

export function extractYouTubePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^(PL|UU|OL|RD)[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const listId = url.searchParams.get('list');
    if (listId && listId.trim().length > 4) {
      return listId.trim();
    }
  } catch {
    const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  }

  const studioMatch = trimmed.match(/\/playlist\/((?:PL|UU|OL|FL)[a-zA-Z0-9_-]{10,})/);
  return studioMatch ? studioMatch[1] : null;
}

function collectSortedUniqueMatches(input: string, patterns: RegExp[]): string[] {
  if (!input.trim()) return [];

  const hits: Array<{ id: string; offset: number }> = [];
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const id = match[1]?.trim();
      if (!id) continue;
      const baseIndex = match.index ?? 0;
      const innerOffset = match[0].indexOf(id);
      hits.push({
        id,
        offset: baseIndex + Math.max(0, innerOffset),
      });
    }
  }

  hits.sort((a, b) => a.offset - b.offset);

  const seen = new Set<string>();
  const results: string[] = [];
  for (const hit of hits) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      results.push(hit.id);
    }
  }
  return results;
}

export function extractYouTubePlaylistIdsFromHtml(html: string): string[] {
  return collectSortedUniqueMatches(html, [
    /(?:[?&]|&amp;)list=((?:PL|UU|OLAK5uy_|FL)[a-zA-Z0-9_-]{10,})/g,
    /(?:\\\/|\\u002[fF]|\/)playlist(?:\\\/|\\u002[fF]|\/)((?:PL|UU|OLAK5uy_|FL)[a-zA-Z0-9_-]{10,})/g,
    /href=["'][^"']*(?:[?&]|&amp;)list=([a-zA-Z0-9_-]{12,})/g,
  ]);
}

export function extractAllYouTubePlaylistIds(input: string): string[] {
  return collectSortedUniqueMatches(input, [
    /(?:[?&]|&amp;)list=([a-zA-Z0-9_-]{12,})/g,
    /\/playlist\/((?:PL|UU|OLAK5uy_|FL)[a-zA-Z0-9_-]{10,})/g,
    /(?:^|[\s,;])((?:PL[a-zA-Z0-9_-]{16,34}|OLAK5uy_[a-zA-Z0-9_-]{20,}|UU[a-zA-Z0-9_-]{22}))(?=$|[\s,;])/g,
  ]);
}

export function getYouTubeThumbnail(videoId: string): string | null {
  if (!videoId || videoId.startsWith('demo_')) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

export function parseTimeString(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10));
  }

  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

export function inferClipLabelFromTitle(
  title: string,
  index: number,
  total: number
): string {
  const normalized = toHalfWidthDigits(title).trim();

  const hasMatchIdentifier =
    /(?:\d+\s*試合目|第\s*\d+\s*試合|game\s*\d+|[a-zA-Z]\s*\d+\s*試合)/i.test(
      normalized
    );
  if (hasMatchIdentifier) {
    const trimmed = title.trim();
    return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed;
  }

  if (/(?:^|[^\d])1\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*1\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '1Q';
  }
  if (/(?:^|[^\d])2\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*2\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '2Q';
  }
  if (/(?:^|[^\d])3\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*3\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '3Q';
  }
  if (/(?:^|[^\d])4\s*(?:Q|クオーター|クォーター)/i.test(normalized) || /第\s*4\s*(?:Q|ピリオド)/i.test(normalized)) {
    return '4Q';
  }
  if (/(?:^|[^a-zA-Z])OT(?:\d+)?(?:$|[^a-zA-Z])|延長/i.test(normalized)) {
    return 'OT';
  }
  if (/前半/.test(normalized)) {
    return '前半';
  }
  if (/後半/.test(normalized)) {
    return '後半';
  }

  if (total === 1) {
    return '試合動画';
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return `動画${index + 1}`;
  }
  return trimmed.length > 14 ? `${trimmed.slice(0, 14)}…` : trimmed;
}

function formatIsoDate(year: string, monthNum: number, dayNum: number): string | null {
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }
  return `${year}-${monthNum.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
}

export function inferDateFromText(text: string, fallbackIso: string): string {
  const normalized = toHalfWidthDigits(text);
  const match = normalized.match(/(20\d{2})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
  if (match) {
    const formatted = formatIsoDate(
      match[1],
      parseInt(match[2], 10),
      parseInt(match[3], 10)
    );
    if (formatted) return formatted;
  }

  const shortMatch = normalized.match(
    /(?:^|[^\d])(\d{1,2})\s*[/月]\s*(\d{1,2})(?:日)?(?=$|[^\d])/
  );
  if (shortMatch) {
    const year = /^20\d{2}/.test(fallbackIso)
      ? fallbackIso.slice(0, 4)
      : String(new Date().getFullYear());
    const formatted = formatIsoDate(
      year,
      parseInt(shortMatch[1], 10),
      parseInt(shortMatch[2], 10)
    );
    if (formatted) return formatted;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(fallbackIso)) {
    return fallbackIso.slice(0, 10);
  }
  return new Date().toISOString().split('T')[0];
}

export function inferOpponentFromTitle(title: string): string {
  const cleaned = title.trim();
  if (!cleaned) return '対戦相手';

  const vsMatch = cleaned.match(/(?:vs\.?|VS\.?|対)\s*([^\s/｜|【】()（）]+)/);
  if (vsMatch && vsMatch[1]) {
    const candidate = vsMatch[1]
      .replace(/(?:1|2|3|4)Q.*$/i, '')
      .replace(/戦$/, '')
      .trim();
    if (candidate) return candidate;
  }

  const normalizedPrefix = toHalfWidthDigits(cleaned);
  const dateMatch = normalizedPrefix.match(
    /^(?:20\d{2}[-/.年]\s*)?\d{1,2}\s*[-/.月]\s*\d{1,2}日?\s*/
  );
  const afterDate = dateMatch
    ? cleaned.slice(dateMatch[0].length)
    : cleaned;
  const withoutAt = afterDate.replace(/^[@＠]\s*/, '').trim();
  if (withoutAt) return withoutAt;

  return cleaned;
}

export function inferPlaylistKind(title: string): 'game' | 'practice' {
  const lower = title.toLowerCase();
  const practiceKeywords = [
    '練習',
    'ドリル',
    'トレーニング',
    '自主練',
    'シューティング',
    'メニュー',
    'practice',
  ];
  return practiceKeywords.some((kw) => lower.includes(kw)) ? 'practice' : 'game';
}

export function extractHashtagsFromText(
  text: string,
  knownTags: string[]
): string[] {
  const found = new Set<string>();
  const hashMatches = text.match(/#[^\s#\u3000]+/g) ?? [];
  hashMatches.forEach((tag) => found.add(tag.trim()));

  const lower = text.toLowerCase();
  knownTags.forEach((tag) => {
    const bare = tag.replace(/^#/, '').trim();
    if (bare && lower.includes(bare.toLowerCase())) {
      found.add(tag.startsWith('#') ? tag : `#${tag}`);
    }
  });

  return Array.from(found);
}
