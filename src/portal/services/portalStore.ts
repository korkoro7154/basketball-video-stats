import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DEFAULT_OWNER_EMAIL,
  createInitialPortalData,
  stripSampleEntries,
} from '../data/sampleData';
import type { PortalData } from '../types';

const PORTAL_COLLECTION = 'portal';
const PORTAL_DOC_ID = 'main';

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
