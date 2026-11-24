import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOcrBatchToPortalData,
  extractDateAndOpponentHintsFromFileName,
  findBestMatchingGameForItem,
  hydrateOcrPlayersWithRoster,
  mergeEditableOcrPlayerRows,
} from './stats.ts';
import {
  normalizeScreenshotDate,
  sanitizeParsedOutput,
} from '../../../api/parse-stats.ts';

function makePlayer(id, number, name) {
  return { id, number, name, position: 'G', grade: '2年' };
}

function makeOcrRow(overrides = {}) {
  return {
    id: overrides.id ?? 'row_1',
    reportedPts: overrides.reportedPts ?? 0,
    number: overrides.number ?? '4',
    name: overrides.name ?? '',
    twoPm: overrides.twoPm ?? 0,
    twoPa: overrides.twoPa ?? 0,
    threePm: overrides.threePm ?? 0,
    threePa: overrides.threePa ?? 0,
    ftm: overrides.ftm ?? 0,
    fta: overrides.fta ?? 0,
    oreb: overrides.oreb ?? 0,
    dreb: overrides.dreb ?? 0,
    ast: overrides.ast ?? 0,
    stl: overrides.stl ?? 0,
    blk: overrides.blk ?? 0,
    to: overrides.to ?? 0,
    pf: overrides.pf ?? 0,
  };
}

