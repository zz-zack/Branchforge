# 契约层(Contract Layer)设计

> 状态:设计草案 · 归属:承重墙 #1(语义零和)· 配套:[REQUIREMENTS.md](./REQUIREMENTS.md)
> 落地阶段:配合 v0.3 Lead 中枢调度;`Contract` 数据类型可在 v0.2 多工作区时提前引入。

---

## 1. 要解决的问题:Git 消除物理零和,但不消除「语义零和」

worktree 隔离解决的是**物理写入冲突**(两个 agent 不再覆盖彼此文件)。但:

> Worker A 写后端接口 `getUser(id)`,Worker B 写前端调用 `fetchUser(userId)` —— `git merge` 会**成功**(无文本冲突),却合出一个**语义上坏掉**的整体。

**git 只看字节,不看含义。** 它保证"不互相覆盖",保证不了"拼起来是对的"。这是一种 git 看不见的零和。

真正的协调载体不是事后的 MR,而是 fan-out **之前**就确立的一层:**契约层**。

> 一句话:**git 管「不打架」,契约层管「拼得上」。**

---

## 2. 核心设计决断:契约优先 + 可执行 artifact

**契约优先于任务(contract-first)**:Lead 先识别接缝、把每条接缝固化成一个**可校验的契约**,再沿契约边界切任务。

**优先可执行 artifact 而非散文**:契约尽量写成 interface / schema / 共享测试 —— 因为这样「实现是否符合契约」可被机器校验,语义不匹配变成一次**测试失败**。

---

## 3. 数据模型:契约作为一等公民

在 `src/main/core/types.ts` 基础上扩展:

```ts
type ContractKind =
  | 'interface'   // 一个 .ts 接口/类型文件
  | 'api-schema'  // OpenAPI / GraphQL schema
  | 'data-schema' // DB schema / 事件消息结构
  | 'shared-test' // 消费者驱动的契约测试(最强形态)
  | 'decision'    // 共享设计决策:"用 Postgres"、"错误返回 {code,message}"

interface Contract {
  id: string
  name: string              // "User API"、"Auth Token 结构"
  kind: ContractKind
  artifactPath: string      // 存在 hub 的 contracts/ 下,本身受 git 版本控制
  version: number           // 变更即 bump,触发依赖方 re-sync
  owner: 'lead' | string    // 谁有权改它(默认 Lead)
  producers: string[]       // 实现该契约的 workspace
  consumers: string[]       // 依赖该契约的 workspace
  checkable: boolean        // 能否机器校验
  checkCommand?: string     // 如何跑契约测试 / 类型校验
  status: 'proposed' | 'agreed' | 'violated' | 'changed'
}

interface TaskContractBinding {
  implements: string[]      // 本任务必须满足的契约 id
  dependsOn: string[]       // 本任务消费的契约 id
}
```

### 关键设计点(反直觉):任务依赖契约,不依赖任务

```
Task B  --dependsOn-->  Contract C  <--implements--  Task A
```

**B 不需要等 A 跑完。** 只要契约 C 进入 `agreed`,A 和 B 就能**同时**开工 —— A 实现一侧,B 按契约另一侧编码。契约把任务**解耦**,这才是「并行」真正的来源(而非各跑各的、最后赌能拼上)。

依赖图因此从 `task→task` 变为 `task→contract→task`,**解锁信号是契约 `agreed`,不是任务 `done`**。

---

## 4. Lead 的拆解:用「隔离房间」逼出每条隐含约定

Lead 的灵魂 framing:

> **假设这些 agent 被关在互不相通的房间里、永远不能交谈。任何它们需要共享的东西,都必须现在、以契约形式钉死。**

拆解 prompt 骨架(结构化输出):

