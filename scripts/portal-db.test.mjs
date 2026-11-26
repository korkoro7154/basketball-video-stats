import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { classifyFile } from './parallel.mjs'
import {
  checkPortalDataSafety,
  formatPortalSummary,
  loadServiceAccountKey,
  runPortalDbCli,
  stripUndefined,
  validatePortalData,
} from './portal-db.mjs'

function createMemoryFs(initialFiles = {}, { failWritePrefix = null } = {}) {
  const files = new Map()
  const dirs = new Set(['/'])

  const ensureDir = (dirPath) => {
    const normalized = path.resolve(dirPath)
    const parts = normalized.split(path.sep).filter(Boolean)
    let cur = path.isAbsolute(normalized) ? path.sep : ''
    for (const part of parts) {
      cur = cur === path.sep ? `${path.sep}${part}` : path.join(cur, part)
      dirs.add(cur)
    }
  }

  for (const [rawPath, content] of Object.entries(initialFiles)) {
    const resolved = path.resolve(rawPath)
    ensureDir(path.dirname(resolved))
    files.set(resolved, String(content))
  }

  return {
    files,
    dirs,
    existsSync(targetPath) {
      const resolved = path.resolve(targetPath)
      return files.has(resolved) || dirs.has(resolved)
    },
    mkdirSync(targetPath, { recursive } = {}) {
      const resolved = path.resolve(targetPath)
      if (recursive) {
        ensureDir(resolved)
      } else {
        dirs.add(resolved)
      }
    },
    readFileSync(targetPath) {
      const resolved = path.resolve(targetPath)
      if (!files.has(resolved)) {
        throw new Error(`ENOENT: no such file or directory, open '${resolved}'`)
      }
      return files.get(resolved)
    },
    writeFileSync(targetPath, content) {
      const resolved = path.resolve(targetPath)
      if (failWritePrefix && resolved.startsWith(path.resolve(failWritePrefix))) {
        throw new Error('EACCES: simulated backup write failure')
      }
      ensureDir(path.dirname(resolved))
      files.set(resolved, String(content))
    },
  }
}

function makeFakeServiceAccountJson(projectId = 'basketball-portal-11649') {
  return JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    private_key_id: 'key-id-1',
    private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    client_email: `admin@${projectId}.iam.gserviceaccount.com`,
  })
}

function makeSamplePortalData({ gameCount = 2, playerCount = 2, practiceCount = 1 } = {}) {
  const players = Array.from({ length: playerCount }, (_, idx) => ({
    id: `p_${idx + 1}`,
    number: String(idx + 4),
    name: `テスト選手${idx + 1}`,
    ...(idx === 0 ? { grade: '2年', position: 'G' } : {}),
  }))

  const games = Array.from({ length: gameCount }, (_, idx) => {
    const dayNum = String(idx + 1).padStart(2, '0')
    return {
      id: `g_${idx + 1}`,
      title: `練習試合 ${idx + 1}`,
      date: `2026-11-${dayNum}`,
      opponent: `相手高校${idx + 1}`,
      category: '練習試合',
      homeScore: 60 + idx,
      awayScore: 55 + idx,
      isOrganized: idx === 0,
      matches: [
        {
          id: `m_${idx + 1}_1`,
          label: '1試合目',
          teamUnit: 'A',
          opponent: `相手高校${idx + 1}`,
          homeScore: 60 + idx,
          awayScore: 55 + idx,
          videos: [
            {
              id: `v_${idx + 1}_1`,
              label: '1Q',
              youtubeTitle: `vs相手高校${idx + 1}`,
              youtubeId: `yt_${idx + 1}_1`,
              youtubeUrl: `https://www.youtube.com/watch?v=yt_${idx + 1}_1`,
            },
          ],
          events: [],
        },
      ],
      videos: [
        {
          id: `v_${idx + 1}_1`,
          label: '1Q',
          youtubeTitle: `vs相手高校${idx + 1}`,
          youtubeId: `yt_${idx + 1}_1`,
          youtubeUrl: `https://www.youtube.com/watch?v=yt_${idx + 1}_1`,
        },
      ],
      events: [],
    }
  })

  const practices = Array.from({ length: practiceCount }, (_, idx) => ({
    id: `pr_${idx + 1}`,
    title: `練習メニュー ${idx + 1}`,
    date: '2026-11-20',
    youtubeId: `pyt_${idx + 1}`,
    youtubeUrl: `https://www.youtube.com/watch?v=pyt_${idx + 1}`,
    tags: ['#速攻'],
    moments: [{ id: `mo_${idx + 1}`, timestampSec: 12, label: 'ポイント' }],
  }))

  return {
    teamName: '都立サンプル高校',
    players,
    games,
    practices,
    practiceTags: ['#速攻', '#DF'],
    adminPin: '1234',
    ownerEmails: ['owner@example.com'],
    allowedEmails: ['member@example.com'],
  }
}

