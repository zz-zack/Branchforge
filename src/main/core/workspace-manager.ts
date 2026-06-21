// 工作区管理器 —— harness 内核的核心编排。
// 把 git(物理隔离) + agent(执行) 串成 Workspace 的完整生命周期(见需求文档 §6.2 状态机)。

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import * as git from './git'
import type { AgentBackend } from './agent'
import type { Task, Workspace, RunResult, WorkspaceStatus } from './types'
import type { HarnessEvent } from './events'

export interface WorkspaceManagerOptions {
  backend: AgentBackend
  emit: (e: HarnessEvent) => void // 推送状态流到 UI(画布)
}

export class WorkspaceManager {
  private workspaces = new Map<string, Workspace>()

  constructor(private opts: WorkspaceManagerOptions) {}

  list(): Workspace[] {
    return [...this.workspaces.values()]
  }

  /** 创建工作区:建 worktree(隔离)→ 异步启动 session 跑 task → 完成后等人审。 */
  async create(projectRoot: string, task: Task): Promise<Workspace> {
    const repo = await git.repoRoot(projectRoot)
    const base = await git.currentBranch(repo)
    const id = randomUUID().slice(0, 8)
    const slug = this.slugify(task.prompt)
    const branch = `forge/${slug}-${id}`
    const worktreePath = join(repo, '.forge', 'worktrees', `${slug}-${id}`)

    const ws: Workspace = {
      id,
      projectRoot: repo,
      branch,
      worktreePath,
      task,
      status: 'created',
      createdAt: Date.now(),
    }
    this.workspaces.set(id, ws)

    await git.worktreeAdd(repo, worktreePath, branch, base)
    void this.run(ws, base) // 异步执行,不阻塞 create 返回
    return ws
  }

  /** 批准并本地提交工作区改动。 */
  async commit(workspaceId: string): Promise<void> {
    const ws = this.must(workspaceId)
    await git.commitAll(ws.worktreePath, `forge: ${ws.task?.prompt ?? 'changes'}`)
    this.setStatus(ws, 'committed')
  }

  /** 打回重做:在同一隔离工作区重新跑 task。 */
  async retry(workspaceId: string): Promise<void> {
    const ws = this.must(workspaceId)
    const base = await git.currentBranch(ws.projectRoot)
    await this.run(ws, base)
  }

  // —— 内部 ——

  private async run(ws: Workspace, base: string): Promise<void> {
    this.setStatus(ws, 'running')
    try {
      this.setStatus(ws, 'streaming')
      const result = await this.opts.backend.runSession({
        cwd: ws.worktreePath,
        task: ws.task!,
        onEvent: (e) => {
          if (e.type === 'chunk') {
            this.opts.emit({ type: 'session:chunk', workspaceId: ws.id, chunk: e.text })
          } else {
            this.opts.emit({ type: 'session:tool', workspaceId: ws.id, tool: e.name, input: e.input })
          }
        },
      })
      ws.diffStat = await git.numstat(ws.worktreePath, base)
      const diff = await git.diffText(ws.worktreePath, base)
      const full: RunResult = { ...result, diff, diffStat: ws.diffStat }
      this.opts.emit({ type: 'workspace:result', workspaceId: ws.id, result: full })
      this.setStatus(ws, 'awaiting')
    } catch (err) {
      this.setStatus(ws, 'failed')
      this.opts.emit({ type: 'workspace:error', workspaceId: ws.id, message: String(err) })
    }
  }

  private setStatus(ws: Workspace, status: WorkspaceStatus): void {
    ws.status = status
    this.opts.emit({ type: 'workspace:status', workspaceId: ws.id, status })
  }

  private must(id: string): Workspace {
    const ws = this.workspaces.get(id)
    if (!ws) throw new Error(`workspace 不存在: ${id}`)
    return ws
  }

  private slugify(s: string): string {
    const words = s.toLowerCase().match(/[a-z0-9]+/g) ?? []
    return words.slice(0, 3).join('-') || 'task'
  }
}
