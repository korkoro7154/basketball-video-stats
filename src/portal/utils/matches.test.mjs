import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectGameOrganizationStatus } from './matches.ts';

function makeClip(overrides = {}) {
  const idx = overrides.idx ?? 1;
  return {
    id: overrides.id ?? `clip_${idx}`,
    label: overrides.label ?? `${idx}Q`,
    youtubeTitle:
      overrides.youtubeTitle === undefined
        ? `20261122 都立駒場vsテスト高校 ${idx}Q`
        : overrides.youtubeTitle,
    youtubeId: overrides.youtubeId ?? `yt_${idx}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${overrides.youtubeId ?? `yt_${idx}`}`,
  };
}

function makeMatch(overrides = {}) {
  return {
    id: overrides.id ?? 'match_1',
    label: overrides.label ?? '1試合目',
    teamUnit: overrides.teamUnit ?? '',
    opponent: overrides.opponent ?? '相手高校',
    homeScore: overrides.homeScore ?? 0,
    awayScore: overrides.awayScore ?? 0,
    videos: overrides.videos ?? [],
    events: overrides.events ?? [],
    ...(overrides.manualBoxScore
      ? { manualBoxScore: overrides.manualBoxScore }
      : {}),
  };
}

function makeGame(overrides = {}) {
  return {
    id: overrides.id ?? 'game_1',
    title: overrides.title ?? '練習試合 vs 相手高校',
    date: overrides.date ?? '2026-11-22',
    opponent: overrides.opponent ?? '相手高校',
    category: overrides.category ?? '練習試合',
    homeScore: overrides.homeScore ?? 0,
    awayScore: overrides.awayScore ?? 0,
    matches: overrides.matches ?? [],
    videos: overrides.videos ?? [],
    events: overrides.events ?? [],
    ...(overrides.isOrganized !== undefined
      ? { isOrganized: overrides.isOrganized }
      : {}),
  };
}

