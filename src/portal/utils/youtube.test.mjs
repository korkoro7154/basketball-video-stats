import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAiOrganizedMatches,
  getGameMatches,
  syncGameFromMatches,
} from './matches.ts';
import { computeMatchSummary } from './stats.ts';
import {
  buildMatchesFromParsedEntries,
  collectAllRegisteredVideoIds,
  collectRegisteredGameVideoIds,
  collectRegisteredPracticeVideoIds,
  findMatchingSummaryGameIndex,
  groupPlaylistVideosByDate,
  inferDateFromText,
  inferOpponentFromTitle,
  inferPlaylistKind,
  mergeSummaryDateGroupsIntoGames,
  parseGameVideoTitle,
  shouldStopFetchingOlderPages,
} from './youtube.ts';

test('parseGameVideoTitle handles all actual title patterns accurately', () => {
  const cases = [
    {
      title: '【練習試合】vs正則学園B②20261123',
      date: '2026-11-23',
      opponent: '正則学園',
      teamUnit: 'B',
      gameNumber: 2,
    },
    {
      title: '【練習試合】vs正則学園B①20261123',
      date: '2026-11-23',
      opponent: '正則学園',
      teamUnit: 'B',
      gameNumber: 1,
    },
    {
      title: '【練習試合】vs正則学園②20261123',
      date: '2026-11-23',
      opponent: '正則学園',
      teamUnit: '',
      gameNumber: 2,
    },
    {
      title: '【練習試合】vs正則学園①20261123',
      date: '2026-11-23',
      opponent: '正則学園',
      teamUnit: '',
      gameNumber: 1,
    },
    {
      title: '【練習試合】vs都小山台B②20261123',
      date: '2026-11-23',
      opponent: '都小山台',
      teamUnit: 'B',
      gameNumber: 2,
    },
    {
      title: '【練習試合】vs大宮北B20261122',
      date: '2026-11-22',
      opponent: '大宮北',
      teamUnit: 'B',
      gameNumber: null,
    },
    {
      title: '【練習試合】vs大宮北②20261122',
      date: '2026-11-22',
      opponent: '大宮北',
      teamUnit: '',
      gameNumber: 2,
    },
    {
      title: '【練習試合】vs大宮北①20261122',
      date: '2026-11-22',
      opponent: '大宮北',
      teamUnit: '',
      gameNumber: 1,
    },
    {
      title: '【練習試合】駒場VS都立杉並 20260620 ⑦',
      date: '2026-06-20',
      opponent: '都立杉並',
      teamUnit: '',
      gameNumber: 7,
    },
  ];

  for (const c of cases) {
    const parsed = parseGameVideoTitle(c.title, '2026-11-24T00:00:00Z');
    assert.equal(parsed.date, c.date, `date mismatch for ${c.title}`);
    assert.equal(parsed.resolvedDate, c.date, `resolvedDate mismatch for ${c.title}`);
    assert.equal(parsed.opponent, c.opponent, `opponent mismatch for ${c.title}`);
    assert.equal(parsed.teamUnit, c.teamUnit, `teamUnit mismatch for ${c.title}`);
    assert.equal(parsed.gameNumber, c.gameNumber, `gameNumber mismatch for ${c.title}`);
    assert.equal(parsed.quarterLabel, null);
  }
});

