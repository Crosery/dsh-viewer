/**
 * Assert the committed `lib/` is exactly what `src/` builds.
 *
 * The dist is committed on purpose — the official install command is the git
 * channel, and pnpm refuses to run a git-hosted package's build scripts unless
 * the user pre-approves them in their profile. Shipping the built halves inside
 * the repository is what makes that install work with no approval, and this
 * check is the price of doing it: a committed artifact that silently disagrees
 * with its source is worse than no artifact at all.
 *
 * The build is byte-deterministic (esbuild and tsc both are, for one input set),
 * so a recursive comparison is the honest check. Building into a scratch
 * directory rather than in place means a stale tree is reported, not rewritten.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'dsh-viewer-dist-'))

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)
      if (statSync(path).isDirectory()) walk(path)
      else found.push(relative(dir, path))
    }
  }
  walk(dir)
  return found.sort()
}

try {
  execFileSync(process.execPath, ['scripts/build.mjs', '--outdir', scratch], { cwd: root, stdio: 'inherit' })

  const committed = join(root, 'lib')
  assert.ok(existsSync(committed), 'lib/ is not committed — the git install path depends on it')

  const expected = filesUnder(scratch)
  const actual = filesUnder(committed)
  const missing = expected.filter((path) => !actual.includes(path))
  const extra = actual.filter((path) => !expected.includes(path))
  assert.deepEqual(missing, [], `committed lib/ is missing: ${missing.join(', ')}`)
  assert.deepEqual(extra, [], `committed lib/ has files a build does not produce: ${extra.join(', ')}`)

  const stale = expected.filter((path) => !readFileSync(join(scratch, path)).equals(readFileSync(join(committed, path))))
  assert.deepEqual(stale, [], `committed lib/ differs from a fresh build: ${stale.join(', ')} — run \`npm run build\` and commit the result`)

  console.log(`Distribution OK: ${expected.length} committed files match a fresh build`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
