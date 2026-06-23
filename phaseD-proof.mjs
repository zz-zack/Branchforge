// Phase D 证明:契约层 + 集成自愈。
// 两个 worktree 各实现「契约的一半」(互不见对方),集成时合并两半、跑契约测试当闸门。
// 契约测试过 = 语义兼容被证明(git 看不见的语义零和,被契约测试抓住)。
// 用法: node phaseD-proof.mjs <hub仓库>

import { execFileSync } from 'node:child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'

const repo = process.argv[2]
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])

console.log('Phase D: 契约层 + 集成自愈')
console.log('  base=' + base + '\n')

// 契约把任务解耦:两半各按契约实现,并行、互不见对方
const parts = [
  { id: 'a', task: 'Implement getUser(id) in user.js. Contract: getUser(1) must return an object { id: 1, name: "Alice" }. Only edit user.js.' },
  { id: 'b', task: 'Implement formatUser(user) in format.js. Contract: formatUser({ id, name }) must return the string `User #${id}: ${name}`. Only edit format.js.' },
]

async function runPart(p) {
  const branch = 'forge/proofD-' + p.id
  const wt = repo + '/.forge/wt-D-' + p.id
  git(repo, ['worktree', 'add', '-b', branch, wt, base])
  console.log('  -> ' + p.id + ' 按契约实现一半')
  const res = query({ prompt: p.task, options: { cwd: wt, permissionMode: 'bypassPermissions' } })
  for await (const m of res) {
    if (m.type === 'result') console.log('     ' + p.id + ' 完成 $' + (m.total_cost_usd || 0).toFixed(4))
  }
  git(wt, ['add', '-A'])
  git(wt, ['commit', '-q', '-m', 'part ' + p.id])
  return branch
}

const branches = await Promise.all(parts.map(runPart))
console.log('  两半完成:', branches.join(', '))

// 集成:新建集成 worktree,合并两半,跑契约测试当闸门
const intWt = repo + '/.forge/wt-D-int'
git(repo, ['worktree', 'add', '-b', 'forge/proofD-int', intWt, base])
console.log('\n  集成:把两半合并到一个 worktree...')
for (const b of branches) {
  git(intWt, ['merge', '--no-edit', b])
}

console.log('  跑契约测试(集成后整体)...')
let passed = false
try {
  execFileSync('node', ['--test', 'contract.test.js'], { cwd: intWt, encoding: 'utf8', stdio: 'pipe' })
  passed = true
} catch (e) {
  // 契约测试失败 = 语义不匹配 -> 真实产品会 spawn 自愈 session 修复
}

console.log('\n=== Phase D 结果 ===')
console.log('  契约测试(集成后):' + (passed ? 'PASS -> 语义兼容被证明' : 'FAIL -> 触发集成自愈'))
console.log('  集成后文件:')
console.log(git(intWt, ['diff', base, '--stat']))
