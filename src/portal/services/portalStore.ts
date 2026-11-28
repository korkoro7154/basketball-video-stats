import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_OWNER_EMAIL,
  createInitialPortalData,
  stripSampleEntries,
} from '../data/sampleData';
import type { PortalData, PortalRevision, PortalRevisionStats } from '../types';
import {
  MAX_DIFF_CHANGES,
  MAX_REVISIONS_KEEP,
  buildPortalRevision,
  computePortalRevisionStats,
  formatRevisionDateJst,
  summarizePortalDiff,
} from '../utils/revisions';

const PORTAL_COLLECTION = 'portal';
const PORTAL_DOC_ID = 'main';
const REVISIONS_SUBCOLLECTION = 'revisions';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    });
    return out as T;
  }
  return value;
}

function mergeWithDefaults(raw: Partial<PortalData>): PortalData {
  const initial = createInitialPortalData();
  const ownerSet = new Set<string>([
    DEFAULT_OWNER_EMAIL,
    ...(Array.isArray(raw.ownerEmails) ? raw.ownerEmails.map(normalizeEmail) : []),
  ]);
  const allowedSet = new Set<string>([
    DEFAULT_OWNER_EMAIL,
    ...(Array.isArray(raw.allowedEmails) ? raw.allowedEmails.map(normalizeEmail) : []),
  ]);

  return {
    teamName: raw.teamName || initial.teamName,
    adminPin: raw.adminPin || initial.adminPin,
    practiceTags:
      Array.isArray(raw.practiceTags) && raw.practiceTags.length > 0
        ? raw.practiceTags
        : initial.practiceTags,
    players: Array.isArray(raw.players) ? raw.players : initial.players,
    games: Array.isArray(raw.games) ? raw.games : initial.games,
    practices: Array.isArray(raw.practices) ? raw.practices : initial.practices,
    ownerEmails: Array.from(ownerSet),
    allowedEmails: Array.from(allowedSet),
  };
}

export function isEmailAllowed(
  email: string | null | undefined,
  data: PortalData
): boolean {
  if (!email) return false;
  const target = normalizeEmail(email);
  if (target === normalizeEmail(DEFAULT_OWNER_EMAIL)) return true;

  const owners = data.ownerEmails.map(normalizeEmail);
  const allowed = data.allowedEmails.map(normalizeEmail);
  return owners.includes(target) || allowed.includes(target);
}

export interface PortalSubscriptionCallbacks {
  onData: (data: PortalData) => void;
  onAccessDenied: () => void;
  onError: (message: string) => void;
}

export function subscribePortalData(
  userEmail: string | null | undefined,
  callbacks: PortalSubscriptionCallbacks
): () => void {
  if (!db || !userEmail) {
    callbacks.onAccessDenied();
    return () => {};
  }

  const docRef = doc(db, PORTAL_COLLECTION, PORTAL_DOC_ID);
  let initTriggered = false;
  let sampleCleanupTriggered = false;
  const normalizedUser = normalizeEmail(userEmail);
  const isDefaultOwner = normalizedUser === normalizeEmail(DEFAULT_OWNER_EMAIL);

  return onSnapshot(
    docRef,
    (snap) => {
      if (!snap.exists()) {
        if (isDefaultOwner) {
          const initial = createInitialPortalData();
          if (!initTriggered) {
            initTriggered = true;
            setDoc(docRef, stripUndefined(initial)).catch((err) => {
              console.error('Failed to initialize portal doc:', err);
              callbacks.onError('初期データのクラウド保存に失敗しました。');
            });
          }
          callbacks.onData(initial);
        } else {
          callbacks.onAccessDenied();
        }
        return;
      }

      const merged = mergeWithDefaults(snap.data() as Partial<PortalData>);
      if (!isEmailAllowed(userEmail, merged)) {
        callbacks.onAccessDenied();
        return;
      }
      const { cleaned, changed } = stripSampleEntries(merged);
      if (changed && !sampleCleanupTriggered) {
        sampleCleanupTriggered = true;
        setDoc(docRef, stripUndefined(cleaned)).catch((err) => {
          console.error('Failed to clean sample entries:', err);
        });
      }
      callbacks.onData(cleaned);
    },
    (err) => {
      console.error('Firestore subscription error:', err);
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      if (code === 'permission-denied') {
        callbacks.onAccessDenied();
      } else {
        callbacks.onError('クラウドデータの読み込みに失敗しました。');
      }
    }
  );
}

export async function savePortalDataToCloud(data: PortalData): Promise<void> {
  if (!db) return;
  const docRef = doc(db, PORTAL_COLLECTION, PORTAL_DOC_ID);
  await setDoc(docRef, stripUndefined(data));
}

function normalizeRevisionStats(
  raw: unknown,
  fallbackSnapshot: PortalData
): PortalRevisionStats {
  const fallback = computePortalRevisionStats(fallbackSnapshot);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fallback;
  }
  const obj = raw as Record<string, unknown>;
  const asCount = (value: unknown, fb: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : fb;

  return {
    gameDays: asCount(obj.gameDays, fallback.gameDays),
    matches: asCount(obj.matches, fallback.matches),
    scoredMatches: asCount(obj.scoredMatches, fallback.scoredMatches),
    players: asCount(obj.players, fallback.players),
    practices: asCount(obj.practices, fallback.practices),
  };
}

