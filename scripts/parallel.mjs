#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOMS = {
  'room-a': { id: 'room-a', branch: 'work/room-a', relDir: '.worktrees/room-a', port: 5174 },
  'room-b': { id: 'room-b', branch: 'work/room-b', relDir: '.worktrees/room-b', port: 5175 },
  'room-c': { id: 'room-c', branch: 'work/room-c', relDir: '.worktrees/room-c', port: 5176 },
}

const ROOM_ORDER = ['room-a', 'room-b', 'room-c']

const AREAS = {
  'portal-home': 'ホーム・ログイン・PIN画面',
  'portal-games': '試合一覧/詳細・試合整理・スクショ読取UI',
  'portal-practices': '練習一覧・YouTube取込/埋込再生',
  'portal-admin': '管理・設定・選手名簿',
  'video-analyzer': '従来の動画分析画面 (src/App.tsx 等)',
  api: 'サーバー側AI処理 (api/*・解析API呼出)',
  docs: '仕様書・ドキュメント (*.md)',
}

const SHARED_EXACT_FILES = new Set([
  'src/portal/PortalApp.tsx',
  'src/portal/types.ts',
  'src/types.ts',
  'src/portal/services/portalStore.ts',
  'src/portal/firebase.ts',
  'src/portal/portal.css',
  'src/index.css',
  'src/main.tsx',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'eslint.config.js',
  'firestore.rules',
  'vercel.json',
  'render.yaml',
  'index.html',
  'GEMINI.md',
  'scripts/parallel.mjs',
  'scripts/portal-db.mjs',
  'scripts/portal-db.test.mjs',
  '.gitignore',
])

const STATE_LOCK_STALE_MS = 60_000
const MERGE_LOCK_STALE_MS = 600_000
const LOCK_WAIT_TIMEOUT_MS = 30_000
const MAX_HISTORY_ITEMS = 20

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function runGitSafe(args, cwd) {
  try {
    const stdout = runGit(args, cwd)
    return { ok: true, stdout, stderr: '' }
  } catch (err) {
    return {
      ok: false,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    }
  }
}

function resolvePaths() {
  let rawCommonDir = ''
  try {
    rawCommonDir = runGit(['rev-parse', '--git-common-dir'], process.cwd()).trim()
  } catch {
    throw new Error('Gitリポジトリ内で実行してください。')
  }
  const gitCommonDir = path.resolve(process.cwd(), rawCommonDir)
  const mainRoot = path.dirname(gitCommonDir)
  return {
    gitCommonDir,
    mainRoot,
    statePath: path.join(gitCommonDir, 'parallel-state.json'),
    boardPath: path.join(mainRoot, 'PARALLEL_BOARD.md'),
    locksDir: path.join(gitCommonDir, 'parallel-locks'),
  }
}

