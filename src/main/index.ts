// Electron 主进程 = Harness 内核入口。
// 创建窗口 + 注册 IPC + 实例化 WorkspaceManager,把状态流推送给画布。

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { WorkspaceManager } from './core/workspace-manager'
import { ClaudeBackend } from './core/agent'
import { HARNESS_EVENT_CHANNEL } from './core/events'
import type { HarnessEvent } from './core/events'
import type { Task } from './core/types'

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'BranchForge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL) // dev
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')) // prod
  }
}

/** 把 harness 事件推送到渲染进程(画布)。 */
function emit(e: HarnessEvent): void {
  win?.webContents.send(HARNESS_EVENT_CHANNEL, e)
}

const manager = new WorkspaceManager({ backend: new ClaudeBackend(), emit })

function registerIpc(): void {
  ipcMain.handle('workspace:create', (_e, args: { projectRoot: string; task: Task }) =>
    manager.create(args.projectRoot, args.task)
  )
  ipcMain.handle('workspace:commit', (_e, args: { workspaceId: string }) =>
    manager.commit(args.workspaceId)
  )
  ipcMain.handle('workspace:retry', (_e, args: { workspaceId: string }) =>
    manager.retry(args.workspaceId)
  )
  ipcMain.handle('workspace:list', () => manager.list())
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
