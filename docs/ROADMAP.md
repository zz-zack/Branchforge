# BranchForge 整体路线

> 原则:**核心逻辑优先,前端越轻越好**。目标是先**扩散这个思路**。
> 配套:[REQUIREMENTS](./REQUIREMENTS.md) · [CONTRACT_LAYER](./CONTRACT_LAYER.md) · [VERIFICATION_LOOP](./VERIFICATION_LOOP.md)

---

## 架构原则(参考 pencil.dev / opendesign)

它们底层都是**后台 headless 调用 Claude 跑 session,UI 只是反射后台状态的薄壳**。两个结论:

1. **harness 内核 = headless-first 的独立后台**,不绑 Electron。CLI / Electron 渲染进程 / 未来 Web UI 都只是内核之上的薄壳(消费事件流 + 命令)。
2. **核心逻辑完全脱离 UI 验证** —— 一个 node 驱动直接驱动 WorkspaceManager 就能证明整条链。

### 前端策略(扩散优先)
扩散思路最轻的载体是 **CLI**,不是画布。所以:
- **现阶段的「前端」= 一个干净的 CLI**(headless 驱动),既验证核心、又能直接 demo 扩散。
- **Electron 画布 = 推迟**,等需要"可视化指挥室"时再做。
- UI 永远是薄反射层:内核发事件流,UI 订阅渲染。

---

## 分阶段路线(核心逻辑优先,全程 headless 可验)

| 阶段 | 目标 | 验收(无需 UI) |
|---|---|---|
| **A. 单工作区 runtime 跑通** ⬅️ 进行中 | headless CLI 驱动,真实 Agent SDK query() 在 worktree 跑 session | 真实 Claude 在隔离 worktree 改文件 → diff → commit 成功 |
| **B. 验证内循环**(墙#2) | 闸门探测 + worktree 内跑 build/test/lint;code→test→fix 回灌 | "done"由测试证明,非 agent 自称 |
| **C. 多工作区 + 治理** | 调度器并发 N session;成本/速率预算 + kill-switch | 并行多变体安全跑、成本可控 |
| **D. 契约 + 集成自愈**(墙#1、#3) | 契约层(契约测试当闸门)+ 本地 hub + MR + 集成后整体过闸门 | 多工作区集成成连贯、过闸门的整体 |
| **E. UI 薄壳**(推迟) | React Flow 画布,反射内核状态;参考 pencil/opendesign | 仅在核心跑通、且需要可视化时才做 |

横切(随阶段长出):持久化/恢复(A 起步 JSON→SQLite)、沙箱(B 跑闸门)、事件流(events.ts,headless 先打日志)。

---

## 当前下一步:Phase A

1. headless 入口 `src/headless/run.ts`,用 tsx/node 跑,直接调 `WorkspaceManager.create(项目, 任务)`。
2. 临时 git 项目上跑,观察 worktree → 流式 query() → diff → commit。
3. 把 HarnessEvent 打到控制台(未来 UI 要订阅的东西,现在先看日志)。

**验收**:从"代码 typecheck 过"推进到"**核心逻辑真跑通**",完全不碰前端。
环境前提已满足:Claude API 通(PONG)、npm install 成功、Agent SDK 已装。
