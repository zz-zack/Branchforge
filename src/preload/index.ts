// IPC 桥 —— 通过 contextBridge 向渲染进程(画布)安全暴露 harness API。
// 渲染进程不直接碰 Node/Git,只通过这层 invoke 指令 + 订阅事件流。

import { contextBridge, ipcRenderer } from 'electron'
import type { Task, Workspace } from '../main/core/types'
import type { HarnessEvent } from '../main/core/events'
import { HARNESS_EVENT_CHANNEL } from '../main/core/events'

const api = {
  createWorkspace: (projectRoot: string, task: Task): Promise<Workspace> =>
    ipcRenderer.invoke('workspace:create', { projectRoot, task }),
  commitWorkspace: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('workspace:commit', { workspaceId }),
  retryWorkspace: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('workspace:retry', { workspaceId }),
  listWorkspaces: (): Promise<Workspace[]> => ipcRenderer.invoke('workspace:list'),
  /** 订阅 harness 状态流;返回取消订阅函数。 */
  onEvent: (cb: (e: HarnessEvent) => void): (() => void) => {
    const listener = (_: unknown, e: HarnessEvent): void => cb(e)
    ipcRenderer.on(HARNESS_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(HARNESS_EVENT_CHANNEL, listener)
  },
}

contextBridge.exposeInMainWorld('forge', api)

export type ForgeApi = typeof api
