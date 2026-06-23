// Phase C 证明:多工作区并行 + 治理。
// 用带并发上限的简易调度器并发跑 N 个隔离 worktree 的 session;
// 全局成本预算 + kill-switch:累计成本超预算 -> AbortController 中止其余 session。
// 用法: node phaseC-proof.mjs <repo> <variants> <concurrency> <budgetUsd> <task...>

import { execFileSync } from 'node:child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'

const repo = process.argv[2]
const variants = parseInt(process.argv[3] || '3', 10)
const concurrency = parseInt(process.argv[4] || '2', 10)
const budgetUsd = parseFloat(process.argv[5] || '0.5')
const task = process.argv.slice(6).join(' ') || 'Add a small helper function to the project.'

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])

console.log('Phase C: 多工作区并行 + 治理')
console.log('  variants=' + variants + ' concurrency=' + concurrency + ' budget=$' + budgetUsd + ' base=' + base + '\n')

let spent = 0
const abort = new AbortController()

function charge(cost, label) {
  spent += cost || 0
  console.log('  [' + label + '] +$' + (cost || 0).toFixed(4) + ' | 累计 $' + spent.toFixed(4) + ' / $' + budgetUsd)
  if (spent > budgetUsd && !abort.signal.aborted) {
    console.log('  !! 预算超限 -> kill-switch:中止其余 session')
    abort.abort()
  }
}

async function runVariant(letter) {
  const branch = 'forge/proofC-' + letter
  const wt = repo + '/.forge/wt-C-' + letter
  if (abort.signal.aborted) return { id: letter, skipped: true }
  git(repo, ['worktree', 'add', '-b', branch, wt, base])
  console.log('  -> 启动 ' + letter)
  try {
    const res = query({ prompt: task, options: { cwd: wt, permissionMode: 'bypassPermissions', abortController: abort } })
    let cost = 0
    for await (const m of res) {
      if (m.type === 'result') cost = m.total_cost_usd || 0
    }
    charge(cost, letter)
    git(wt, ['add', '-A'])
    const stat = git(wt, ['diff', '--cached', '--numstat', base])
    return { id: letter, branch, cost, files: stat ? stat.split('\n').length : 0 }
  } catch (e) {
    return { id: letter, branch, cost: 0, aborted: abort.signal.aborted, error: String(e).slice(0, 100) }
  }
}

async function pool(items, cap, fn) {
  const out = []
  let i = 0
  const workers = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

const letters = Array.from({ length: variants }, (_, i) => String.fromCharCode(97 + i))
const settled = await pool(letters, concurrency, runVariant)

console.log('\n=== Phase C 结果 ===')
for (const r of settled) {
  if (r.skipped) { console.log('  ' + r.id + ': skipped(预算已超)'); continue }
  console.log('  ' + r.id + ' ' + r.branch + ': $' + (r.cost || 0).toFixed(4) + ' files=' + (r.files || 0) + (r.aborted ? ' (aborted)' : '') + (r.error ? ' ERR' : ''))
}
console.log('  总成本 $' + spent.toFixed(4) + ' / 预算 $' + budgetUsd + '  ' + (abort.signal.aborted ? '(触发了 kill-switch)' : '(预算内)'))