function pathExists(targetPath) {
  try {
    fs.lstatSync(targetPath)
    return true
  } catch {
    return false
  }
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null
  const buf = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function formatJst(isoString) {
  if (!isoString) return '-'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '-'
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`
}

function escapeCell(value) {
  if (!value) return '-'
  return String(value).replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ').trim() || '-'
}

function createEmptyRoomState(packageLockHash = null) {
  return {
    status: 'idle',
    task: '',
    areas: [],
    shared: false,
    notes: '',
    claimedAt: null,
    packageLockHash,
  }
}

function createInitialState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    rooms: {
      'room-a': createEmptyRoomState(),
      'room-b': createEmptyRoomState(),
      'room-c': createEmptyRoomState(),
    },
    history: [],
  }
}

function normalizeState(raw) {
  const base = createInitialState()
  if (!raw || typeof raw !== 'object') return base
  const rooms = {}
  for (const roomId of ROOM_ORDER) {
    const r = raw.rooms?.[roomId]
    rooms[roomId] = {
      status: r?.status === 'active' ? 'active' : 'idle',
      task: typeof r?.task === 'string' ? r.task : '',
      areas: Array.isArray(r?.areas) ? r.areas.filter((a) => typeof a === 'string') : [],
      shared: Boolean(r?.shared),
      notes: typeof r?.notes === 'string' ? r.notes : '',
      claimedAt: typeof r?.claimedAt === 'string' ? r.claimedAt : null,
      packageLockHash: typeof r?.packageLockHash === 'string' ? r.packageLockHash : null,
    }
  }
  const history = Array.isArray(raw.history) ? raw.history.slice(0, MAX_HISTORY_ITEMS) : []
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    rooms,
    history,
  }
}

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmpPath, content, 'utf8')
  fs.renameSync(tmpPath, filePath)
}

function loadState(paths) {
  if (!fs.existsSync(paths.statePath)) {
    return createInitialState()
  }
  const rawText = fs.readFileSync(paths.statePath, 'utf8')
  return normalizeState(JSON.parse(rawText))
}

function renderBoard(state) {
  const sharedHolder = ROOM_ORDER.find(
    (id) => state.rooms[id].status === 'active' && state.rooms[id].shared
  )
  const sharedStatusText = sharedHolder
    ? `🔒 **${sharedHolder}** が使用中（${escapeCell(state.rooms[sharedHolder].task)}）`
    : '🔓 空き（必要な部屋が `--shared` で確保可能）'

  const lines = [
    '# 並行開発 進行ボード (PARALLEL_BOARD)',
    '',
    '> このファイルは `scripts/parallel.mjs` が自動更新します（手動編集は不要です）。',
    '',
    `- **最終更新**: ${formatJst(state.updatedAt)} (JST)`,
    `- **共通パーツロック (\`shared\`)**: ${sharedStatusText}`,
    '',
    '## 作業部屋一覧',
    '',
    '| 部屋 | 状態 | 担当エリア | 共通ロック | 確認ポート | 作業内容 | メモ | 開始時刻 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
  ]

  for (const roomId of ROOM_ORDER) {
    const meta = ROOMS[roomId]
    const r = state.rooms[roomId]
    const statusLabel = r.status === 'active' ? '🟡 作業中' : '⚪ 空き'
    const areasLabel = r.areas.length > 0 ? r.areas.map((a) => `\`${a}\``).join(', ') : '-'
    const sharedLabel = r.status === 'active' && r.shared ? '🔒 あり' : '-'
    const portLabel = `\`${meta.port}\``
    const taskLabel = r.status === 'active' ? escapeCell(r.task) : '-'
    const notesLabel = r.status === 'active' ? escapeCell(r.notes) : '-'
    const claimedLabel = r.status === 'active' ? formatJst(r.claimedAt) : '-'
    lines.push(
      `| \`${roomId}\` | ${statusLabel} | ${areasLabel} | ${sharedLabel} | ${portLabel} | ${taskLabel} | ${notesLabel} | ${claimedLabel} |`
    )
  }

  lines.push(
    '',
    '## エリア早見表',
    '',
    '| エリア名 | 主な担当範囲 |',
    '| :--- | :--- |'
  )
  for (const [areaKey, areaDesc] of Object.entries(AREAS)) {
    lines.push(`| \`${areaKey}\` | ${areaDesc} |`)
  }
  lines.push('| `shared` (`--shared`) | 全体設定・型定義・Firebase共通・全体CSS等（同時1部屋のみ） |')

  lines.push('', '## 最近の統合ログ', '')
  if (state.history.length === 0) {
    lines.push('_まだ統合履歴はありません。_')
  } else {
    lines.push('| 完了時刻 | 部屋 | 内容 | メモ | コミット |')
    lines.push('| :--- | :--- | :--- | :--- | :--- |')
    for (const item of state.history.slice(0, 10)) {
      lines.push(
        `| ${formatJst(item.mergedAt)} | \`${item.room}\` | ${escapeCell(item.task)} | ${escapeCell(item.summary)} | \`${item.commit || '-'}\` |`
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}

function saveStateAndBoard(paths, state) {
  state.updatedAt = new Date().toISOString()
  atomicWriteFile(paths.statePath, JSON.stringify(state, null, 2) + '\n')
  atomicWriteFile(paths.boardPath, renderBoard(state))
}

function isProcessAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code !== 'ESRCH'
  }
}

function tryCleanupStaleLock(lockPath, ownerFile, staleMs) {
  let owner = null
  try {
    owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
  } catch {
    return false
  }
  if (!owner || typeof owner.startedAt !== 'number') return false
  if (Date.now() - owner.startedAt <= staleMs) return false
  if (isProcessAlive(owner.pid)) return false

  try {
    if (pathExists(ownerFile)) fs.unlinkSync(ownerFile)
    if (pathExists(lockPath)) fs.rmdirSync(lockPath)
    return true
  } catch {
    return false
  }
}

function withLock(paths, name, staleMs, fn) {
  fs.mkdirSync(paths.locksDir, { recursive: true })
  const lockPath = path.join(paths.locksDir, `${name}.lock`)
  const ownerFile = path.join(lockPath, 'owner.json')
  const waitStart = Date.now()

  while (true) {
    try {
      fs.mkdirSync(lockPath)
      break
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err
      if (tryCleanupStaleLock(lockPath, ownerFile, staleMs)) {
        continue
      }
      if (Date.now() - waitStart >= LOCK_WAIT_TIMEOUT_MS) {
        let holderInfo = ''
        try {
          const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
          holderInfo = ` (PID: ${owner.pid}, cmd: ${owner.cmd || 'unknown'})`
        } catch {
          holderInfo = ''
        }
        throw new Error(`ロック '${name}' の取得がタイムアウトしました${holderInfo}。少し待ってから再実行してください。`)
      }
      sleepMs(100)
    }
  }

  try {
    const ownerPayload = {
      pid: process.pid,
      startedAt: Date.now(),
      cmd: process.argv.slice(2).join(' '),
    }
    fs.writeFileSync(ownerFile, JSON.stringify(ownerPayload), 'utf8')
    return fn()
  } finally {
    try {
      if (pathExists(ownerFile)) fs.unlinkSync(ownerFile)
    } catch {
      // ignore cleanup error
    }
    try {
      if (pathExists(lockPath)) fs.rmdirSync(lockPath)
    } catch {
      // ignore cleanup error
    }
  }
}

function classifyFile(rawRelPath) {
  const p = rawRelPath.replaceAll('\\', '/').normalize('NFC')
  const base = path.posix.basename(p)
  const segments = p.split('/').filter(Boolean)

  // 1. Forbidden files
  if (
    p === '都立三原' ||
    p.startsWith('都立三原/') ||
    p === 'スクショ例' ||
    p.startsWith('スクショ例/') ||
    p === 'PARALLEL_BOARD.md' ||
    p === '.worktrees' ||
    p.startsWith('.worktrees/') ||
    p === '.secrets' ||
    p.startsWith('.secrets/') ||
    segments.includes('.secrets') ||
    p === '.portal-backups' ||
    p.startsWith('.portal-backups/') ||
    segments.includes('.portal-backups') ||
    base === '.env' ||
    (base.startsWith('.env.') && base !== '.env.example') ||
    /firebase-adminsdk.*\.json$/i.test(base) ||
    /service-account.*\.json$/i.test(base)
  ) {
    return {
      kind: 'forbidden',
      area: null,
      reason: '個人情報や環境変数・秘密鍵・バックアップ・管理用ローカルファイルはコミット禁止です',
    }
  }

  // 2. Shared files
  if (SHARED_EXACT_FILES.has(p)) {
    return { kind: 'shared', area: 'shared' }
  }

  // 3. Area files
  if (/^src\/portal\/components\/(HomeView|LoginScreen|PinGate|AccessDeniedScreen)\.[^/]+$/.test(p)) {
    return { kind: 'area', area: 'portal-home' }
  }
  if (
    /^src\/portal\/components\/(GamesView|MatchOrganizerPanel|StatsScreenshotImporter)\.[^/]+$/.test(p) ||
    /^src\/portal\/utils\/(matches|stats)\.[^/]+$/.test(p)
  ) {
    return { kind: 'area', area: 'portal-games' }
  }
  if (
    /^src\/portal\/components\/(PracticesView|YouTubeEmbed|YouTubeImportPanel)\.[^/]+$/.test(p) ||
    /^src\/portal\/services\/youtubeApi\.[^/]+$/.test(p) ||
    /^src\/portal\/utils\/youtube\.[^/]+$/.test(p)
  ) {
    return { kind: 'area', area: 'portal-practices' }
  }
  if (
    /^src\/portal\/components\/AdminView\.[^/]+$/.test(p) ||
    /^src\/portal\/utils\/roster\.[^/]+$/.test(p)
  ) {
    return { kind: 'area', area: 'portal-admin' }
  }
  if (
    p === 'src/App.tsx' ||
    p === 'src/App.css' ||
    p.startsWith('src/components/') ||
    p.startsWith('src/utils/')
  ) {
    return { kind: 'area', area: 'video-analyzer' }
  }
  if (
    p.startsWith('api/') ||
    /^src\/portal\/services\/(statsOcrApi|matchOrganizeApi)\.[^/]+$/.test(p)
  ) {
    return { kind: 'area', area: 'api' }
  }
  if (p.endsWith('.md')) {
    return { kind: 'area', area: 'docs' }
  }

  // 4. Unclassified files default to shared lock for safety
  return {
    kind: 'shared',
    area: 'shared',
    reason: 'エリア未登録ファイルのため共通扱い (--shared が必要)',
  }
}

function getWorktreeChangedFiles(worktreePath) {
  const files = new Set()
  const commands = [
    ['-C', worktreePath, '-c', 'core.quotepath=false', 'diff', '--name-only', 'main...HEAD'],
    ['-C', worktreePath, '-c', 'core.quotepath=false', 'diff', '--name-only'],
    ['-C', worktreePath, '-c', 'core.quotepath=false', 'diff', '--cached', '--name-only'],
    ['-C', worktreePath, '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard'],
  ]
  for (const args of commands) {
    const out = runGit(args, worktreePath)
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) files.add(trimmed)
    }
  }
  return Array.from(files).sort()
}

