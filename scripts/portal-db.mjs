#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const PORTAL_COLLECTION = 'portal'
export const PORTAL_DOC_ID = 'main'
export const DEFAULT_KEY_REL_PATH = '.secrets/firebase-admin-key.json'
export const DEFAULT_BACKUP_REL_DIR = '.portal-backups'

export const REQUIRED_PORTAL_KEYS = [
  'teamName',
  'players',
  'games',
  'practices',
  'practiceTags',
  'adminPin',
  'ownerEmails',
  'allowedEmails',
]

export const VALID_GAME_CATEGORIES = new Set(['公式戦', '練習試合', 'カップ戦'])
export const VALID_TEAM_UNITS = new Set(['A', 'B', 'その他', ''])
export const VALID_STAT_TEAMS = new Set(['home', 'away'])

const BOX_SCORE_NUMERIC_KEYS = [
  'pts',
  'fgm',
  'fga',
  'tpm',
  'tpa',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'ast',
  'stl',
  'blk',
  'to',
  'pf',
]

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase()
}

export function resolveRepoRoot(cwd = process.cwd()) {
  try {
    const rawCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (!rawCommonDir) return path.resolve(cwd)
    const gitCommonDir = path.resolve(cwd, rawCommonDir)
    return path.dirname(gitCommonDir)
  } catch {
    return path.resolve(cwd)
  }
}

export function resolveServiceAccountPath({
  envPath,
  cwd = process.cwd(),
  repoRoot = resolveRepoRoot(cwd),
  fsImpl = fs,
} = {}) {
  const trimmedEnv = typeof envPath === 'string' ? envPath.trim() : ''
  if (trimmedEnv) {
    return {
      keyPath: path.resolve(cwd, trimmedEnv),
      source: 'env',
    }
  }

  const cwdCandidate = path.resolve(cwd, DEFAULT_KEY_REL_PATH)
  if (fsImpl.existsSync(cwdCandidate)) {
    return {
      keyPath: cwdCandidate,
      source: 'default',
    }
  }

  const repoCandidate = path.resolve(repoRoot || cwd, DEFAULT_KEY_REL_PATH)
  return {
    keyPath: repoCandidate,
    source: 'default',
  }
}

export function buildMissingKeyMessage(keyPath, source) {
  const sourceNote =
    source === 'env'
      ? '環境変数 FIREBASE_SERVICE_ACCOUNT_PATH で指定された鍵ファイルが見つかりません。'
      : `既定の秘密鍵ファイル（${DEFAULT_KEY_REL_PATH}）が見つかりません。`
  return [
    sourceNote,
    `確認したパス: ${keyPath}`,
    '',
    '【秘密鍵ファイルの準備手順】',
    '1. Firebase コンソールで対象プロジェクト（basketball-portal-11649）を開く',
    '2. 「プロジェクトの設定」→「サービス アカウント」タブ →「新しい秘密鍵の生成」をクリックして JSON をダウンロードする',
    `3. ダウンロードした JSON をプロジェクト直下の ${DEFAULT_KEY_REL_PATH} として保存する`,
    '   （または実行時に FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json を指定する）',
    '',
    '※ .secrets/ および *firebase-adminsdk*.json / *service-account*.json は .gitignore と parallel.mjs で二重に保護されており、誤ってコミット・公開されることはありません。',
  ].join('\n')
}

export function loadServiceAccountKey({
  envPath,
  cwd = process.cwd(),
  repoRoot = resolveRepoRoot(cwd),
  fsImpl = fs,
} = {}) {
  const { keyPath, source } = resolveServiceAccountPath({ envPath, cwd, repoRoot, fsImpl })
  if (!fsImpl.existsSync(keyPath)) {
    throw new Error(buildMissingKeyMessage(keyPath, source))
  }

  let rawText
  try {
    rawText = fsImpl.readFileSync(keyPath, 'utf8')
  } catch (err) {
    throw new Error(
      `秘密鍵ファイルの読み込みに失敗しました (${keyPath}): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  }

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch (err) {
    throw new Error(
      `秘密鍵ファイルの JSON 解析に失敗しました (${keyPath}): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  }

  if (
    !isPlainObject(parsed) ||
    !isNonEmptyString(parsed.project_id) ||
    !isNonEmptyString(parsed.client_email) ||
    !isNonEmptyString(parsed.private_key)
  ) {
    throw new Error(
      `秘密鍵ファイルの形式が正しくありません (${keyPath})。Firebase サービスアカウント JSON（project_id / client_email / private_key を含むファイル）を指定してください。`
    )
  }

  return {
    keyPath,
    source,
    serviceAccount: parsed,
  }
}

export function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map((item) => stripUndefined(item))
  }
  if (isPlainObject(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v)
      }
    }
    return out
  }
  return value
}

function scanUnsupportedValues(value, pathLabel, errors) {
  if (value === undefined || value === null) return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      errors.push(`${pathLabel}: 無効な数値（NaN / Infinity）が含まれています`)
    }
    return
  }
  if (typeof value === 'string' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      if (item === undefined) {
        errors.push(`${pathLabel}[${idx}]: 配列要素に undefined が含まれています`)
        return
      }
      scanUnsupportedValues(item, `${pathLabel}[${idx}]`, errors)
    })
    return
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      scanUnsupportedValues(v, `${pathLabel}.${k}`, errors)
    }
    return
  }
  errors.push(`${pathLabel}: Firestore に保存できない型 (${typeof value}) が含まれています`)
}

