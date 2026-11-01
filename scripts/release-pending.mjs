/**
 * Read-only npm release retry decision, independent of upstream ledger changes.
 *
 * Run after the verified follow commit has reached HEAD:
 *   node scripts/release-pending.mjs
 *
 * No npm login, token lookup, tag creation or publishing occurs here. A missing
 * package (404) is pending; registry failures never mean "not published".
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

/** Interpret an unauthenticated registry response without doing any I/O. */
export function registryVersions({ status, body }) {
  if (status === 404) return []
  if (status !== 200) throw new Error(`npm registry returned HTTP ${status}; release state is unknown`)
  let packument
  try {
    packument = JSON.parse(body)
  } catch {
    throw new Error('npm registry returned invalid JSON; release state is unknown')
  }
  if (packument === null || typeof packument !== 'object' || Array.isArray(packument)
      || packument.versions === null || typeof packument.versions !== 'object' || Array.isArray(packument.versions)) {
    throw new Error('npm registry returned no versions map; release state is unknown')
  }
  const versions = Object.keys(packument.versions)
  if (versions.some((version) => !semver.valid(version))) {
    throw new Error('npm registry returned an invalid version; release state is unknown')
  }
  return versions
}

/** Exact version presence, then immutable tag identity; no dist-tag assumptions. */
export function pendingRelease({ manifest, published, head, tagCommit }) {
  if (typeof manifest?.name !== 'string' || !manifest.name || !semver.valid(manifest.version)) {
    throw new Error('package.json must contain a package name and a valid version')
  }
  const { name, version } = manifest
  if (published.includes(version)) return { pending: false, name, version, tag: '', createTag: false }
  const tag = `v${version}`
  if (!head) throw new Error('cannot determine HEAD for the pending release')
  if (tagCommit !== undefined && tagCommit !== head) {
    throw new Error(`${tag} points at another commit; refusing to release HEAD or move the existing tag`)
  }
  return { pending: true, name, version, tag, createTag: tagCommit === undefined }
}

/** Public registry only, with no npm configuration or credentials consulted. */
export async function readPublished(name, fetchRegistry = fetch) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`
  const response = await fetchRegistry(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  return registryVersions({ status: response.status, body: response.status === 200 ? await response.text() : '' })
}

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 })
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  // Validate before using the version in a Git ref or querying the registry.
  pendingRelease({ manifest, published: [manifest.version] })
  const published = await readPublished(manifest.name)
  let head
  let tagCommit
  if (!published.includes(manifest.version)) {
    const current = git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (current.status !== 0) throw new Error('git could not resolve HEAD')
    head = current.stdout.trim()
    const ref = `refs/tags/v${manifest.version}`
    const exists = git(root, ['show-ref', '--verify', '--quiet', ref])
    if (exists.status === 0) {
      // Peel annotated tags as well as lightweight tags.
      const tagged = git(root, ['rev-parse', '--verify', `${ref}^{commit}`])
      if (tagged.status !== 0) throw new Error(`${ref} does not resolve to a commit`)
      tagCommit = tagged.stdout.trim()
    } else if (exists.status !== 1) {
      throw new Error(`git could not check ${ref}`)
    }
  }
  const decision = pendingRelease({ manifest, published, head, tagCommit })
  const outputs = {
    pending: String(decision.pending),
    version: decision.version,
    tag: decision.tag,
    create_tag: String(decision.createTag),
  }
  const text = Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
  console.log(decision.pending
    ? `${manifest.name}@${manifest.version} is not published; ${decision.createTag ? 'create' : 'reuse'} ${decision.tag} at HEAD.`
    : `${manifest.name}@${manifest.version} is already published; no release is pending.`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text)
  else process.stdout.write(text)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
