/**
 * Repo invariants a human reviewer reliably misses.
 *
 * Every check here corresponds to a real defect that shipped or nearly shipped:
 * a README count that drifted from the code, a locale dictionary missing a key
 * a new kind needed, a peer range that silently excluded every prerelease of
 * the harness it claims to support.
 *
 * Runs on source only — no build required — so it is cheap enough to be a PR
 * gate. Prints a GitHub-flavoured summary when running in Actions.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import semver from 'semver'
import { MEDIA_TABLE, MODEL_IMAGE_EXTENSIONS } from '../src/contract.ts'
import { en, zh } from '../src/client/locales.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))

const problems = []
const notes = []
const fail = (what, detail) => problems.push(`**${what}** — ${detail}`)

// 1. The counts in both READMEs are claims the plugin market checks against
//    the code. They drift the moment someone adds a format and stops there.
const kinds = new Set(Object.values(MEDIA_TABLE).map((s) => s.kind))
const extensions = Object.keys(MEDIA_TABLE).length
for (const file of ['README.md', 'README.zh.md']) {
  const text = read(file)
  if (!text.includes(String(extensions))) {
    fail(file, `does not state the real extension count (${extensions}); update the format table and the headline number`)
  }
  if (!text.includes(String(kinds.size))) {
    fail(file, `does not state the real kind count (${kinds.size})`)
  }
  // Every extension the code claims must appear in the table a reader sees.
  const missing = Object.keys(MEDIA_TABLE)
    .map((e) => e.slice(1))
    .filter((e) => !new RegExp(`\`${e}\``).test(text))
  if (missing.length > 0) fail(file, `format table omits: ${missing.join(' ')}`)
}
notes.push(`formats: ${extensions} extensions across ${kinds.size} kinds`)

// 2. The locale service fails a namespace whose dictionaries disagree, and it
//    fails at render time in the browser — far from whoever added the key.
const enKeys = Object.keys(en).sort()
const zhKeys = Object.keys(zh).sort()
const onlyEn = enKeys.filter((k) => !zhKeys.includes(k))
const onlyZh = zhKeys.filter((k) => !enKeys.includes(k))
if (onlyEn.length > 0) fail('locales', `missing from zh: ${onlyEn.join(', ')}`)
if (onlyZh.length > 0) fail('locales', `missing from en: ${onlyZh.join(', ')}`)

// 3. A kind with no title key renders a blank header; a kind with no icon path
//    throws. Both are only visible once that format is actually displayed.
const card = read('src/client/ViewerCard.tsx')
for (const kind of kinds) {
  if (!new RegExp(`^\\s*${kind}:`, 'm').test(card)) {
    fail('ViewerCard', `kind "${kind}" has no entry in KIND_TITLE/KindIcon`)
  }
  const titleKey = kind === 'html' ? 'title.html' : `title.${kind}`
  if (!(titleKey in en)) fail('locales', `kind "${kind}" has no ${titleKey}`)
}

// 4. The prerelease trap: a peer range without an explicit prerelease branch on
//    the matching major.minor.patch tuple silently excludes every prerelease of
//    that tuple, and users hit ERESOLVE.
for (const [name, pinned] of Object.entries(pkg.devDependencies)) {
  const range = pkg.peerDependencies?.[name]
  if (range === undefined) continue
  const version = pinned.replace(/^[\^~]/, '')
  if (!semver.valid(version)) continue
  if (!semver.satisfies(version, range)) {
    fail(
      'peerDependencies',
      `${name} is pinned to ${version} in devDependencies but the peer range \`${range}\` does not admit it` +
        (semver.prerelease(version) ? ' — a prerelease needs a comparator on its own major.minor.patch tuple that itself carries a prerelease tag' : ''),
    )
  }
}

// 5. Storefronts read this file; a path that does not resolve is a 404 in the
//    market listing, which nobody looking at this repo would ever notice.
if (existsSync(join(root, 'screenshots.json'))) {
  const declared = JSON.parse(read('screenshots.json'))
  const shots = Array.isArray(declared) ? declared : declared.screenshots
  for (const rel of shots) {
    if (rel.startsWith('/') || rel.includes('..')) fail('screenshots.json', `path escapes the package: ${rel}`)
    else if (!existsSync(join(root, rel))) fail('screenshots.json', `missing file: ${rel}`)
  }
  if (shots.length < 1 || shots.length > 8) fail('screenshots.json', `declares ${shots.length} images (allowed: 1-8)`)
  notes.push(`screenshots: ${shots.length}`)
}

// 6. Without cordis.patch.yml naming this exact package, dsh installs the
//    package and activates no layer — the plugin is present and does nothing.
const patch = read('cordis.patch.yml')
if (!patch.includes(pkg.name)) fail('cordis.patch.yml', `does not name "${pkg.name}"`)
if (pkg.dsh?.bundle?.patch === undefined) fail('package.json', 'declares no dsh.bundle.patch')

// 7. The attachment store admits exactly these rasters; a mismatch means a card
//    promises model context it cannot deliver.
for (const ext of Object.keys(MODEL_IMAGE_EXTENSIONS)) {
  if (MEDIA_TABLE[ext]?.kind !== 'image') fail('contract', `${ext} is model-image admissible but not classified as image`)
}

// 8. The install path itself. pnpm refuses to run a git-hosted package's build
//    scripts unless the user pre-approves them in their profile's allowBuilds,
//    so the official git-channel command only works while the repository needs
//    no build: no `prepare` script, and the entry the package declares present
//    in the committed tree. Either one missing turns every user's one-line
//    install into ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED.
if (pkg.scripts?.prepare !== undefined) {
  fail('package.json', 'declares a prepare script — a git install then requires the user to approve a build step in allowBuilds')
}
const entry = pkg.exports?.['.']?.default ?? pkg.main
if (typeof entry !== 'string') fail('package.json', 'declares no main/exports["."].default for the host half')
else if (!existsSync(join(root, entry))) fail('distribution', `the declared entry ${entry} is not in the repository — a git install would load nothing`)
const clientEntry = pkg.exports?.['./client']?.default
if (typeof clientEntry === 'string' && !existsSync(join(root, clientEntry))) {
  fail('distribution', `the declared client entry ${clientEntry} is not in the repository`)
}
if (existsSync(join(root, '.gitignore')) && /^\s*lib\/?\s*$/m.test(read('.gitignore'))) {
  fail('.gitignore', 'ignores lib/ — the built halves must be committed for the git channel to install without a build')
}

const summary = [
  problems.length === 0 ? '## Invariants OK' : `## ${problems.length} invariant(s) need changes`,
  '',
  ...problems.map((p) => `- ${p}`),
  '',
  ...notes.map((n) => `- ${n}`),
].join('\n')

console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
}
process.exit(problems.length === 0 ? 0 : 1)