describe('inspectGameOrganizationStatus', () => {
  it('returns needsReview=false for an already organized 2-match day (A/B with 1Q-4Q and youtubeTitle)', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          id: 'm1',
          label: '1試合目',
          teamUnit: 'A',
          opponent: '美原高校',
          videos: [
            makeClip({ id: 'c1', label: '1Q', youtubeId: 'a1' }),
            makeClip({ id: 'c2', label: '2Q', youtubeId: 'a2' }),
            makeClip({ id: 'c3', label: '3Q', youtubeId: 'a3' }),
            makeClip({ id: 'c4', label: '4Q', youtubeId: 'a4' }),
          ],
        }),
        makeMatch({
          id: 'm2',
          label: '2試合目',
          teamUnit: 'B',
          opponent: '国分寺高校',
          videos: [
            makeClip({ id: 'c5', label: '1Q前半', youtubeId: 'b1' }),
            makeClip({ id: 'c6', label: '1Q後半', youtubeId: 'b2' }),
          ],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, false);
    assert.deepEqual(status.reasons, []);
    assert.equal(status.matchCount, 2);
    assert.equal(status.videoCount, 6);
    assert.equal(status.missingYoutubeTitleCount, 0);
    assert.equal(status.matchPreview, 'A 1試合目(4本) / B 2試合目(2本)');
  });

  it('flags 5 or more clips crammed into one match', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          videos: [
            makeClip({ id: 'c1', label: '1Q', youtubeId: 'v1' }),
            makeClip({ id: 'c2', label: '2Q', youtubeId: 'v2' }),
            makeClip({ id: 'c3', label: '3Q', youtubeId: 'v3' }),
            makeClip({ id: 'c4', label: '4Q', youtubeId: 'v4' }),
            makeClip({ id: 'c5', label: '1Q', youtubeId: 'v5' }),
            makeClip({ id: 'c6', label: '2Q', youtubeId: 'v6' }),
          ],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, true);
    assert.ok(status.reasons.includes('1試合に6本集中'));
  });

  it('flags missing youtubeTitle on non-demo clips', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          videos: [
            makeClip({ id: 'c1', label: '1Q', youtubeId: 'v1', youtubeTitle: '' }),
            makeClip({ id: 'c2', label: '2Q', youtubeId: 'v2' }),
          ],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, true);
    assert.equal(status.missingYoutubeTitleCount, 1);
    assert.ok(status.reasons.includes('元タイトル未取得(1本)'));
  });

  it('flags placeholder clip labels like 動画1 / 動画2 / clip / multi-clip 試合動画', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          videos: [
            makeClip({ id: 'c1', label: '動画1', youtubeId: 'v1' }),
            makeClip({ id: 'c2', label: '動画2', youtubeId: 'v2' }),
          ],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, true);
    assert.ok(status.reasons.includes('仮ラベルあり'));
  });

  it('flags placeholder opponent names', () => {
    const game = makeGame({
      opponent: '対戦相手',
      matches: [
        makeMatch({
          opponent: '対戦相手',
          videos: [makeClip({ id: 'c1', label: '1Q', youtubeId: 'v1' })],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, true);
    assert.ok(status.reasons.includes('対戦相手が未設定'));
  });

  it('flags quarter clips split into 1-clip-per-match across 4+ matches', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          id: 'm1',
          label: '1試合目',
          videos: [makeClip({ id: 'c1', label: '1Q', youtubeId: 'v1' })],
        }),
        makeMatch({
          id: 'm2',
          label: '2試合目',
          videos: [makeClip({ id: 'c2', label: '2Q', youtubeId: 'v2' })],
        }),
        makeMatch({
          id: 'm3',
          label: '3試合目',
          videos: [makeClip({ id: 'c3', label: '3Q', youtubeId: 'v3' })],
        }),
        makeMatch({
          id: 'm4',
          label: '4試合目',
          videos: [makeClip({ id: 'c4', label: '4Q', youtubeId: 'v4' })],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, true);
    assert.ok(status.reasons.includes('1本ずつ細切れ'));
  });

  it('flags quarter order mismatch inside a match (e.g. 3Q before 1Q)', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          videos: [
            makeClip({ id: 'c1', label: '3Q', youtubeId: 'v1' }),
            makeClip({ id: 'c2', label: '1Q', youtubeId: 'v2' }),
          ],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.needsReview, true);
    assert.ok(status.reasons.includes('クォーター順ズレ'));
  });

  it('does not flag games with zero videos', () => {
    const game = makeGame({
      matches: [makeMatch({ opponent: '対戦相手', videos: [] })],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.videoCount, 0);
    assert.equal(status.needsReview, false);
    assert.deepEqual(status.reasons, []);
    assert.equal(status.matchPreview, '');
  });

  it('reports hasStats=true when any match has recorded scores or stats', () => {
    const game = makeGame({
      matches: [
        makeMatch({
          homeScore: 72,
          awayScore: 64,
          videos: [makeClip({ id: 'c1', label: '1-4Q', youtubeId: 'v1' })],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.hasStats, true);
    assert.equal(status.isOrganized, false);
  });

  it('excludes isOrganized=true games from needsReview even if unorganized patterns exist', () => {
    const game = makeGame({
      isOrganized: true,
      matches: [
        makeMatch({
          opponent: '対戦相手',
          videos: [
            makeClip({ id: 'c1', label: '動画1', youtubeId: 'v1', youtubeTitle: '' }),
            makeClip({ id: 'c2', label: '動画2', youtubeId: 'v2' }),
            makeClip({ id: 'c3', label: '3Q', youtubeId: 'v3' }),
            makeClip({ id: 'c4', label: '4Q', youtubeId: 'v4' }),
            makeClip({ id: 'c5', label: '5本目', youtubeId: 'v5' }),
          ],
        }),
      ],
    });

    const status = inspectGameOrganizationStatus(game);
    assert.equal(status.isOrganized, true);
    assert.equal(status.needsReview, false);
    assert.ok(status.reasons.length > 0);
  });
});