test('parseGameVideoTitle and infer helpers handle A team, full-width, acronyms, and invalid dates', () => {
  const aTeam = parseGameVideoTitle('【練習試合】vs正則学園A①20261123');
  assert.equal(aTeam.opponent, '正則学園');
  assert.equal(aTeam.teamUnit, 'A');
  assert.equal(aTeam.gameNumber, 1);
  assert.equal(aTeam.date, '2026-11-23');

  const parenB = parseGameVideoTitle('【練習試合】vs正則学園（B）① 20261123');
  assert.equal(parenB.opponent, '正則学園');
  assert.equal(parenB.teamUnit, 'B');
  assert.equal(parenB.gameNumber, 1);

  const spacedB = parseGameVideoTitle('【練習試合】vs正則学園 B ① 20261123');
  assert.equal(spacedB.opponent, '正則学園');
  assert.equal(spacedB.teamUnit, 'B');
  assert.equal(spacedB.gameNumber, 1);

  const fullWidth = parseGameVideoTitle('【練習試合】ＶＳ大宮北Ａ②２０２６１１２２');
  assert.equal(fullWidth.opponent, '大宮北');
  assert.equal(fullWidth.teamUnit, 'A');
  assert.equal(fullWidth.gameNumber, 2);
  assert.equal(fullWidth.date, '2026-11-22');

  const beforeUnit = parseGameVideoTitle('【B戦】vs正則学園 20261123');
  assert.equal(beforeUnit.opponent, '正則学園');
  assert.equal(beforeUnit.teamUnit, 'B');

  const acronym = parseGameVideoTitle('【練習試合】vsKBA 20261123');
  assert.equal(acronym.opponent, 'KBA');
  assert.equal(acronym.teamUnit, '');

  const quarterClip = parseGameVideoTitle('【練習試合】vs正則学園 20261123 1Q');
  assert.equal(quarterClip.opponent, '正則学園');
  assert.equal(quarterClip.quarterLabel, '1Q');

  // Invalid calendar date (Feb 30) falls back cleanly
  assert.equal(
    inferDateFromText('20260230 vsテスト', '2026-11-24T00:00:00Z'),
    '2026-11-24'
  );
  assert.equal(
    inferDateFromText('【練習試合】vs大宮北B20261122', '2026-11-24T00:00:00Z'),
    '2026-11-22'
  );
  assert.equal(inferOpponentFromTitle('【練習試合】vs正則学園B②20261123'), '正則学園');
  assert.equal(inferPlaylistKind('【下級生】練習試合'), 'game');
  assert.equal(inferPlaylistKind('シューティング練習'), 'practice');
});

test('shouldStopFetchingOlderPages stops newest-first playlists early after sinceDate', () => {
  const newPage = [
    { videoId: 'v1', title: 'vsA①20261123', publishedAt: '2026-11-23T12:00:00Z', position: 0 },
    { videoId: 'v2', title: 'vsA②20261122', publishedAt: '2026-11-22T12:00:00Z', position: 1 },
  ];
  assert.equal(shouldStopFetchingOlderPages(newPage, newPage, '2026-11-22'), false);

  const mixedOldPage = [
    { videoId: 'v3', title: 'vsB①20261122', publishedAt: '2026-11-22T10:00:00Z', position: 2 },
    { videoId: 'v4', title: 'vsC①20261120', publishedAt: '2026-11-20T10:00:00Z', position: 3 },
    { videoId: 'v5', title: 'vsC②20261119', publishedAt: '2026-11-19T10:00:00Z', position: 4 },
    { videoId: 'v6', title: 'vsD①20261118', publishedAt: '2026-11-18T10:00:00Z', position: 5 },
    { videoId: 'v7', title: 'vsD②20261117', publishedAt: '2026-11-17T10:00:00Z', position: 6 },
    { videoId: 'v8', title: 'vsE①20261116', publishedAt: '2026-11-16T10:00:00Z', position: 7 },
  ];
  assert.equal(
    shouldStopFetchingOlderPages(mixedOldPage, [...newPage, ...mixedOldPage], '2026-11-22'),
    true
  );

  // Oldest-first (ascending) playlist should NOT stop prematurely
  const ascPage = [
    { videoId: 'a1', title: 'vsX①20260401', publishedAt: '2026-04-01T10:00:00Z', position: 0 },
    { videoId: 'a2', title: 'vsX②20260402', publishedAt: '2026-04-02T10:00:00Z', position: 1 },
    { videoId: 'a3', title: 'vsY①20260403', publishedAt: '2026-04-03T10:00:00Z', position: 2 },
  ];
  assert.equal(shouldStopFetchingOlderPages(ascPage, ascPage, '2026-11-22'), false);
});