function validateManualBoxScore(box, pathLabel, errors) {
  if (box === undefined) return
  if (!isPlainObject(box)) {
    errors.push(`${pathLabel}: オブジェクトである必要があります`)
    return
  }
  for (const [playerKey, entry] of Object.entries(box)) {
    if (entry === undefined) continue
    const entryPath = `${pathLabel}.${playerKey}`
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: オブジェクトである必要があります`)
      continue
    }
    if (entry.playerId !== undefined && typeof entry.playerId !== 'string') {
      errors.push(`${entryPath}.playerId: 文字列である必要があります`)
    }
    for (const statKey of BOX_SCORE_NUMERIC_KEYS) {
      if (entry[statKey] !== undefined && !isFiniteNonNegativeNumber(entry[statKey])) {
        errors.push(`${entryPath}.${statKey}: 0以上の数値である必要があります`)
      }
    }
  }
}

function validateVideoClip(clip, pathLabel, errors) {
  if (!isPlainObject(clip)) {
    errors.push(`${pathLabel}: オブジェクトである必要があります`)
    return
  }
  if (!isNonEmptyString(clip.id)) errors.push(`${pathLabel}.id: 空でない文字列が必要です`)
  if (typeof clip.label !== 'string') errors.push(`${pathLabel}.label: 文字列が必要です`)
  if (clip.youtubeTitle !== undefined && typeof clip.youtubeTitle !== 'string') {
    errors.push(`${pathLabel}.youtubeTitle: 文字列である必要があります`)
  }
  if (typeof clip.youtubeId !== 'string') errors.push(`${pathLabel}.youtubeId: 文字列が必要です`)
  if (typeof clip.youtubeUrl !== 'string') errors.push(`${pathLabel}.youtubeUrl: 文字列が必要です`)
  if (clip.homeScore !== undefined && !isFiniteNonNegativeNumber(clip.homeScore)) {
    errors.push(`${pathLabel}.homeScore: 0以上の数値である必要があります`)
  }
  if (clip.awayScore !== undefined && !isFiniteNonNegativeNumber(clip.awayScore)) {
    errors.push(`${pathLabel}.awayScore: 0以上の数値である必要があります`)
  }
  validateManualBoxScore(clip.manualBoxScore, `${pathLabel}.manualBoxScore`, errors)
}

function validateStatEvent(ev, pathLabel, errors) {
  if (!isPlainObject(ev)) {
    errors.push(`${pathLabel}: オブジェクトである必要があります`)
    return
  }
  if (!isNonEmptyString(ev.id)) errors.push(`${pathLabel}.id: 空でない文字列が必要です`)
  if (ev.videoClipId !== undefined && typeof ev.videoClipId !== 'string') {
    errors.push(`${pathLabel}.videoClipId: 文字列である必要があります`)
  }
  if (!isNonEmptyString(ev.quarter)) errors.push(`${pathLabel}.quarter: 文字列が必要です`)
  if (!isFiniteNonNegativeNumber(ev.timestampSec)) {
    errors.push(`${pathLabel}.timestampSec: 0以上の数値が必要です`)
  }
  if (!VALID_STAT_TEAMS.has(ev.team)) {
    errors.push(`${pathLabel}.team: 'home' または 'away' である必要があります`)
  }
  if (ev.playerId !== null && typeof ev.playerId !== 'string') {
    errors.push(`${pathLabel}.playerId: 文字列または null である必要があります`)
  }
  if (!isNonEmptyString(ev.type)) errors.push(`${pathLabel}.type: 文字列が必要です`)
  if (ev.note !== undefined && typeof ev.note !== 'string') {
    errors.push(`${pathLabel}.note: 文字列である必要があります`)
  }
}

function validateGameMatch(match, pathLabel, errors) {
  if (!isPlainObject(match)) {
    errors.push(`${pathLabel}: オブジェクトである必要があります`)
    return
  }
  if (!isNonEmptyString(match.id)) errors.push(`${pathLabel}.id: 空でない文字列が必要です`)
  if (typeof match.label !== 'string') errors.push(`${pathLabel}.label: 文字列が必要です`)
  if (match.teamUnit !== undefined && !VALID_TEAM_UNITS.has(match.teamUnit)) {
    errors.push(`${pathLabel}.teamUnit: 'A' / 'B' / 'その他' / '' のいずれかである必要があります`)
  }
  if (typeof match.opponent !== 'string') errors.push(`${pathLabel}.opponent: 文字列が必要です`)
  if (!isFiniteNonNegativeNumber(match.homeScore)) {
    errors.push(`${pathLabel}.homeScore: 0以上の数値が必要です`)
  }
  if (!isFiniteNonNegativeNumber(match.awayScore)) {
    errors.push(`${pathLabel}.awayScore: 0以上の数値が必要です`)
  }
  if (!Array.isArray(match.videos)) {
    errors.push(`${pathLabel}.videos: 配列が必要です`)
  } else {
    match.videos.forEach((clip, idx) => validateVideoClip(clip, `${pathLabel}.videos[${idx}]`, errors))
  }
  if (!Array.isArray(match.events)) {
    errors.push(`${pathLabel}.events: 配列が必要です`)
  } else {
    match.events.forEach((ev, idx) => validateStatEvent(ev, `${pathLabel}.events[${idx}]`, errors))
  }
  validateManualBoxScore(match.manualBoxScore, `${pathLabel}.manualBoxScore`, errors)
}

export function validatePortalData(raw) {
  const errors = []
  const warnings = []

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: ['ルートデータは JSON オブジェクトである必要があります。'],
      warnings: [],
      cleaned: null,
    }
  }

  for (const key of REQUIRED_PORTAL_KEYS) {
    if (!(key in raw)) {
      errors.push(`必須フィールド '${key}' がありません`)
    }
  }

  const allowedTopKeys = new Set(REQUIRED_PORTAL_KEYS)
  for (const key of Object.keys(raw)) {
    if (!allowedTopKeys.has(key)) {
      warnings.push(`想定外のトップレベルフィールド '${key}' が含まれています`)
    }
  }

  if ('teamName' in raw && !isNonEmptyString(raw.teamName)) {
    errors.push('teamName: 空でない文字列が必要です')
  }
  if ('adminPin' in raw && !isNonEmptyString(raw.adminPin)) {
    errors.push('adminPin: 空でない文字列が必要です')
  }

  if ('practiceTags' in raw) {
    if (!Array.isArray(raw.practiceTags)) {
      errors.push('practiceTags: 配列が必要です')
    } else {
      raw.practiceTags.forEach((tag, idx) => {
        if (typeof tag !== 'string') {
          errors.push(`practiceTags[${idx}]: 文字列である必要があります`)
        }
      })
    }
  }

  if ('ownerEmails' in raw) {
    if (!Array.isArray(raw.ownerEmails)) {
      errors.push('ownerEmails: 配列が必要です')
    } else if (raw.ownerEmails.length === 0) {
      errors.push('ownerEmails: オーナーロックアウト防止のため1件以上のメールアドレスが必要です')
    } else {
      raw.ownerEmails.forEach((email, idx) => {
        if (!isNonEmptyString(email)) {
          errors.push(`ownerEmails[${idx}]: 空でない文字列が必要です`)
        }
      })
    }
  }

  if ('allowedEmails' in raw) {
    if (!Array.isArray(raw.allowedEmails)) {
      errors.push('allowedEmails: 配列が必要です')
    } else {
      raw.allowedEmails.forEach((email, idx) => {
        if (!isNonEmptyString(email)) {
          errors.push(`allowedEmails[${idx}]: 空でない文字列が必要です`)
        }
      })
    }
  }

  if ('players' in raw) {
    if (!Array.isArray(raw.players)) {
      errors.push('players: 配列が必要です')
    } else {
      const seenPlayerIds = new Set()
      raw.players.forEach((player, idx) => {
        const pLabel = `players[${idx}]`
        if (!isPlainObject(player)) {
          errors.push(`${pLabel}: オブジェクトである必要があります`)
          return
        }
        if (!isNonEmptyString(player.id)) {
          errors.push(`${pLabel}.id: 空でない文字列が必要です`)
        } else if (seenPlayerIds.has(player.id)) {
          errors.push(`${pLabel}.id: 重複した選手ID '${player.id}' があります`)
        } else {
          seenPlayerIds.add(player.id)
        }
        if (typeof player.number !== 'string') {
          errors.push(`${pLabel}.number: 文字列が必要です`)
        }
        if (!isNonEmptyString(player.name)) {
          errors.push(`${pLabel}.name: 空でない文字列が必要です`)
        }
        if (player.position !== undefined && typeof player.position !== 'string') {
          errors.push(`${pLabel}.position: 文字列である必要があります`)
        }
        if (player.grade !== undefined && typeof player.grade !== 'string') {
          errors.push(`${pLabel}.grade: 文字列である必要があります`)
        }
      })
    }
  }

  if ('games' in raw) {
    if (!Array.isArray(raw.games)) {
      errors.push('games: 配列が必要です')
    } else {
      const seenGameIds = new Set()
      raw.games.forEach((game, idx) => {
        const gLabel = `games[${idx}]`
        if (!isPlainObject(game)) {
          errors.push(`${gLabel}: オブジェクトである必要があります`)
          return
        }
        if (!isNonEmptyString(game.id)) {
          errors.push(`${gLabel}.id: 空でない文字列が必要です`)
        } else if (seenGameIds.has(game.id)) {
          errors.push(`${gLabel}.id: 重複した試合日ID '${game.id}' があります`)
        } else {
          seenGameIds.add(game.id)
        }
        if (typeof game.title !== 'string') errors.push(`${gLabel}.title: 文字列が必要です`)
        if (typeof game.date !== 'string') errors.push(`${gLabel}.date: 文字列が必要です`)
        if (typeof game.opponent !== 'string') errors.push(`${gLabel}.opponent: 文字列が必要です`)
        if (!VALID_GAME_CATEGORIES.has(game.category)) {
          errors.push(`${gLabel}.category: '公式戦' / '練習試合' / 'カップ戦' のいずれかが必要です`)
        }
        if (!isFiniteNonNegativeNumber(game.homeScore)) {
          errors.push(`${gLabel}.homeScore: 0以上の数値が必要です`)
        }
        if (!isFiniteNonNegativeNumber(game.awayScore)) {
          errors.push(`${gLabel}.awayScore: 0以上の数値が必要です`)
        }
        if (game.youtubePlaylistId !== undefined && typeof game.youtubePlaylistId !== 'string') {
          errors.push(`${gLabel}.youtubePlaylistId: 文字列である必要があります`)
        }
        if (game.notes !== undefined && typeof game.notes !== 'string') {
          errors.push(`${gLabel}.notes: 文字列である必要があります`)
        }
        if (game.isOrganized !== undefined && typeof game.isOrganized !== 'boolean') {
          errors.push(`${gLabel}.isOrganized: boolean である必要があります`)
        }
        if (!Array.isArray(game.videos)) {
          errors.push(`${gLabel}.videos: 配列が必要です`)
        } else {
          game.videos.forEach((clip, cIdx) => validateVideoClip(clip, `${gLabel}.videos[${cIdx}]`, errors))
        }
        if (!Array.isArray(game.events)) {
          errors.push(`${gLabel}.events: 配列が必要です`)
        } else {
          game.events.forEach((ev, eIdx) => validateStatEvent(ev, `${gLabel}.events[${eIdx}]`, errors))
        }
        validateManualBoxScore(game.manualBoxScore, `${gLabel}.manualBoxScore`, errors)

        if (game.matches !== undefined) {
          if (!Array.isArray(game.matches)) {
            errors.push(`${gLabel}.matches: 配列である必要があります`)
          } else {
            const seenMatchIds = new Set()
            game.matches.forEach((m, mIdx) => {
              validateGameMatch(m, `${gLabel}.matches[${mIdx}]`, errors)
              if (isPlainObject(m) && isNonEmptyString(m.id)) {
                if (seenMatchIds.has(m.id)) {
                  errors.push(`${gLabel}.matches[${mIdx}].id: 試合日内で重複した試合ID '${m.id}' があります`)
                } else {
                  seenMatchIds.add(m.id)
                }
              }
            })
          }
        }
      })
    }
  }

  if ('practices' in raw) {
    if (!Array.isArray(raw.practices)) {
      errors.push('practices: 配列が必要です')
    } else {
      const seenPracticeIds = new Set()
      raw.practices.forEach((pr, idx) => {
        const prLabel = `practices[${idx}]`
        if (!isPlainObject(pr)) {
          errors.push(`${prLabel}: オブジェクトである必要があります`)
          return
        }
        if (!isNonEmptyString(pr.id)) {
          errors.push(`${prLabel}.id: 空でない文字列が必要です`)
        } else if (seenPracticeIds.has(pr.id)) {
          errors.push(`${prLabel}.id: 重複した練習動画ID '${pr.id}' があります`)
        } else {
          seenPracticeIds.add(pr.id)
        }
        if (typeof pr.title !== 'string') errors.push(`${prLabel}.title: 文字列が必要です`)
        if (typeof pr.date !== 'string') errors.push(`${prLabel}.date: 文字列が必要です`)
        if (typeof pr.youtubeId !== 'string') errors.push(`${prLabel}.youtubeId: 文字列が必要です`)
        if (typeof pr.youtubeUrl !== 'string') errors.push(`${prLabel}.youtubeUrl: 文字列が必要です`)
        if (pr.youtubePlaylistId !== undefined && typeof pr.youtubePlaylistId !== 'string') {
          errors.push(`${prLabel}.youtubePlaylistId: 文字列である必要があります`)
        }
        if (pr.memo !== undefined && typeof pr.memo !== 'string') {
          errors.push(`${prLabel}.memo: 文字列である必要があります`)
        }
        if (!Array.isArray(pr.tags)) {
          errors.push(`${prLabel}.tags: 配列が必要です`)
        } else {
          pr.tags.forEach((t, tIdx) => {
            if (typeof t !== 'string') {
              errors.push(`${prLabel}.tags[${tIdx}]: 文字列である必要があります`)
            }
          })
        }
        if (!Array.isArray(pr.moments)) {
          errors.push(`${prLabel}.moments: 配列が必要です`)
        } else {
          pr.moments.forEach((mo, moIdx) => {
            const moLabel = `${prLabel}.moments[${moIdx}]`
            if (!isPlainObject(mo)) {
              errors.push(`${moLabel}: オブジェクトである必要があります`)
              return
            }
            if (!isNonEmptyString(mo.id)) errors.push(`${moLabel}.id: 空でない文字列が必要です`)
            if (!isFiniteNonNegativeNumber(mo.timestampSec)) {
              errors.push(`${moLabel}.timestampSec: 0以上の数値が必要です`)
            }
            if (typeof mo.label !== 'string') errors.push(`${moLabel}.label: 文字列が必要です`)
          })
        }
      })
    }
  }

  scanUnsupportedValues(raw, 'root', errors)

  if (errors.length > 0) {
    return { ok: false, errors, warnings, cleaned: null }
  }

  return {
    ok: true,
    errors: [],
    warnings,
    cleaned: stripUndefined(raw),
  }
}

export function hasNonEmptyManualBox(box) {
  if (!isPlainObject(box)) return false
  return Object.values(box).some((entry) => {
    if (!isPlainObject(entry)) return false
    return BOX_SCORE_NUMERIC_KEYS.some((key) => typeof entry[key] === 'number' && entry[key] > 0)
  })
}

export function getEffectiveMatches(game) {
  if (Array.isArray(game?.matches) && game.matches.length > 0) {
    return game.matches
  }
  return [
    {
      id: game?.id ? `legacy_${game.id}` : 'legacy_0',
      label: game?.title || '1試合目',
      teamUnit: '',
      opponent: game?.opponent || '',
      homeScore: typeof game?.homeScore === 'number' ? game.homeScore : 0,
      awayScore: typeof game?.awayScore === 'number' ? game.awayScore : 0,
      videos: Array.isArray(game?.videos) ? game.videos : [],
      events: Array.isArray(game?.events) ? game.events : [],
      manualBoxScore: game?.manualBoxScore,
    },
  ]
}

export function matchHasRecordedStats(match) {
  const home = typeof match?.homeScore === 'number' ? match.homeScore : 0
  const away = typeof match?.awayScore === 'number' ? match.awayScore : 0
  const eventsCount = Array.isArray(match?.events) ? match.events.length : 0
  return home > 0 || away > 0 || eventsCount > 0 || hasNonEmptyManualBox(match?.manualBoxScore)
}

export function computePortalMetrics(data) {
  const games = Array.isArray(data?.games) ? data.games : []
  const players = Array.isArray(data?.players) ? data.players : []
  const practices = Array.isArray(data?.practices) ? data.practices : []
  const practiceTags = Array.isArray(data?.practiceTags) ? data.practiceTags : []
  const ownerEmails = Array.isArray(data?.ownerEmails) ? data.ownerEmails : []
  const allowedEmails = Array.isArray(data?.allowedEmails) ? data.allowedEmails : []

  let totalMatches = 0
  let matchesWithStats = 0
  let totalGameVideos = 0

  for (const game of games) {
    const matches = getEffectiveMatches(game)
    totalMatches += matches.length
    for (const match of matches) {
      if (matchHasRecordedStats(match)) {
        matchesWithStats += 1
      }
    }
    if (Array.isArray(game?.matches) && game.matches.length > 0) {
      for (const match of game.matches) {
        totalGameVideos += Array.isArray(match?.videos) ? match.videos.length : 0
      }
    } else {
      totalGameVideos += Array.isArray(game?.videos) ? game.videos.length : 0
    }
  }

  return {
    gameDays: games.length,
    totalMatches,
    matchesWithStats,
    totalGameVideos,
    players: players.length,
    practices: practices.length,
    practiceTags: practiceTags.length,
    ownerEmails: ownerEmails.length,
    allowedEmails: allowedEmails.length,
  }
}

export function checkPortalDataSafety(currentData, nextData, { force = false } = {}) {
  const nextMetrics = computePortalMetrics(nextData)
  if (!currentData) {
    return {
      ok: true,
      blocked: false,
      issues: [],
      currentMetrics: null,
      nextMetrics,
    }
  }

  const cur = computePortalMetrics(currentData)
  const issues = []

  if (cur.gameDays > 0 && nextMetrics.gameDays === 0) {
    issues.push(`試合日が全件消滅します (${cur.gameDays}件 → 0件)`)
  } else {
    if (cur.gameDays >= 2 && nextMetrics.gameDays <= Math.floor(cur.gameDays * 0.5)) {
      issues.push(`試合日数が半分以下に減少します (${cur.gameDays}件 → ${nextMetrics.gameDays}件)`)
    }
    if (cur.gameDays - nextMetrics.gameDays >= 5) {
      issues.push(`試合日数が5件以上減少します (${cur.gameDays}件 → ${nextMetrics.gameDays}件)`)
    }
  }

  if (cur.totalMatches > 0 && nextMetrics.totalMatches === 0) {
    issues.push(`各試合データが全件消滅します (${cur.totalMatches}試合 → 0試合)`)
  } else if (cur.totalMatches >= 4 && nextMetrics.totalMatches <= Math.floor(cur.totalMatches * 0.5)) {
    issues.push(`総試合数が半分以下に減少します (${cur.totalMatches}試合 → ${nextMetrics.totalMatches}試合)`)
  }

  if (cur.matchesWithStats > 0 && nextMetrics.matchesWithStats === 0) {
    issues.push(`記録済みスタッツ・スコアが全件消滅します (${cur.matchesWithStats}試合 → 0試合)`)
  } else if (
    cur.matchesWithStats >= 4 &&
    nextMetrics.matchesWithStats <= Math.floor(cur.matchesWithStats * 0.5)
  ) {
    issues.push(
      `記録済みスタッツ・スコア試合数が半分以下に減少します (${cur.matchesWithStats}試合 → ${nextMetrics.matchesWithStats}試合)`
    )
  }

  if (cur.totalGameVideos > 0 && nextMetrics.totalGameVideos === 0) {
    issues.push(`試合動画が全件消滅します (${cur.totalGameVideos}本 → 0本)`)
  } else if (
    cur.totalGameVideos >= 4 &&
    nextMetrics.totalGameVideos <= Math.floor(cur.totalGameVideos * 0.5)
  ) {
    issues.push(
      `試合動画数が半分以下に減少します (${cur.totalGameVideos}本 → ${nextMetrics.totalGameVideos}本)`
    )
  }

  if (cur.players > 0 && nextMetrics.players === 0) {
    issues.push(`選手名簿が全件消滅します (${cur.players}名 → 0名)`)
  } else if (cur.players >= 4 && nextMetrics.players <= Math.floor(cur.players * 0.5)) {
    issues.push(`選手数が半分以下に減少します (${cur.players}名 → ${nextMetrics.players}名)`)
  }

  if (cur.practices > 0 && nextMetrics.practices === 0) {
    issues.push(`練習動画が全件消滅します (${cur.practices}本 → 0本)`)
  } else if (cur.practices >= 4 && nextMetrics.practices <= Math.floor(cur.practices * 0.5)) {
    issues.push(`練習動画数が半分以下に減少します (${cur.practices}本 → ${nextMetrics.practices}本)`)
  }

  const currentOwners = Array.isArray(currentData.ownerEmails)
    ? currentData.ownerEmails.map(normalizeEmail).filter(Boolean)
    : []
  const nextOwnerSet = new Set(
    (Array.isArray(nextData.ownerEmails) ? nextData.ownerEmails : [])
      .map(normalizeEmail)
      .filter(Boolean)
  )
  if (currentOwners.length > 0 && !currentOwners.some((email) => nextOwnerSet.has(email))) {
    issues.push('既存のオーナーメールアドレスがすべて削除されるためロックアウトの危険があります')
  }

  return {
    ok: issues.length === 0 || force,
    blocked: issues.length > 0 && !force,
    issues,
    currentMetrics: cur,
    nextMetrics,
  }
}

export function formatBackupTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const ss = pad(date.getSeconds())
  return `${y}${m}${d}-${hh}${mm}${ss}`
}

export function saveBackupSnapshot(
  data,
  { backupDir, now = new Date(), fsImpl = fs } = {}
) {
  if (!backupDir) {
    throw new Error('バックアップ保存先ディレクトリが指定されていません。')
  }
  fsImpl.mkdirSync(backupDir, { recursive: true, mode: 0o700 })

  const stamp = formatBackupTimestamp(now)
  let candidate = path.join(backupDir, `portal-${stamp}.json`)
  let suffix = 2
  while (fsImpl.existsSync(candidate)) {
    candidate = path.join(backupDir, `portal-${stamp}-${suffix}.json`)
    suffix += 1
  }

  const payload = JSON.stringify(stripUndefined(data), null, 2) + '\n'
  fsImpl.writeFileSync(candidate, payload, { encoding: 'utf8', mode: 0o600 })
  return candidate
}

function compareJerseyNumber(a, b) {
  const numA = String(a?.number ?? '').trim()
  const numB = String(b?.number ?? '').trim()
  const intA = /^\d+$/.test(numA) ? Number(numA) : Number.POSITIVE_INFINITY
  const intB = /^\d+$/.test(numB) ? Number(numB) : Number.POSITIVE_INFINITY
  if (intA !== intB) return intA - intB
  if (numA !== numB) return numA.localeCompare(numB, 'ja')
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'ja')
}

export function formatPortalSummary(data) {
  const metrics = computePortalMetrics(data)
  const lines = [
    `=== Firestore ポータル概要 (${PORTAL_COLLECTION}/${PORTAL_DOC_ID}) ===`,
    `チーム名: ${data.teamName || '(未設定)'}`,
    `選手数: ${metrics.players}名 / 試合日数: ${metrics.gameDays}日 (全${metrics.totalMatches}試合・動画${metrics.totalGameVideos}本) / 練習動画数: ${metrics.practices}本`,
    '',
    '【試合日一覧】',
  ]

  const games = Array.isArray(data.games) ? [...data.games] : []
  games.sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')))

  if (games.length === 0) {
    lines.push('  (登録なし)')
  } else {
    for (const game of games) {
      const organizedBadge = game.isOrganized ? ' ✅整理済' : ''
      const categoryLabel = game.category ? `[${game.category}] ` : ''
      lines.push(
        `  - ${game.date || '日付未設定'} | ${categoryLabel}${game.title || '(無題)'}${organizedBadge}`
      )
      const matches = getEffectiveMatches(game)
      for (const match of matches) {
        const unitLabel = match.teamUnit && match.teamUnit !== '' ? `[${match.teamUnit}] ` : ''
        const opponent = (match.opponent || game.opponent || '').trim() || '対戦相手未設定'
        const home = typeof match.homeScore === 'number' ? match.homeScore : 0
        const away = typeof match.awayScore === 'number' ? match.awayScore : 0
        const hasStats = matchHasRecordedStats(match)
        let scoreText = 'スコアなし'
        if (home > 0 || away > 0) {
          scoreText = `スコアあり (${home}-${away})`
        } else if (hasStats) {
          scoreText = 'スタッツあり (0-0)'
        }
        const videoCount = Array.isArray(match.videos) ? match.videos.length : 0
        lines.push(
          `      • ${unitLabel}${match.label || '試合'} vs ${opponent} | ${scoreText} | 動画 ${videoCount}本`
        )
      }
    }
  }

  lines.push('', '【選手名簿】')
  const players = Array.isArray(data.players) ? [...data.players].sort(compareJerseyNumber) : []
  if (players.length === 0) {
    lines.push('  (登録なし)')
  } else {
    for (const p of players) {
      const numText = String(p.number ?? '').trim() || '-'
      const extras = [p.grade, p.position].filter((v) => typeof v === 'string' && v.trim()).join(' / ')
      lines.push(`  - #${numText} ${p.name}${extras ? ` (${extras})` : ''}`)
    }
  }

  return lines.join('\n')
}

