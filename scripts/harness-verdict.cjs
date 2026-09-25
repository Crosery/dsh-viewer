/**
 * The verdict step of `.github/workflows/harness-compat.yml`, one cell at a
 * time. Called from actions/github-script:
 *
 *   await require('./scripts/harness-verdict.cjs')({ github, context, core })
 *
 * Reads the stage outcomes from `STAGE_<name>` environment variables (a
 * step's `outcome`: success / failure / skipped / cancelled / empty), the
 * stages the cell was expected to run from `EXPECTED`, and `CELL`, `VERSION`,
 * `INCOMPLETE`, `REPORT`.
 *
 * - Any failed stage fails the job.
 * - With REPORT=true, a failure opens an `upstream-drift` issue titled
 *   `Harness compatibility broken against @<cell>`, or comments on the open
 *   one; a cell whose every expected stage succeeded comments on that issue
 *   and closes it. An incomplete train (published without packages this
 *   plugin needs, or not yet at all) does neither: it is not drift, and it is
 *   not evidence that drift was fixed.
 *
 * CommonJS because github-script evaluates the step as a CommonJS function
 * body and this repository is `"type": "module"`.
 */

const LABEL = 'upstream-drift'

const ADVICE = {
  resolve: 'the cell did not resolve to a published version — read the step log (a desktop feed that disagrees across platforms fails here).',
  install: 'the repointed graph did not install, and `@deepseek-ai/dsh` at this version does install on its own — so the conflict is this repository\'s.',
  types: 'an upstream export was renamed or removed; the typecheck output names it.',
  tests: 'the plugin\'s own tests fail against this train\'s packages.',
  admission: 'a peer range does not admit this version, so dsh ≥0.1.7 refuses to install or load the plugin. Widen only after types, tests and `node scripts/smoke-boot.mjs --dsh <version> --accept-risk` pass.',
  smoke: 'the packed plugin did not install, activate or get served on a real `dsh --profile web`; the step summary names the stage.',
  feed: 'the desktop update feed could not be read.',
  download: 'the desktop zip did not download or did not match the feed\'s sha512.',
  runtime: 'the desktop app\'s bundled runtime is not the version its feed announces.',
}

function outcomes(env) {
  return Object.fromEntries(Object.entries(env)
    .filter(([key]) => key.startsWith('STAGE_'))
    .map(([key, value]) => [key.slice('STAGE_'.length), value || 'not run']))
}

/** Pure part: what the stages add up to. */
function judge(env) {
  const stages = outcomes(env)
  const expected = String(env.EXPECTED ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const failed = Object.entries(stages).filter(([, outcome]) => outcome === 'failure').map(([name]) => name)
  const incomplete = env.INCOMPLETE === 'true'
  const green = !incomplete && failed.length === 0 && expected.length > 0 && expected.every((name) => stages[name] === 'success')
  return { stages, expected, failed, incomplete, green }
}

async function verdict({ github, context, core, env = process.env }) {
  const cell = env.CELL
  const version = env.VERSION || 'unresolved'
  const { stages, failed, incomplete, green } = judge(env)
  const run = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`

  await core.summary
    .addHeading(`harness@${cell} (${version}) — ${failed.length > 0 ? `failed: ${failed.join(', ')}` : incomplete ? 'incomplete train, neutral' : green ? 'green' : 'not fully run'}`, 3)
    .addList(Object.entries(stages).map(([name, outcome]) => `${name}: ${outcome}`))
    .write()

  if (env.REPORT === 'true') {
    const { owner, repo } = context.repo
    const title = `Harness compatibility broken against @${cell}`
    const open = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', labels: LABEL })
    const hit = open.find((issue) => issue.title === title && !issue.pull_request)
    if (failed.length > 0) {
      const body = [
        `\`harness@${cell}\` resolved to \`${version}\` and failed: **${failed.join(', ')}**.`,
        '',
        `Run: ${run}`,
        '',
        ...failed.map((name) => `- **${name}**: ${ADVICE[name] ?? 'see the step log.'}`),
        '',
        'This issue closes itself on the first run where every stage of this cell passes again.',
      ].join('\n')
      if (hit !== undefined) {
        await github.rest.issues.createComment({ owner, repo, issue_number: hit.number, body })
      } else {
        await github.rest.issues.getLabel({ owner, repo, name: LABEL })
          .catch(() => github.rest.issues.createLabel({ owner, repo, name: LABEL, color: 'd93f0b', description: 'The plugin no longer works on a published harness train' }))
        await github.rest.issues.create({ owner, repo, title, body, labels: [LABEL] })
      }
    } else if (green && hit !== undefined) {
      const passed = Object.entries(stages).filter(([, o]) => o === 'success').map(([name]) => name)
      await github.rest.issues.createComment({
        owner, repo, issue_number: hit.number,
        body: `Green against \`${version}\`: ${passed.join(', ')} all passed.\n\nRun: ${run}`,
      })
      await github.rest.issues.update({ owner, repo, issue_number: hit.number, state: 'closed', state_reason: 'completed' })
    }
  }

  if (failed.length > 0) core.setFailed(`harness@${cell} (${version}): ${failed.join(', ')}`)
  return { failed, incomplete, green }
}

module.exports = verdict
module.exports.judge = judge