test('groupPlaylistVideosByDate filters by sinceDate, groups by date, and restores ①→② order', () => {
  const samplePlaylistVideos = [
    { videoId: 'vid_01', title: '【練習試合】vs正則学園B②20261123', publishedAt: '2026-11-23T18:00:00Z', position: 0 },
    { videoId: 'vid_02', title: '【練習試合】vs正則学園B①20261123', publishedAt: '2026-11-23T17:00:00Z', position: 1 },
    { videoId: 'vid_03', title: '【練習試合】vs正則学園②20261123', publishedAt: '2026-11-23T16:00:00Z', position: 2 },
    { videoId: 'vid_04', title: '【練習試合】vs正則学園①20261123', publishedAt: '2026-11-23T15:00:00Z', position: 3 },
    { videoId: 'vid_05', title: '【練習試合】vs都小山台B②20261123', publishedAt: '2026-11-23T14:00:00Z', position: 4 },
    { videoId: 'vid_06', title: '【練習試合】vs大宮北B20261122', publishedAt: '2026-11-22T18:00:00Z', position: 5 },
    { videoId: 'vid_07', title: '【練習試合】vs大宮北②20261122', publishedAt: '2026-11-22T17:00:00Z', position: 6 },
    { videoId: 'vid_08', title: '【練習試合】vs大宮北①20261122', publishedAt: '2026-11-22T16:00:00Z', position: 7 },
    { videoId: 'vid_09', title: '【練習試合】駒場VS都立杉並 20260620 ⑦', publishedAt: '2026-06-20T16:00:00Z', position: 8 },
  ];

  const res = groupPlaylistVideosByDate(samplePlaylistVideos, {
    sinceDate: '2026-11-22',
    registeredVideoIds: new Set(['vid_08', 'vid_07', 'vid_06']),
  });

  assert.equal(res.filteredOutCount, 1);
  assert.equal(res.groups.length, 2);

  const day23 = res.groups[0];
  assert.equal(day23.date, '2026-11-23');
  assert.deepEqual(day23.opponents, ['都小山台', '正則学園']);
  assert.equal(day23.totalCount, 5);
  assert.equal(day23.unregisteredCount, 5);
  assert.equal(day23.allRegistered, false);
  assert.deepEqual(
    day23.entries.map((e) => e.video.videoId),
    ['vid_05', 'vid_04', 'vid_03', 'vid_02', 'vid_01']
  );

  const day22 = res.groups[1];
  assert.equal(day22.date, '2026-11-22');
  assert.deepEqual(day22.opponents, ['大宮北']);
  assert.equal(day22.totalCount, 3);
  assert.equal(day22.unregisteredCount, 0);
  assert.equal(day22.allRegistered, true);
  assert.deepEqual(
    day22.entries.map((e) => e.video.videoId),
    ['vid_08', 'vid_07', 'vid_06']
  );
});

