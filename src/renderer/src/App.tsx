import { useEffect, useState, type CSSProperties } from 'react'
import type { Workspace, WorkspaceStatus } from '../../main/core/types'
import type { HarnessEvent } from '../../main/core/events'
import type { ForgeApi } from '../../preload'

declare global {
  interface Window {
    forge: ForgeApi
  }
}

interface NodeState {
  ws: Workspace
  log: string
}

export function App(): JSX.Element {
  const [projectRoot, setProjectRoot] = useState('')
  const [prompt, setPrompt] = useState('')
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})

  // 订阅 harness 状态流,更新对应工作区节点。
  useEffect(() => {
    return window.forge.onEvent((e: HarnessEvent) => {
      setNodes((prev) => {
        const n = prev[e.workspaceId]
        if (!n) return prev
        const updated: NodeState = { ws: { ...n.ws }, log: n.log }
        switch (e.type) {
          case 'workspace:status':
            updated.ws.status = e.status
            break
          case 'session:chunk':
            updated.log += e.chunk
            break
          case 'session:tool':
            updated.log += `\n[tool] ${e.tool}\n`
            break
          case 'workspace:result':
            updated.ws.diffStat = e.result.diffStat
            break
          case 'workspace:error':
            updated.log += `\n[error] ${e.message}\n`
            break
        }
        return { ...prev, [e.workspaceId]: updated }
      })
    })
  }, [])

  async function create(): Promise<void> {
    if (!projectRoot || !prompt) return
    const ws = await window.forge.createWorkspace(projectRoot, { id: crypto.randomUUID(), prompt })
    setNodes((p) => ({ ...p, [ws.id]: { ws, log: '' } }))
    setPrompt('')
  }

  return (
    <div style={page}>
      <h1 style={{ margin: '0 0 4px' }}>BranchForge</h1>
      <p style={{ opacity: 0.6, marginTop: 0 }}>Git-native Agentic Harness — 单工作区 MVP</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input style={inp} placeholder="项目根目录" value={projectRoot} onChange={(e) => setProjectRoot(e.target.value)} />
        <input style={{ ...inp, flex: 1 }} placeholder="任务描述" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <button style={btn} onClick={create}>创建工作区</button>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {Object.values(nodes).map(({ ws, log }) => (
          <div key={ws.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{ws.branch}</strong>
              <span style={badge(ws.status)}>{ws.status}</span>
            </div>
            {ws.diffStat && (
              <div style={{ opacity: 0.7, fontSize: 13, marginTop: 4 }}>
                +{ws.diffStat.added} −{ws.diffStat.removed} · {ws.diffStat.files} 文件
              </div>
            )}
            <pre style={logBox}>{log || '…'}</pre>
            {ws.status === 'awaiting' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={btn} onClick={() => window.forge.commitWorkspace(ws.id)}>提交</button>
                <button style={btnGhost} onClick={() => window.forge.retryWorkspace(ws.id)}>打回重做</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const page: CSSProperties = { fontFamily: 'system-ui, sans-serif', padding: 24, color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }
const inp: CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }
const btn: CSSProperties = { padding: '8px 14px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer' }
const btnGhost: CSSProperties = { ...btn, background: 'transparent', border: '1px solid #475569' }
const card: CSSProperties = { border: '1px solid #334155', borderRadius: 8, padding: 12, background: '#1e293b' }
const logBox: CSSProperties = { background: '#0f172a', padding: 8, borderRadius: 6, maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0' }
const badge = (s: WorkspaceStatus): CSSProperties => ({
  padding: '2px 10px',
  borderRadius: 999,
  fontSize: 12,
  background: s === 'failed' ? '#7f1d1d' : s === 'awaiting' ? '#854d0e' : s === 'committed' ? '#14532d' : '#1e40af',
})
