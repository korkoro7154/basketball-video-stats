import type { PortalData } from '../types';

export const PORTAL_STORAGE_KEY = 'hoops_portal_proto_v1';
export const DEFAULT_OWNER_EMAIL = 'kokoronan7@gmail.com';

const SAMPLE_GAME_IDS = new Set(['game_01', 'game_02', 'game_03']);
const SAMPLE_PRACTICE_IDS = new Set(['prac_01', 'prac_02', 'prac_03', 'prac_04']);
const SAMPLE_PLAYER_NAMES = new Map<string, string>([
  ['p4', '高橋 颯太'],
  ['p5', '鈴木 陸'],
  ['p6', '田中 悠真'],
  ['p7', '佐藤 健斗'],
  ['p8', '伊藤 蓮'],
  ['p9', '渡辺 翔'],
  ['p10', '山本 大輝'],
  ['p11', '中村 翼'],
]);

export function createInitialPortalData(): PortalData {
  return {
    teamName: '駒81男バス',
    adminPin: '1234',
    ownerEmails: [DEFAULT_OWNER_EMAIL],
    allowedEmails: [DEFAULT_OWNER_EMAIL],
    practiceTags: [
      '#速攻',
      '#ディフェンス',
      '#シュート',
      '#ピック＆ロール',
      '#ゾーン対策',
      '#リバウンド',
    ],
    players: [],
    games: [],
    practices: [],
  };
}

export function stripSampleEntries(data: PortalData): {
  cleaned: PortalData;
  changed: boolean;
} {
  const nextGames = data.games.filter(
    (g) =>
      !(
        SAMPLE_GAME_IDS.has(g.id) &&
        g.videos.length > 0 &&
        g.videos.every((v) => v.youtubeId.startsWith('demo_'))
      )
  );
  const nextPractices = data.practices.filter(
    (p) => !(SAMPLE_PRACTICE_IDS.has(p.id) && p.youtubeId.startsWith('demo_'))
  );
  const nextPlayers = data.players.filter(
    (p) => SAMPLE_PLAYER_NAMES.get(p.id) !== p.name
  );
  const nextTeamName =
    data.teamName === '桜台高校 バスケ部' ? '駒81男バス' : data.teamName;

  const changed =
    nextGames.length !== data.games.length ||
    nextPractices.length !== data.practices.length ||
    nextPlayers.length !== data.players.length ||
    nextTeamName !== data.teamName;

  if (!changed) {
    return { cleaned: data, changed: false };
  }

  return {
    changed: true,
    cleaned: {
      ...data,
      teamName: nextTeamName,
      players: nextPlayers,
      games: nextGames,
      practices: nextPractices,
    },
  };
}

export function loadPortalData(): PortalData {
  try {
    const raw = localStorage.getItem(PORTAL_STORAGE_KEY);
    if (!raw) return createInitialPortalData();
    const parsed = JSON.parse(raw) as Partial<PortalData>;
    const initial = createInitialPortalData();
    const assembled: PortalData = {
      teamName: parsed.teamName || initial.teamName,
      adminPin: parsed.adminPin || initial.adminPin,
      practiceTags:
        Array.isArray(parsed.practiceTags) && parsed.practiceTags.length > 0
          ? parsed.practiceTags
          : initial.practiceTags,
      players: Array.isArray(parsed.players) ? parsed.players : initial.players,
      games: Array.isArray(parsed.games) ? parsed.games : initial.games,
      practices: Array.isArray(parsed.practices) ? parsed.practices : initial.practices,
      ownerEmails:
        Array.isArray(parsed.ownerEmails) && parsed.ownerEmails.length > 0
          ? parsed.ownerEmails
          : initial.ownerEmails,
      allowedEmails:
        Array.isArray(parsed.allowedEmails) && parsed.allowedEmails.length > 0
          ? parsed.allowedEmails
          : initial.allowedEmails,
    };
    return stripSampleEntries(assembled).cleaned;
  } catch {
    return createInitialPortalData();
  }
}

export function savePortalData(data: PortalData): void {
  try {
    localStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save portal data:', err);
  }
}

export function resetPortalData(): PortalData {
  const initial = createInitialPortalData();
  savePortalData(initial);
  return initial;
}