function makeMatch(overrides = {}) {
  return {
    id: overrides.id ?? 'match_1',
    label: overrides.label ?? '1試合目',
    teamUnit: overrides.teamUnit ?? '',
    opponent: overrides.opponent ?? '対戦相手',
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
  const matches = overrides.matches ?? [makeMatch()];
  return {
    id: overrides.id ?? 'game_1',
    title: overrides.title ?? 'テスト試合',
    date: overrides.date ?? '2026-09-23',
    opponent: overrides.opponent ?? 'テスト高校',
    category: overrides.category ?? '練習試合',
    homeScore: overrides.homeScore ?? 0,
    awayScore: overrides.awayScore ?? 0,
    matches,
    videos: [],
    events: [],
  };
}

function makePortalData(games, players = []) {
  return {
    teamName: '都立駒場',
    players,
    games,
    practices: [],
    practiceTags: [],
    adminPin: '1234',
    ownerEmails: ['owner@example.com'],
    allowedEmails: [],
  };
}

describe('Multi-day batch save (applyOcrBatchToPortalData)', () => {
  it('saves cards across two different targetGameIds while leaving a third game untouched', () => {
    const p4 = makePlayer('p4', '4', '山田 太郎');
    const p5 = makePlayer('p5', '5', '佐藤 次郎');

    const g1 = makeGame({
      id: 'g_mihara',
      date: '2026-09-23',
      title: '9/23 美原・国分寺戦',
      opponent: '美原',
      matches: [makeMatch({ id: 'm_g1_1', opponent: '美原' })],
    });
    const g2 = makeGame({
      id: 'g_denki',
      date: '2026-08-20',
      title: '8/20 電機大高校戦',
      opponent: '電機大',
      matches: [makeMatch({ id: 'm_g2_1', opponent: '電機大' })],
    });
    const g3 = makeGame({
      id: 'g_untouched',
      date: '2026-10-31',
      title: '10/31 U15VISION戦',
      opponent: 'U15VISION',
      homeScore: 70,
      awayScore: 60,
      matches: [
        makeMatch({ id: 'm_g3_1', homeScore: 70, awayScore: 60 }),
      ],
    });

    let seq = 0;
    const prev = makePortalData([g1, g2, g3], [p4, p5]);

    const { nextData, updatedGameIds, appliedItemCount } =
      applyOcrBatchToPortalData(
        prev,
        {
          autoAddMissingPlayers: false,
          items: [
            {
              targetGameId: 'g_mihara',
              targetMatchId: 'm_g1_1',
              mergeMode: 'replace',
              awayTeamName: '美原高校',
              teamUnit: 'A',
              homeScore: 14,
              awayScore: 10,
              rows: [
                makeOcrRow({
                  number: '4',
                  name: '山田 太郎',
                  twoPm: 4,
                  twoPa: 6,
                  threePm: 2,
                  threePa: 3,
                }),
              ],
            },
            {
              targetGameId: 'g_denki',
              targetMatchId: 'm_g2_1',
              mergeMode: 'replace',
              awayTeamName: '電機大高校',
              teamUnit: '',
              homeScore: 9,
              awayScore: 12,
              rows: [
                makeOcrRow({
                  number: '5',
                  name: '',
                  threePm: 3,
                  threePa: 3,
                }),
              ],
            },
          ],
        },
        {
          fallbackGameId: 'g_mihara',
          createPlayerId: (prefix) => `${prefix}_${++seq}`,
          createMatchIdFn: () => `new_match_${++seq}`,
        }
      );

    assert.equal(appliedItemCount, 2);
    assert.deepEqual(updatedGameIds, ['g_mihara', 'g_denki']);

    const savedG1 = nextData.games.find((g) => g.id === 'g_mihara');
    const savedG2 = nextData.games.find((g) => g.id === 'g_denki');
    const savedG3 = nextData.games.find((g) => g.id === 'g_untouched');

    assert.equal(savedG1.homeScore, 14);
    assert.equal(savedG1.awayScore, 10);
    assert.equal(savedG1.matches[0].opponent, '美原高校');
    assert.equal(savedG1.matches[0].manualBoxScore.p4.pts, 14);

    assert.equal(savedG2.homeScore, 9);
    assert.equal(savedG2.awayScore, 12);
    assert.equal(savedG2.matches[0].manualBoxScore.p5.pts, 9);

    assert.deepEqual(savedG3, g3);
  });

  it('auto-adds a missing player once across multiple days and creates __new__ matches cleanly', () => {
    const g1 = makeGame({
      id: 'g_1',
      date: '2026-09-23',
      opponent: '美原',
      matches: [makeMatch({ id: 'm1' })],
    });
    const g2 = makeGame({
      id: 'g_2',
      date: '2026-10-31',
      opponent: 'U15VISION',
      matches: [makeMatch({ id: 'm2' })],
    });

    let seq = 0;
    const prev = makePortalData([g1, g2], []);

    const { nextData, addedPlayers } = applyOcrBatchToPortalData(
      prev,
      {
        autoAddMissingPlayers: true,
        items: [
          {
            targetGameId: 'g_1',
            targetMatchId: '__new__',
            mergeMode: 'replace',
            awayTeamName: '国分寺',
            teamUnit: 'B',
            homeScore: 6,
            awayScore: 4,
            rows: [
              makeOcrRow({
                number: '12',
                name: '高橋 健',
                twoPm: 3,
                twoPa: 3,
              }),
            ],
          },
          {
            targetGameId: 'g_2',
            targetMatchId: 'm2',
            mergeMode: 'replace',
            awayTeamName: 'U15VISION',
            teamUnit: '',
            homeScore: 5,
            awayScore: 8,
            rows: [
              makeOcrRow({
                number: '12',
                name: '',
                threePm: 1,
                threePa: 1,
                twoPm: 1,
                twoPa: 1,
              }),
            ],
          },
        ],
      },
      {
        fallbackGameId: 'g_1',
        createPlayerId: (prefix) => `${prefix}_${++seq}`,
        createMatchIdFn: () => `m_new_${++seq}`,
      }
    );

    assert.equal(addedPlayers.length, 1);
    assert.equal(nextData.players.length, 1);
    const addedId = addedPlayers[0].id;

    const updatedG1 = nextData.games.find((g) => g.id === 'g_1');
    const updatedG2 = nextData.games.find((g) => g.id === 'g_2');
    assert.equal(updatedG1.matches.length, 2);
    assert.equal(updatedG1.matches[1].label, '2試合目');
    assert.equal(updatedG1.matches[1].manualBoxScore[addedId].pts, 6);
    assert.equal(updatedG2.matches[0].manualBoxScore[addedId].pts, 5);
  });
});

describe('Quarter aggregation (mergeMode: add & mergeEditableOcrPlayerRows)', () => {
  it('sums 1Q (replace) and 2Q (add) targeting the same match across all stat columns', () => {
    const p4 = makePlayer('p4', '4', '山田');
    const p7 = makePlayer('p7', '7', '鈴木');
    const p9 = makePlayer('p9', '9', '田中');

    const g = makeGame({
      id: 'g_q',
      date: '2026-08-20',
      opponent: '相手校',
      matches: [makeMatch({ id: 'm_q', opponent: '相手校' })],
    });

    let seq = 0;
    const { nextData } = applyOcrBatchToPortalData(
      makePortalData([g], [p4, p7, p9]),
      {
        autoAddMissingPlayers: false,
        items: [
          {
            targetGameId: 'g_q',
            targetMatchId: 'm_q',
            mergeMode: 'replace',
            awayTeamName: '相手校',
            teamUnit: 'A',
            homeScore: 12,
            awayScore: 10,
            rows: [
              makeOcrRow({
                number: '4',
                twoPm: 2,
                twoPa: 2,
                threePm: 1,
                threePa: 1,
                ftm: 1,
                fta: 1,
                oreb: 1,
                dreb: 2,
                ast: 2,
                stl: 1,
                blk: 1,
                to: 1,
                pf: 1,
              }),
              makeOcrRow({
                number: '7',
                twoPm: 2,
                twoPa: 2,
                pf: 2,
              }),
            ],
          },
          {
            targetGameId: 'g_q',
            targetMatchId: 'm_q',
            mergeMode: 'add',
            awayTeamName: '相手校',
            teamUnit: 'A',
            homeScore: 11,
            awayScore: 14,
            rows: [
              makeOcrRow({
                number: '4',
                twoPm: 1,
                twoPa: 1,
                threePm: 1,
                threePa: 1,
                ftm: 2,
                fta: 2,
                oreb: 2,
                dreb: 1,
                ast: 3,
                stl: 2,
                blk: 0,
                to: 2,
                pf: 1,
              }),
              makeOcrRow({
                number: '9',
                twoPm: 2,
                twoPa: 2,
                stl: 1,
              }),
            ],
          },
        ],
      },
      {
        createPlayerId: (p) => `${p}_${++seq}`,
        createMatchIdFn: () => `m_${++seq}`,
      }
    );

    const savedMatch = nextData.games[0].matches[0];
    assert.equal(savedMatch.homeScore, 23);
    assert.equal(savedMatch.awayScore, 24);
    assert.equal(nextData.games[0].homeScore, 23);
    assert.equal(nextData.games[0].awayScore, 24);

    assert.deepEqual(savedMatch.manualBoxScore.p4, {
      playerId: 'p4',
      pts: 15,
      fgm: 5,
      fga: 5,
      tpm: 2,
      tpa: 2,
      ftm: 3,
      fta: 3,
      oreb: 3,
      dreb: 3,
      ast: 5,
      stl: 3,
      blk: 1,
      to: 3,
      pf: 2,
    });
    assert.equal(savedMatch.manualBoxScore.p7.pts, 4);
    assert.equal(savedMatch.manualBoxScore.p7.pf, 2);
    assert.equal(savedMatch.manualBoxScore.p9.pts, 4);
    assert.equal(savedMatch.manualBoxScore.p9.stl, 1);
  });

  it('adds 2Q onto an already saved 1Q match and combines __new__ + add into one new match', () => {
    const p4 = makePlayer('p4', '4', '山田');
    const existingBox = {
      p4: {
        playerId: 'p4',
        pts: 10,
        fgm: 4,
        fga: 4,
        tpm: 2,
        tpa: 2,
        ftm: 0,
        fta: 0,
        oreb: 1,
        dreb: 1,
        ast: 1,
        stl: 0,
        blk: 0,
        to: 1,
        pf: 1,
      },
    };
    const g = makeGame({
      id: 'g_add',
      matches: [
        makeMatch({
          id: 'm_existing',
          opponent: '相手校A',
          homeScore: 10,
          awayScore: 8,
          manualBoxScore: existingBox,
        }),
      ],
    });

    let seq = 0;
    const { nextData } = applyOcrBatchToPortalData(
      makePortalData([g], [p4]),
      {
        autoAddMissingPlayers: false,
        items: [
          {
            targetGameId: 'g_add',
            targetMatchId: 'm_existing',
            mergeMode: 'add',
            awayTeamName: '相手校A',
            teamUnit: '',
            homeScore: 5,
            awayScore: 7,
            rows: [
              makeOcrRow({
                number: '4',
                twoPm: 1,
                twoPa: 1,
                threePm: 1,
                threePa: 1,
                stl: 2,
              }),
            ],
          },
          {
            targetGameId: 'g_add',
            targetMatchId: '__new__',
            mergeMode: 'replace',
            awayTeamName: '相手校B',
            teamUnit: 'B',
            homeScore: 6,
            awayScore: 4,
            rows: [makeOcrRow({ number: '4', twoPm: 3, twoPa: 3 })],
          },
          {
            targetGameId: 'g_add',
            targetMatchId: '__new__',
            mergeMode: 'add',
            awayTeamName: '相手校B',
            teamUnit: 'B',
            homeScore: 3,
            awayScore: 5,
            rows: [makeOcrRow({ number: '4', threePm: 1, threePa: 1 })],
          },
        ],
      },
      {
        createPlayerId: (p) => `${p}_${++seq}`,
        createMatchIdFn: () => `m_created_${++seq}`,
      }
    );

    const matches = nextData.games[0].matches;
    assert.equal(matches.length, 2);
    assert.equal(matches[0].homeScore, 15);
    assert.equal(matches[0].awayScore, 15);
    assert.equal(matches[0].manualBoxScore.p4.pts, 15);
    assert.equal(matches[0].manualBoxScore.p4.stl, 2);

    assert.equal(matches[1].opponent, '相手校B');
    assert.equal(matches[1].homeScore, 9);
    assert.equal(matches[1].awayScore, 9);
    assert.equal(matches[1].manualBoxScore.p4.pts, 9);
  });

  it('merges editable preview rows accurately and sorts by jersey number', () => {
    const roster = [
      makePlayer('p4', '4', '山田'),
      makePlayer('p10', '10', '高橋'),
    ];
    const q1 = [
      makeOcrRow({ id: 'r1', number: '10', name: '', twoPm: 2, twoPa: 2, ast: 1 }),
      makeOcrRow({ id: 'r2', number: '4', name: '山田', threePm: 1, threePa: 1, pf: 1 }),
    ];
    const q2 = [
      makeOcrRow({ id: 'r3', number: '4', name: '', twoPm: 1, twoPa: 1, pf: 2, stl: 3 }),
    ];

    const merged = mergeEditableOcrPlayerRows(q1, q2, roster);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].number, '4');
    assert.equal(merged[0].name, '山田');
    assert.equal(merged[0].twoPm, 1);
    assert.equal(merged[0].threePm, 1);
    assert.equal(merged[0].pf, 3);
    assert.equal(merged[0].stl, 3);
    assert.equal(merged[1].number, '10');
    assert.equal(merged[1].name, '高橋');
  });
});

