import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOrganizePrompt,
  handleOrganizeMatchesPayload,
  sanitizeAiMatches,
} from './organize-matches.ts';

test('buildOrganizePrompt includes rules for circled numbers, ascending order, squad units, and multi-school separation', () => {
  const prompt = buildOrganizePrompt({
    gameTitle: '【下級生】練習試合（11/23）',
    gameDate: '2026-11-23',
    defaultOpponent: '正則学園',
    clips: [
      {
        index: 1,
        id: 'clip_1',
        currentLabel: '試合動画',
        youtubeTitle: '【練習試合】vs正則学園B②20261123',
      },
      {
        index: 2,
        id: 'clip_2',
        currentLabel: '試合動画',
        youtubeTitle: '【練習試合】vs正則学園①20261123',
      },
    ],
  });

  assert.match(prompt, /①/);
  assert.match(prompt, /chronological ascending order/i);
  assert.match(prompt, /1 video = 1 match/);
  assert.match(prompt, /vs正則学園B②20261123/);
  assert.match(prompt, /Do NOT include "A" or "B" in "label"/);
  assert.match(prompt, /Never merge videos with different opponent schools/);
  assert.match(prompt, /clip_1/);
  assert.match(prompt, /clip_2/);
});

test('sanitizeAiMatches normalizes teamUnit, preserves every clip once, and rescues dropped clips', () => {
  const inputClips = [
    { id: 'c1', label: '試合動画', youtubeId: 'yt1', youtubeTitle: 'vs正則学園①20261123' },
    { id: 'c2', label: '試合動画', youtubeId: 'yt2', youtubeTitle: 'vs正則学園B②20261123' },
    { id: 'c3', label: '試合動画', youtubeId: 'yt3', youtubeTitle: 'vs都小山台B②20261123' },
  ];

  const sanitized = sanitizeAiMatches(
    {
      matches: [
        {
          label: '1試合目',
          teamUnit: '指定なし',
          opponent: '正則学園',
          clips: [{ id: 'c1', label: '試合動画' }, { id: 'c1', label: '重複' }],
        },
        {
          label: '2試合目',
          teamUnit: 'b',
          opponent: '正則学園',
          clips: [
            { id: 'c2', label: '試合動画' },
            { id: 'unknown_id', label: '未知' },
          ],
        },
        // c3 intentionally omitted to verify rescue logic
      ],
    },
    inputClips,
    '対戦相手'
  );

  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[0].teamUnit, '');
  assert.equal(sanitized[0].opponent, '正則学園');
  assert.deepEqual(sanitized[0].clips, [{ id: 'c1', label: '試合動画' }]);

  assert.equal(sanitized[1].teamUnit, 'B');
  assert.deepEqual(
    sanitized[1].clips.map((c) => c.id),
    ['c2', 'c3']
  );
});

test('handleOrganizeMatchesPayload validates missing API key and empty clips', async () => {
  const missingKey = await handleOrganizeMatchesPayload({
    body: { mode: 'organize', clips: [{ id: 'c1', label: '1Q', youtubeId: 'yt1' }] },
    authHeader: null,
    env: { geminiApiKey: '', firebaseApiKey: '' },
  });
  assert.equal(missingKey.status, 503);

  const emptyClips = await handleOrganizeMatchesPayload({
    body: { mode: 'organize', clips: [] },
    authHeader: null,
    env: { geminiApiKey: 'dummy_key', firebaseApiKey: '' },
  });
  assert.equal(emptyClips.status, 400);
});
