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

// 4. The prerelease trap, and the version gate. node-semver admits a
//    prerelease only through a comparator on its own major.minor.patch tuple
//    that itself carries a prerelease tag; a range without one silently
//    excludes every prerelease of that tuple and npm/pnpm users hit ERESOLVE.
//    dsh ≥0.1.7 applies the same ranges itself, prerelease-inclusive
//    (`evaluatePluginCompatibility` in dsh-app-boot), refusing the install and
//    silently skipping an installed plugin at boot. So every claim is checked
//    under BOTH rules: the devDependency pin, and every published version
//    docs/harness-compatibility.md lists. And nothing outside it may be
//    admitted — an unverified train that resolves is the failure this catches,
//    and `npm install` never shows it. `node scripts/sweep-trains.mjs` and
//    `node scripts/smoke-boot.mjs --dsh <v>` produce the evidence.
/**
 * Every published `@deepseek-ai/dsh` version, all admitted. 0.0.1-rc.1 and
 * rc.2 are admitted although nobody can install them — their own harness
 * depends on a `dsh-agent-tool-mode` that was never published — because the
 * range claims tuples, not builds, and admitting them costs nothing.
 */
const ADMITTED_TRAINS = [
  '0.0.1-rc.1', '0.0.1-rc.2', '0.0.1-rc.5',
  '0.1.0-rc.2', '0.1.0-rc.3', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8',
  '0.1.1-rc.1', '0.1.1-rc.2',
  '0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5', '0.1.2-rc.1',
  '0.1.3-alpha.2',
  '0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.5-rc.3',
  '0.1.6-alpha.1', '0.1.6-alpha.2',
  '0.1.7-alpha.1', '0.1.7-alpha.2', '0.1.7-rc.1', '0.1.7-rc.2',
]
/**
 * Builds that must stay outside, under both rules: 0.1.4 was never published;
 * 0.1.8+ and 0.2 wait for a sweep; 0.0.0 and 0.0.2 were never published.
 */
const OUTSIDE = [
  '0.0.0', '0.0.2-rc.0', '0.1.4-rc.0', '0.1.8-alpha.0', '0.1.8-rc.0', '0.1.8', '0.2.0',
]
const rules = [['default semver (npm, pnpm)', {}], ['includePrerelease (dsh ≥0.1.7 install and boot)', { includePrerelease: true }]]
/**
 * One comparator set per tuple, `>=M.m.p-<pre> <M.m.(p+1)-0`: a set spanning
 * two tuples admits no prerelease of the second under npm's rule, and a set
 * without a prerelease floor admits none of its own.
 */
function tupleOf(set) {
  const match = /^>=(\d+)\.(\d+)\.(\d+)-[0-9A-Za-z.]+ <(\d+)\.(\d+)\.(\d+)-0$/.exec(set.trim())
  if (match === null) return undefined
  const [, M, m, p, M2, m2, p2] = match.map(Number)
  return M === M2 && m === m2 && p2 === p + 1 ? `${M}.${m}.${p}` : undefined
}
for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
  if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
  const sets = range.split('||')
  const tuples = sets.map(tupleOf)
  if (tuples.includes(undefined)) fail('peerDependencies', `${name} \`${range}\` has a comparator set that is not one prerelease-floored tuple (\`>=M.m.p-pre <M.m.(p+1)-0\`)`)
  else if (new Set(tuples).size !== tuples.length) fail('peerDependencies', `${name} names a tuple twice`)
  const pinned = pkg.devDependencies?.[name]
  const trains = [...(pinned !== undefined && semver.valid(pinned) ? [pinned] : []), ...ADMITTED_TRAINS]
  for (const train of trains) {
    for (const [rule, options] of rules) {
      if (!semver.satisfies(train, range, options)) {
        fail('peerDependencies', `${name} \`${range}\` rejects ${train === pinned ? 'the pinned' : 'the published'} train ${train} under ${rule}` +
          (semver.prerelease(train) ? ' — a prerelease needs a comparator on its own major.minor.patch tuple that itself carries a prerelease tag' : ''))
      }
    }
  }
  for (const train of OUTSIDE) {
    for (const [rule, options] of rules) {
      if (semver.satisfies(train, range, options)) fail('peerDependencies', `${name} admits ${train} under ${rule}, which is outside the documented support`)
    }
  }
  if (pinned !== undefined && !semver.valid(pinned)) fail('devDependencies', `${name} must pin one exact, tested version, not \`${pinned}\``)
}
for (const file of ['docs/harness-compatibility.md', 'docs/harness-compatibility.zh.md']) {
  const text = read(file)
  const unlisted = ADMITTED_TRAINS.filter((train) => !text.includes(`\`${train}\``))
  if (unlisted.length > 0) fail(file, `does not list admitted trains: ${unlisted.join(', ')}`)
}
notes.push(`peer ranges: ${ADMITTED_TRAINS.length} published trains admitted and ${OUTSIDE.length} outside builds refused, under both semver rules, one comparator set per tuple`)

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
