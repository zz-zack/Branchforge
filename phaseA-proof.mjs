// Phase A 证明脚本(纯 JS,无需 TS 运行器,node 直跑)。
// 验证核心链路:worktree 隔离 → Agent SDK query() session → diff。
// 用法: node phaseA-proof.mjs <项目根目录> <任务...>

import { execFileSync } from 'node:child_process'
import { query } from '@anthropic-ai/claude-agent-sdk'

const repo = process.argv[2]
const prompt = process.argv.slice(3).join(' ')
if (!repo || !prompt) {
  console.error('用法: node phaseA-proof.mjs <项目根目录> <任务...>')
  process.exit(1)
}

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
const id = Math.random().toString(36).slice(2, 6)
const branch = 'forge/proof-' + id
const wt = repo + '/.forge/wt-' + id

console.log('Phase A 证明')
console.log('  项目: ' + repo + '  base: ' + base)
git(repo, ['worktree', 'add', '-b', branch, wt, base])
console.log('  worktree: ' + wt + '  分支: ' + branch + '\n')

console.log('启动 Agent SDK session(cwd=隔离 worktree)...\n')
const res = query({ prompt, options: { cwd: wt, permissionMode: 'bypassPermissions' } })

for await (const m of res) {
  if (m.type === 'assistant') {
    for (const b of m.message.content) {
      if (b.type === 'text') process.stdout.write(b.text)
      else if (b.type === 'tool_use') console.log('\n  [tool] ' + b.name)
    }
  } else if (m.type === 'result') {
    console.log('\n\n[result] cost=$' + (m.total_cost_usd ?? '?') + ' error=' + m.is_error + ' subtype=' + m.subtype)
  }
}

git(wt, ['add', '-A'])
console.log('\n=== diff (worktree 相对 base) ===')
console.log(git(wt, ['diff', '--cached', '--stat', base]) || '(无改动)')
console.log('\nPhase A 证明结束。隔离 worktree 已产出改动。')
