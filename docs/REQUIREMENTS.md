# BranchForge 需求文档

> 版本:v0.1 草案 · 状态:方向已对齐,MVP 核心链路已真跑通(Phase A)

---

## 1. 文档目的与范围

定义 BranchForge 的产品定位、领域模型、系统架构与需求基线,并明确 MVP(v0.1)的范围。

---

## 2. 背景与问题

今天的 AI Coding 工具是「一个 Agent ≈ 一个开发者」—— 串行、单工作区、单分支。即使同时开多个 session,它们仍共享工作目录、互相覆盖 commit、无法真正并行与集成。**缺的不是模型能力,而是软件工程基础设施(harness)。**

---

## 3. 产品定位

BranchForge 是一个 **Git-native Agentic Harness**:一套运行时 + 工作台,为 Claude agent 提供可靠工作的环境。

### 3.1 Harness ≠ Multi-agent 协作

| | Multi-agent 协作 | Agentic Harness(本产品) |
|---|---|---|
| 重点 | agent 间沟通协商 | 提供环境/工具/约束让 agent 干活 |
| 类比 | AutoGPT "AI 开会" | Kubernetes:提供运行容器的环境与编排 |
| 智能涌现于 | agent 间对话(脆弱) | 环境机制(Git/MR/隔离)+ 人在环路(可控) |
| 人的位置 | 旁观者 | 指挥官,俯瞰 + 干预 |

### 3.2 核心价值主张

> 对线上世界,表现为一个开发者(只出一个干净 PR);对本地世界,是一整个工程团队。

---

## 4. 核心概念与领域模型

| 概念 | 定义 |
|---|---|
| Goal | 用户下发的更大开发目标 / 产品计划 |
| Plan | Lead 把 Goal 拆解成的子任务集合 |
| Workspace | 一个本地文件夹 + 一个 Git worktree + 一个 Agent Session,物理隔离 |
| Session | Claude Agent SDK 的一个 query() 运行实例,cwd 指向 Workspace |
| LocalHub | 本地集成中心仓库(bare),多 Workspace 在此汇聚 |
| MergeRequest | Workspace -> LocalHub 的集成请求,可被 Reviewer 审查 |
| RemoteProject | 线上真实仓库,用户维护的那一个分支,最终出口 |

---

## 5. 系统架构

**分层**:渲染进程(画布控制台)<-IPC-> 主进程(Harness 内核:编排器 / 工作区管理器 / Agent 运行时 / Git 集成层 / 事件总线)-> 外部(Claude Agent SDK、系统 Git、线上 origin)。

- **主进程(内核)**:管 Git、spawn/管理 Session、跑编排、聚合事件。
- **渲染进程(画布)**:只读状态 + 发指令,不直接碰文件/Git。

---

## 6. 关键流程

### 6.1 单工作区 Runtime(MVP 核心)
用户下发任务 -> 内核建 worktree+分支 -> query({cwd:工作区}) -> 流式消息回推画布 -> 完成收 diff -> 用户批准 -> 本地 commit。

### 6.2 Workspace 生命周期状态机
`created -> running -> streaming -> awaiting -> committed`;出错 -> `failed`;打回 -> 回到 running。
(v0.2 加 `verifying / fixing / blocked`,见 VERIFICATION_LOOP。)

---

## 7. 功能需求

**MVP(v0.1)**:FR-1 选本地 git 项目;FR-2 建工作区(worktree+分支);FR-3 下发任务;FR-4 query() 启动 session,流式推送;FR-5 收集展示 diff;FR-6 提交 / 打回重做;FR-7 工作区状态可视。

**后续**:FR-8 多工作区并行 + Hub + MR;FR-9 Lead 拆解;FR-10 Reviewer 审查;FR-11 线上 PR + 冲突解决。

---

## 8. 非功能需求

隔离性(物理 worktree)、可观测性(俯瞰 + 流式)、可干预性(人是指挥官)、网络鲁棒性(镜像/代理/超时)、可替换性(Agent 后端抽象,Git 不可替换)。

---

## 9. MVP v0.1 范围边界

| 在范围内 | 不在范围(后续) |
|---|---|
| 单工作区 + 单 session 跑通 | 多工作区并行 |
| worktree 隔离 + 流式 + diff + 本地 commit | 本地 Hub / MR |
| Agent SDK 打通 | Lead 拆解 / Reviewer / 线上 PR |

---

## 10. 非目标

不做 IDE/编辑器;不做 AutoGPT 式 agent 群聊;不追求全自动无人值守(坚持人在环路)。

---

## 11. 技术选型

Electron + TS(主进程与 SDK 同生态);Claude Agent SDK(开源、Claude Code 同款引擎);系统 Git(worktree/merge 最可靠);画布 UI(把 harness 状态可视化)。

## 11.5 前置条件与认证

前提:本机装 Claude Code CLI / Agent SDK 运行时;完成登录或设 ANTHROPIC_API_KEY;api.anthropic.com 可达。

| 认证 | 含义 | 注意 |
|---|---|---|
| 复用订阅登录 | claude login 后凭证存 ~/.claude,SDK 复用 | 订阅有速率/并发上限 |
| API Key | 设 ANTHROPIC_API_KEY,按 token 计费 | 按量付费 |

并发计费风险:并行多 Session 时订阅易撞限,API Key 更适合重度并行。

---

## 12. Roadmap

v0.1 单工作区 runtime(已真跑通)-> v0.2 多工作区 + Hub + MR + 验证内循环 -> v0.3 Lead 调度 + Reviewer -> v1.0 线上 PR / 冲突可视化 / 多后端 / 远程 worker。

---

## 13. 开放问题

画布库选型(React Flow vs tldraw);本地 Hub 形态(bare vs 主 worktree);事件协议 schema;状态持久化(重启恢复);认证默认走订阅还是 API Key。
