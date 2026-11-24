import type { Player } from '../types';

export interface BulkRosterEntry {
  number: string;
  name: string;
}

const KANJI_VARIANT_MAP: Record<string, string> = {
  髙: '高',
  栁: '柳',
  﨑: '崎',
  邊: '辺',
  邉: '辺',
  齊: '斉',
  齋: '斉',
};

/** Normalizes whitespace and common kanji variants for player name matching. */
export function normalizeRosterName(name: string): string {
  return Array.from(name.replace(/[\s\u3000]+/g, ''))
    .map((ch) => KANJI_VARIANT_MAP[ch] ?? ch)
    .join('');
}

function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}

/** Parses newline-separated "number name" entries cleanly, deduplicating by jersey number. */
export function parseBulkRosterLines(text: string): BulkRosterEntry[] {
  const seenNumbers = new Set<string>();
  const entries: BulkRosterEntry[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const normalizedPrefix = toHalfWidthDigits(trimmed)
      .replace(/^(?:#|＃|No\.?\s*|NO\.?\s*)/i, '')
      .trim();
    const match = normalizedPrefix.match(/^(\d+)[\s\u3000,:：\t]+(.+)$/);
    if (!match) continue;

    const number = match[1].trim();
    const name = match[2].replace(/[\s\u3000]+/g, ' ').trim();
    if (!number || !name || seenNumbers.has(number)) continue;

    seenNumbers.add(number);
    entries.push({ number, name });
  }

  return entries;
}

/** Merges parsed bulk roster entries into existing players while keeping IDs and existing stats intact. */
export function mergeBulkRosterPlayers(
  existing: Player[],
  incoming: BulkRosterEntry[],
  createId: (prefix: string) => string
): {
  players: Player[];
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
} {
  const nextPlayers = existing.map((p) => ({ ...p }));
  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const item of incoming) {
    const normIncomingName = normalizeRosterName(item.name);
    let idx = nextPlayers.findIndex(
      (p) => normalizeRosterName(p.name) === normIncomingName
    );
    if (idx === -1) {
      idx = nextPlayers.findIndex((p) => p.number.trim() === item.number);
    }

    if (idx !== -1) {
      const target = nextPlayers[idx];
      if (target.number !== item.number || target.name !== item.name) {
        nextPlayers[idx] = {
          ...target,
          number: item.number,
          name: item.name,
        };
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    } else {
      nextPlayers.push({
        id: createId('p'),
        number: item.number,
        name: item.name,
        position: '',
        grade: '',
      });
      addedCount += 1;
    }
  }

  return {
    players: nextPlayers,
    addedCount,
    updatedCount,
    skippedCount,
  };
}
