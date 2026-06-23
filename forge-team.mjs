// forge-team.mjs — M4: 契约拆解 + 并行 + 集成自愈(完整的「大目标 -> 一个干净结果」)。
// Lead 读目标+契约测试 -> 拆成独立 parts -> 并行实现(各按契约)-> 合并集成 -> 契约测试当闸门 -> 失败自愈。
// 前提:repo 里有 contract.test.js(定义集成验收)。
// 用法: node forge-team.mjs <repo> "<goal>" [--budget USD] [--heal K]

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'

const repo = process.argv[2]
const goal = process.argv[3]
const flag = (n, d) => {
  const i = process.argv.indexOf('--' + n)
  return i >= 0 ? process.argv[i + 1] : d
}
const budget = parseFloat(flag('budget', '1.5'))
const healMax = parseInt(flag('heal', '2'), 10)

if (!repo || !goal) {
  console.error('用法: node forge-team.mjs <repo> "<goal>" [--budget USD] [--heal K]')
  process.exit(1)
}

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])

const contractPath = join(repo, 'contract.test.js')
if (!existsSync(contractPath)) {
  console.error('需要 ' + repo + '/contract.test.js 作为集成契约')
  process.exit(1)
}
const contract = readFileSync(contractPath, 'utf8')

let spent = 0
const abort = new AbortController()
function charge(c) {
  spent += c || 0
  if (spent > budget && !abort.signal.aborted) {
    console.log('  !! 预算超限 -> kill-switch')
    abort.abort()
  }
}

async function runAgent(prompt, cwd) {
  let text = ''
  let cost = 0
  const res = query({ prompt, options: { cwd, permissionMode: 'bypassPermissions', abortController: abort } })
  for await (const m of res) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) if (b.type === 'text') text += b.text
    } else if (m.type === 'result') {
      cost = m.total_cost_usd || 0
    }
  }
  return { text, cost }
}

console.log('forge team: ' + goal)
console.log('  base=' + base + '  budget=$' + budget + '\n')

console.log('  Lead 拆解契约...')
const tmp = mkdtempSync(join(tmpdir(), 'forge-lead-'))
const leadPrompt =
  'You are a tech lead. Goal: ' + goal + '\n\n' +
  'The integration contract (the test the final merged result MUST pass):\n```\n' + contract + '\n```\n\n' +
  'Decompose into INDEPENDENT parts, each built in parallel by an isolated agent who never talks to the others. ' +
  'Each part owns DISJOINT files and implements its half of the contract. ' +
  'Output ONLY a JSON array, no prose. Example: [{"id":"a","files":["user.js"],"task":"implement ..."}]'
const lead = await runAgent(leadPrompt, tmp)
charge(lead.cost)
let parts
try {
  parts = JSON.parse(lead.text.match(/\[[\s\S]*\]/)[0])
} catch (e) {
  console.error('  Lead 计划解析失败:\n' + lead.text.slice(0, 500))
  process.exit(1)
}
console.log('  拆成 ' + parts.length + ' 个 part: ' + parts.map((p) => p.id + '(' + (p.files || []).join(',') + ')').join(' '))

async function runPart(p) {
  if (abort.signal.aborted) return { ...p, skipped: true }
  const branch = 'forge/team-' + p.id
  const wt = repo + '/.forge/wt-team-' + p.id
  git(repo, ['worktree', 'add', '-b', branch, wt, base])
  const prompt =
    p.task + '\n\nYou must satisfy this shared contract (do NOT edit the contract test):\n```\n' + contract + '\n```\nOnly edit: ' + (p.files || []).join(', ')
  const r = await runAgent(prompt, wt)
  charge(r.cost)
  git(wt, ['add', '-A'])
  try { git(wt, ['commit', '-q', '-m', 'team part ' + p.id]) } catch {}
  return { ...p, branch, cost: r.cost }
}
console.log('\n  并行实现各 part...')
const done = await Promise.all(parts.map(runPart))

const intWt = repo + '/.forge/wt-team-int'
git(repo, ['worktree', 'add', '-b', 'forge/team-int', intWt, base])
console.log('\n  集成:合并所有 part...')
for (const p of done) if (p.branch) git(intWt, ['merge', '--no-edit', p.branch])

function gate(cwd) {
  try {
    execFileSync('node', ['--test', 'contract.test.js'], { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { passed: true }
  } catch (e) {
    return { passed: false, out: ((e.stdout || '') + (e.stderr || '')).slice(-1500) }
  }
}

let g = gate(intWt)
let heals = 0
while (!g.passed && heals < healMax && !abort.signal.aborted) {
  heals++
  console.log('  契约测试 FAIL -> 集成自愈(第 ' + heals + ' 轮)...')
  const r = await runAgent('The integrated result fails the contract test. Fix the code (not the test) so it passes. Failure:\n' + g.out, intWt)
  charge(r.cost)
  git(intWt, ['add', '-A'])
  try { git(intWt, ['commit', '-q', '-m', 'heal ' + heals]) } catch {}
  g = gate(intWt)
}

console.log('\n=== forge team 结果 ===')
console.log('  契约测试(集成后):' + (g.passed ? 'PASS -> 语义兼容,得到一个干净结果' : 'FAIL'))
console.log('  集成自愈轮数:' + heals)
console.log('  总成本 $' + spent.toFixed(4) + ' / 预算 $' + budget)
console.log('  集成分支:forge/team-int  ->  git -C ' + repo + ' merge forge/team-int')