function evaluateRoomFiles(roomId, state, worktreePath) {
  const roomState = state.rooms[roomId]
  const changedFiles = getWorktreeChangedFiles(worktreePath)
  const violations = []
  const allowedAreas = new Set(roomState.areas)
  const otherActiveShared = ROOM_ORDER.find(
    (id) => id !== roomId && state.rooms[id].status === 'active' && state.rooms[id].shared
  )
  const areaOwners = new Map()
  for (const id of ROOM_ORDER) {
    if (id === roomId || state.rooms[id].status !== 'active') continue
    for (const a of state.rooms[id].areas) {
      areaOwners.set(a, id)
    }
  }

  for (const file of changedFiles) {
    const cls = classifyFile(file)
    if (cls.kind === 'forbidden') {
      violations.push(`🚫 禁止ファイル: ${file} (${cls.reason})`)
      continue
    }
    if (cls.kind === 'shared') {
      if (!roomState.shared) {
        const extra = cls.reason ? ` / ${cls.reason}` : ''
        violations.push(`🔒 共通ファイル無許可編集: ${file} (--shared 付きで確保が必要${extra})`)
      } else if (otherActiveShared) {
        violations.push(`⚠️ 共通ロック競合 (${otherActiveShared} も --shared): ${file}`)
      }
      continue
    }
    if (!allowedAreas.has(cls.area)) {
      const owner = areaOwners.get(cls.area)
      if (owner) {
        violations.push(`🚧 他部屋エリア侵入 (${owner} が '${cls.area}' を担当中): ${file}`)
      } else {
        violations.push(`⚠️ 担当外エリア '${cls.area}' の編集: ${file} (担当エリア: ${roomState.areas.join(', ') || 'なし'})`)
      }
    }
  }

  return { changedFiles, violations }
}