function createCliHarness({
  initialDoc = makeSamplePortalData(),
  docExists = true,
  initialFiles = {},
  env = {},
  nowDate = new Date(2026, 10, 26, 19, 38, 35),
  failBackupWrite = false,
} = {}) {
  const repoRoot = '/repo'
  const cwd = '/repo'
  const defaultKeyPath = path.join(repoRoot, '.secrets/firebase-admin-key.json')
  const fsImpl = createMemoryFs(
    {
      [defaultKeyPath]: makeFakeServiceAccountJson(),
      ...initialFiles,
    },
    { failWritePrefix: failBackupWrite ? path.join(repoRoot, '.portal-backups') : null }
  )

  const operations = []
  let storedDoc = docExists ? structuredClone(initialDoc) : null
  const stdoutLines = []
  const stderrLines = []

  const openSession = async ({ serviceAccount }) => {
    operations.push('session:open')
    return {
      projectId: serviceAccount.project_id,
      docRef: {
        async get() {
          operations.push('firestore:get')
          return {
            exists: storedDoc !== null,
            data: () => structuredClone(storedDoc),
          }
        },
        async set(payload) {
          operations.push('firestore:set')
          storedDoc = structuredClone(payload)
        },
      },
      async close() {
        operations.push('session:close')
      },
    }
  }

  const wrappedFs = {
    ...fsImpl,
    writeFileSync(targetPath, content) {
      if (path.resolve(targetPath).startsWith(path.join(repoRoot, '.portal-backups'))) {
        operations.push(`backup:write:${path.basename(targetPath)}`)
      }
      return fsImpl.writeFileSync(targetPath, content)
    },
  }

  const run = (argv) =>
    runPortalDbCli(argv, {
      cwd,
      repoRoot,
      env,
      fsImpl: wrappedFs,
      now: () => nowDate,
      stdout: (line) => stdoutLines.push(String(line)),
      stderr: (line) => stderrLines.push(String(line)),
      openSession,
    })

  return {
    run,
    fsImpl,
    operations,
    stdoutLines,
    stderrLines,
    getStoredDoc: () => storedDoc,
    repoRoot,
  }
}

describe('parallel.mjs dual leak-prevention guard', () => {
  it('blocks secrets, portal backups, and service account JSON patterns as forbidden', () => {
    const forbiddenPaths = [
      '.secrets',
      '.secrets/firebase-admin-key.json',
      'nested/.secrets/key.json',
      '.portal-backups',
      '.portal-backups/portal-20261126-193835.json',
      'nested/.portal-backups/snap.json',
      'basketball-portal-firebase-adminsdk-abc123.json',
      'nested/my-service-account-key.json',
      'SERVICE-ACCOUNT.JSON',
      '.env',
      '.env.local',
      '都立三原/sample.png',
      'スクショ例/score.png',
    ]

    for (const filePath of forbiddenPaths) {
      const result = classifyFile(filePath)
      assert.equal(result.kind, 'forbidden', `expected forbidden for ${filePath}, got ${result.kind}`)
    }
  })

  it('classifies portal-db scripts and package.json as shared', () => {
    for (const filePath of ['scripts/portal-db.mjs', 'scripts/portal-db.test.mjs', 'package.json']) {
      const result = classifyFile(filePath)
      assert.equal(result.kind, 'shared', `expected shared for ${filePath}`)
    }
  })
})