export function buildChangeSummary(currentData, nextData) {
  const next = computePortalMetrics(nextData)
  if (!currentData) {
    return [
      '=== 変更サマリー (新規作成) ===',
      `チーム名: ${nextData.teamName}`,
      `選手数: ${next.players}名`,
      `試合日数: ${next.gameDays}日 (全${next.totalMatches}試合・スコア/スタッツ有 ${next.matchesWithStats}試合・動画 ${next.totalGameVideos}本)`,
      `練習動画数: ${next.practices}本`,
      `許可メール: オーナー ${next.ownerEmails}件 / メンバー ${next.allowedEmails}件`,
    ].join('\n')
  }

  const cur = computePortalMetrics(currentData)
  const formatDelta = (before, after, unit) => {
    const diff = after - before
    const sign = diff > 0 ? `+${diff}` : `${diff}`
    return `${before}${unit} → ${after}${unit} (${diff === 0 ? '変更なし' : sign + unit})`
  }

  const curGameMap = new Map(
    (Array.isArray(currentData.games) ? currentData.games : []).map((g) => [g.id, g])
  )
  const nextGameMap = new Map(
    (Array.isArray(nextData.games) ? nextData.games : []).map((g) => [g.id, g])
  )
  const addedGames = []
  const removedGames = []
  for (const [id, g] of nextGameMap) {
    if (!curGameMap.has(id)) addedGames.push(`${g.date || '?'} ${g.title || id}`)
  }
  for (const [id, g] of curGameMap) {
    if (!nextGameMap.has(id)) removedGames.push(`${g.date || '?'} ${g.title || id}`)
  }

  const curPlayerMap = new Map(
    (Array.isArray(currentData.players) ? currentData.players : []).map((p) => [p.id, p])
  )
  const nextPlayerMap = new Map(
    (Array.isArray(nextData.players) ? nextData.players : []).map((p) => [p.id, p])
  )
  const addedPlayers = []
  const removedPlayers = []
  for (const [id, p] of nextPlayerMap) {
    if (!curPlayerMap.has(id)) addedPlayers.push(`#${p.number} ${p.name}`)
  }
  for (const [id, p] of curPlayerMap) {
    if (!nextPlayerMap.has(id)) removedPlayers.push(`#${p.number} ${p.name}`)
  }

  const lines = [
    '=== 変更サマリー ===',
    `チーム名: ${currentData.teamName === nextData.teamName ? `${nextData.teamName} (変更なし)` : `${currentData.teamName} → ${nextData.teamName}`}`,
    `選手数: ${formatDelta(cur.players, next.players, '名')}`,
    `試合日数: ${formatDelta(cur.gameDays, next.gameDays, '日')}`,
    `総試合数: ${formatDelta(cur.totalMatches, next.totalMatches, '試合')}`,
    `スコア/スタッツ有: ${formatDelta(cur.matchesWithStats, next.matchesWithStats, '試合')}`,
    `試合動画数: ${formatDelta(cur.totalGameVideos, next.totalGameVideos, '本')}`,
    `練習動画数: ${formatDelta(cur.practices, next.practices, '本')}`,
    `練習タグ数: ${formatDelta(cur.practiceTags, next.practiceTags, '件')}`,
    `管理者PIN: ${currentData.adminPin === nextData.adminPin ? '変更なし' : '変更あり'}`,
    `許可メール: オーナー ${formatDelta(cur.ownerEmails, next.ownerEmails, '件')} / メンバー ${formatDelta(cur.allowedEmails, next.allowedEmails, '件')}`,
  ]

  if (addedGames.length > 0) {
    lines.push(`追加される試合日 (${addedGames.length}件): ${addedGames.slice(0, 5).join(', ')}${addedGames.length > 5 ? ' ...' : ''}`)
  }
  if (removedGames.length > 0) {
    lines.push(`削除される試合日 (${removedGames.length}件): ${removedGames.slice(0, 5).join(', ')}${removedGames.length > 5 ? ' ...' : ''}`)
  }
  if (addedPlayers.length > 0) {
    lines.push(`追加される選手 (${addedPlayers.length}名): ${addedPlayers.slice(0, 5).join(', ')}${addedPlayers.length > 5 ? ' ...' : ''}`)
  }
  if (removedPlayers.length > 0) {
    lines.push(`削除される選手 (${removedPlayers.length}名): ${removedPlayers.slice(0, 5).join(', ')}${removedPlayers.length > 5 ? ' ...' : ''}`)
  }

  return lines.join('\n')
}