function ensureDotEnvSymlink(mainRoot, worktreePath) {
  const mainEnv = path.join(mainRoot, '.env')
  const wtEnv = path.join(worktreePath, '.env')
  if (fs.existsSync(mainEnv) && !pathExists(wtEnv)) {
    fs.symlinkSync(mainEnv, wtEnv)
  }
}

function cloneOrInstallNodeModules(mainRoot, worktreePath) {
  const mainModules = path.join(mainRoot, 'node_modules')
  const wtModules = path.join(worktreePath, 'node_modules')
  if (pathExists(wtModules)) return
  if (!fs.existsSync(mainModules)) {
    console.log('node_modules が見つからないため npm ci を実行します...')
    execFileSync('npm', ['ci'], { cwd: worktreePath, stdio: 'inherit' })
    return
  }
  console.log('node_modules を作業部屋へ複製中 (APFS CoW)...')
  try {
    execFileSync('cp', ['-cR', mainModules, wtModules], { stdio: 'pipe' })
  } catch {
    console.log('高速コピーに失敗したため npm ci に切り替えます...')
    execFileSync('npm', ['ci'], { cwd: worktreePath, stdio: 'inherit' })
  }
}

function parseCliArgs(argv, valueFlags, booleanFlags) {
  const options = {}
  const positionals = []
  const valueSet = new Set(valueFlags)
  const boolSet = new Set(booleanFlags)

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }
    const eqIndex = token.indexOf('=')
    const flagName = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2)
    if (boolSet.has(flagName)) {
      if (eqIndex >= 0) {
        options[flagName] = token.slice(eqIndex + 1) !== 'false'
      } else {
        options[flagName] = true
      }
      continue
    }
    if (valueSet.has(flagName)) {
      if (eqIndex >= 0) {
        options[flagName] = token.slice(eqIndex + 1)
      } else {
        i += 1
        if (i >= argv.length) {
          throw new Error(`--${flagName} には値が必要です。`)
        }
        options[flagName] = argv[i]
      }
      continue
    }
    throw new Error(`不明なオプションです: --${flagName}`)
  }

  return { options, positionals }
}

function assertValidRoom(roomId) {
  if (!roomId || !ROOMS[roomId]) {
    throw new Error(`部屋名は ${ROOM_ORDER.join(' / ')} のいずれかを指定してください。`)
  }
  return roomId
}

