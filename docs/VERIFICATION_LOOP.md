# 验证内循环(Verification Loop)设计

> 状态:设计草案 · 归属:承重墙 #2(机器可验收)· 配套:[CONTRACT_LAYER.md](./CONTRACT_LAYER.md)
> 落地阶段:v0.2 引入 per-workspace gates + 内循环;v0.3 接入契约测试 + 集成自愈 + 打分。

---

## 1. 要解决的问题:「agent 说做完了」≠ 做完了

我们 MVP 的循环是 `run-once → awaiting`:agent 说"实现完了",我们就信。这是**赌博**:

> agent 既自信又会错 —— "功能已实现",而类型挂了、测试红了、build 坏了。

没有验证闸门,合并的是**希望**。而 `Task.Acceptance` 字段我们定义了却没用 —— 它本该是那道闸门。

---

## 2. 核心设计决断:Acceptance 是可执行闸门 + 内循环

真实 agent 循环**不是跑一次**,而是:

```
写代码 → 跑闸门 → 失败 → 把失败回灌 agent → 修 → 重跑 → 直到全绿 或 预算耗尽
```

「done」必须由**机器证明**,失败必须**回灌**让 agent 自纠。workspace 在闸门全绿前到不了 `awaiting`(人审);预算耗尽仍红则进 `blocked` 并浮出失败。

---

## 3. 数据模型:Gate / GateResult / Acceptance

```ts
type GateKind = 'build' | 'typecheck' | 'lint' | 'unit' | 'contract' | 'coverage' | 'e2e' | 'custom'

interface Gate {
  kind: GateKind
  command: string      // 在 worktree 内如何跑
  required: boolean    // 硬闸门 vs 仅提示
  timeoutMs?: number
}

interface GateResult {
  kind: GateKind
  passed: boolean
  exitCode: number
  summary: string      // 浓缩后的失败信号(回灌给 agent)
  raw?: string         // 截断的完整日志(给人看)
  durationMs: number
}

interface Acceptance {
  gates: Gate[]        // 「done」的可校验定义
  // 来源 = 项目工具链探测 + 任务专属测试 + 契约测试
}
```

`Task` 加 `acceptance: Acceptance`;`Workspace` 加 `gateResults: GateResult[]` 与 `attempt: number`。

### 状态机扩展(对 REQUIREMENTS §6.2)

```
created → running → streaming → verifying → (全绿) → awaiting → committed
                                         → (红, 有预算) → fixing → running(resume)
                                         → (红, 预算耗尽) → blocked
```

---

## 4. 工具链探测:harness 怎么知道如何验证一个项目

这是个真实子问题。验证命令的来源,按优先级:

1. **用户显式配置** `.forge/gates.yaml`(最高优先,可覆盖)
2. **自动探测**:读 `package.json` scripts(test/build/lint/typecheck)、`Makefile`、`go.mod`、`Cargo.toml`、`pytest.ini` 等
3. **agent 推断**:首跑时让一个轻 agent 推断"如何 test/build/lint 本项目",结果缓存

产物:每个项目一份 `GateProfile`(自动探测 + 用户可覆盖),落 `.forge/gates.yaml`。

---

## 5. 内循环机制(心脏)

```
attempt = 0
loop:
  agent 跑(在 worktree 产出代码)
  results = runGates(worktree, gates)          # 沙箱内执行
  if 所有 required 绿: → awaiting               # 交人审
  if attempt >= maxAttempts 或 预算耗尽: → blocked(浮出失败)
  else:
    feedback = condense(results.failures)       # 日志 → 可行动信号
    agent.resume(feedback)                       # SDK resume,带失败上下文
    attempt++
```

设计要点(魔鬼在这里):

- **失败浓缩(condense)**:原始测试/build 日志又长又吵。要浓缩成**可行动信号**(哪个测试挂、断言是什么、file:line)。回灌**信号**而非噪声。可用 per-gate 确定性解析器,或廉价 LLM 摘要。
- **resume vs 重开**:失败回灌**同一 session**(SDK resume)保上下文;若上下文耗尽、或**同一失败重复 N 次(卡死)**,升级 —— 带摘要开新 session,或转人。
- **per-workspace 预算**:每次 attempt 烧 token + 时间。**同时**限 attempt 数和 token 预算。卡死检测:失败签名重复 → 中断升级。
- **fail-fast 排序**:便宜闸门先跑(typecheck/lint)再跑贵的(e2e),尽早失败省时省钱。
- **沙箱**:跑闸门 = 执行任意项目代码(测试/build)。这里**沙箱是承重的** —— 接上"安全"那根支柱。

---

## 6. 集成自愈(跨 workspace 的更高层循环)

各 workspace 单独绿、合进 hub 后:

> A、B 各自绿,合一起**仍可能炸**(契约不匹配、符号重复、资源冲突)。

所以**合并后对集成结果再跑一遍闸门**。集成失败的处理:

- spawn 一个"集成修复" session 在 hub 里修,或
- 把失败归因到契约违约 → **弹回违约的 workspace** 重修

> 集成不是 git 说"merged"就完,是**集成结果过闸门**才完 —— 这把承重墙 #3(集成/合并)也拉了进来。

---

## 7. 与契约层的焊接(承重墙 #1 × #2)

**契约测试就是一种 gate kind(`'contract'`),同时跑进生产者与消费者两侧的循环:**

- 生产者 A 的循环含契约测试 → A 自纠直到**实现**契约
- 消费者 B 的循环含同一契约测试(生产者 mock)→ B 自纠直到**正确消费**
- 集成时两边都真实 → 契约测试过 → **语义兼容被证明**

> 契约层的「契约」,变成验证层循环里的一个「闸门」。两根墙是**同一台机器**。

---

## 8. 竞争模式的客观打分

N 个变体竞争同一任务时,闸门产出**客观分**(不只 LLM 拍脑袋):

- 必过项:required 闸门是否全绿(二元门槛)
- 过门者之间排序:覆盖率 / 复杂度 / 改动行数 / 闸门耗时 / 成本 —— 一套 rubric

> 现有 review 引擎的"推荐"应**建立在闸门结果 + 指标上**,而非仅 LLM 读 diff。

---

## 9. 画布:闸门可视化

- 每个 workspace 节点一条 **gate strip**:闸门徽章行(build ✓ types ✓ lint ✓ unit ✗3 contract ✓),一眼看健康。
- 内循环可见:attempt 计数、"fixing… 3/5"、正在修的失败。
- 点红闸门 → 浓缩失败 + 原始日志。
- **预算表**(attempt 用量、token/成本)。
- **卡死浮出**:"同一失败 ×3,需人介入" → 注意力路由(接上"人的注意力"那根墙)。
- hub 节点上一条**集成 gate strip**。

---

## 10. 与现有代码 / roadmap 的关系

- Go 原型有"跑 agent → 收 diff",**无闸门**。Electron `workspace-manager.ts` 的 `run()` 正是循环嵌入点:`runSession` 之后跑闸门,决定 awaiting / fixing / blocked。
- `WorkspaceStatus` 需加 `verifying` / `fixing` / `blocked`。

| 阶段 | 验证层涉及 |
|---|---|
| v0.2 | per-workspace gates(build/typecheck/lint/unit)+ 内循环 + 工具链探测 |
| v0.3 | 契约测试闸门 + 集成自愈 + 竞争打分 rubric |
| v0.3+ | 沙箱化执行闸门(安全)、卡死检测 → 注意力路由 |

**下一步候选**:承重墙 #3(集成/语义合并)—— 它已被本文 §6 拉进来一角,可钉到同样深度。