test('cross-portal collectors and mergeSummaryDateGroupsIntoGames prevent duplicates across games and matches', () => {
  const existingGames = [
    {
      id: 'g_other_playlist',
      title: '11/22 大宮北戦（個別リスト）',
      date: '2026-11-20',
      opponent: '別日テスト',
      category: '練習試合',
      homeScore: 0,
      awayScore: 0,
      youtubePlaylistId: 'PL_OTHER',
      matches: [
        {
          id: 'm_existing_1',
          label: '1試合目',
          teamUnit: '',
          opponent: '別日テスト',
          homeScore: 0,
          awayScore: 0,
          videos: [
            {
              id: 'c_1',
              label: '試合動画',
              youtubeTitle: '既存動画',
              youtubeId: 'vid_08',
              youtubeUrl: 'https://www.youtube.com/watch?v=vid_08',
            },
          ],
          events: [],
        },
      ],
      videos: [], // intentionally empty to verify matches[].videos traversal
      events: [],
    },
    {
      id: 'g_same_day_23',
      title: '【下級生】練習試合（11/23）',
      date: '2026-11-23',
      opponent: '都小山台',
      category: '練習試合',
      homeScore: 0,
      awayScore: 0,
      matches: [
        {
          id: 'm_existing_23',
          label: '2試合目',
          teamUnit: 'B',
          opponent: '都小山台',
          homeScore: 0,
          awayScore: 0,
          videos: [
            {
              id: 'c_2',
              label: '試合動画',
              youtubeTitle: '【練習試合】vs都小山台B②20261123',
              youtubeId: 'vid_05',
              youtubeUrl: 'https://www.youtube.com/watch?v=vid_05',
            },
          ],
          events: [],
        },
      ],
      videos: [
        {
          id: 'c_2',
          label: '試合動画',
          youtubeTitle: '【練習試合】vs都小山台B②20261123',
          youtubeId: 'vid_05',
          youtubeUrl: 'https://www.youtube.com/watch?v=vid_05',
        },
      ],
      events: [],
    },
  ];

  const existingPractices = [
    {
      id: 'p_1',
      title: '練習テスト',
      date: '2026-11-21',
      youtubeId: 'prac_vid_1',
      youtubeUrl: 'https://www.youtube.com/watch?v=prac_vid_1',
      tags: ['#速攻'],
      moments: [],
    },
  ];

  const gameIds = collectRegisteredGameVideoIds(existingGames);
  assert.equal(gameIds.has('vid_08'), true);
  assert.equal(gameIds.has('vid_05'), true);
  assert.equal(collectRegisteredPracticeVideoIds(existingPractices).has('prac_vid_1'), true);

  const allIds = collectAllRegisteredVideoIds({
    games: existingGames,
    practices: existingPractices,
  });
  assert.equal(allIds.has('vid_08'), true);
  assert.equal(allIds.has('vid_05'), true);
  assert.equal(allIds.has('prac_vid_1'), true);

  const videos = [
    { videoId: 'vid_01', title: '【練習試合】vs正則学園B②20261123', publishedAt: '2026-11-23T18:00:00Z', position: 0 },
    { videoId: 'vid_04', title: '【練習試合】vs正則学園①20261123', publishedAt: '2026-11-23T15:00:00Z', position: 1 },
    { videoId: 'vid_05', title: '【練習試合】vs都小山台B②20261123', publishedAt: '2026-11-23T14:00:00Z', position: 2 },
    { videoId: 'vid_08', title: '【練習試合】vs大宮北①20261122', publishedAt: '2026-11-22T16:00:00Z', position: 3 },
  ];

  const grouped = groupPlaylistVideosByDate(videos, {
    sinceDate: '2026-11-22',
    registeredVideoIds: gameIds,
  });

  // 2026-11-22 has only vid_08 which is already in g_other_playlist -> allRegistered === true
  const group22 = grouped.groups.find((g) => g.date === '2026-11-22');
  assert.ok(group22);
  assert.equal(group22.allRegistered, true);

  // Even if caller passes ALL groups including already-registered 2026-11-22:
  let seq = 0;
  const createId = (p) => `${p}_${++seq}`;
  const firstMerge = mergeSummaryDateGroupsIntoGames({
    prevGames: existingGames,
    groups: grouped.groups,
    playlistTitle: '【下級生】練習試合',
    createId,
  });

  // Should NOT create a new game for 2026-11-22, and should append ONLY vid_04 & vid_01 to g_same_day_23
  assert.equal(firstMerge.addedGames, 0);
  assert.equal(firstMerge.updatedGames, 1);
  assert.equal(firstMerge.addedVideos, 2);
  assert.equal(firstMerge.skippedDays, 1);
  assert.equal(firstMerge.nextGames.length, 2);

  const updated23 = firstMerge.nextGames.find((g) => g.id === 'g_same_day_23');
  assert.ok(updated23);
  assert.equal(updated23.matches.length, 3);
  assert.deepEqual(
    updated23.matches.map((m) => ({
      opponent: m.opponent,
      teamUnit: m.teamUnit,
      label: m.label,
      ytId: m.videos[0]?.youtubeId,
      ytTitle: m.videos[0]?.youtubeTitle,
    })),
    [
      {
        opponent: '都小山台',
        teamUnit: 'B',
        label: '2試合目',
        ytId: 'vid_05',
        ytTitle: '【練習試合】vs都小山台B②20261123',
      },
      {
        opponent: '正則学園',
        teamUnit: '',
        label: '1試合目',
        ytId: 'vid_04',
        ytTitle: '【練習試合】vs正則学園①20261123',
      },
      {
        opponent: '正則学園',
        teamUnit: 'B',
        label: '2試合目',
        ytId: 'vid_01',
        ytTitle: '【練習試合】vs正則学園B②20261123',
      },
    ]
  );

  // Re-running merge a second time must be a complete no-op
  const secondMerge = mergeSummaryDateGroupsIntoGames({
    prevGames: firstMerge.nextGames,
    groups: grouped.groups,
    playlistTitle: '【下級生】練習試合',
    createId,
  });
  assert.equal(secondMerge.addedGames, 0);
  assert.equal(secondMerge.updatedGames, 0);
  assert.equal(secondMerge.addedVideos, 0);
  assert.equal(secondMerge.skippedDays, 2);

  // Creating a brand-new date group (e.g. 2026-11-24) produces 3-layer GameRecord
  const freshGrouped = groupPlaylistVideosByDate(
    [
      {
        videoId: 'fresh_1',
        title: '【練習試合】vs大宮北B20261124',
        publishedAt: '2026-11-24T10:00:00Z',
        position: 0,
      },
    ],
    { sinceDate: '2026-11-22' }
  );
  const directMatches = buildMatchesFromParsedEntries(freshGrouped.groups[0].entries, {
    createId,
  });
  assert.equal(directMatches.length, 1);
  assert.equal(directMatches[0].teamUnit, 'B');
  assert.equal(directMatches[0].opponent, '大宮北');
  assert.equal(directMatches[0].label, '1試合目');
  assert.equal(directMatches[0].videos[0].youtubeTitle, '【練習試合】vs大宮北B20261124');

  const thirdMerge = mergeSummaryDateGroupsIntoGames({
    prevGames: firstMerge.nextGames,
    groups: freshGrouped.groups,
    playlistTitle: '【下級生】練習試合',
    createId,
  });
  assert.equal(thirdMerge.addedGames, 1);
  assert.equal(thirdMerge.nextGames[0].date, '2026-11-24');
  assert.equal(thirdMerge.nextGames[0].title, '【下級生】練習試合（11/24）');
  assert.equal(thirdMerge.nextGames[0].youtubePlaylistId, undefined);
});