function getMainTrackingStatus(mainRoot) {
  const branch = runGit(['-C', mainRoot, 'rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const trackedDirty = runGit(
    ['-C', mainRoot, '-c', 'core.quotepath=false', 'status', '--porcelain', '--untracked-files=no'],
    mainRoot
  ).trim()
  return { branch, trackedDirty }
}

function cmdInit(paths) {
  const state = withLock(paths, 'state', STATE_LOCK_STALE_MS, () => {
    const loaded = loadState(paths)
    saveStateAndBoard(paths, loaded)
    return loaded
  })
  console.log(`初期化完了: ${paths.boardPath}`)
  printStatusSummary(paths, state)
}

function printStatusSummary(paths, state) {
  const sharedHolder = ROOM_ORDER.find(
    (id) => state.rooms[id].status === 'active' && state.rooms[id].shared
  )
  console.log(`=== 並行開発ステータス (更新: ${formatJst(state.updatedAt)}) ===`)
  console.log(`共通ロック (--shared): ${sharedHolder ? `LOCKED by ${sharedHolder}` : 'FREE'}`)
  for (const roomId of ROOM_ORDER) {
    const meta = ROOMS[roomId]
    const r = state.rooms[roomId]
    const wtPath = path.join(paths.mainRoot, meta.relDir)
    const wtExists = fs.existsSync(wtPath)
    if (r.status === 'active') {
      console.log(
        `  [${roomId}] ACTIVE | port:${meta.port} | areas:[${r.areas.join(', ') || '-'}] | shared:${r.shared ? 'YES' : 'no'} | task: ${r.task}${r.notes ? ` | note: ${r.notes}` : ''}`
      )
    } else {
      let extra = ''
      if (wtExists) {
        const dirty = runGitSafe(
          ['-C', wtPath, '-c', 'core.quotepath=false', 'status', '--porcelain'],
          wtPath
        )
        if (dirty.ok && dirty.stdout.trim()) extra = ' (注意: 未コミット変更あり)'
      }
      console.log(`  [${roomId}] IDLE   | port:${meta.port} | worktree:${wtExists ? '準備済み' : '未作成'}${extra}`)
    }
  }
  if (state.history.length > 0) {
    console.log('最近の統合:')
    for (const h of state.history.slice(0, 5)) {
      console.log(`  - ${formatJst(h.mergedAt)} [${h.room}] ${h.task} (${h.commit})`)
    }
  }
}

function cmdStatus(paths) {
  const state = withLock(paths, 'state', STATE_LOCK_STALE_MS, () => {
    const loaded = loadState(paths)
    saveStateAndBoard(paths, loaded)
    return loaded
  })
  printStatusSummary(paths, state)
}

function cmdClaim(paths, argv) {
  const { options, positionals } = parseCliArgs(
    argv,
    ['task', 'area', 'room', 'notes'],
    ['shared']
  )
  if (positionals.length > 0) {
    throw new Error(`不要な引数があります: ${positionals.join(' ')}`)
  }
  const task = (options.task || '').trim()
  if (!task) {
    throw new Error('--task "<作業内容>" を指定してください。')
  }
  const shared = Boolean(options.shared)
  const rawAreas = (options.area || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const areas = Array.from(new Set(rawAreas))

  if (areas.length === 0 && !shared) {
    throw new Error(`--area "<エリア>" (または --shared) を指定してください。有効エリア: ${Object.keys(AREAS).join(', ')}`)
  }
  for (const a of areas) {
    if (!AREAS[a]) {
      throw new Error(`未知のエリア '${a}' です。有効エリア: ${Object.keys(AREAS).join(', ')}`)
    }
  }
  const requestedRoom = options.room ? assertValidRoom(options.room) : null
  const notes = (options.notes || '').trim()

  const result = withLock(paths, 'state', STATE_LOCK_STALE_MS, () => {
    const state = loadState(paths)

    // 1. Choose room
    let targetRoom = requestedRoom
    if (targetRoom) {
      if (state.rooms[targetRoom].status === 'active') {
        throw new Error(
          `${targetRoom} は現在作業中です（内容: ${state.rooms[targetRoom].task}）。別の部屋を指定してください。`
        )
      }
    } else {
      targetRoom = ROOM_ORDER.find((id) => state.rooms[id].status === 'idle') || null
      if (!targetRoom) {
        const activeList = ROOM_ORDER.map((id) => `${id}: ${state.rooms[id].task}`).join(' / ')
        throw new Error(`全3部屋が作業中のため空きがありません (${activeList})。`)
      }
    }

    // 2. Check conflicts with active rooms
    for (const id of ROOM_ORDER) {
      const r = state.rooms[id]
      if (r.status !== 'active') continue
      if (shared && r.shared) {
        throw new Error(`共通パーツ (--shared) は現在 ${id} がロック中です（内容: ${r.task}）。完了まで待つか、ユーザーへ確認してください。`)
      }
      for (const a of areas) {
        if (r.areas.includes(a)) {
          throw new Error(`エリア '${a}' は現在 ${id} が担当中です（内容: ${r.task}）。別の範囲にするか、完了まで待ってください。`)
        }
      }
    }

    // 3. Check main repository status
    const mainStatus = getMainTrackingStatus(paths.mainRoot)
    if (mainStatus.branch !== 'main') {
      throw new Error(`親フォルダのブランチが 'main' ではなく '${mainStatus.branch}' です。'main' に戻してから実行してください。`)
    }
    if (mainStatus.trackedDirty) {
      throw new Error(`親フォルダに未コミットの変更があるため安全のため中断しました:\n${mainStatus.trackedDirty}`)
    }

    // 4. Prepare worktree
    const meta = ROOMS[targetRoom]
    const worktreePath = path.join(paths.mainRoot, meta.relDir)
    const branchRef = `refs/heads/${meta.branch}`
    const branchExists = runGitSafe(['-C', paths.mainRoot, 'show-ref', '--verify', '--quiet', branchRef], paths.mainRoot).ok

    if (!fs.existsSync(worktreePath)) {
      if (branchExists) {
        const aheadCount = Number(
          runGit(['-C', paths.mainRoot, 'rev-list', '--count', `main..${meta.branch}`], paths.mainRoot).trim()
        )
        if (aheadCount > 0) {
          throw new Error(
            `ブランチ '${meta.branch}' に main へ未統合のコミットが ${aheadCount} 件残っています。確認後に解消してください。`
          )
        }
      }
      fs.mkdirSync(path.join(paths.mainRoot, '.worktrees'), { recursive: true })
      runGit(['-C', paths.mainRoot, 'worktree', 'add', '-B', meta.branch, worktreePath, 'main'], paths.mainRoot)
      cloneOrInstallNodeModules(paths.mainRoot, worktreePath)
      ensureDotEnvSymlink(paths.mainRoot, worktreePath)
    } else {
      if (!pathExists(path.join(worktreePath, '.git'))) {
        throw new Error(`${worktreePath} は正常な git worktree ではありません。状態を確認してください。`)
      }
      const wtDirty = runGit(
        ['-C', worktreePath, '-c', 'core.quotepath=false', 'status', '--porcelain'],
        worktreePath
      ).trim()
      if (wtDirty) {
        throw new Error(`${targetRoom} の作業部屋に未コミット変更が残っています:\n${wtDirty}`)
      }
      const headAhead = Number(
        runGit(['-C', worktreePath, 'rev-list', '--count', 'main..HEAD'], worktreePath).trim()
      )
      if (headAhead > 0) {
        throw new Error(`${targetRoom} に main へ未統合のコミットが ${headAhead} 件残っています。`)
      }
      if (branchExists) {
        const branchAhead = Number(
          runGit(['-C', paths.mainRoot, 'rev-list', '--count', `main..${meta.branch}`], paths.mainRoot).trim()
        )
        if (branchAhead > 0) {
          throw new Error(`ブランチ '${meta.branch}' に main へ未統合のコミットが ${branchAhead} 件残っています。`)
        }
        runGit(['-C', worktreePath, 'checkout', meta.branch], worktreePath)
        runGit(['-C', worktreePath, 'reset', '--hard', 'main'], worktreePath)
      } else {
        runGit(['-C', worktreePath, 'checkout', '-B', meta.branch, 'main'], worktreePath)
      }

      const prevLockHash = state.rooms[targetRoom].packageLockHash
      const currentLockHash = hashFile(path.join(worktreePath, 'package-lock.json'))
      if (!pathExists(path.join(worktreePath, 'node_modules'))) {
        cloneOrInstallNodeModules(paths.mainRoot, worktreePath)
      } else if (prevLockHash && currentLockHash && prevLockHash !== currentLockHash) {
        console.log('package-lock.json の更新を検知したため依存関係を更新中...')
        execFileSync('npm', ['install'], { cwd: worktreePath, stdio: 'inherit' })
      }
      ensureDotEnvSymlink(paths.mainRoot, worktreePath)
    }

    const newLockHash = hashFile(path.join(worktreePath, 'package-lock.json'))
    state.rooms[targetRoom] = {
      status: 'active',
      task,
      areas,
      shared,
      notes,
      claimedAt: new Date().toISOString(),
      packageLockHash: newLockHash,
    }
    saveStateAndBoard(paths, state)

    return { targetRoom, meta, worktreePath, areas, shared, task }
  })

  console.log('')
  console.log(`✅ 作業部屋 '${result.targetRoom}' を確保しました。`)
  console.log(`- 作業ディレクトリ (絶対パス): ${result.worktreePath}`)
  console.log(`- ブランチ: ${result.meta.branch}`)
  console.log(`- 担当エリア: ${result.areas.join(', ') || '(共通のみ)'}`)
  console.log(`- 共通ロック (--shared): ${result.shared ? 'あり' : 'なし'}`)
  console.log(`- 確認サーバー起動: cd "${result.worktreePath}" && npm run dev -- --port ${result.meta.port}`)
  console.log(`- 完了時の統合コマンド: node scripts/parallel.mjs merge ${result.targetRoom} --summary "完了メモ"`)
}

function cmdNote(paths, argv) {
  const { positionals } = parseCliArgs(argv, [], [])
  const roomId = assertValidRoom(positionals[0])
  const memo = positionals.slice(1).join(' ').trim()
  if (!memo) {
    throw new Error('メモ内容を指定してください。例: node scripts/parallel.mjs note room-a "ビルド確認中"')
  }

  withLock(paths, 'state', STATE_LOCK_STALE_MS, () => {
    const state = loadState(paths)
    if (state.rooms[roomId].status !== 'active') {
      throw new Error(`${roomId} は現在作業中ではありません。`)
    }
    state.rooms[roomId].notes = memo
    saveStateAndBoard(paths, state)
  })
  console.log(`📝 ${roomId} のメモを更新しました: ${memo}`)
}

function mergeMainIntoWorktree(worktreePath) {
  const res = runGitSafe(['-C', worktreePath, 'merge', '--no-edit', 'main'], worktreePath)
  if (res.ok) return
  const conflicted = runGitSafe(
    ['-C', worktreePath, '-c', 'core.quotepath=false', 'diff', '--name-only', '--diff-filter=U'],
    worktreePath
  )
  runGitSafe(['-C', worktreePath, 'merge', '--abort'], worktreePath)
  const filesText = conflicted.stdout.trim() || '(特定不可)'
  throw new Error(
    `main の取り込み中にコンフリクトが発生したため自動中断しました。\n競合ファイル:\n${filesText}`
  )
}

function cmdSync(paths, argv) {
  const { positionals } = parseCliArgs(argv, [], [])
  const roomId = assertValidRoom(positionals[0])
  const worktreePath = path.join(paths.mainRoot, ROOMS[roomId].relDir)

  const state = withLock(paths, 'state', STATE_LOCK_STALE_MS, () => loadState(paths))
  if (state.rooms[roomId].status !== 'active') {
    throw new Error(`${roomId} は現在作業中ではありません。`)
  }
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`作業部屋が見つかりません: ${worktreePath}`)
  }
  const wtDirty = runGit(
    ['-C', worktreePath, '-c', 'core.quotepath=false', 'status', '--porcelain'],
    worktreePath
  ).trim()
  if (wtDirty) {
    throw new Error(`作業部屋に未コミットの変更があるため sync できません。先にコミットしてください:\n${wtDirty}`)
  }

  mergeMainIntoWorktree(worktreePath)
  console.log(`🔄 ${roomId} へ最新の main を取り込みました。`)
}

