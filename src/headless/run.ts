// Headless CLI 驱动 —— 不依赖 Electron/UI,直接驱动 harness 内核,验证核心逻辑。
// 这同时是「扩散阶段的轻量前端」:把整条链(worktree 隔离 → Agent SDK session → diff → commit)跑给人看。
// 用法: npx tsx src/headless/run.ts <项目根目录> <任务描述...>

import { WorkspaceManager } from '../main/core/workspace-manager'
import { ClaudeBackend } from '../main/core/agent'
import type { HarnessEvent } from '../main/core/events'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const projectRoot = args[0]
  const prompt = args.slice(1).join(' ')
  if (!projectRoot || !prompt) {
    console.error('用法: npx tsx src/headless/run.ts <项目根目录> <任务描述>')
    process.exit(1)
  }

  let resolveDone: () => void = () => {}
  const done = new Promise<void>((r) => {
    resolveDone = r
  })

  // 事件流 → 控制台(未来 UI 订阅的就是这些 HarnessEvent,现在先打日志看)。
  const emit = (e: HarnessEvent): void => {
    switch (e.type) {
      case 'workspace:status':
        console.log(`\n● [${e.workspaceId}] ${e.status}`)
        break
      case 'session:chunk':
        process.stdout.write(e.chunk)
        break
      case 'session:tool':
        console.log(`\n  ↳ [tool] ${e.tool}`)
        break
      case 'workspace:result': {
        const d = e.result.diffStat
        console.log('\n=== 结果 ===')
        console.log(`diff: +${d?.added ?? 0} -${d?.removed ?? 0}, ${d?.files ?? 0} 文件`)
        if (e.result.costUsd != null) console.log(`成本: $${e.result.costUsd}`)
        console.log(`自述: ${e.result.text}`)
        resolveDone()
        break
      }
      case 'workspace:error':
        console.error(`\n[错误] ${e.message}`)
        resolveDone()
        break
    }
  }

  const manager = new WorkspaceManager({ backend: new ClaudeBackend(), emit })
  console.log(`▶ headless run\n  项目: ${projectRoot}\n  任务: ${prompt}`)

  const ws = await manager.create(projectRoot, { id: 'task-1', prompt })
  console.log(`  工作区: ${ws.branch}\n  worktree: ${ws.worktreePath}`)

  await done
  console.log('\n✓ headless 完成。worktree 改动已生成,待 commit/审阅。')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