function normalizePortalRevision(
  docId: string,
  raw: Record<string, unknown>
): PortalRevision | null {
  if (
    typeof raw.beforeSnapshot !== 'object' ||
    raw.beforeSnapshot === null ||
    Array.isArray(raw.beforeSnapshot)
  ) {
    return null;
  }
  const beforeSnapshot = mergeWithDefaults(
    raw.beforeSnapshot as Partial<PortalData>
  );
  const rawChanges = Array.isArray(raw.changes)
    ? raw.changes
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, MAX_DIFF_CHANGES)
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : docId,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    actorEmail: typeof raw.actorEmail === 'string' ? raw.actorEmail : '',
    actorName:
      typeof raw.actorName === 'string' && raw.actorName.trim()
        ? raw.actorName
        : typeof raw.actorEmail === 'string' && raw.actorEmail.trim()
          ? raw.actorEmail
          : '不明なユーザー',
    actionSummary:
      typeof raw.actionSummary === 'string' && raw.actionSummary.trim()
        ? raw.actionSummary
        : 'ポータルデータを更新',
    changes: rawChanges.length > 0 ? rawChanges : ['変更内容の詳細は未記録です'],
    beforeSnapshot,
    afterStats: normalizeRevisionStats(raw.afterStats, beforeSnapshot),
  };
}

export async function savePortalRevisionToCloud(
  revision: PortalRevision
): Promise<void> {
  if (!db) return;
  const revRef = doc(
    db,
    PORTAL_COLLECTION,
    PORTAL_DOC_ID,
    REVISIONS_SUBCOLLECTION,
    revision.id
  );
  await setDoc(revRef, stripUndefined(revision));
}

export async function fetchPortalRevisionsFromCloud(
  maxItems = MAX_REVISIONS_KEEP
): Promise<{
  revisions: PortalRevision[];
  totalCount: number | null;
  hasOverflow: boolean;
}> {
  if (!db) {
    return { revisions: [], totalCount: 0, hasOverflow: false };
  }

  const colRef = collection(
    db,
    PORTAL_COLLECTION,
    PORTAL_DOC_ID,
    REVISIONS_SUBCOLLECTION
  );
  const snap = await getDocs(
    query(colRef, orderBy('createdAt', 'desc'), limit(maxItems + 1))
  );

  let totalCount: number | null = null;
  try {
    const countSnap = await getCountFromServer(colRef);
    totalCount = countSnap.data().count;
  } catch {
    // 履歴件数集計に失敗した場合は一覧取得結果のみで継続する
  }

  const revisions: PortalRevision[] = [];
  for (const docSnap of snap.docs.slice(0, maxItems)) {
    const normalized = normalizePortalRevision(
      docSnap.id,
      docSnap.data() as Record<string, unknown>
    );
    if (normalized) {
      revisions.push(normalized);
    }
  }

  const hasOverflow =
    snap.docs.length > maxItems ||
    (totalCount !== null && totalCount > maxItems);

  return {
    revisions,
    totalCount,
    hasOverflow,
  };
}

export async function restorePortalRevisionInCloud(params: {
  revision: PortalRevision;
  actorEmail: string;
  actorName: string;
}): Promise<{
  restoredData: PortalData;
  backupRevision: PortalRevision;
}> {
  if (!db) {
    throw new Error('Firebaseが設定されていません。');
  }

  const mainRef = doc(db, PORTAL_COLLECTION, PORTAL_DOC_ID);
  const currentSnap = await getDoc(mainRef);
  const currentLiveData = currentSnap.exists()
    ? mergeWithDefaults(currentSnap.data() as Partial<PortalData>)
    : createInitialPortalData();

  const restoredData = mergeWithDefaults(
    JSON.parse(
      JSON.stringify(params.revision.beforeSnapshot)
    ) as Partial<PortalData>
  );

  const diff = summarizePortalDiff(currentLiveData, restoredData);
  const targetWhen = formatRevisionDateJst(params.revision.createdAt);
  const backupRevision = buildPortalRevision({
    before: currentLiveData,
    after: restoredData,
    actorEmail: params.actorEmail,
    actorName: params.actorName,
    overrideActionSummary: `復元前の控え（${targetWhen} の変更前に復元）`,
    overrideChanges: [
      `復元対象：${params.revision.actionSummary}`,
      ...diff.changes,
    ],
  });

  if (!backupRevision) {
    throw new Error('復元前バックアップの作成に失敗しました。');
  }

  // 必ず先に復元前の控えを履歴へ保存し、成功してから本番データを上書きする
  const backupRef = doc(
    db,
    PORTAL_COLLECTION,
    PORTAL_DOC_ID,
    REVISIONS_SUBCOLLECTION,
    backupRevision.id
  );
  await setDoc(backupRef, stripUndefined(backupRevision));
  await setDoc(mainRef, stripUndefined(restoredData));

  return {
    restoredData,
    backupRevision,
  };
}

export async function pruneOldPortalRevisions(
  keepCount = MAX_REVISIONS_KEEP
): Promise<{ deletedCount: number; hasMore: boolean }> {
  if (!db) {
    return { deletedCount: 0, hasMore: false };
  }

  const colRef = collection(
    db,
    PORTAL_COLLECTION,
    PORTAL_DOC_ID,
    REVISIONS_SUBCOLLECTION
  );
  let deletedCount = 0;

  for (let pass = 0; pass < 5; pass += 1) {
    const snap = await getDocs(
      query(colRef, orderBy('createdAt', 'desc'), limit(100))
    );
    const overflowDocs = snap.docs.slice(keepCount);
    if (overflowDocs.length === 0) {
      return { deletedCount, hasMore: false };
    }

    const batch = writeBatch(db);
    for (const docSnap of overflowDocs) {
      batch.delete(docSnap.ref);
    }
    await batch.commit();
    deletedCount += overflowDocs.length;

    if (snap.docs.length < 100) {
      return { deletedCount, hasMore: false };
    }
  }

  return { deletedCount, hasMore: true };
}
