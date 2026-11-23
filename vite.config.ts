import { Buffer } from 'node:buffer'
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { handleParseStatsPayload } from './api/parse-stats'
import { handleOrganizeMatchesPayload } from './api/organize-matches'

async function readRequestJsonBody(
  req: AsyncIterable<unknown>,
  maxBytes: number
): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array | string)
    totalBytes += buf.length
    if (totalBytes > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    chunks.push(buf)
  }
  const rawText = Buffer.concat(chunks).toString('utf8')
  return rawText ? (JSON.parse(rawText) as unknown) : null
}

function mountPostJsonApi(
  server: ViteDevServer,
  route: string,
  maxBytes: number,
  tooLargeMessage: string,
  handler: (input: {
    body: unknown
    authHeader: string | null
  }) => Promise<{ status: number; data: Record<string, unknown> }>
): void {
  server.middlewares.use(route, (req, res, next) => {
    if (req.method !== 'POST') {
      next()
      return
    }

    void (async () => {
      try {
        const body = await readRequestJsonBody(req, maxBytes)
        const result = await handler({
          body,
          authHeader:
            typeof req.headers.authorization === 'string'
              ? req.headers.authorization
              : null,
        })

        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result.data))
      } catch (err: unknown) {
        const isTooLarge =
          err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE'
        res.statusCode = isTooLarge ? 413 : 500
        res.setHeader('Content-Type', 'application/json')
        res.end(
          JSON.stringify({
            error: isTooLarge
              ? tooLargeMessage
              : 'ローカル解析サーバーでエラーが発生しました。',
          })
        )
      }
    })()
  })
}

function portalApiDevPlugin(env: Record<string, string>): Plugin {
  const apiEnv = {
    geminiApiKey: env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    firebaseApiKey:
      env.VITE_FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '',
  }

  return {
    name: 'portal-api-dev',
    configureServer(server) {
      mountPostJsonApi(
        server,
        '/api/parse-stats',
        12 * 1024 * 1024,
        '画像サイズが大きすぎます。別のスクショでお試しください。',
        (input) => handleParseStatsPayload({ ...input, env: apiEnv })
      )

      mountPostJsonApi(
        server,
        '/api/organize-matches',
        2 * 1024 * 1024,
        '送信データサイズが大きすぎます。動画数を分けてお試しください。',
        (input) => handleOrganizeMatchesPayload({ ...input, env: apiEnv })
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), portalApiDevPlugin(env)],
  }
})