```
角色:资深 tech lead。把 GOAL 拆给若干"互不通信的独立 agent"并行执行。

硬规则:
1. 先识别接缝(seams):哪里出现"一个 agent 的产出被另一个依赖"?每条接缝 = 一个 Contract。
2. 优先产出【可执行契约】:能写成 interface/schema/共享测试的,绝不写散文。
3. 任务只能 dependsOn 契约,绝不能依赖另一个任务的内部实现。
4. 自检:"关在不同房间、永不见面的人,照这份契约能各自做完且拼得上吗?
   拼不上 → 缺哪条契约?补上。"

输出(JSON):
  contracts: [{ name, kind, artifactContent(真实接口/schema/测试代码), checkCommand }]
  tasks:     [{ goal, implements:[contractId], dependsOn:[contractId] }]
```

两个配套机制:

- **计划预审是最高杠杆的人类决策点**:fan-out 前,人先审「契约 + 任务图」。现在改一条契约是一句话;10 个 agent 照错契约建完再改是灾难。把人的介入放在**最便宜、最关键**的那一刻。
- **契约演化是受控事件**:Worker 中途发现契约不对,**不能私改代码**,而是发起 **contract change** → version bump → 通知所有 consumer re-sync。这是「接口必然要变」的唯一合法通道。

---

## 5. 画布:从「任务监视器」升级为「协调仪表盘」

契约让画布第一次有了真实图结构 —— 契约是节点间带类型的枢纽:

```
  [WS-A 后端] --implements--> (📜 UserAPI v2 · agreed ✓ · test green) <--consumes-- [WS-B 前端]
                                          ▲
                                          └--consumes-- [WS-C 移动端]
```

- **契约是独立节点类型**(不同形状/颜色),坐在 workspace 之间。一个契约连 1 producer + 3 consumer,一眼看出「关键接口」。
- **状态即颜色**:proposed(灰)→ agreed(绿)→ **violated(红色脉冲)** → changed(黄,标"N 个依赖方待 re-sync")。
- **违约精准定位**:某 workspace 契约测试挂 → **只点亮违约方与契约之间那条红边**,立刻看到「语义断在哪」。
- **发射前控制室**:fan-out 前,画布把「拟定契约 + 任务图」作为可编辑图呈现,人改契约/重画边界/批准,**然后**才 spawn agent。

质变:画布不再监视「任务」,而展示**「接口、归属、依赖、断裂点」** —— 单 agent 工具给不出的视角。

---

## 6. 走一遍:用户中心例子

目标「加用户中心(列表 + 详情)」:

1. Lead 识别接缝 = 前后端之间 → 产出契约 `UserAPI`(TS interface + 契约测试)。
2. 任务 A(后端)、任务 B(前端)**都对着 `UserAPI`,并行开工,B 不等 A**。
3. 若 A 返回 `snake_case` 而 B 期望 `camelCase` → **契约测试直接红**,不会等到合并后才发现整个用户中心是坏的。

---

## 7. 综合:三根承重墙在这里合一

当契约表达为**共享测试**时:

- A(生产者)跑契约测试 → 必须变绿 → **证明**实现了契约
- B(消费者)跑同一测试 → **证明**正确消费
- 集成时两边都真实 → 契约测试通过 → **语义兼容是被证明的,不是被祈祷的**

> **「语义零和」(墙#1)被「验证内循环」(墙#2)自动抓住,靠的就是契约可执行。** 契约是连接两墙的桥 —— 它们不是独立问题,而是一条主线。

这条主线,就是 BranchForge 区别于「一堆并行 agent」的真正内核。

---

## 8. 与现有 roadmap 的关系

| 阶段 | 契约层涉及 |
|---|---|
| v0.2 | 引入 `Contract` 数据类型 + hub 的 `contracts/` 目录(手工契约亦可);多工作区按契约解耦 |
| v0.3 | Lead 自动产出契约(contract-first 拆解)+ 计划预审 + 契约演化事件 |
| v0.3+ | 契约测试自动跑进各 workspace 的验证内循环(对接承重墙 #2) |

**下一步**:把承重墙 #2(验证内循环 / 机器可验收)钉到同样深度,并设计契约测试如何嵌入每个 workspace 的 `code→test→fix` 循环。
