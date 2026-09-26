/**
 * The compatibility note a release starts with: the exact harness versions the
 * gate smoked, read from the `harness-*` artifacts its cells uploaded.
 *
 *   node scripts/release-notes.mjs <dir of downloaded harness artifacts> --sha256 <hex of the asset>
 *
 * Each `harness-<cell>` directory holds that cell's `smoke.jsonl`.
 *
 * The note says the release's own tarball was smoked, so it checks that: every
 * smoke row must carry the asset's sha256 and have passed. A row that smoked
 * other bytes — a tarball packed separately, say — or no rows at all fail
 * the release instead of printing a claim nobody verified.
 *
 * Prints Markdown on stdout; exit 1 with the reason on stderr otherwise.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { sha256: { type: 'string' } } })
const [dir] = positionals
const sha256 = values.sha256 ?? ''

try {
  if (dir === undefined || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('usage: release-notes.mjs <dir> --sha256 <64 hex digits>')
  const rows = (existsSync(dir) ? readdirSync(dir) : []).sort().flatMap((cell) => {
    const file = join(dir, cell, 'smoke.jsonl')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => [cell.replace(/^harness-/, ''), JSON.parse(line)])
  })
  if (rows.length === 0) throw new Error(`no smoke results under ${dir}: the gate recorded nothing to put in the notes`)
  const foreign = rows.filter(([, r]) => r.tarballSha256 !== sha256).map(([cell, r]) => `${cell} (${r.tarballSha256 ?? 'no digest'})`)
  if (foreign.length > 0) throw new Error(`these cells smoked a different tarball than the one being released (${sha256}): ${foreign.join(', ')}`)
  const failed = rows.filter(([, r]) => r.outcome !== 'passed' || r.strict !== true).map(([cell]) => cell)
  if (failed.length > 0) throw new Error(`these cells did not pass a strict smoke: ${failed.join(', ')}`)

  console.log('### Verified harness versions\n')
  console.log(`Boot smoke of this release's tarball, \`dsh-viewer.tgz\` (sha256 \`${sha256}\`): installed with \`dsh plugin add\` (no exemption), activated and served.\n`)
  console.log('| cell | dsh | smoke |\n| --- | --- | --- |')
  for (const [cell, r] of rows) console.log(`| ${cell} | ${r.dsh ?? '?'} | ${r.outcome} |`)
  console.log('\nEvery published harness version the gate swept either passed typecheck, tests and peer admission or is published incomplete upstream; the gate run lists each one.')
} catch (error) {
  console.error(`::error::${String(error?.message ?? error)}`)
  process.exit(1)
}