async function openFirebaseAdminSession({ serviceAccount }) {
  const { cert, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  const appName = `portal-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const app = initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    },
    appName
  )
  const db = getFirestore(app)
  const docRef = db.collection(PORTAL_COLLECTION).doc(PORTAL_DOC_ID)
  return {
    docRef,
    projectId: serviceAccount.project_id,
    close: async () => {
      await app.delete()
    },
  }
}

function readJsonInputFile(filePath, cwd, fsImpl) {
  const resolved = path.resolve(cwd, filePath)
  if (!fsImpl.existsSync(resolved)) {
    throw new Error(`指定された JSON ファイルが見つかりません: ${resolved}`)
  }
  const text = fsImpl.readFileSync(resolved, 'utf8')
  try {
    return { resolvedPath: resolved, data: JSON.parse(text) }
  } catch (err) {
    throw new Error(
      `JSON ファイルの構文が正しくありません (${resolved}): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    )
  }
}

function parseSubcommandArgs(args, allowedFlags) {
  const flags = new Set()
  const positionals = []
  for (const token of args) {
    if (token.startsWith('--')) {
      const name = token.slice(2)
      if (!allowedFlags.has(name)) {
        throw new Error(`不明なオプションです: ${token}`)
      }
      flags.add(name)
    } else {
      positionals.push(token)
    }
  }
  return { flags, positionals }
}