function cmdCheck(paths, argv) {
  const { positionals } = parseCliArgs(argv, [], [])
  const roomId = assertValidRoom(positionals[0])
  const worktreePath = path.join(paths.mainRoot, ROOMS[roomId].relDir)

  const state = withLock(paths, 'state', STATE_LOCK_STALE_MS, () => loadState(paths))
  if (state.rooms[roomId].status !== 'active') {
    throw new Error(`${roomId} は現在作業中ではありません。`)
  }
  if (!fs.existsSync(worktreePath)) {
    throw new Error(`作業部屋が見つかりません: ${worktreePath}`)
  }

  const { changedFiles, violations } = evaluateRoomFiles(roomId, state, worktreePath)
  if (violations.length > 0) {
    console.error(`❌ ${roomId} の範囲チェックで違反が見つかりました:`)
    for (const v of violations) {
      console.error(`  - ${v}`)
    }
    process.exitCode = 1
    return
  }
  console.log(`✅ ${roomId} の範囲チェック OK (変更ファイル ${changedFiles.length} 件・違反なし)`)
}

function cmdMerge(paths, argv) {
  const { options, positionals } = parseCliArgs(argv, ['summary'], ['skip-build'])
  const roomId = assertValidRoom(positionals[0])
  const summary = (options.summary || '').trim()
  const skipBuild = Boolean(options['skip-build'])
  const meta = ROOMS[roomId]
  const worktreePath = path.join(paths.mainRoot, meta.relDir)

  const mergedInfo = withLock(paths, 'merge', MERGE_LOCK_STALE_MS, () => {
    const state = withLock(paths, 'state', STATE_LOCK_STALE_MS, () => loadState(paths))
    const roomState = state.rooms[roomId]
    if (roomState.status !== 'active') {
      throw new Error(`${roomId} は作業中ではありません。`)
    }
    if (!fs.existsSync(worktreePath)) {
      throw new Error(`作業部屋が見つかりません: ${worktreePath}`)
    }

    const wtDirty = runGit(
      ['-C', worktreePath, '-c', 'core.quotepath=false', 'status', '--porcelain'],
      worktreePath
    ).trim()
    if (wtDirty) {
      throw new Error(`作業部屋に未コミットの変更が残っています。先にコミットしてください:\n${wtDirty}`)
    }

    const mainStatus = getMainTrackingStatus(paths.mainRoot)
    if (mainStatus.branch !== 'main') {
      throw new Error(`親フォルダのブランチが 'main' ではありません ('${mainStatus.branch}')。`)
    }
    if (mainStatus.trackedDirty) {
      throw new Error(`親フォルダに未コミットの変更があります:\n${mainStatus.trackedDirty}`)
    }

    const commitCount = Number(
      runGit(['-C', worktreePath, 'rev-list', '--count', 'main..HEAD'], worktreePath).trim()
    )
    if (commitCount === 0) {
      throw new Error(`${roomId} にまだコミットがありません。変更をコミットするか、中止なら release を実行してください。`)
    }

    const { violations } = evaluateRoomFiles(roomId, state, worktreePath)
    if (violations.length > 0) {
      throw new Error(`範囲チェック違反のため統合を中止しました:\n- ${violations.join('\n- ')}`)
    }

    console.log(`1/3: ${roomId} へ最新の main を取り込み中...`)
    mergeMainIntoWorktree(worktreePath)

    if (!skipBuild) {
      console.log(`2/3: ${roomId} 内でビルド検証 (npm run build) を実行中...`)
      try {
        execFileSync('npm', ['run', 'build'], { cwd: worktreePath, stdio: 'inherit' })
      } catch {
        throw new Error(`ビルドに失敗したため main への統合を中止しました（main は無変更です）。`)
      }
    } else {
      console.log('2/3: --skip-build 指定のためビルド検証をスキップしました。')
    }

    const mainCheckBeforeMerge = getMainTrackingStatus(paths.mainRoot)
    if (mainCheckBeforeMerge.branch !== 'main' || mainCheckBeforeMerge.trackedDirty) {
      throw new Error('統合直前に親フォルダの状態が変化したため中止しました。')
    }

    console.log(`3/3: main へ統合中 (${meta.branch})...`)
    runGit(
      ['-C', paths.mainRoot, 'merge', '--no-ff', meta.branch, '-m', `merge(${roomId}): ${roomState.task}`],
      paths.mainRoot
    )
    const shortHash = runGit(['-C', paths.mainRoot, 'rev-parse', '--short', 'HEAD'], paths.mainRoot).trim()

    withLock(paths, 'state', STATE_LOCK_STALE_MS, () => {
      const latestState = loadState(paths)
      const prevTask = latestState.rooms[roomId].task || roomState.task
      const prevAreas = latestState.rooms[roomId].areas
      const prevShared = latestState.rooms[roomId].shared
      const prevNotes = latestState.rooms[roomId].notes
      const mainLockHash = hashFile(path.join(paths.mainRoot, 'package-lock.json'))

      latestState.rooms[roomId] = createEmptyRoomState(mainLockHash)
      latestState.history.unshift({
        mergedAt: new Date().toISOString(),
        room: roomId,
        task: prevTask,
        areas: prevAreas,
        shared: prevShared,
        summary: summary || prevNotes || '',
        commit: shortHash,
      })
      latestState.history = latestState.history.slice(0, MAX_HISTORY_ITEMS)
      saveStateAndBoard(paths, latestState)
    })

    return { shortHash, task: roomState.task }
  })

  console.log('')
  console.log(`✅ ${roomId} の変更をローカルの main へ統合しました (コミット: ${mergedInfo.shortHash})。`)
  console.log('※ 本番公開 (git push) はユーザーの明示的な指示があるまで実行しないでください。')
}