describe('stripUndefined and validatePortalData', () => {
  it('accepts valid 3-tier PortalData and strips nested undefined fields', () => {
    const sample = makeSamplePortalData()
    sample.games[0].notes = undefined
    sample.games[0].matches[0].manualBoxScore = {
      p_1: {
        playerId: 'p_1',
        pts: 12,
        fgm: 5,
        fga: 10,
        tpm: 2,
        tpa: 4,
        ftm: 0,
        fta: 0,
        oreb: 1,
        dreb: 3,
        ast: 2,
        stl: 1,
        blk: 0,
        to: 1,
        pf: 2,
        extraUndefined: undefined,
      },
    }
    sample.games[0].events.push({
      id: 'ev_1',
      quarter: '1Q',
      timestampSec: 0,
      team: 'home',
      playerId: null,
      type: '2P_MADE',
      note: undefined,
    })

    const res = validatePortalData(sample)
    assert.equal(res.ok, true)
    assert.deepEqual(res.errors, [])
    assert.equal('notes' in res.cleaned.games[0], false)
    assert.equal('extraUndefined' in res.cleaned.games[0].matches[0].manualBoxScore.p_1, false)
    assert.equal(res.cleaned.games[0].events[0].playerId, null)
    assert.equal('note' in res.cleaned.games[0].events[0], false)

    const strippedArray = stripUndefined([1, undefined, { a: 2, b: undefined }])
    assert.deepEqual(strippedArray, [1, { a: 2 }])
  })

  it('rejects missing required fields, empty ownerEmails, invalid category, NaN scores, and duplicate IDs', () => {
    const missingRequired = validatePortalData({ teamName: 'A' })
    assert.equal(missingRequired.ok, false)
    assert.ok(missingRequired.errors.some((e) => e.includes('players')))
    assert.ok(missingRequired.errors.some((e) => e.includes('games')))
    assert.ok(missingRequired.errors.some((e) => e.includes('ownerEmails')))

    const bad = makeSamplePortalData({ gameCount: 2, playerCount: 2 })
    bad.ownerEmails = []
    bad.games[0].category = '非対応カテゴリ'
    bad.games[0].homeScore = Number.NaN
    bad.games[1].id = bad.games[0].id
    bad.players[1].id = bad.players[0].id
    bad.games[0].matches.push({ ...structuredClone(bad.games[0].matches[0]) })

    const res = validatePortalData(bad)
    assert.equal(res.ok, false)
    assert.ok(res.errors.some((e) => e.includes('ownerEmails')))
    assert.ok(res.errors.some((e) => e.includes('category')))
    assert.ok(res.errors.some((e) => e.includes('homeScore')))
    assert.ok(res.errors.some((e) => e.includes('重複した試合日ID')))
    assert.ok(res.errors.some((e) => e.includes('重複した選手ID')))
    assert.ok(res.errors.some((e) => e.includes('重複した試合ID')))
  })
})

describe('checkPortalDataSafety', () => {
  it('allows normal additions, score edits, and minor cleanup of 1 out of 10 games', () => {
    const current = makeSamplePortalData({ gameCount: 10, playerCount: 12, practiceCount: 8 })
    const next = structuredClone(current)
    next.games.pop()
    next.games[0].matches[0].homeScore = 72

    const safety = checkPortalDataSafety(current, next)
    assert.equal(safety.ok, true)
    assert.equal(safety.blocked, false)
    assert.deepEqual(safety.issues, [])
  })

  it('blocks extreme drops in games, matches, stats, videos, players, practices, and owner lockout', () => {
    const current = makeSamplePortalData({ gameCount: 10, playerCount: 10, practiceCount: 8 })

    // 1. Wiping all games
    const wipedGames = structuredClone(current)
    wipedGames.games = []
    const wipeRes = checkPortalDataSafety(current, wipedGames)
    assert.equal(wipeRes.blocked, true)
    assert.ok(wipeRes.issues.some((i) => i.includes('試合日が全件消滅')))

    // 2. Half or >= 5 games dropped (10 -> 4)
    const droppedGames = structuredClone(current)
    droppedGames.games = droppedGames.games.slice(0, 4)
    const dropRes = checkPortalDataSafety(current, droppedGames)
    assert.equal(dropRes.blocked, true)
    assert.ok(dropRes.issues.some((i) => i.includes('試合日数が半分以下')))
    assert.ok(dropRes.issues.some((i) => i.includes('試合日数が5件以上減少')))

    // 3. >= 5 games dropped even above 50% (12 -> 7)
    const current12 = makeSamplePortalData({ gameCount: 12, playerCount: 10, practiceCount: 8 })
    const next7 = structuredClone(current12)
    next7.games = next7.games.slice(0, 7)
    const drop5Res = checkPortalDataSafety(current12, next7)
    assert.equal(drop5Res.blocked, true)
    assert.ok(drop5Res.issues.some((i) => i.includes('試合日数が5件以上減少')))

    // 4. Stats wiped while games remain
    const statsWiped = structuredClone(current)
    for (const g of statsWiped.games) {
      g.homeScore = 0
      g.awayScore = 0
      g.matches[0].homeScore = 0
      g.matches[0].awayScore = 0
    }
    const statsRes = checkPortalDataSafety(current, statsWiped)
    assert.equal(statsRes.blocked, true)
    assert.ok(statsRes.issues.some((i) => i.includes('記録済みスタッツ・スコアが全件消滅')))

    // 5. Players & practices dropped >50% and owner lockout
    const lockout = structuredClone(current)
    lockout.players = lockout.players.slice(0, 3)
    lockout.practices = lockout.practices.slice(0, 2)
    lockout.ownerEmails = ['stranger@example.com']
    const lockoutRes = checkPortalDataSafety(current, lockout)
    assert.equal(lockoutRes.blocked, true)
    assert.ok(lockoutRes.issues.some((i) => i.includes('選手数が半分以下')))
    assert.ok(lockoutRes.issues.some((i) => i.includes('練習動画数が半分以下')))
    assert.ok(lockoutRes.issues.some((i) => i.includes('ロックアウト')))

    // 6. force: true allows safety check to pass while returning issues
    const forcedRes = checkPortalDataSafety(current, wipedGames, { force: true })
    assert.equal(forcedRes.ok, true)
    assert.equal(forcedRes.blocked, false)
    assert.ok(forcedRes.issues.length > 0)
  })
})

