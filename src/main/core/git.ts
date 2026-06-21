// Git 集成层 —— 用 Node child_process 调系统 git。
// 选系统 git 而非库:worktree/merge/冲突用系统 git 最可靠(沿用 Go 原型的经验)。
// 仅依赖 Node 内置模块,无需 npm install。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DiffStat } from './types'

const exec = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
}

export async function isRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])) === 'true'
  } catch {
    return false
  }
}

export function repoRoot(dir: string): Promise<string> {
  return git(dir, ['rev-parse', '--show-toplevel'])
}

export function currentBranch(dir: string): Promise<string> {
  return git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])) === ''
}

export async function worktreeAdd(repo: string, worktreePath: string, branch: string, base: string): Promise<void> {
  await git(repo, ['worktree', 'add', '-b', branch, worktreePath, base])
}

export async function worktreeRemove(repo: string, worktreePath: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', worktreePath])
}

export async function commitAll(dir: string, message: string): Promise<boolean> {
  await git(dir, ['add', '-A'])
  if (await isClean(dir)) return false
  await git(dir, ['commit', '-m', message])
  return true
}

export async function numstat(dir: string, base: string): Promise<DiffStat> {
  const out = await git(dir, ['diff', '--numstat', base])
  let added = 0
  let removed = 0
  let files = 0
  for (const line of out.split('\n').filter(Boolean)) {
    const [a, r] = line.split('\t')
    files++
    if (a !== '-') added += Number(a) || 0
    if (r !== '-') removed += Number(r) || 0
  }
  return { added, removed, files }
}

export function diffText(dir: string, base: string): Promise<string> {
  return git(dir, ['diff', base])
}