describe('Filename / Date / Opponent auto-matching', () => {
  it('extracts match date 09-23 (ignoring LINE export date 261123) and opponent tokens', () => {
    const res = extractDateAndOpponentHintsFromFileName(
      'LINE_ALBUM_923 美原、国分寺_261123_1.jpg'
    );
    assert.equal(res.mmdd, '09-23');
    assert.deepEqual(res.opponentTokens, ['美原', '国分寺']);
  });

  it('extracts 10-31 from 1031 LINE album filename', () => {
    const res = extractDateAndOpponentHintsFromFileName(
      'LINE_ALBUM_1031 U15VISION_261121_1.jpg'
    );
    assert.equal(res.mmdd, '10-31');
    assert.deepEqual(res.opponentTokens, ['U15VISION']);
  });

  it('matches the right game day by screenshotDate or filename', () => {
    const games = [
      makeGame({ id: 'g923', date: '2026-09-23', title: '9/23 美原・国分寺', opponent: '美原' }),
      makeGame({ id: 'g820', date: '2026-08-20', title: '8/20 電機大', opponent: '電機大高校' }),
      makeGame({ id: 'g1031', date: '2026-10-31', title: '10/31 U15VISION', opponent: 'U15VISION' }),
    ];

    const m1 = findBestMatchingGameForItem(games, {
      fileName: 'LINE_ALBUM_923 美原、国分寺_261123_1.jpg',
    });
    assert.equal(m1.game?.id, 'g923');

    const m2 = findBestMatchingGameForItem(games, {
      screenshotDate: '08-20',
      awayTeamName: '電機大',
      fileName: 'IMG_0012.JPG',
    });
    assert.equal(m2.game?.id, 'g820');
  });
});

