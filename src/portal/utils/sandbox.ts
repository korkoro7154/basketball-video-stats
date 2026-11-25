import type { PortalData } from '../types';

export const SANDBOX_ENABLED_KEY = 'hoops_portal_sandbox_enabled_v1';
export const SANDBOX_DATA_KEY = 'hoops_portal_sandbox_data_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getBrowserLocalStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isLocalSandboxHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;

  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '[::1]'
  ) {
    return true;
  }

  if (normalized.endsWith('.local')) {
    return true;
  }

  return (
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(normalized)
  );
}

export function canUseLocalSandbox(options: {
  isDev: boolean;
  hostname: string;
}): boolean {
  const normalizedHost = options.hostname.trim().toLowerCase();
  if (normalizedHost.endsWith('.vercel.app')) {
    return false;
  }
  return options.isDev || isLocalSandboxHost(normalizedHost);
}

export function clonePortalData(source: PortalData): PortalData {
  return JSON.parse(JSON.stringify(source)) as PortalData;
}

export function isValidPortalData(value: unknown): value is PortalData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.teamName === 'string' &&
    typeof candidate.adminPin === 'string' &&
    Array.isArray(candidate.players) &&
    Array.isArray(candidate.games) &&
    Array.isArray(candidate.practices) &&
    Array.isArray(candidate.practiceTags)
  );
}

export function readSandboxEnabled(
  storage?: Pick<StorageLike, 'getItem'> | null
): boolean {
  const target = storage === undefined ? getBrowserLocalStorage() : storage;
  if (!target) return false;
  try {
    return target.getItem(SANDBOX_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSandboxEnabled(
  enabled: boolean,
  storage?: Pick<StorageLike, 'setItem' | 'removeItem'> | null
): void {
  const target = storage === undefined ? getBrowserLocalStorage() : storage;
  if (!target) return;
  try {
    if (enabled) {
      target.setItem(SANDBOX_ENABLED_KEY, '1');
    } else {
      target.removeItem(SANDBOX_ENABLED_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function readSandboxData(
  storage?: Pick<StorageLike, 'getItem'> | null
): PortalData | null {
  const target = storage === undefined ? getBrowserLocalStorage() : storage;
  if (!target) return null;
  try {
    const raw = target.getItem(SANDBOX_DATA_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidPortalData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSandboxData(
  data: PortalData,
  storage?: Pick<StorageLike, 'setItem'> | null
): boolean {
  const target = storage === undefined ? getBrowserLocalStorage() : storage;
  if (!target) return false;
  try {
    target.setItem(SANDBOX_DATA_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSandboxData(
  storage?: Pick<StorageLike, 'removeItem'> | null
): void {
  const target = storage === undefined ? getBrowserLocalStorage() : storage;
  if (!target) return;
  try {
    target.removeItem(SANDBOX_DATA_KEY);
  } catch {
    // ignore storage errors
  }
}

export function resolvePortalWriteTarget(options: {
  isFirebaseConfigured: boolean;
  sandboxActive: boolean;
}): 'sandbox' | 'cloud' | 'local' {
  if (options.sandboxActive) return 'sandbox';
  if (options.isFirebaseConfigured) return 'cloud';
  return 'local';
}
