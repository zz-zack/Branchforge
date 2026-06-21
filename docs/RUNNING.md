# 在健康机器上运行 / 验证(交接指南)

> 目的:换一台 node/npm/文件系统正常的机器,几条命令验证核心逻辑(Phase A)。
> 配套:[ROADMAP](./ROADMAP.md) · [DEVELOPMENT](./DEVELOPMENT.md)

---

## 1. 前提

- Node >= 18、系统 git。
- Claude 认证(二选一):本机 `claude` CLI 已登录(复用订阅);或设 `ANTHROPIC_API_KEY`。
- `api.anthropic.com` 可达。自检:`claude -p "ping" --output-format json` 能返回即可。

---

## 2. 安装依赖

```bash
cd BranchForge
npm install
# 或最少只装 SDK: npm i @anthropic-ai/claude-agent-sdk
```

国内网络:`npm config set registry https://registry.npmmirror.com`;
或走本地 HTTP 代理:`export HTTPS_PROXY=http://127.0.0.1:PORT HTTP_PROXY=http://127.0.0.1:PORT`。

---

## 3. 跑 Phase A 证明(核心链路)

```bash
# 造个临时 git 项目
mkdir /tmp/demo && cd /tmp/demo && git init -b main
echo 'export const x = 1' > index.js && git add -A && git commit -m init

# 回到 BranchForge 跑证明脚本
cd /path/to/BranchForge
node phaseA-proof.mjs /tmp/demo "在 index.js 新增并导出函数 add(a,b) 返回 a+b"
```

预期(= 核心逻辑跑通):
- 建出隔离 worktree `.forge/wt-xxxx` + 分支 `forge/proof-xxxx`
- 真实 Agent SDK `query()` session 流式输出 + 工具调用([tool] Write / Bash 等)
- 结尾打印 `diff --stat`,显示该 worktree 相对 base 的改动

跑通即证明:worktree 物理隔离 -> 真实 Claude session -> diff 这条链在真实环境成立。
(`phaseA-proof.mjs` 是纯 JS、零 TS 运行器依赖;TS 版内核在 `src/main/core/`,环境稳后可用 tsx 跑 `src/headless/run.ts`。)

---

## 4. 环境排错清单(本会话踩过的坑)

| 症状 | 根因 | 对策 |
|---|---|---|
| `npm install` 卡死 | 外网 DNS 被阻断(8.8.8.8/UDP53 超时) | 开代理 TUN 模式(接管 DNS),或给 npm 配 HTTP 代理 |
| 域名 `ENOTFOUND` | 系统 DNS 不可达 | 同上;普通"全局代理"管不到 getaddrinfo,要 TUN |
| `Cannot find package` / node_modules 时有时无 | 中断的 npm install 损坏依赖树 | 别 kill 正在跑的 npm;坏了重 `npm install` 恢复 |
| 文件写了读不到 / 空文件 / 重复行 | 本机文件系统坏窗口 | 写后用 Read 校验;临时产物放 /tmp;重启清状态 |
| SDK Options 里 `model` 报类型错 | 该版本 SDK Options 无 model 顶层字段 | MVP 用默认模型;agent.ts 已去掉留 TODO |

> 这些是本机特定的环境抖动,正常机器无此问题。代码侧(`src/main/core/` 内核 + 证明脚本)已 typecheck 过并入库。

---

## 5. 跑通之后

按 [ROADMAP](./ROADMAP.md) 推进:A(本文)单工作区 runtime -> B 验证内循环 -> C 多工作区+治理 -> D 契约+集成自愈 -> E UI 薄壳(推迟)。
前端策略:CLI 即扩散阶段的轻量前端,Electron 画布推迟。
