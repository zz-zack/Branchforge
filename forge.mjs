// forge.mjs — BranchForge 统一入口(.mjs 总指挥,零 TS 工具链依赖,node 直跑)。
// 一条命令串起已证明的机制:
//   M1 worktree 隔离 + M3 并行/并发上限/预算/kill-switch + M2 每个 worktree 的验证内循环(code->test->fix)
// 用法:
//   node forge.mjs <repo> "<task>" [--variants N] [--concurrency C] [--budget USD] [--max-fix K]

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'

const repo = process.argv[2]
const task = process.argv[3]
const flag = (name, def) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const variants = parseInt(flag('variants', '2'), 10)
const concurrency = parseInt(flag('concurrency', '2'), 10)
const budget = parseFloat(flag('budget', '1.0'))
const maxFix = parseInt(flag('max-fix', '3'), 10)

if (!repo || !task) {
  console.error('用法: node forge.mjs <repo> "<task>" [--variants N] [--concurrency C] [--budget USD] [--max-fix K]')
  process.exit(1)
}

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])

// 闸门(M2):探测并在 worktree 内跑测试
function detectGate(cwd) {
  const files = readdirSync(cwd)
  if (files.some((f) => /\.test\.(c|m)?js$/.test(f))) return ['node', ['--test']]
  if (files.includes('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(cwd + '/package.json', 'utf8'))
      if (pkg.scripts && pkg.scripts.test) return ['npm', ['test', '--silent']]
    } catch {}
  }
  return null
}
function runGate(cwd) {
  const g = detectGate(cwd)
  if (!g) return { gated: false }
  try {
    execFileSync(g[0], g[1], { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { gated: true, passed: true }
  } catch (e) {
    return { gated: true, passed: false, output: ((e.stdout || '') + (e.stderr || '')).slice(-1500) }
  }
}

// 治理(M3):全局预算 + kill-switch
let spent = 0
const abort = new AbortController()
function charge(cost) {
  spent += cost || 0
  if (spent > budget && !abort.signal.aborted) {
    console.log('  !! 预算超限 -> kill-switch:中止其余 session')
    abort.abort()
  }
}

// 一个 variant:M1 隔离 + M2 验证内循环
async function runVariant(letter) {
  if (abort.signal.aborted) return { id: letter, skipped: true }
  const branch = 'forge/' + letter
  const wt = repo + '/.forge/wt-' + letter
  git(repo, ['worktree', 'add', '-b', branch, wt, base])
  console.log('  [' + letter + '] 启动')

  let cost = 0
  let sessionId = null
  let lastFail = ''
  let gate = { gated: false }
  let attempt = 0
  for (attempt = 1; attempt <= maxFix; attempt++) {
    if (abort.signal.aborted) break
    const prompt = attempt === 1 ? task : 'Tests failed. Fix the code so they pass. Output:\n' + lastFail
    const opts = { cwd: wt, permissionMode: 'bypassPermissions', abortController: abort }
    if (sessionId) opts.resume = sessionId
    try {
      const res = query({ prompt, options: opts })
      for await (const m of res) {
        if (m.type === 'result') {
          sessionId = m.session_id
          cost += m.total_cost_usd || 0
        }
      }
    } catch (e) {
      break
    }
    gate = runGate(wt)
    if (!gate.gated || gate.passed) break
    lastFail = gate.output
    console.log('  [' + letter + '] 闸门失败 -> 回灌修复(第 ' + attempt + ' 轮)')
  }

  charge(cost)
  git(wt, ['add', '-A'])
  const stat = git(wt, ['diff', '--cached', '--numstat', base])
  return {
    id: letter,
    branch,
    cost,
    attempts: attempt,
    gate: !gate.gated ? 'none' : gate.passed ? 'PASS' : 'FAIL',
    files: stat ? stat.split('\n').filter(Boolean).length : 0,
  }
}

// 简易调度器:并发上限
async function pool(items, cap, fn) {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(cap, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx])
      }
    })
  )
  return out
}

console.log('forge: ' + task)
console.log('  repo=' + repo + ' base=' + base + ' variants=' + variants + ' concurrency=' + concurrency + ' budget=$' + budget + '\n')

const letters = Array.from({ length: variants }, (_, i) => String.fromCharCode(97 + i))
const results = await pool(letters, concurrency, runVariant)

console.log('\n=== 结果对比 ===')
for (const r of results) {
  if (r.skipped) {
    console.log('  ' + r.id + '  (skipped, 预算已超)')
    continue
  }
  console.log('  ' + r.id + '  ' + r.branch + '  gate=' + r.gate + '  尝试=' + r.attempts + '  文件=' + r.files + '  $' + r.cost.toFixed(4))
}
console.log('\n  总成本 $' + spent.toFixed(4) + ' / 预算 $' + budget + (abort.signal.aborted ? '  (触发了 kill-switch)' : ''))
console.log('  择优合并:  git -C ' + repo + ' merge <分支>')
