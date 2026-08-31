/**
 * The asset route: bytes for one signed reference, with range support.
 *
 * Range handling is not an optimization here — it is what makes `<video>` and
 * `<audio>` seekable at all. Chrome and Safari will not expose a scrub bar for
 * a response that does not advertise `accept-ranges`, and Safari refuses to
 * start playback of a media response that answers a range request with 200.
 *
 * Bytes are streamed from the process path rather than pulled through
 * `ctx.fs.readBytes`, which materializes a whole file in memory: a two-hour
 * video is exactly the case this plugin exists for. The tradeoff is that the
 * route is only available on a backend that exposes a local path — `index.ts`
 * degrades that case to the attachment path for admissible rasters, and to an
 * unavailable card otherwise.
 * @module @crosery/dsh-viewer/asset-route
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { basename } from 'node:path'
import { classifyPath, type ViewerKind } from './contract.ts'
import { verifyAssetRequest } from './asset-token.ts'

/** One parsed, satisfiable byte range. */
interface ByteRange {
  start: number
  end: number
}

/**
 * Parse a single-range `Range` header against a known size.
 *
 * Only the single-range form is honored. A multipart range response is a
 * different content type with its own framing, and no browser media element
 * needs one; answering the whole entity is the specified fallback.
 * @param header - the raw header value, or undefined.
 * @param size - the entity's total byte length.
 * @returns the resolved range, `undefined` for no usable range, or `'invalid'`
 *   when the client named a range that cannot be satisfied.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | undefined | 'invalid' {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (size === 0) return 'invalid'

  if (rawStart === '') {
    // Suffix form: the last N bytes. N larger than the entity is the whole one.
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'invalid'
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return 'invalid'
  return { start, end }
}

/**
 * Response headers that keep an inline-served asset from becoming an XSS
 * vector.
 *
 * The route answers on the app's own origin, so a user who opens an asset URL
 * in a tab navigates to it as a document. For `text/html` and `image/svg+xml`
 * that document would otherwise run its own script with the app's origin. The
 * CSP header removes that: `sandbox` puts a navigated HTML asset in an opaque
 * origin, and `default-src 'none'` leaves an SVG document with no script at
 * all. Both are inert when the asset is loaded as a subresource, which is the
 * normal path.
 * @param kind - the classified viewer kind.
 * @returns extra headers for this kind, possibly empty.
 */
export function guardHeaders(kind: ViewerKind): Record<string, string> {
  if (kind === 'html') return { 'content-security-policy': 'sandbox allow-scripts allow-forms' }
  if (kind === 'image') return { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" }
  return {}
}

/**
 * Build the asset route's handler.
 * @param secret - a thunk returning the harness MAC key, or `undefined` while
 *   key material is still loading (the route answers 503 until it resolves).
 * @returns the `webServer` route handler.
 */
export function assetHandler(secret: () => Buffer | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end()
      return
    }
    const key = secret()
    if (key === undefined) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('viewer key not ready')
      return
    }
    const search = (req.url ?? '').slice((req.url ?? '').indexOf('?') + 1)
    const path = verifyAssetRequest(key, search)
    if (path === undefined) {
      // One code for "not signed by us" and "signed but nonsense": a probe must
      // not learn whether a path exists from the status alone.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }

    let size: number
    try {
      const info = await stat(path)
      if (!info.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
        return
      }
      size = info.size
    } catch {
      // The file was displayed once and is gone now: an ordinary outcome for a
      // reopened session, not an error worth logging.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }

    const spec = classifyPath(path)
    const range = parseRange(req.headers.range, size)
    if (range === 'invalid') {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
      return
    }

    const headers: Record<string, string> = {
      'content-type': spec.mediaType,
      'accept-ranges': 'bytes',
      // The reference is signed over a path, not over content: the file behind
      // it may be rewritten at any time, so a cached copy could be stale.
      'cache-control': 'no-store',
      // Without this a browser may sniff an octet-stream into something
      // executable; with it, the declared type is the only type.
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
      ...guardHeaders(spec.kind),
    }

    if (range === undefined) {
      res.writeHead(200, { ...headers, 'content-length': String(size) })
    } else {
      res.writeHead(206, {
        ...headers,
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
      })
    }
    if (req.method === 'HEAD' || size === 0) {
      res.end()
      return
    }

    const stream = createReadStream(path, range === undefined ? {} : { start: range.start, end: range.end })
    try {
      await pipeline(stream, res)
    } catch {
      // A player that seeks mid-download destroys the response; the headers are
      // long gone, so the only thing left to do is release the socket.
      if (!res.writableEnded) res.destroy()
    }
  }
}