describe('Roster auto-linking & blank name backfill', () => {
  it('links blank-name JBA paper rows by jersey number and keeps 0 distinct from 00', () => {
    const roster = [
      makePlayer('p0', '0', 'ゼロ選手'),
      makePlayer('p00', '00', 'ダブルゼロ'),
      makePlayer('p4', '4', '駒場 太郎'),
      makePlayer('p5', '5', '駒場 次郎'),
    ];

    let seq = 0;
    const rows = hydrateOcrPlayersWithRoster(
      [
        { number: '4', name: '', pts: 4, twoPm: 2, twoPa: 2, threePm: 0, threePa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 2 },
        { number: '＃０５', name: '#5', pts: 3, twoPm: 0, twoPa: 0, threePm: 1, threePa: 1, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 },
        { number: '00', name: '', pts: 2, twoPm: 1, twoPa: 1, threePm: 0, threePa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 },
        { number: '0', name: '', pts: 1, twoPm: 0, twoPa: 0, threePm: 0, threePa: 0, ftm: 1, fta: 1, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 },
      ],
      roster,
      (p) => `${p}_${++seq}`
    );

    assert.equal(rows[0].name, '駒場 太郎');
    assert.equal(rows[1].number, '05');
    assert.equal(rows[1].name, '駒場 次郎');
    assert.equal(rows[2].name, 'ダブルゼロ');
    assert.equal(rows[3].name, 'ゼロ選手');
  });
});