function cmdRelease(paths, argv) {
  const { options, positionals } = parseCliArgs(argv, ['reason'], ['force'])
  const roomId = assertValidRoom(positionals[0])
  const reason = (options.reason || '').trim()
  const force = Boolean(options.force)
  const worktreePath = path.join(paths.mainRoot, ROOMS[roomId].relDir)

  withLock(paths, 'state', STATE_LOCK_STALE_MS, () => {
    const state = loadState(paths)
    const roomState = state.rooms[roomId]
    if (roomState.status === 'idle' && !force) {
      console.log(`ℹ️ ${roomId} はすでに空き状態です。`)
      return
    }
    if (!force && fs.existsSync(worktreePath)) {
      const wtDirty = runGit(
        ['-C', worktreePath, '-c', 'core.quotepath=false', 'status', '--porcelain'],
        worktreePath
      ).trim()
      if (wtDirty) {
        throw new Error(
          `${roomId} に未コミットの変更が残っているため解放を中止しました (強制解放する場合は --force):\n${wtDirty}`
        )
      }
      const unmerged = Number(
        runGit(['-C', worktreePath, 'rev-list', '--count', 'main..HEAD'], worktreePath).trim()
      )
      if (unmerged > 0) {
        throw new Error(
          `${roomId} に main へ未統合のコミットが ${unmerged} 件残っています (強制解放する場合は --force)。`
        )
      }
    }

    const preservedHash = roomState.packageLockHash
    state.rooms[roomId] = createEmptyRoomState(preservedHash)
    saveStateAndBoard(paths, state)
  })

  console.log(`🔓 ${roomId} の予約を解放しました${reason ? `（理由: ${reason}）` : ''}。作業部屋フォルダは再利用のため保持しています。`)
}

