// Agent 运行时 —— 对 Claude Agent SDK 的封装。
// harness 调用的「单 agent 原语」:一个 agent 在一个 cwd 里干活(流式/工具/权限)。
//
// 注:本机文件系统对 node_modules 读取异常,无法直接核对 SDK 类型。
// 故 SDK 消息流处用受控的局部类型断言;运行时结构沿用 Claude CLI headless JSON(已实测:
// result 含 is_error/total_cost_usd/duration_ms/subtype/result;assistant 含 message.content blocks)。

import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Task } from './types'

export type AgentStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool'; name: string; input: unknown }

export interface SessionResult {
  text: string
  isError: boolean
  costUsd?: number
  durationMs?: number
}

export interface RunSessionOptions {
  cwd: string
  task: Task
  onEvent: (e: AgentStreamEvent) => void
  signal?: AbortSignal
}

export interface AgentBackend {
  readonly name: string
  runSession(opts: RunSessionOptions): Promise<SessionResult>
}

interface SdkMessage {
  type: string
  message?: { content?: Array<{ type: string; text?: string; name?: string; input?: unknown }> }
  is_error?: boolean
  total_cost_usd?: number
  duration_ms?: number
  subtype?: string
  result?: string
}

export class ClaudeBackend implements AgentBackend {
  readonly name = 'claude'

  async runSession(opts: RunSessionOptions): Promise<SessionResult> {
    const { cwd, task, onEvent, signal } = opts
    const abort = new AbortController()
    signal?.addEventListener('abort', () => abort.abort())

    const response = query({
      prompt: task.prompt,
      options: {
        cwd,
        permissionMode: 'bypassPermissions',
        abortController: abort,
      },
    })

    const out: SessionResult = { text: '', isError: false }

    for await (const raw of response) {
      const m = raw as unknown as SdkMessage
      if (m.type === 'assistant') {
        for (const block of m.message?.content ?? []) {
          if (block.type === 'text' && block.text != null) {
            onEvent({ type: 'chunk', text: block.text })
          } else if (block.type === 'tool_use' && block.name) {
            onEvent({ type: 'tool', name: block.name, input: block.input })
          }
        }
      } else if (m.type === 'result') {
        out.isError = Boolean(m.is_error)
        out.costUsd = m.total_cost_usd
        out.durationMs = m.duration_ms
        if (m.subtype === 'success') out.text = m.result ?? ''
      }
    }

    return out
  }
}
</parameter>
