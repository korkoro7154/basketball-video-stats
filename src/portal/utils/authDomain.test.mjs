import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_AUTH_PROXY_HOST,
  resolveFirebaseAuthDomain,
} from './authDomain.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

describe('resolveFirebaseAuthDomain', () => {
  it('uses the production Vercel host when running on the production domain', () => {
    assert.equal(
      resolveFirebaseAuthDomain({
        envAuthDomain: 'basketball-portal-11649.firebaseapp.com',
        hostname: 'basketball-video-stats.vercel.app',
      }),
      PRODUCTION_AUTH_PROXY_HOST
    );

    assert.equal(
      resolveFirebaseAuthDomain({
        envAuthDomain: 'basketball-portal-11649.firebaseapp.com',
        hostname: '  BASKETBALL-VIDEO-STATS.VERCEL.APP  ',
      }),
      PRODUCTION_AUTH_PROXY_HOST
    );

    assert.equal(
      resolveFirebaseAuthDomain({
        envAuthDomain: '',
        hostname: 'basketball-video-stats.vercel.app',
      }),
      PRODUCTION_AUTH_PROXY_HOST
    );
  });

  it('keeps VITE_FIREBASE_AUTH_DOMAIN on local development hosts', () => {
    const envDomain = 'basketball-portal-11649.firebaseapp.com';
    for (const hostname of ['localhost', '127.0.0.1', '192.168.11.49', 'macbook.local']) {
      assert.equal(
        resolveFirebaseAuthDomain({
          envAuthDomain: ` ${envDomain} `,
          hostname,
        }),
        envDomain
      );
    }
  });

  it('falls back to VITE_FIREBASE_AUTH_DOMAIN on preview, subdomain, or lookalike hosts', () => {
    const envDomain = 'basketball-portal-11649.firebaseapp.com';
    for (const hostname of [
      'basketball-video-stats-git-main-team.vercel.app',
      'sub.basketball-video-stats.vercel.app',
      'basketball-video-stats.vercel.app.example.com',
    ]) {
      assert.equal(
        resolveFirebaseAuthDomain({
          envAuthDomain: envDomain,
          hostname,
        }),
        envDomain
      );
    }
  });

  it('falls back safely when hostname or envAuthDomain is missing', () => {
    assert.equal(
      resolveFirebaseAuthDomain({
        envAuthDomain: 'basketball-portal-11649.firebaseapp.com',
        hostname: '',
      }),
      'basketball-portal-11649.firebaseapp.com'
    );
    assert.equal(
      resolveFirebaseAuthDomain({
        envAuthDomain: 'basketball-portal-11649.firebaseapp.com',
        hostname: undefined,
      }),
      'basketball-portal-11649.firebaseapp.com'
    );
    assert.equal(
      resolveFirebaseAuthDomain({
        envAuthDomain: null,
        hostname: null,
      }),
      ''
    );
  });
});

describe('vercel.json Firebase Auth proxy configuration', () => {
  it('preserves regions and functions config while adding auth and firebase rewrites', () => {
    const vercelConfigPath = path.join(repoRoot, 'vercel.json');
    const config = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));

    assert.deepEqual(config.regions, ['hnd1']);
    assert.deepEqual(config.functions, {
      'api/*.ts': {
        maxDuration: 45,
      },
    });
    assert.deepEqual(config.rewrites, [
      {
        source: '/__/auth/(.*)',
        destination: 'https://basketball-portal-11649.firebaseapp.com/__/auth/$1',
      },
      {
        source: '/__/firebase/(.*)',
        destination: 'https://basketball-portal-11649.firebaseapp.com/__/firebase/$1',
      },
    ]);
  });
});
