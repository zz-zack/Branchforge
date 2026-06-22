// Phase B 证明:验证内循环(code -> test -> fix)。
// worktree 隔离 + Agent SDK session;每轮跑测试当「闸门」,失败就回灌(resume)让它修,
// 直到测试全绿或达到尝试上限。这把「agent 说做完」变成「测试证明做完」。
// 用法: node phaseB-proof.mjs <项目根目录> [任务...]

import { execFileSync } from 'node:child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'

const repo = process.argv[2]
const task = process.argv.slice(3).join(' ') || 'Make the failing tests pass. Implement whatever is missing.'
if (!repo) {
  console.error('用法: node phaseB-proof.mjs <项目根目录> [任务]')
  process.exit(1)
}

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
const id = Math.random().toString(36).slice(2, 6)
const wt = repo + '/.forge/wt-' + id
git(repo, ['worktree', 'add', '-b', 'forge/proofB-' + id, wt, base])
console.log('Phase B: 验证内循环')
console.log('  worktree:', wt, '\n')

// 闸门:在 worktree 内跑 node --test。passed=true 表示「done 被测试证明」。
function runGate(cwd) {
  try {
    const out = execFileSync('node', ['--test'], { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { passed: true, output: out }
  } catch (e) {
    const o = (e.stdout || '') + (e.stderr || '')
    return { passed: false, output: o.slice(-2000) }
  }
}

const maxAttempts = 4
let sessionId = null
let lastFail = ''
let passed = false
let totalCost = 0

for (let attempt = 1; attempt <= maxAttempts && !passed; attempt++) {
  const prompt =
    attempt === 1 ? task : 'Tests still fail. Fix the code so they pass. Failure output:\n' + lastFail
  const opts = { cwd: wt, permissionMode: 'bypassPermissions' }
  if (sessionId) opts.resume = sessionId // 回灌:在同一 session 续上下文

  console.log('=== attempt ' + attempt + ' (agent 干活) ===')
  const res = query({ prompt, options: opts })
  for await (const m of res) {
    if (m.type === 'assistant') {
      for (const b of m.message.content) {
        if (b.type === 'tool_use') process.stdout.write('[' + b.name + '] ')
      }
    } else if (m.type === 'result') {
      sessionId = m.session_id
      totalCost += m.total_cost_usd || 0
    }
  }

  const gate = runGate(wt)
  if (gate.passed) {
    passed = true
    console.log('\n  GATE: PASS (测试全绿)\n')
  } else {
    lastFail = gate.output
    console.log('\n  GATE: FAIL -> 回灌失败、resume 重试\n')
  }
}

console.log('=== Phase B 结果 ===')
console.log('  测试通过:', passed ? '是(done 被测试证明)' : '否(达上限仍红 -> blocked)')
console.log('  累计成本: $' + totalCost.toFixed(4))
git(wt, ['add', '-A'])
console.log('  diff:')
console.log(git(wt, ['diff', '--cached', '--stat', base]) || '  (无改动)')
