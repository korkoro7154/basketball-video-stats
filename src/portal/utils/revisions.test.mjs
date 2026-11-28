import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_DIFF_CHANGES,
  buildPortalRevision,
  buildPortalUrlWithoutHistoryMode,
  computePortalRevisionStats,
  formatRevisionDateJst,
  isHistoryModeSearch,
  isOwnerEmail,
  summarizePortalDiff,
} from './revisions.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

function makeBoxEntry(playerId, pts = 0, ast = 0) {
  return {
    playerId,
    pts,
    fgm: Math.floor(pts / 2),
    fga: Math.floor(pts / 2) + 1,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    oreb: 1,
    dreb: 2,
    ast,
    stl: 0,
    blk: 0,
    to: 1,
    pf: 1,
  };
}

function makeSamplePortalData() {
  return {
    teamName: '駒81男バス',
    players: [
      { id: 'p1', number: '4', name: '佐藤 健', position: 'G', grade: '2年' },
      { id: 'p2', number: '7', name: '鈴木 陸', position: 'F', grade: '2年' },
    ],
    games: [
      {
        id: 'g1',
        title: '練習試合 vs 美原高校',
        date: '2026-11-22',
        opponent: '美原高校',
        category: '練習試合',
        homeScore: 62,
        awayScore: 54,
        isOrganized: false,
        matches: [
          {
            id: 'm1',
            label: '1試合目',
            teamUnit: 'A',
            opponent: '美原高校',
            homeScore: 62,
            awayScore: 54,
            videos: [
              {
                id: 'v1',
                label: '1Q',
                youtubeId: 'abc12345678',
                youtubeUrl: 'https://www.youtube.com/watch?v=abc12345678',
              },
            ],
            events: [],
            manualBoxScore: {
              p1: makeBoxEntry('p1', 16, 4),
            },
          },
        ],
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
    practices: [
      {
        id: 'pr1',
        title: '速攻ドリル',
        date: '2026-11-20',
        youtubeId: 'prac1234567',
        youtubeUrl: 'https://www.youtube.com/watch?v=prac1234567',
        tags: ['#速攻'],
        memo: '走り出し意識',
        moments: [{ id: 'mo1', timestampSec: 45, label: 'ナイスパス' }],
      },
    ],
    practiceTags: ['#速攻', '#ディフェンス'],
    adminPin: '1234',
    ownerEmails: ['kokoronan7@gmail.com', 'subowner@example.com'],
    allowedEmails: ['kokoronan7@gmail.com', 'member@example.com'],
  };
}

describe('isOwnerEmail', () => {
  it('recognizes default owner and ownerEmails case-insensitively and rejects others', () => {
    const data = makeSamplePortalData();

    assert.equal(isOwnerEmail('kokoronan7@gmail.com', data), true);
    assert.equal(isOwnerEmail('  KOKORONAN7@GMAIL.COM ', null), true);
    assert.equal(isOwnerEmail('SubOwner@Example.com', data), true);

    assert.equal(isOwnerEmail('member@example.com', data), false);
    assert.equal(isOwnerEmail('stranger@example.com', data), false);
    assert.equal(isOwnerEmail('', data), false);
    assert.equal(isOwnerEmail(null, data), false);
    assert.equal(isOwnerEmail(undefined, data), false);
  });
});

describe('history mode URL helpers', () => {
  it('detects ?mode=history and strips only mode parameter while preserving others', () => {
    assert.equal(isHistoryModeSearch('?mode=history'), true);
    assert.equal(isHistoryModeSearch('?foo=1&mode=history&bar=2'), true);
    assert.equal(isHistoryModeSearch('?mode=normal'), false);
    assert.equal(isHistoryModeSearch(''), false);

    assert.equal(
      buildPortalUrlWithoutHistoryMode(
        'https://basketball-video-stats.vercel.app/?mode=history'
      ),
      '/'
    );
    assert.equal(
      buildPortalUrlWithoutHistoryMode(
        'https://basketball-video-stats.vercel.app/app?tab=games&mode=history#top'
      ),
      '/app?tab=games#top'
    );
    assert.equal(buildPortalUrlWithoutHistoryMode('invalid-url'), '/');
  });
});

describe('computePortalRevisionStats', () => {
  it('counts gameDays, matches, scoredMatches, players, and practices', () => {
    const data = makeSamplePortalData();
    data.games[0].matches.push({
      id: 'm2',
      label: '2試合目',
      teamUnit: 'B',
      opponent: '国分寺高校',
      homeScore: 0,
      awayScore: 0,
      videos: [],
      events: [],
    });

    const stats = computePortalRevisionStats(data);
    assert.deepEqual(stats, {
      gameDays: 1,
      matches: 2,
      scoredMatches: 1,
      players: 2,
      practices: 1,
    });
  });
});

describe('summarizePortalDiff', () => {
  it('returns hasChanges=false when semantically identical even with key order or undefined fields', () => {
    const before = makeSamplePortalData();
    const after = {
      allowedEmails: [...before.allowedEmails],
      ownerEmails: [...before.ownerEmails],
      adminPin: before.adminPin,
      practiceTags: [...before.practiceTags],
      practices: JSON.parse(JSON.stringify(before.practices)),
      games: JSON.parse(JSON.stringify(before.games)),
      players: JSON.parse(JSON.stringify(before.players)),
      teamName: before.teamName,
    };
    after.games[0].notes = undefined;

    const diff = summarizePortalDiff(before, after);
    assert.equal(diff.hasChanges, false);
    assert.equal(diff.actionSummary, '');
    assert.deepEqual(diff.changes, []);
  });

  it('summarizes added and deleted game days', () => {
    const base = makeSamplePortalData();
    const withAdded = makeSamplePortalData();
    withAdded.games.push({
      id: 'g2',
      title: '練習試合 vs 電機大高校',
      date: '2026-11-28',
      opponent: '電機大高校',
      category: '練習試合',
      homeScore: 0,
      awayScore: 0,
      matches: [
        {
          id: 'm2_1',
          label: '1試合目',
          teamUnit: 'A',
          opponent: '電機大高校',
          homeScore: 0,
          awayScore: 0,
          videos: [
            {
              id: 'v2_1',
              label: '1Q',
              youtubeId: 'xyz12345678',
              youtubeUrl: 'https://www.youtube.com/watch?v=xyz12345678',
            },
          ],
          events: [],
        },
      ],
      videos: [],
      events: [],
    });

    const addDiff = summarizePortalDiff(base, withAdded);
    assert.equal(addDiff.hasChanges, true);
    assert.ok(addDiff.actionSummary.includes('試合日を追加'));
    assert.ok(addDiff.changes[0].includes('2026-11-28'));
    assert.ok(addDiff.changes[0].includes('1試合・動画1本'));

    const delDiff = summarizePortalDiff(withAdded, base);
    assert.equal(delDiff.hasChanges, true);
    assert.ok(delDiff.actionSummary.includes('試合日を削除'));
    assert.ok(delDiff.changes[0].includes('電機大高校'));
  });

  it('summarizes match score/boxScore/events updates and video organization/isOrganized changes', () => {
    const before = makeSamplePortalData();
    const afterScoreBox = makeSamplePortalData();
    afterScoreBox.games[0].matches[0].homeScore = 70;
    afterScoreBox.games[0].matches[0].awayScore = 58;
    afterScoreBox.games[0].matches[0].manualBoxScore = {
      p1: makeBoxEntry('p1', 20, 6),
      p2: makeBoxEntry('p2', 50, 2),
    };

    const scoreBoxDiff = summarizePortalDiff(before, afterScoreBox);
    assert.equal(scoreBoxDiff.hasChanges, true);
    assert.ok(
      scoreBoxDiff.changes.some(
        (c) =>
          c.includes('スコア・ボックススコアを更新') &&
          c.includes('16-54 → 70-58')
      )
    );

    const afterBoxOnly = makeSamplePortalData();
    afterBoxOnly.games[0].matches[0].manualBoxScore = {
      p1: makeBoxEntry('p1', 16, 7),
    };
    const boxOnlyDiff = summarizePortalDiff(before, afterBoxOnly);
    assert.ok(
      boxOnlyDiff.changes.some((c) => c.includes('ボックススコアを変更'))
    );

    const afterEventsOnly = makeSamplePortalData();
    afterEventsOnly.games[0].matches[0].events = [
      {
        id: 'ev1',
        quarter: '1Q',
        timestampSec: 12,
        team: 'home',
        playerId: 'p1',
        type: 'AST',
      },
    ];
    const eventsDiff = summarizePortalDiff(before, afterEventsOnly);
    assert.ok(
      eventsDiff.changes.some((c) => c.includes('プレイ履歴を変更（0件 → 1件）'))
    );

    const afterOrganized = makeSamplePortalData();
    afterOrganized.games[0].isOrganized = true;
    afterOrganized.games[0].matches.push({
      id: 'm_new',
      label: '2試合目',
      teamUnit: 'B',
      opponent: '美原高校',
      homeScore: 0,
      awayScore: 0,
      videos: [
        {
          id: 'v_new',
          label: '1Q',
          youtubeId: 'new12345678',
          youtubeUrl: 'https://www.youtube.com/watch?v=new12345678',
        },
      ],
      events: [],
    });
    const orgDiff = summarizePortalDiff(before, afterOrganized);
    assert.ok(orgDiff.changes.some((c) => c.includes('整理済みに変更')));
    assert.ok(orgDiff.changes.some((c) => c.includes('試合・動画構成を変更')));
  });

  it('summarizes practice video additions, deletions, and modifications', () => {
    const before = makeSamplePortalData();
    const after = makeSamplePortalData();
    after.practices[0].title = '速攻3メン';
    after.practices[0].tags = ['#速攻', '#シュート'];
    after.practices.push({
      id: 'pr2',
      title: 'シューティング',
      date: '2026-11-25',
      youtubeId: 'prac2345678',
      youtubeUrl: 'https://www.youtube.com/watch?v=prac2345678',
      tags: ['#シュート'],
      moments: [],
    });

    const diff = summarizePortalDiff(before, after);
    assert.equal(diff.hasChanges, true);
    assert.ok(diff.changes.some((c) => c.includes('練習動画を追加')));
    assert.ok(
      diff.changes.some(
        (c) =>
          c.includes('練習動画「速攻3メン」を更新') &&
          c.includes('タイトル') &&
          c.includes('タグ')
      )
    );
  });

  it('summarizes single and bulk roster changes cleanly', () => {
    const before = makeSamplePortalData();
    const afterBulk = makeSamplePortalData();
    for (let i = 10; i <= 14; i += 1) {
      afterBulk.players.push({
        id: `p_${i}`,
        number: String(i),
        name: `新入生${i}`,
      });
    }
    afterBulk.players[0].name = '佐藤 健太';

    const bulkDiff = summarizePortalDiff(before, afterBulk);
    assert.ok(
      bulkDiff.changes.some((c) => c.includes('選手を5名追加') && c.includes('ほか2名'))
    );
    assert.ok(
      bulkDiff.changes.some((c) => c.includes('選手情報を変更：#4 佐藤 健 → #4 佐藤 健太'))
    );
  });

  it('summarizes settings changes without leaking adminPin digits', () => {
    const before = makeSamplePortalData();
    const after = makeSamplePortalData();
    after.teamName = '都立駒場 男子バスケ部';
    after.adminPin = '9876';
    after.practiceTags = ['#速攻', '#リバウンド'];
    after.ownerEmails = ['kokoronan7@gmail.com'];
    after.allowedEmails = [
      'kokoronan7@gmail.com',
      'member@example.com',
      'newmember@example.com',
    ];

    const diff = summarizePortalDiff(before, after);
    assert.equal(diff.hasChanges, true);
    assert.ok(
      diff.changes.some((c) => c.includes('チーム名を変更（駒81男バス → 都立駒場 男子バスケ部）'))
    );
    assert.ok(diff.changes.includes('管理者PINを変更'));
    assert.ok(!diff.actionSummary.includes('9876'));
    assert.ok(!diff.actionSummary.includes('1234'));
    assert.ok(diff.changes.every((c) => !c.includes('9876') && !c.includes('1234')));
    assert.ok(diff.changes.some((c) => c.includes('練習タグを追加：#リバウンド')));
    assert.ok(diff.changes.some((c) => c.includes('練習タグを削除：#ディフェンス')));
    assert.ok(diff.changes.some((c) => c.includes('オーナー権限を削除')));
    assert.ok(diff.changes.some((c) => c.includes('ログイン許可メンバーを追加')));
  });

  it('caps changes array to 10 entries when more than 10 changes occur', () => {
    const before = makeSamplePortalData();
    const after = makeSamplePortalData();
    for (let i = 1; i <= 12; i += 1) {
      after.games.push({
        id: `g_extra_${i}`,
        title: `試合${i}`,
        date: `2026-10-${String(i).padStart(2, '0')}`,
        opponent: `相手${i}校`,
        category: '練習試合',
        homeScore: 0,
        awayScore: 0,
        matches: [],
        videos: [],
        events: [],
      });
    }

    const diff = summarizePortalDiff(before, after);
    assert.equal(diff.hasChanges, true);
    assert.equal(diff.changes.length, MAX_DIFF_CHANGES);
    assert.equal(diff.changes[MAX_DIFF_CHANGES - 1], 'ほか 3 件の変更');
    assert.equal(diff.actionSummary, '試合日を12日追加');
  });
});

describe('buildPortalRevision & formatRevisionDateJst', () => {
  it('returns null when there are no differences unless overrideActionSummary is supplied', () => {
    const before = makeSamplePortalData();
    const same = makeSamplePortalData();
    assert.equal(
      buildPortalRevision({
        actorEmail: 'kokoronan7@gmail.com',
        actorName: '顧問',
        before,
        after: same,
      }),
      null
    );

    const backupRev = buildPortalRevision({
      actorEmail: 'kokoronan7@gmail.com',
      actorName: '顧問',
      before,
      after: same,
      overrideActionSummary: '復元前の控え',
      overrideChanges: ['復元対象：テスト'],
    });
    assert.ok(backupRev);
    assert.equal(backupRev.actionSummary, '復元前の控え');
    assert.deepEqual(backupRev.changes, ['復元対象：テスト']);
  });

  it('deep-clones beforeSnapshot so later mutations do not affect the revision', () => {
    const before = makeSamplePortalData();
    const after = makeSamplePortalData();
    after.teamName = '変更後チーム';

    const rev = buildPortalRevision({
      id: 'rev_test_1',
      createdAt: '2026-11-28T13:05:09.000Z',
      actorEmail: 'kokoronan7@gmail.com',
      actorName: '顧問',
      before,
      after,
    });
    assert.ok(rev);
    before.teamName = 'あとから改変';
    assert.equal(rev.beforeSnapshot.teamName, '駒81男バス');
    assert.equal(formatRevisionDateJst(rev.createdAt), '2026/11/28(土) 22:05:09');
  });
});

describe('firestore.rules revisions security structure', () => {
  it('preserves /portal/main rule and protects /portal/main/revisions/{revisionId}', () => {
    const rulesPath = path.join(repoRoot, 'firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    assert.match(rules, /match \/portal\/main\s*\{[\s\S]*allow read, write:/);
    assert.match(
      rules,
      /match \/portal\/main\/revisions\/\{revisionId\}\s*\{[\s\S]*allow create:\s*if isPortalMember\(\);[\s\S]*allow read,\s*delete:\s*if isPortalOwner\(\);[\s\S]*allow update:\s*if false;[\s\S]*\}/
    );
  });
});