export function getHelpText() {
  return [
    `使い方: node scripts/portal-db.mjs <command> [options]`,
    '',
    `対象 Firestore ドキュメント: ${PORTAL_COLLECTION}/${PORTAL_DOC_ID}`,
    `秘密鍵の参照先: FIREBASE_SERVICE_ACCOUNT_PATH または ${DEFAULT_KEY_REL_PATH}`,
    '',
    'コマンド:',
    '  check                              接続確認し、チーム名・選手数・試合日数・練習動画数を表示',
    `  backup                             現在の ${PORTAL_COLLECTION}/${PORTAL_DOC_ID} を ${DEFAULT_BACKUP_REL_DIR}/portal-YYYYMMDD-HHMMSS.json に保存`,
    '  summary                            登録済みの試合日（日付・タイトル・各試合の相手/スコア有無/動画数）と選手名簿を一覧表示',
    '  apply <jsonFile> [--dry-run] [--force]',
    '                                     PortalData 検証・安全チェック後に反映（--dry-run で事前確認のみ、本番反映時は先に自動 backup）',
    '  restore <backupJsonFile>           復元前に現在状態のバックアップを1枚保存してから指定バックアップで復元',
  ].join('\n')
}

export async function runPortalDbCli(argv, deps = {}) {
  const cwd = deps.cwd ?? process.cwd()
  const repoRoot = deps.repoRoot ?? resolveRepoRoot(cwd)
  const env = deps.env ?? process.env
  const fsImpl = deps.fsImpl ?? fs
  const now = deps.now ?? (() => new Date())
  const stdout = deps.stdout ?? ((msg) => console.log(msg))
  const stderr = deps.stderr ?? ((msg) => console.error(msg))
  const openSession = deps.openSession ?? openFirebaseAdminSession
  const backupDir = path.resolve(repoRoot, DEFAULT_BACKUP_REL_DIR)

  const command = argv[0]
  const rest = argv.slice(1)

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    stdout(getHelpText())
    return 0
  }

  const withFirestoreSession = async (fn) => {
    const { keyPath, serviceAccount } = loadServiceAccountKey({
      envPath: env?.FIREBASE_SERVICE_ACCOUNT_PATH,
      cwd,
      repoRoot,
      fsImpl,
    })
    const session = await openSession({ keyPath, serviceAccount })
    try {
      return await fn(session)
    } finally {
      if (typeof session?.close === 'function') {
        await session.close()
      }
    }
  }

  try {
    switch (command) {
      case 'check': {
        const { positionals } = parseSubcommandArgs(rest, new Set())
        if (positionals.length > 0) {
          throw new Error(`不要な引数があります: ${positionals.join(' ')}`)
        }
        return await withFirestoreSession(async ({ docRef, projectId }) => {
          const snap = await docRef.get()
          if (!snap.exists) {
            stderr(`❌ ドキュメント ${PORTAL_COLLECTION}/${PORTAL_DOC_ID} が見つかりませんでした（プロジェクト: ${projectId || '不明'}）。`)
            return 1
          }
          const data = snap.data()
          const metrics = computePortalMetrics(data)
          stdout(`✅ Firestore 接続確認 OK (プロジェクト: ${projectId || '不明'} / ドキュメント: ${PORTAL_COLLECTION}/${PORTAL_DOC_ID})`)
          stdout(`- チーム名: ${data?.teamName || '(未設定)'}`)
          stdout(`- 選手数: ${metrics.players}名`)
          stdout(`- 試合日数: ${metrics.gameDays}日 (全${metrics.totalMatches}試合・動画${metrics.totalGameVideos}本)`)
          stdout(`- 練習動画数: ${metrics.practices}本`)
          return 0
        })
      }

      case 'backup': {
        const { positionals } = parseSubcommandArgs(rest, new Set())
        if (positionals.length > 0) {
          throw new Error(`不要な引数があります: ${positionals.join(' ')}`)
        }
        return await withFirestoreSession(async ({ docRef }) => {
          const snap = await docRef.get()
          if (!snap.exists) {
            stderr(`❌ ドキュメント ${PORTAL_COLLECTION}/${PORTAL_DOC_ID} が存在しないためバックアップできません。`)
            return 1
          }
          const data = snap.data()
          const savedPath = saveBackupSnapshot(data, { backupDir, now: now(), fsImpl })
          const metrics = computePortalMetrics(data)
          stdout(`✅ バックアップを保存しました: ${savedPath}`)
          stdout(`- 内容: チーム「${data?.teamName || '(未設定)'}」 / 選手 ${metrics.players}名 / 試合日 ${metrics.gameDays}日 / 練習動画 ${metrics.practices}本`)
          return 0
        })
      }

      case 'summary': {
        const { positionals } = parseSubcommandArgs(rest, new Set())
        if (positionals.length > 0) {
          throw new Error(`不要な引数があります: ${positionals.join(' ')}`)
        }
        return await withFirestoreSession(async ({ docRef }) => {
          const snap = await docRef.get()
          if (!snap.exists) {
            stderr(`❌ ドキュメント ${PORTAL_COLLECTION}/${PORTAL_DOC_ID} が見つかりませんでした。`)
            return 1
          }
          stdout(formatPortalSummary(snap.data()))
          return 0
        })
      }

      case 'apply': {
        const { flags, positionals } = parseSubcommandArgs(rest, new Set(['dry-run', 'force']))
        if (positionals.length !== 1) {
          throw new Error('使い方: node scripts/portal-db.mjs apply <jsonFile> [--dry-run] [--force]')
        }
        const dryRun = flags.has('dry-run')
        const force = flags.has('force')
        const { resolvedPath, data: inputData } = readJsonInputFile(positionals[0], cwd, fsImpl)
        const validation = validatePortalData(inputData)
        if (!validation.ok) {
          stderr(`❌ 入力データ (${resolvedPath}) の検証でエラーが見つかりました:`)
          for (const errMsg of validation.errors) {
            stderr(`  - ${errMsg}`)
          }
          return 1
        }
        for (const warnMsg of validation.warnings) {
          stdout(`⚠️ 注意: ${warnMsg}`)
        }

        return await withFirestoreSession(async ({ docRef }) => {
          const snap = await docRef.get()
          const currentData = snap.exists ? snap.data() : null
          const safety = checkPortalDataSafety(currentData, validation.cleaned, { force })
          stdout(buildChangeSummary(currentData, validation.cleaned))

          if (safety.issues.length > 0) {
            if (safety.blocked) {
              stderr('')
              stderr('❌ 安全チェックにより書き込みをブロックしました（--force 未指定）:')
              for (const issue of safety.issues) {
                stderr(`  - ${issue}`)
              }
              stderr('意図的な大幅削減・削除である場合のみ --force を付けて再実行してください。')
              return 1
            }
            stdout('')
            stdout('⚠️ 安全チェックの警告がありますが --force 指定のため続行します:')
            for (const issue of safety.issues) {
              stdout(`  - ${issue}`)
            }
          }

          if (dryRun) {
            stdout('')
            stdout('🔍 --dry-run 指定のため、バックアップ作成および Firestore への書き込みは行いませんでした。')
            return 0
          }

          let backupPath = null
          if (currentData !== null) {
            backupPath = saveBackupSnapshot(currentData, { backupDir, now: now(), fsImpl })
            stdout(`💾 更新前バックアップを保存しました: ${backupPath}`)
          }
          await docRef.set(validation.cleaned)
          stdout(`✅ ${PORTAL_COLLECTION}/${PORTAL_DOC_ID} へ反映しました (${resolvedPath})。`)
          return 0
        })
      }

      case 'restore': {
        const { positionals } = parseSubcommandArgs(rest, new Set())
        if (positionals.length !== 1) {
          throw new Error('使い方: node scripts/portal-db.mjs restore <backupJsonFile>')
        }
        const { resolvedPath, data: backupInput } = readJsonInputFile(positionals[0], cwd, fsImpl)
        const validation = validatePortalData(backupInput)
        if (!validation.ok) {
          stderr(`❌ バックアップファイル (${resolvedPath}) の検証でエラーが見つかりました:`)
          for (const errMsg of validation.errors) {
            stderr(`  - ${errMsg}`)
          }
          return 1
        }

        return await withFirestoreSession(async ({ docRef }) => {
          const snap = await docRef.get()
          const currentData = snap.exists ? snap.data() : null
          if (currentData !== null) {
            const preRestoreBackup = saveBackupSnapshot(currentData, {
              backupDir,
              now: now(),
              fsImpl,
            })
            stdout(`💾 復元前の現在状態をバックアップしました: ${preRestoreBackup}`)
          }
          stdout(buildChangeSummary(currentData, validation.cleaned))
          await docRef.set(validation.cleaned)
          stdout(`✅ ${resolvedPath} の内容で ${PORTAL_COLLECTION}/${PORTAL_DOC_ID} を復元しました。`)
          return 0
        })
      }

      default:
        throw new Error(`不明なコマンドです: ${command}\n\n${getHelpText()}`)
    }
  } catch (err) {
    stderr(`エラー: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

const isDirectRun = (() => {
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
  } catch {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  }
})()

if (isDirectRun) {
  const exitCode = await runPortalDbCli(process.argv.slice(2))
  if (exitCode !== 0) {
    process.exitCode = exitCode
  }
}