function printHelp() {
  console.log(`使い方: node scripts/parallel.mjs <command> [options]

コマンド:
  init                                      状態ファイルと PARALLEL_BOARD.md を初期化
  status                                    全部屋の状態を表示して PARALLEL_BOARD.md を更新
  claim --task "<説明>" --area "<a1,a2>" [--room room-a|room-b|room-c] [--shared] [--notes "<メモ>"]
                                            空いている作業部屋を確保
  note <room> "<メモ>"                      作業中のメモを更新
  sync <room>                               作業部屋へ最新の main を取り込む
  check <room>                              変更ファイルが担当エリア・ルール内か検証
  merge <room> [--summary "<メモ>"] [--skip-build]
                                            main 同期・ビルド検証後にローカル main へ統合
  release <room> [--reason "<理由>"] [--force]
                                            統合せず予約のみ解放（フォルダは削除しない）`)
}

function main() {
  const args = process.argv.slice(2)
  const command = args[0]
  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }

  const paths = resolvePaths()
  const rest = args.slice(1)

  switch (command) {
    case 'init':
      cmdInit(paths)
      break
    case 'status':
      cmdStatus(paths)
      break
    case 'claim':
      cmdClaim(paths, rest)
      break
    case 'note':
      cmdNote(paths, rest)
      break
    case 'sync':
      cmdSync(paths, rest)
      break
    case 'check':
      cmdCheck(paths, rest)
      break
    case 'merge':
      cmdMerge(paths, rest)
      break
    case 'release':
      cmdRelease(paths, rest)
      break
    default:
      throw new Error(`不明なコマンドです: ${command}`)
  }
}

export { classifyFile }

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  }
})()

if (isDirectRun) {
  try {
    main()
  } catch (err) {
    console.error(`エラー: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
