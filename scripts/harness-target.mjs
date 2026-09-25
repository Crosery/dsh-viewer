/**
 * Resolve one harness cell to an exact dsh version, and put this checkout on
 * it.
 *
 *   node scripts/harness-target.mjs <cell> [--repoint] [--install] [--admits]
 *   node scripts/harness-target.mjs --plan <cell,cell,…> [--smoke heads|all|none]
 *   node scripts/harness-target.mjs --feed <mac-arm64|win-x64>
 *
 * Cells:
 *   pinned              what devDependencies pin — the pull-request baseline
 *   floor               0.1.1-rc.2, the oldest train with live evidence
 *   desktop             what the official desktop app's update feed ships today
 *   latest|next|alpha   an npm dist-tag of @deepseek-ai/dsh
 *   <exact version>     one published @deepseek-ai/dsh version (sweep rows)
 *   sweep               (--plan only) every published version the peer ranges
 *                       start admitting at, read from npm at run time
 *
 * `desktop` reads both platform feeds the app has (mac-arm64, win-x64; the app
 * hard-codes the `nightly` channel and no other feed exists), refuses a
 * disagreement, then requires `@deepseek-ai/dsh` at that exact version on npm:
 * that package is the Web app the desktop boots, so its version is the Web
 * version that matches the desktop.
 *
 * --repoint  rewrites every `@deepseek-ai/dsh-*` devDependency to the exact
 *            version (cordis and schemastery to what that train ships) and
 *            writes the exact versions to the step summary.
 * --install  installs the result from scratch (`npm ci` for `pinned`), through
 *            the train's own `@deepseek-ai/dsh` graph if its peers do not
 *            resolve on their own — see `installTrain`.
 * --admits   applies the rule dsh ≥0.1.7 applies before installing or loading
 *            a plugin (every `@deepseek-ai/dsh*` peer, prerelease-inclusive)
 *            and node-semver's default rule; both must admit the version.
 * --plan     prints the matrix (`matrix=` in $GITHUB_OUTPUT) for a cell list.
 * --feed     prints version / path / sha512 / size of one desktop feed.
 *
 * Writes its answers to $GITHUB_OUTPUT when set.
 * Exit 0 ok, 1 hard failure, 3 the train is not (yet) published in full:
 * incomplete, which CI reports as neutral — neither drift nor green.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import semver from 'semver'
import {
  DESKTOP_FEEDS, DIST_TAGS, FLOOR, HARNESS,
  describeRefusals, harnessPeers, installTrain, parseFeed, planCells, refusals, repointManifest, run, sweepStart, tail, versionsOf, view,
} from './harness-lib.mjs'

const INCOMPLETE = 3
const root = fileURLToPath(new URL('..', import.meta.url))
const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repoint: { type: 'boolean', default: false },
    install: { type: 'boolean', default: false },
    admits: { type: 'boolean', default: false },
    plan: { type: 'string' },
    smoke: { type: 'string', default: 'heads' },
    feed: { type: 'string' },
  },
})

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const peers = harnessPeers(pkg)

function out(key, value) {
  console.log(`${key}=${value}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
}
class Incomplete extends Error {}

async function feed(platform) {
  const url = DESKTOP_FEEDS[platform]
  if (url === undefined) throw new Error(`no desktop feed for ${JSON.stringify(platform)}; known: ${Object.keys(DESKTOP_FEEDS).join(', ')}`)
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`desktop feed ${url} answered ${res.status}`)
  const parsed = parseFeed(await res.text())
  if (!semver.valid(parsed.version)) throw new Error(`desktop feed ${url} carries no valid version`)
  // These values reach a shell and a download in CI; accept only what the feed is supposed to hold.
  if (!/^https:\/\/download\.deepseek\.com\/[\w./-]+$/.test(parsed.path ?? '')) throw new Error(`desktop feed ${url} names an unexpected download: ${parsed.path}`)
  if (!/^[A-Za-z0-9+/]{86}==$/.test(parsed.sha512 ?? '')) throw new Error(`desktop feed ${url} carries no sha512 digest`)
  return { platform, url, ...parsed }
}

async function desktopVersion() {
  const seen = await Promise.all(Object.keys(DESKTOP_FEEDS).map(feed))
  if (new Set(seen.map((s) => s.version)).size !== 1) {
    throw new Error(`desktop platforms disagree: ${seen.map((s) => `${s.platform} → ${s.version}`).join('; ')}`)
  }
  summary(`- desktop feeds: ${seen.map((s) => `${s.platform} ${s.version} (released ${s.releaseDate})`).join(', ')}`)
  return seen[0].version
}

/** The one exact version every harness devDependency pins. */
function pinnedVersion() {
  const pins = [...new Set(Object.entries(pkg.devDependencies).filter(([n]) => n.startsWith('@deepseek-ai/dsh-')).map(([, v]) => v))]
  if (pins.length !== 1 || !semver.valid(pins[0])) throw new Error(`harness devDependencies must pin one exact version; found ${pins.join(', ')}`)
  return pins[0]
}

async function resolveCell(cell) {
  if (cell === 'pinned') return { version: pinnedVersion(), source: 'package.json devDependencies' }
  if (cell === 'floor') return { version: FLOOR, source: 'documented floor' }
  if (cell === 'desktop') return { version: await desktopVersion(), source: 'desktop update feeds (nightly, mac-arm64 + win-x64)' }
  if (DIST_TAGS.includes(cell)) {
    const version = view(`${HARNESS}@${cell}`, 'version')
    if (!semver.valid(version)) throw new Error(`npm dist-tag ${cell} of ${HARNESS} resolves to nothing`)
    return { version, source: `npm dist-tag ${cell}` }
  }
  if (semver.valid(cell)) return { version: cell, source: 'exact version' }
  throw new Error(`unknown cell ${JSON.stringify(cell)}`)
}

