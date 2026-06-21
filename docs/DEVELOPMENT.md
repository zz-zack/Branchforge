# BranchForge 开发文档

> 更新:2026-06 · 阶段:**v0.1 MVP 骨架完成,待 `npm install` 接入运行**
> 配套:[README.md](../README.md) · [REQUIREMENTS.md](./REQUIREMENTS.md)(需求 + 5 张架构图)

---

## 1. 现状

Electron + TS 的 harness 骨架已全部写完(主进程内核 + IPC + 画布),`agent.ts` 的 Claude Agent SDK 集成也已写好。唯一缺口是 **`npm install` 后做 typecheck + 启动验证**。Go CLI 原型(`cmd/`、`internal/`)已真实验证核心链路,作概念参考保留。

---

## 2. 产品方向(已钉死)

| 维度 | 决定 |
|---|---|
| 本质 | Git-native **Agentic Harness**(运行时/工作台),**非** multi-agent 协作;类比 Kubernetes |
| 核心价值 | 对线上是一个开发者、对内是一个团队;两级 git,本地消化混乱,线上只出一个 PR |
| 打破零和 | git worktree 物理隔离消除共享可变状态争抢;隔离 + 合并 = 零和变正和 |
| 技术栈 | Electron + TypeScript;主进程=内核,渲染进程=画布 |
| Agent 运行时 | Claude Agent SDK,每工作区一个 `query()` session(独立 cwd) |
| 编排 | Lead 中枢调度(harness 的 scheduler 组件,非协作 agent) |
| MVP | 单工作区跑通 runtime |
| 认证 | 复用订阅登录 / API Key(默认待定;注意并发计费,见 REQUIREMENTS §11.5) |

---

## 3. 进度

**✅ 已完成**
- 文档:`README.md`、`REQUIREMENTS.md`(5 张 Mermaid 图)、本文。
- Go CLI 原型:真实跑通 worktree 隔离 + claude headless 并行 + diff + LLM 推荐(实测成本 0.0689 USD、两个差异化实现)。仅概念验证,非主线。
- Electron Harness 骨架(主线):配置文件 + 主进程内核 + IPC 桥 + 画布,见 §4。`git.ts` 为可用真实实现;`agent.ts` 已写真实 SDK `query()` 集成。

**🔜 待办(按序)**
1. `npm install`(⚠️ 先配镜像,见 §5)。
2. `npm run typecheck` —— 重点核对 `agent.ts` 的 SDK 类型(见 §6),个别守卫按真实 `.d.ts` 微调。
3. prettier 规整(个别文件因写入环境抖动缩进略乱,不影响编译)。
4. `npm run dev` 启动 + §5.3 端到端验证。
5. 进入 v0.2(见 §8)。

---

## 4. 代码结构与职责

| 文件 | 职责 |
|---|---|
| `package.json` / `electron.vite.config.ts` / `tsconfig.*` | 构建与类型配置(electron-vite 三进程) |
| `src/main/index.ts` | Electron 入口:窗口 + IPC 注册 + 实例化内核 + 推送事件 |
| `src/main/core/types.ts` | 领域模型:Workspace / Task / RunResult / WorkspaceStatus |
| `src/main/core/events.ts` | IPC 契约:CommandMap(指令) + HarnessEvent(状态流) |
| `src/main/core/git.ts` | Git 集成层(execFile 调系统 git);worktree/diff/commit ✅可用 |
| `src/main/core/agent.ts` | Agent 后端:AgentBackend 抽象 + ClaudeBackend(`query()` 集成) |
| `src/main/core/workspace-manager.ts` | 核心编排:create→worktree→session→diff→等审;commit/retry |
| `src/preload/index.ts` | contextBridge 暴露 `window.forge`(invoke 指令 + onEvent 订阅) |
| `src/renderer/src/App.tsx` | 画布:下发任务 / 工作区节点 / 流式日志 / diff / 提交-重做 |

**数据流**:`App.tsx` → `window.forge.createWorkspace`(preload) → `ipcMain.handle` → `WorkspaceManager.create` → `git.worktreeAdd` + `ClaudeBackend.runSession`(流式 `onEvent` → `emit` → `HARNESS_EVENT_CHANNEL` → 画布更新节点)。

---

## 5. 如何继续开发

**5.1 环境**:Node ≥ 18、系统 git;本地 `claude` CLI 已登录(或设 `ANTHROPIC_API_KEY`),`api.anthropic.com` 可达。本机外网受限,**必配镜像**:
```
npm config set registry https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

**5.2 安装启动**:`npm install` → `npm run typecheck` → `npm run dev`。

**5.3 验证 MVP**:启动后在画布填「本地 git 项目根目录」+「任务描述」→ 创建工作区 → 观察状态 `created→running→streaming→awaiting`、流式日志、diff 统计 → 点提交(本地 commit)或重做。检查 `<项目>/.forge/worktrees/<slug>-<id>/` 确有隔离改动。

---

## 6. Agent SDK 集成(待 install 验证)

`agent.ts` 的 `ClaudeBackend.runSession` 基于 `query({ prompt, options: { cwd, model, permissionMode:'bypassPermissions', abortController } })`,for-await 消息流:`assistant` 消息逐 content block(text / tool_use)回调 `onEvent`;`result` 消息取 `is_error` / `total_cost_usd` / `duration_ms`(沿用 CLI headless JSON 字段,实测过),`subtype==='success'` 时取 `result`。**install 后对照 SDK `.d.ts` 确认** content block 结构与 result 守卫,有出入只需微调字段访问。

---

## 7. 已知约束(本机特定)

- **网络**:`npm`/`github`/`goproxy.cn` 外网 DNS REFUSED 不可达,**Anthropic API 可达**。装依赖必走镜像,否则 `npm install` 卡死并可能拖垮系统。
- **文件/工具层偶发抖动**(开发期遇到):写入偶发**内容重复损坏**、Bash 输出丢字、重定向偶发不落盘、Read 偶发陈旧。**正常机器无此问题**。应对:写后 Read 校验、删重复行或重写。
- 代码/文档格式个别处因抖动略乱,不影响内容与编译,正常环境 prettier 统一即可。

---

## 8. Roadmap

| 版本 | 目标 |
|---|---|
| v0.1(进行中) | 单工作区跑通 runtime |
| v0.2 | 多工作区并行 + 本地 Hub 集成 + 本地 MR;画布升级 React Flow;状态持久化 |
| v0.3 | Lead 中枢调度(大目标自动拆解→投递→汇总)+ Reviewer 审查 |
| v1.0 | 线上一键 PR、冲突可视化、多后端(codex/gemini)、远程 worker |

---

## 9. 参考

- [README.md](../README.md) — 门面、定位、两级 git 架构图
- [REQUIREMENTS.md](./REQUIREMENTS.md) — 需求、领域模型、5 张架构图、MVP 范围、认证
- 记忆:`branchforge-harness-direction`、`user-env-network-constraint`