describe('API parse-stats sanitizer & date normalizer', () => {
  it('normalizes full-width and Japanese dates to MM-DD', () => {
    assert.equal(normalizeScreenshotDate('8月20日'), '08-20');
    assert.equal(normalizeScreenshotDate('８月２０日'), '08-20');
    assert.equal(normalizeScreenshotDate('2026-09-23'), '09-23');
    assert.equal(normalizeScreenshotDate(''), '');
  });

  it('sanitizes paper_scoresheet with sourceKind, quarterLabel, blank names, and pts backfill', () => {
    const out = sanitizeParsedOutput({
      imageType: 'paper_scoresheet',
      sourceKind: 'quarter_timeline',
      quarterLabel: '第1Q',
      screenshotDate: '８月２０日',
      homeTeamName: '都立駒場 高校',
      awayTeamName: '相手高校',
      homeScore: 0,
      awayScore: 11,
      players: [
        {
          number: '＃４',
          name: '',
          pts: 0,
          twoPm: 2,
          twoPa: 2,
          threePm: 1,
          threePa: 1,
          ftm: 1,
          fta: 1,
          oreb: 1,
          dreb: 2,
          ast: 2,
          stl: 1,
          blk: 1,
          to: 0,
          pf: 2,
        },
      ],
    });

    assert.equal(out.imageType, 'paper_scoresheet');
    assert.equal(out.sourceKind, 'quarter_timeline');
    assert.equal(out.quarterLabel, '1Q');
    assert.equal(out.screenshotDate, '08-20');
    assert.equal(out.homeScore, 8);
    assert.equal(out.awayScore, 11);
    assert.equal(out.players.length, 1);
    assert.equal(out.players[0].number, '4');
    assert.equal(out.players[0].name, '');
    assert.equal(out.players[0].pts, 8);
  });
});