async function plan(list) {
  const cells = list.split(',').map((s) => s.trim()).filter(Boolean)
  const resolved = {}
  const named = cells.filter((c) => c !== 'sweep' && !semver.valid(c))
  if (cells.includes('sweep')) {
    // Only to recognise which sweep rows a named cell already covers and which
    // deserve a boot smoke; a cell that fails to resolve here fails in its own row.
    for (const cell of new Set([...named, 'desktop', ...DIST_TAGS])) {
      try { resolved[cell] = (await resolveCell(cell)).version } catch {}
    }
  }
  const rows = planCells(cells, {
    published: cells.includes('sweep') ? versionsOf(HARNESS) : [],
    sweepFrom: sweepStart(peers),
    pinned: pinnedVersion(),
    resolved,
  }, flags.smoke)
  if (cells.includes('sweep') && !rows.some((r) => semver.valid(r.cell))) {
    // An empty sweep means npm answered nothing, not that nothing is published.
    throw new Error(`the sweep found no published ${HARNESS} version at or above ${sweepStart(peers)}`)
  }
  out('matrix', JSON.stringify({ include: rows }))
  summary(`### Harness plan\n\n${rows.length} cells: ${rows.map((r) => `\`${r.cell}\`${r.smoke ? '' : ' (no smoke)'}`).join(', ')}`)
}

async function target(cell) {
  const { version, source } = await resolveCell(cell)
  out('version', version)
  out('source', source)
  summary(`### harness@${cell} → ${version} (${source})`)

  // The Web app at the same version must exist, or there is nothing to test.
  if (cell !== 'pinned' && !versionsOf(HARNESS).includes(version)) {
    throw new Incomplete(`${HARNESS}@${version} is not on npm yet`)
  }

  let manifest = pkg
  if ((flags.repoint || flags.install) && cell !== 'pinned') {
    const repointed = repointManifest(pkg, version)
    if (repointed.missing.length > 0) {
      const missing = repointed.missing.map((m) => `${m.name} (${m.why})`).join(', ')
      out('missing', missing)
      throw new Incomplete(`not published at ${version}: ${missing}`)
    }
    manifest = repointed.manifest
    writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + '\n')
  }
  if (flags.repoint || flags.install) {
    const exact = Object.entries(manifest.devDependencies).filter(([n]) => n.startsWith('@deepseek-ai/'))
    console.log(`harness devDependencies:\n${exact.map(([n, v]) => `  ${n}@${v}`).join('\n')}`)
    if (!flags.install) summary(['', '| devDependency | pinned to |', '| --- | --- |', ...exact.map(([n, v]) => `| \`${n}\` | \`${v}\` |`), ''].join('\n'))
  }

  if (flags.install) {
    if (cell === 'pinned') {
      const result = run(root, 'npm', ['ci', '--no-audit', '--no-fund'])
      if (!result.ok) throw new Error(`npm ci failed:\n${tail(result.output, 40)}`)
      out('via', 'lockfile')
    } else {
      const result = installTrain(root, manifest, version)
      out('via', result.via)
      if (result.via !== 'peer graph') summary(`- installed via ${result.via}`)
      if (!result.ok) {
        if (result.incomplete) throw new Incomplete(`${HARNESS}@${version} does not install even on its own:\n${tail(result.output, 20)}`)
        throw new Error(`install failed:\n${tail(result.output, 40)}`)
      }
    }
    // What actually landed, not what was asked for: cordis and schemastery are ranges.
    const installed = Object.keys(manifest.devDependencies).filter((n) => n.startsWith('@deepseek-ai/')).map((name) => {
      try { return [name, JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version] } catch { return [name, 'not installed'] }
    })
    console.log(`installed:\n${installed.map(([n, v]) => `  ${n}@${v}`).join('\n')}`)
    summary(['', '| installed | version |', '| --- | --- |', ...installed.map(([n, v]) => `| \`${n}\` | \`${v}\` |`), ''].join('\n'))
  }

  if (flags.admits) {
    const refused = refusals(version, peers)
    summary(`- peer admission of ${version}: ${refused.length === 0 ? 'admitted by every harness peer under both rules' : describeRefusals(refused).join(', ')}`)
    if (refused.length > 0) {
      throw new Error(
        `the peer ranges do not admit dsh ${version} — ${refused.length} of ${peers.length} harness peers refuse it:\n  ` +
          describeRefusals(refused).join('\n  ') +
          '\nWiden a range only after types, tests and `smoke-boot.mjs --accept-risk` pass on this version (docs/harness-compatibility.md).',
      )
    }
    console.log(`peer admission: ${version} is admitted by all ${peers.length} harness peers under both rules`)
  }
}

try {
  if (flags.plan !== undefined) await plan(flags.plan)
  else if (flags.feed !== undefined) {
    const f = await feed(flags.feed)
    for (const key of ['version', 'path', 'sha512', 'size', 'releaseDate']) out(key, f[key])
  } else {
    if (positionals.length !== 1) throw new Error('usage: harness-target.mjs <cell> [--repoint] [--install] [--admits] | --plan <cells> | --feed <platform>')
    await target(positionals[0])
  }
} catch (error) {
  const message = String(error?.message ?? error)
  if (error instanceof Incomplete) {
    out('incomplete', 'true')
    summary(`- incomplete, not drift: ${message.split('\n')[0]}`)
    console.log(`::notice title=incomplete harness train::${message.split('\n')[0]}`)
    if (message.includes('\n')) console.log(message)
    process.exit(INCOMPLETE)
  }
  console.error(`::error::${message.split('\n')[0]}`)
  if (message.includes('\n')) console.error(message)
  process.exit(1)
}
