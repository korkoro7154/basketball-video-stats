import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SANDBOX_DATA_KEY,
  SANDBOX_ENABLED_KEY,
  canUseLocalSandbox,
  clearSandboxData,
  clonePortalData,
  isLocalSandboxHost,
  readSandboxData,
  readSandboxEnabled,
  resolvePortalWriteTarget,
  writeSandboxData,
  writeSandboxEnabled,
} from './sandbox.ts';

function createMockStorage(options = {}) {
  const store = new Map();
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      if (options.throwOnWrite) {
        throw new Error('QuotaExceededError');
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function makeSamplePortalData() {
  return {
    teamName: '都立駒場',
    players: [{ id: 'p1', number: '4', name: 'テスト選手' }],
    games: [
      {
        id: 'g1',
        title: '練習試合',
        date: '2026-11-22',
        opponent: 'テスト高校',
        category: '練習試合',
        homeScore: 60,
        awayScore: 55,
        matches: [
          {
            id: 'm1',
            label: '1試合目',
            teamUnit: 'A',
            opponent: 'テスト高校',
            homeScore: 60,
            awayScore: 55,
            videos: [
              {
                id: 'v1',
                label: '1Q',
                youtubeId: 'abc12345678',
                youtubeUrl: 'https://www.youtube.com/watch?v=abc12345678',
              },
            ],
            events: [],
          },
        ],
        videos: [],
        events: [],
      },
    ],
    practices: [],
    practiceTags: ['#速攻', '#DF'],
    adminPin: '1234',
    ownerEmails: ['owner@example.com'],
    allowedEmails: ['member@example.com'],
  };
}

describe('local sandbox detection', () => {
  it('detects localhost and local network hosts', () => {
    assert.equal(isLocalSandboxHost('localhost'), true);
    assert.equal(isLocalSandboxHost('127.0.0.1'), true);
    assert.equal(isLocalSandboxHost('192.168.11.49'), true);
    assert.equal(isLocalSandboxHost('macbook.local'), true);
    assert.equal(isLocalSandboxHost('10.0.0.5'), true);
    assert.equal(isLocalSandboxHost('172.16.1.10'), true);
  });

  it('allows local sandbox on local/dev hosts and blocks vercel/public production', () => {
    assert.equal(canUseLocalSandbox({ isDev: true, hostname: 'localhost' }), true);
    assert.equal(canUseLocalSandbox({ isDev: false, hostname: 'localhost' }), true);
    assert.equal(canUseLocalSandbox({ isDev: false, hostname: '127.0.0.1' }), true);
    assert.equal(canUseLocalSandbox({ isDev: false, hostname: '192.168.11.49' }), true);
    assert.equal(canUseLocalSandbox({ isDev: false, hostname: 'mac.local' }), true);

    assert.equal(
      canUseLocalSandbox({ isDev: false, hostname: 'basketball-video-stats.vercel.app' }),
      false
    );
    assert.equal(
      canUseLocalSandbox({ isDev: true, hostname: 'basketball-video-stats.vercel.app' }),
      false
    );
    assert.equal(
      canUseLocalSandbox({ isDev: false, hostname: 'portal.example.com' }),
      false
    );
  });
});

describe('resolvePortalWriteTarget', () => {
  it('never writes to cloud when sandboxActive is true', () => {
    assert.equal(
      resolvePortalWriteTarget({ isFirebaseConfigured: true, sandboxActive: true }),
      'sandbox'
    );
    assert.equal(
      resolvePortalWriteTarget({ isFirebaseConfigured: false, sandboxActive: true }),
      'sandbox'
    );
  });

  it('routes to cloud or local when sandboxActive is false', () => {
    assert.equal(
      resolvePortalWriteTarget({ isFirebaseConfigured: true, sandboxActive: false }),
      'cloud'
    );
    assert.equal(
      resolvePortalWriteTarget({ isFirebaseConfigured: false, sandboxActive: false }),
      'local'
    );
  });
});

describe('clonePortalData', () => {
  it('deep-clones portal data without mutating the source', () => {
    const source = makeSamplePortalData();
    const cloned = clonePortalData(source);

    cloned.teamName = 'テスト変更チーム';
    cloned.games[0].opponent = '変更相手';
    cloned.games[0].matches[0].videos[0].label = '変更後ラベル';
    cloned.practiceTags.push('#新タグ');

    assert.equal(source.teamName, '都立駒場');
    assert.equal(source.games[0].opponent, 'テスト高校');
    assert.equal(source.games[0].matches[0].videos[0].label, '1Q');
    assert.deepEqual(source.practiceTags, ['#速攻', '#DF']);
  });
});

describe('sandbox storage helpers', () => {
  it('reads, writes, and clears sandbox enabled flag', () => {
    const storage = createMockStorage();
    assert.equal(readSandboxEnabled(storage), false);

    writeSandboxEnabled(true, storage);
    assert.equal(storage.getItem(SANDBOX_ENABLED_KEY), '1');
    assert.equal(readSandboxEnabled(storage), true);

    writeSandboxEnabled(false, storage);
    assert.equal(storage.getItem(SANDBOX_ENABLED_KEY), null);
    assert.equal(readSandboxEnabled(storage), false);
  });

  it('reads, writes, clears sandbox data and handles invalid payloads', () => {
    const storage = createMockStorage();
    const sample = makeSamplePortalData();

    assert.equal(writeSandboxData(sample, storage), true);
    const loaded = readSandboxData(storage);
    assert.deepEqual(loaded, sample);

    clearSandboxData(storage);
    assert.equal(readSandboxData(storage), null);

    storage.setItem(SANDBOX_DATA_KEY, '{broken json');
    assert.equal(readSandboxData(storage), null);

    storage.setItem(SANDBOX_DATA_KEY, JSON.stringify({ teamName: 'only name' }));
    assert.equal(readSandboxData(storage), null);
  });

  it('returns false when storage write throws', () => {
    const storage = createMockStorage({ throwOnWrite: true });
    const sample = makeSamplePortalData();
    assert.equal(writeSandboxData(sample, storage), false);
  });
});