test('mergeSummaryDateGroupsIntoGames with applyAiOrganizedMatches protects existing stats and handles partial AI failure', () => {
  const existingBox = {
    p1: {
      playerId: 'p1',
      pts: 18,
      fgm: 7,
      fga: 12,
      tpm: 2,
      tpa: 4,
      ftm: 2,
      fta: 2,
      oreb: 1,
      dreb: 4,
      ast: 3,
      stl: 2,
      blk: 0,
      to: 1,
      pf: 2,
    },
    p2: {
      playerId: 'p2',
      pts: 24,
      fgm: 10,
      fga: 15,
      tpm: 2,
      tpa: 5,
      ftm: 2,
      fta: 3,
      oreb: 2,
      dreb: 3,
      ast: 4,
      stl: 1,
      blk: 1,
      to: 2,
      pf: 1,
    },
  };
  const existingEvents = [
    {
      id: 'ev_1',
      videoClipId: 'clip_existing_1q',
      quarter: '1Q',
      timestampSec: 45,
      team: 'home',
      playerId: 'p1',
      type: '2P_MADE',
    },
  ];
  const prevGames = [
    {
      id: 'g_with_stats',
      title: '【下級生】練習試合（11/23）',
      date: '2026-11-23',
      opponent: '正則学園',
      category: '練習試合',
      homeScore: 42,
      awayScore: 35,
      notes: '「【下級生】練習試合」より取り込み',
      matches: [
        {
          id: 'match_stats_1',
          label: '1試合目',
          teamUnit: '',
          opponent: '正則学園',
          homeScore: 42,
          awayScore: 35,
          videos: [
            {
              id: 'clip_existing_1q',
              label: '1Q',
              youtubeTitle: '【練習試合】vs正則学園①20261123 1Q',
              youtubeId: 'yt_old_1q',
              youtubeUrl: 'https://www.youtube.com/watch?v=yt_old_1q',
            },
          ],
          events: existingEvents,
          manualBoxScore: existingBox,
        },
      ],
      videos: [
        {
          id: 'clip_existing_1q',
          label: '1Q',
          youtubeTitle: '【練習試合】vs正則学園①20261123 1Q',
          youtubeId: 'yt_old_1q',
          youtubeUrl: 'https://www.youtube.com/watch?v=yt_old_1q',
        },
      ],
      events: [],
    },
  ];

  const grouped = groupPlaylistVideosByDate(
    [
      {
        videoId: 'yt_old_1q',
        title: '【練習試合】vs正則学園①20261123 1Q',
        publishedAt: '2026-11-23T14:00:00Z',
        position: 0,
      },
      {
        videoId: 'yt_new_2q',
        title: '【練習試合】vs正則学園①20261123 2Q',
        publishedAt: '2026-11-23T15:00:00Z',
        position: 1,
      },
      {
        videoId: 'yt_new_b2',
        title: '【練習試合】vs正則学園B②20261123',
        publishedAt: '2026-11-23T16:00:00Z',
        position: 2,
      },
      {
        videoId: 'yt_day22_1',
        title: '【練習試合】vs大宮北B20261122',
        publishedAt: '2026-11-22T15:00:00Z',
        position: 3,
      },
    ],
    {
      sinceDate: '2026-11-22',
      registeredVideoIds: collectRegisteredGameVideoIds(prevGames),
    }
  );

  // Simulate UI pre-filtering and AI call ONLY on 2026-11-23 (and AI failed on 2026-11-22)
  const clipIdsByVideoId = {
    yt_new_2q: 'clip_new_2q',
    yt_new_b2: 'clip_new_b2',
    yt_day22_1: 'clip_day22_1',
  };

  assert.equal(
    findMatchingSummaryGameIndex(
      prevGames,
      '2026-11-23',
      ['正則学園'],
      '【下級生】練習試合',
      getGameMatches
    ),
    0
  );

  const aiResultsByDate = {
    '2026-11-23': {
      matches: [
        {
          label: '1試合目',
          teamUnit: '',
          opponent: '正則学園',
          clips: [
            { id: 'clip_existing_1q', label: '1Q' },
            { id: 'clip_new_2q', label: '2Q' },
          ],
        },
        {
          label: '2試合目',
          teamUnit: 'B',
          opponent: '正則学園',
          clips: [{ id: 'clip_new_b2', label: '試合動画' }],
        },
      ],
      fetchedTitles: {
        yt_new_2q: '【練習試合】vs正則学園①20261123 2Q',
        yt_new_b2: '【練習試合】vs正則学園B②20261123',
      },
    },
    // 2026-11-22 intentionally omitted -> fallback rule-based grouping
  };

  let seq = 0;
  const res = mergeSummaryDateGroupsIntoGames({
    prevGames,
    groups: grouped.groups,
    playlistTitle: '【下級生】練習試合',
    createId: (p) => `${p}_${++seq}`,
    getMatchesFn: getGameMatches,
    syncGameFn: (g, m) => syncGameFromMatches(g, m, computeMatchSummary),
    clipIdsByVideoId,
    aiResultsByDate,
    applyAiMatchesFn: applyAiOrganizedMatches,
  });

  assert.equal(res.addedGames, 1);
  assert.equal(res.updatedGames, 1);
  assert.equal(res.addedVideos, 3);
  assert.equal(res.nextGames.length, 2);

  // Day 23 preserved stats on match 1 while placing 2Q into match 1 and B② into match 2
  const day23 = res.nextGames.find((g) => g.date === '2026-11-23');
  assert.ok(day23);
  assert.equal(day23.matches.length, 2);
  assert.equal(day23.matches[0].homeScore, 42);
  assert.equal(day23.matches[0].awayScore, 35);
  assert.equal(day23.matches[0].manualBoxScore?.p1.pts, 18);
  assert.equal(day23.matches[0].manualBoxScore?.p2.pts, 24);
  assert.equal(day23.matches[0].events.length, 1);
  assert.deepEqual(
    day23.matches[0].videos.map((v) => v.youtubeId),
    ['yt_old_1q', 'yt_new_2q']
  );
  assert.equal(day23.matches[1].teamUnit, 'B');
  assert.equal(day23.matches[1].opponent, '正則学園');
  assert.equal(day23.matches[1].homeScore, 0);
  assert.deepEqual(
    day23.matches[1].videos.map((v) => v.youtubeId),
    ['yt_new_b2']
  );
  assert.equal(day23.homeScore, 42);
  assert.equal(day23.awayScore, 35);

  // Day 22 (AI failed) was saved cleanly using rule-based fallback
  const day22 = res.nextGames.find((g) => g.date === '2026-11-22');
  assert.ok(day22);
  assert.equal(day22.matches.length, 1);
  assert.equal(day22.matches[0].teamUnit, 'B');
  assert.equal(day22.matches[0].opponent, '大宮北');
  assert.equal(day22.matches[0].videos[0].id, 'clip_day22_1');
});

