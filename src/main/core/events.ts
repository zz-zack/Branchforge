// IPC 事件协议 —— 主进程(harness 内核) ↔ 渲染进程(画布控制台)。
// 原则:渲染进程「只读状态 + 发指令」,不直接碰文件/Git;主进程推送状态流。

import type { Workspace, Task, RunResult, WorkspaceStatus } from './types'

/**
 * 渲染进程 → 主进程:invoke 风格指令(请求-响应,经 ipcRenderer.invoke)。
 * key 为 IPC channel 名,value 为该 channel 的签名。
 */
export interface CommandMap {
  /** 创建工作区:建 worktree + 分支,启动 session 跑 task。 */
  'workspace:create': (args: { projectRoot: string; task: Task }) => Promise<Workspace>
  /** 批准并本地提交工作区的改动。 */
  'workspace:commit': (args: { workspaceId: string }) => Promise<void>
  /** 打回重做:在同一工作区重新跑 task。 */
  'workspace:retry': (args: { workspaceId: string }) => Promise<void>
  /** 列出当前所有工作区。 */
  'workspace:list': () => Promise<Workspace[]>
}

export type CommandName = keyof CommandMap

/**
 * 主进程 → 渲染进程:状态流(单向推送,经 webContents.send)。
 * 全部走同一个 channel(HARNESS_EVENT_CHANNEL),用 type 区分。
 */
export type HarnessEvent =
  | { type: 'workspace:status'; workspaceId: string; status: WorkspaceStatus }
  | { type: 'session:chunk'; workspaceId: string; chunk: string } // 流式文本片段
  | { type: 'session:tool'; workspaceId: string; tool: string; input: unknown } // 工具调用
  | { type: 'workspace:result'; workspaceId: string; result: RunResult }
  | { type: 'workspace:error'; workspaceId: string; message: string }

/** 主进程推送 HarnessEvent 所用的统一 IPC channel 名。 */
export const HARNESS_EVENT_CHANNEL = 'harness:event'