describe('loadServiceAccountKey and CLI subcommands', () => {
  it('shows clear Japanese instructions when service account key file is missing', async () => {
    const fsImpl = createMemoryFs()
    assert.throws(
      () =>
        loadServiceAccountKey({
          cwd: '/repo',
          repoRoot: '/repo',
          fsImpl,
        }),
      /既定の秘密鍵ファイル（\.secrets\/firebase-admin-key\.json）が見つかりません/
    )

    const stderr = []
    const code = await runPortalDbCli(['check'], {
      cwd: '/repo',
      repoRoot: '/repo',
      env: { FIREBASE_SERVICE_ACCOUNT_PATH: '.secrets/missing.json' },
      fsImpl,
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    })
    assert.equal(code, 1)
    assert.match(stderr.join('\n'), /FIREBASE_SERVICE_ACCOUNT_PATH/)
    assert.match(stderr.join('\n'), /新しい秘密鍵の生成/)
  })

  it('runs check, backup (with collision suffix), and summary', async () => {
    const sample = makeSamplePortalData({ gameCount: 2, playerCount: 2, practiceCount: 3 })
    sample.games[1].matches[0].homeScore = 0
    sample.games[1].matches[0].awayScore = 0
    sample.games[1].matches.push({
      id: 'm_2_2',
      label: '2試合目',
      teamUnit: 'B',
      opponent: '別チーム',
      homeScore: 48,
      awayScore: 44,
      videos: [],
      events: [],
    })

    const h = createCliHarness({ initialDoc: sample })

    // check
    assert.equal(await h.run(['check']), 0)
    const checkOut = h.stdoutLines.join('\n')
    assert.match(checkOut, /都立サンプル高校/)
    assert.match(checkOut, /選手数: 2名/)
    assert.match(checkOut, /試合日数: 2日/)
    assert.match(checkOut, /練習動画数: 3本/)

    // backup twice in same second -> collision safe suffix -2.json
    assert.equal(await h.run(['backup']), 0)
    assert.equal(await h.run(['backup']), 0)
    const firstBackup = '/repo/.portal-backups/portal-20261126-193835.json'
    const secondBackup = '/repo/.portal-backups/portal-20261126-193835-2.json'
    assert.equal(h.fsImpl.existsSync(firstBackup), true)
    assert.equal(h.fsImpl.existsSync(secondBackup), true)
    assert.deepEqual(JSON.parse(h.fsImpl.readFileSync(firstBackup)), sample)

    // summary
    h.stdoutLines.length = 0
    assert.equal(await h.run(['summary']), 0)
    const summaryOut = h.stdoutLines.join('\n')
    assert.match(summaryOut, /2026-11-01 \| \[練習試合\] 練習試合 1 ✅整理済/)
    assert.match(summaryOut, /\[A\] 1試合目 vs 相手高校1 \| スコアあり \(60-55\) \| 動画 1本/)
    assert.match(summaryOut, /\[A\] 1試合目 vs 相手高校2 \| スコアなし \| 動画 1本/)
    assert.match(summaryOut, /\[B\] 2試合目 vs 別チーム \| スコアあり \(48-44\) \| 動画 0本/)
    assert.match(summaryOut, /#4 テスト選手1 \(2年 \/ G\)/)
    assert.match(summaryOut, /#5 テスト選手2/)
    assert.equal(typeof formatPortalSummary(sample), 'string')
  })

  it('supports apply --dry-run without creating backups or writing Firestore', async () => {
    const current = makeSamplePortalData({ gameCount: 2, playerCount: 2, practiceCount: 1 })
    const next = structuredClone(current)
    next.teamName = '更新後チーム名'
    next.games.push(makeSamplePortalData({ gameCount: 3 }).games[2])

    const h = createCliHarness({
      initialDoc: current,
      initialFiles: {
        '/repo/next.json': JSON.stringify(next),
      },
    })

    const code = await h.run(['apply', 'next.json', '--dry-run'])
    assert.equal(code, 0)
    assert.equal(h.operations.includes('firestore:set'), false)
    assert.equal(
      h.operations.some((op) => op.startsWith('backup:write:')),
      false
    )
    assert.equal(h.getStoredDoc().teamName, '都立サンプル高校')
    assert.match(h.stdoutLines.join('\n'), /都立サンプル高校 → 更新後チーム名/)
    assert.match(h.stdoutLines.join('\n'), /2日 → 3日/)
    assert.match(h.stdoutLines.join('\n'), /--dry-run/)
  })

  it('saves backup strictly BEFORE writing to Firestore on apply, and aborts write if backup fails', async () => {
    const current = makeSamplePortalData({ gameCount: 2, playerCount: 2, practiceCount: 1 })
    const next = structuredClone(current)
    next.teamName = '本番更新チーム'

    const h = createCliHarness({
      initialDoc: current,
      initialFiles: {
        '/repo/next.json': JSON.stringify(next),
      },
    })

    const code = await h.run(['apply', 'next.json'])
    assert.equal(code, 0)
    const backupIdx = h.operations.findIndex((op) => op.startsWith('backup:write:'))
    const setIdx = h.operations.indexOf('firestore:set')
    assert.ok(backupIdx >= 0, 'expected backup write before set')
    assert.ok(setIdx > backupIdx, 'expected backup write strictly before firestore:set')
    assert.equal(h.getStoredDoc().teamName, '本番更新チーム')

    // Backup failure must abort before firestore:set
    const failing = createCliHarness({
      initialDoc: current,
      initialFiles: {
        '/repo/next.json': JSON.stringify(next),
      },
      failBackupWrite: true,
    })
    const failCode = await failing.run(['apply', 'next.json'])
    assert.equal(failCode, 1)
    assert.equal(failing.operations.includes('firestore:set'), false)
    assert.equal(failing.getStoredDoc().teamName, '都立サンプル高校')
  })

  it('blocks extreme drops on apply and never bypasses schema validation with --force', async () => {
    const current = makeSamplePortalData({ gameCount: 6, playerCount: 6, practiceCount: 4 })
    const wiped = structuredClone(current)
    wiped.games = []

    const h = createCliHarness({
      initialDoc: current,
      initialFiles: {
        '/repo/wiped.json': JSON.stringify(wiped),
        '/repo/invalid.json': JSON.stringify({ teamName: 'broken' }),
      },
    })

    const blockedCode = await h.run(['apply', 'wiped.json'])
    assert.equal(blockedCode, 1)
    assert.equal(h.operations.includes('firestore:set'), false)
    assert.equal(
      h.operations.some((op) => op.startsWith('backup:write:')),
      false
    )
    assert.match(h.stderrLines.join('\n'), /安全チェックにより書き込みをブロック/)

    // Invalid schema cannot be bypassed even with --force
    h.stderrLines.length = 0
    const invalidForcedCode = await h.run(['apply', 'invalid.json', '--force'])
    assert.equal(invalidForcedCode, 1)
    assert.equal(h.operations.includes('firestore:set'), false)
  })

  it('backs up current state strictly BEFORE restoring from backup file on restore', async () => {
    const current = makeSamplePortalData({ gameCount: 3, playerCount: 3, practiceCount: 2 })
    current.teamName = '現在の本番'
    const backup = makeSamplePortalData({ gameCount: 2, playerCount: 2, practiceCount: 1 })
    backup.teamName = '復元対象バックアップ'

    const h = createCliHarness({
      initialDoc: current,
      initialFiles: {
        '/repo/.portal-backups/portal-20261125-120000.json': JSON.stringify(backup),
      },
    })

    const code = await h.run(['restore', '.portal-backups/portal-20261125-120000.json'])
    assert.equal(code, 0)
    const backupIdx = h.operations.findIndex((op) => op.startsWith('backup:write:'))
    const setIdx = h.operations.indexOf('firestore:set')
    assert.ok(backupIdx >= 0)
    assert.ok(setIdx > backupIdx)
    assert.equal(h.getStoredDoc().teamName, '復元対象バックアップ')
    const savedPreRestore = JSON.parse(
      h.fsImpl.readFileSync('/repo/.portal-backups/portal-20261126-193835.json')
    )
    assert.equal(savedPreRestore.teamName, '現在の本番')
  })
})
