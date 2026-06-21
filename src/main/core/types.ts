// BranchForge harness 领域模型 —— 对应需求文档 §4。
// MVP(v0.1)聚焦单工作区;LocalHub / MergeRequest / RemoteProject 等留待 v0.2。

/** 工作区生命周期状态(见需求文档 §6.2 状态机)。 */
export type WorkspaceStatus =
  | 'created' // 已创建 worktree,尚未启动 session
  | 'running' // session 启动中
  | 'streaming' // 流式输出中
  | 'awaiting' // 完成,等待人工审阅
  | 'committed' // 已本地提交
  | 'failed' // 出错

/** 一个交给 agent 执行的任务。 */
export interface Task {
  id: string
  prompt: string // 自然语言任务描述
  model?: string // 可选,覆盖默认模型
}

/** diff 统计。 */
export interface DiffStat {
  added: number // 新增行数
  removed: number // 删除行数
  files: number // 改动文件数
}

/**
 * 工作区:一个文件夹 + 一个 git worktree + 一个 agent session,物理隔离。
 * 这是 harness 打破"共享可变状态零和博弈"的核心单元。
 */
export interface Workspace {
  id: string
  projectRoot: string // 目标项目根目录
  branch: string // 隔离分支,如 forge/<slug>
  worktreePath: string // 隔离的工作目录(独立物理副本)
  task?: Task
  sessionId?: string // 绑定的 Agent SDK session id(用于 resume)
  status: WorkspaceStatus
  diffStat?: DiffStat // session 完成后回填
  createdAt: number
}

/** 一次 session 运行的最终结果。 */
export interface RunResult {
  workspaceId: string
  text: string // agent 自述(最终消息)
  isError: boolean
  costUsd?: number // 真实 API 成本
  durationMs?: number
  diff?: string // 完整 unified diff
  diffStat?: DiffStat
}
