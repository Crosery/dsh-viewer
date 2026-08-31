/**
 * Signed asset references: how a card names a file to the asset route without
 * the route ever trusting a path the browser supplied.
 *
 * The design constraint is that a card must survive a harness restart. A card
 * rebuilt from a replayed session log holds only the URL that was minted months
 * ago, so an in-process token table would leave every reopened video dead. The
 * reference is therefore self-contained — the path travels in the URL and a
 * keyed MAC travels beside it — and the route accepts a path only when the MAC
 * proves this harness minted it.
 *
 * The MAC key is the whole security boundary: without it the route would be an
 * arbitrary-file-read endpoint on a port the user's browser can reach. It is
 * generated once per harness home, stored 0600, and never leaves the Host.
 * @module @crosery/dsh-viewer/asset-token
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ASSET_ROUTE } from './contract.ts'

/** Query parameter carrying the base64url-encoded absolute path. */
export const PATH_PARAM = 'p'

/** Query parameter carrying the hex MAC over that path. */
export const SIGNATURE_PARAM = 's'

/**
 * MAC length in hex characters. 128 bits is far past any online forgery budget
 * against a loopback HTTP server, and keeps the URL short enough to read in
 * devtools.
 */
const SIGNATURE_HEX_LENGTH = 32

/** Bytes of key material generated on first use. */
const SECRET_BYTES = 32

/**
 * Load the harness-local MAC key, generating it on first use.
 *
 * Written with the exclusive flag so two harness processes racing on a fresh
 * home cannot end up with different keys — the loser reads the winner's file
 * instead of overwriting it, which would have invalidated every URL the winner
 * had already minted.
 * @param keyPath - absolute path of the key file inside the harness home.
 * @returns the raw key bytes.
 */
export async function loadAssetSecret(keyPath: string): Promise<Buffer> {
  const existing = await readIfPresent(keyPath)
  if (existing !== undefined && existing.length >= SECRET_BYTES) return existing

  const created = randomBytes(SECRET_BYTES)
  await mkdir(dirname(keyPath), { recursive: true })
  if (existing === undefined) {
    try {
      await writeFile(keyPath, created, { mode: 0o600, flag: 'wx' })
      return created
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // Another process won the race; its key is the authoritative one.
      const raced = await readIfPresent(keyPath)
      if (raced !== undefined && raced.length >= SECRET_BYTES) return raced
    }
  }
  // The file is present but too short to be key material. Every URL minted
  // under it was already unusable, so replacing it loses nothing and is the
  // only way out of the state.
  await writeFile(keyPath, created, { mode: 0o600 })
  return created
}

/** Read a file, treating absence as a value rather than an error. */
async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Base64url without padding — the URL-safe alphabet, so a path with `/` or `+`
 * bytes survives a query string untouched.
 */
function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

/**
 * Decode a base64url path parameter.
 * @param encoded - the parameter value.
 * @returns the decoded path, or `undefined` when the value is not a faithful
 *   encoding of it (a re-encode mismatch rejects mutated or padded input).
 */
function fromBase64Url(encoded: string): string | undefined {
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8')
  return toBase64Url(decoded) === encoded ? decoded : undefined
}

/** Compute the MAC over one absolute path. */
function sign(secret: Buffer, path: string): string {
  return createHmac('sha256', secret).update(path, 'utf8').digest('hex').slice(0, SIGNATURE_HEX_LENGTH)
}

/**
 * Mint the same-origin URL a card loads for one file.
 * @param secret - the harness MAC key.
 * @param processPath - the canonical absolute path in the backend's execution
 *   world, as `ctx.fs.processPath` reports it.
 * @returns the signed, root-relative asset URL.
 */
export function assetUrlFor(secret: Buffer, processPath: string): string {
  const params = new URLSearchParams({
    [PATH_PARAM]: toBase64Url(processPath),
    [SIGNATURE_PARAM]: sign(secret, processPath),
  })
  return `${ASSET_ROUTE}?${params.toString()}`
}

/**
 * Recover the path one asset request names, after proving this harness minted
 * the reference.
 *
 * Comparison is constant-time over equal-length buffers; a length mismatch is
 * rejected before the compare, because `timingSafeEqual` throws on unequal
 * lengths and a length difference leaks nothing an attacker did not already
 * choose.
 * @param secret - the harness MAC key.
 * @param search - the request URL's query string, leading `?` optional.
 * @returns the verified absolute path, or `undefined` for a missing, malformed,
 *   or unsigned reference.
 */
export function verifyAssetRequest(secret: Buffer, search: string): string | undefined {
  const params = new URLSearchParams(search)
  const encoded = params.get(PATH_PARAM)
  const signature = params.get(SIGNATURE_PARAM)
  if (encoded === null || signature === null) return undefined
  if (signature.length !== SIGNATURE_HEX_LENGTH) return undefined
  const path = fromBase64Url(encoded)
  if (path === undefined || path.length === 0) return undefined
  const expected = Buffer.from(sign(secret, path), 'utf8')
  const supplied = Buffer.from(signature, 'utf8')
  if (expected.length !== supplied.length) return undefined
  return timingSafeEqual(expected, supplied) ? path : undefined
}
