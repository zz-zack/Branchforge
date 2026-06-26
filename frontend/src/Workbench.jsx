import { useState, useEffect, useRef } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { Button } from './components/ui/button'
import { cn } from './lib/utils'

const LANG = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python', go: 'go', rs: 'rust', java: 'java', sh: 'shell', yml: 'yaml', yaml: 'yaml', sql: 'sql' }
const langOf = (p) => LANG[(p || '').split('.').pop()] || 'plaintext'

function TreeNode({ node, depth, onOpen, active }) {
  const [open, setOpen] = useState(depth < 1)
  if (node.dir) {
    return (
      <div>
        <div onClick={() => setOpen(!open)} className="flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer hover:bg-secondary text-[13px]" style={{ paddingLeft: depth * 12 + 6 }}>
          <span className="text-muted-foreground w-3">{open ? '▾' : '▸'}</span><span className="truncate">{node.name}</span>
        </div>
        {open && node.children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onOpen={onOpen} active={active} />)}
      </div>
    )
  }
  return (
    <div onClick={() => onOpen(node.path)} className={cn('flex items-center gap-1 px-1.5 py-1 rounded cursor-pointer hover:bg-secondary text-[13px]', active === node.path && 'bg-secondary')} style={{ paddingLeft: depth * 12 + 21 }}>
      <span className="truncate">{node.name}</span>
    </div>
  )
}

export default function Workbench({ session }) {
  const [tree, setTree] = useState([])
  const [diffs, setDiffs] = useState([])
  const [tab, setTab] = useState('files')
  const [openFile, setOpenFile] = useState(null)
  const [diffFile, setDiffFile] = useState(null)
  const [view, setView] = useState('code')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState(session._initial || '')
  const [streaming, setStreaming] = useState(false)
  const chatRef = useRef(null)

  const refresh = () => {
    fetch('/fs/tree?id=' + session.id).then((r) => r.json()).then(setTree).catch(() => {})
    fetch('/session/diff?id=' + session.id).then((r) => r.json()).then(setDiffs).catch(() => {})
  }
  useEffect(() => {
    setOpenFile(null); setDiffFile(null); setView('code'); setTab('files')
    refresh(); fetch('/session/history?id=' + session.id).then((r) => r.json()).then(setMessages)
  }, [session.id])
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, [messages])

  const openCode = (path) => { setView('code'); fetch('/fs/read?id=' + session.id + '&file=' + encodeURIComponent(path)).then((r) => r.json()).then((d) => setOpenFile({ path, content: d.content })) }
  const openDiff = (d) => { setView('diff'); setDiffFile(d) }

  const send = () => {
    const msg = input.trim(); if (!msg || streaming) return
    setInput(''); setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '' }]); setStreaming(true)
    let acc = ''
    const es = new EventSource('/chat?session=' + session.id + '&msg=' + encodeURIComponent(msg))
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data)
      if (e.type === 'chunk') acc += e.text
      else if (e.type === 'tool') acc += '\n[tool] ' + e.name + '\n'
      else if (e.type === 'done') { es.close(); setStreaming(false); refresh(); return }
      else return
      setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', text: acc }; return c })
    }
    es.onerror = () => { es.close(); setStreaming(false) }
  }

  return (
    <div className="flex-1 flex min-w-0">
      <div className="w-56 border-r bg-card flex flex-col">
        <div className="flex text-xs border-b">
          <button onClick={() => setTab('files')} className={cn('flex-1 py-2', tab === 'files' ? 'font-semibold border-b-2 border-primary' : 'text-muted-foreground')}>文件</button>
          <button onClick={() => setTab('changes')} className={cn('flex-1 py-2', tab === 'changes' ? 'font-semibold border-b-2 border-primary' : 'text-muted-foreground')}>改动 {diffs.length ? '(' + diffs.length + ')' : ''}</button>
        </div>
        <div className="flex-1 overflow-auto p-1">
          {tab === 'files'
            ? tree.map((n) => <TreeNode key={n.path} node={n} depth={0} onOpen={openCode} active={openFile && openFile.path} />)
            : (diffs.length ? diffs.map((d) => (
                <div key={d.file} onClick={() => openDiff(d)} className={cn('flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-secondary text-[13px]', diffFile && diffFile.file === d.file && view === 'diff' && 'bg-secondary')}>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" /><span className="truncate">{d.file}</span>
                </div>
              )) : <div className="text-xs text-muted-foreground p-3">还没有改动</div>)}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-9 border-b flex items-center px-3 text-xs text-muted-foreground gap-3 font-mono">
          {view === 'diff' && diffFile ? <span>◑ {diffFile.file} · 当前 vs {session.base}</span> : openFile ? <span>{openFile.path}</span> : <span>从左侧选择文件 / 改动</span>}
        </div>
        <div className="flex-1 min-h-0">
          {view === 'diff' && diffFile ? (
            <DiffEditor height="100%" language={langOf(diffFile.file)} original={diffFile.base} modified={diffFile.work} theme="vs" options={{ readOnly: true, renderSideBySide: true, fontSize: 12, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
          ) : openFile ? (
            <Editor height="100%" language={langOf(openFile.path)} value={openFile.content} theme="vs" options={{ readOnly: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm px-6 text-center">选择一个文件查看代码,或在「改动」里看 agent 改了什么(Monaco diff)</div>
          )}
        </div>
      </div>

      <div className="w-[360px] border-l bg-card flex flex-col min-h-0">
        <div ref={chatRef} className="flex-1 overflow-auto p-3 flex flex-col gap-2.5">
          {messages.length === 0 && <div className="text-xs text-muted-foreground p-2">在这个 worktree({session.branch})里跟 agent 对话,它改的文件会出现在左侧「改动」。</div>}
          {messages.map((m, i) => (
            <div key={i} className={cn('max-w-[92%] px-3 py-2 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap', m.role === 'user' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-secondary font-mono')}>{m.text || '…'}</div>
          ))}
        </div>
        <div className="p-2.5 border-t">
          <div className="flex items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="让 agent 在这个 worktree 干活…" rows={2} className="flex-1 resize-none outline-none bg-transparent text-[13px]" />
            <Button size="icon" disabled={streaming} onClick={send}>↑</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
