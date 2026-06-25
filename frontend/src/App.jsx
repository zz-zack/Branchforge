import { useState, useEffect, useRef } from 'react'
import { Button } from './components/ui/button'
import { Card, CardContent } from './components/ui/card'
import { cn } from './lib/utils'

export default function App() {
  const [sessions, setSessions] = useState([])
  const [cur, setCur] = useState(null)
  const [messages, setMessages] = useState([])
  const [repo, setRepo] = useState('')
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef(null)
  const repoRef = useRef(null)

  const loadSessions = () => fetch('/sessions').then((r) => r.json()).then(setSessions).catch(() => {})
  useEffect(() => { loadSessions() }, [])
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])

  const openSession = (s) => { setCur(s); fetch('/session/history?id=' + s.id).then((r) => r.json()).then(setMessages) }
  const newSession = () => { setCur(null); setMessages([]) }

  const send = async () => {
    const msg = input.trim()
    if (!msg || streaming) return
    let s = cur
    if (!s) {
      if (!repo) { repoRef.current && repoRef.current.focus(); return }
      s = await fetch('/session/new?repo=' + encodeURIComponent(repo) + '&title=' + encodeURIComponent(msg.slice(0, 24))).then((r) => r.json())
      if (s.error) { alert(s.error); return }
      setCur(s); setMessages([]); loadSessions()
    }
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: msg }, { role: 'assistant', text: '' }])
    setStreaming(true)
    let acc = ''
    const es = new EventSource('/chat?session=' + s.id + '&msg=' + encodeURIComponent(msg))
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data)
      if (e.type === 'chunk') acc += e.text
      else if (e.type === 'tool') acc += '\n[tool] ' + e.name + '\n'
      else if (e.type === 'done') { es.close(); setStreaming(false); loadSessions(); return }
      else return
      setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: 'assistant', text: acc }; return c })
    }
    es.onerror = () => { es.close(); setStreaming(false) }
  }

  const turns = sessions.reduce((a, s) => a + (s.turns || 0), 0)
  const cost = sessions.reduce((a, s) => a + (s.cost || 0), 0)

  return (
    <div className="flex h-full">
      <aside className="w-64 border-r bg-card flex flex-col p-3 gap-1">
        <div className="flex items-center gap-2 px-2 py-3 font-bold"><span className="text-primary text-lg">✳</span> BranchForge</div>
        <Button variant="outline" className="justify-start" onClick={newSession}>＋ 新建会话</Button>
        <div className="text-xs text-muted-foreground px-2 mt-4 mb-1">最近会话</div>
        <div className="flex-1 overflow-auto flex flex-col gap-0.5">
          {sessions.slice().reverse().map((s) => (
            <button key={s.id} onClick={() => openSession(s)} className={cn('flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left hover:bg-secondary', cur && cur.id === s.id && 'bg-secondary')}>
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" /><span className="truncate">{s.title}</span>
            </button>
          ))}
        </div>
        <a href="/office" target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-accent bg-secondary hover:opacity-90">⌗ 团队视图 · 并行 worktree</a>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div ref={scrollRef} className="flex-1 overflow-auto px-[8%]">
          {!cur ? (
            <Home sessions={sessions} turns={turns} cost={cost} />
          ) : (
            <div className="max-w-3xl mx-auto py-7 flex flex-col gap-3.5">
              {messages.map((m, i) => (
                <div key={i} className={cn('max-w-[84%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap', m.role === 'user' ? 'self-end bg-primary text-primary-foreground rounded-br-sm' : 'self-start bg-card border font-mono text-[13px] rounded-bl-sm')}>{m.text || '…'}</div>
              ))}
            </div>
          )}
        </div>

        <div className="px-[8%] pb-5 pt-3 bg-gradient-to-t from-background to-transparent">
          <div className="max-w-3xl mx-auto bg-card border rounded-2xl shadow-sm p-2.5">
            <div className="flex flex-wrap gap-1.5 items-center mb-2">
              <Chip>📁 <input ref={repoRef} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="项目路径 / 仓库URL" className="bg-transparent outline-none text-xs w-40" /></Chip>
              <Chip>⎇ {cur ? cur.branch : 'main'}</Chip>
              <Chip>◍ ワークツリー</Chip>
              <Chip>✦ Opus 4.8 · 高</Chip>
            </div>
            <div className="flex items-end gap-2">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} placeholder="描述任务,或问点什么…(Enter 发送)" rows={1} className="flex-1 resize-none outline-none bg-transparent text-sm py-1 max-h-36" />
              <Button size="icon" disabled={streaming} onClick={send}>↑</Button>
            </div>
          </div>
        </div>
      </main>

      <div className="fixed right-6 bottom-5 text-3xl pointer-events-none animate-bounce">🦊</div>
    </div>
  )
}

function Chip({ children }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-secondary border rounded-full px-2.5 py-1">{children}</span>
}

function Home({ sessions, turns, cost }) {
  const tiles = [['会话', sessions.length], ['消息', turns], ['累计成本', '$' + cost.toFixed(2)], ['分支', sessions.length]]
  const heat = Array.from({ length: 26 * 5 }, (_, i) => { const lv = (i * 7 + turns * 3) % 11; return lv > 8 ? 0.9 : lv > 5 ? 0.55 : lv > 2 ? 0.28 : 0.08 })
  return (
    <div className="max-w-2xl mx-auto pt-16 pb-10">
      <div className="text-[26px] font-bold flex items-center gap-2.5"><span className="text-primary text-2xl">✳</span> 你好,接下来做点什么?</div>
      <div className="text-muted-foreground text-sm mt-1.5 mb-7">描述一个任务交给一个会话,或开个大目标让团队并行开干。</div>
      <Card>
        <CardContent>
          <div className="flex gap-4 text-[13px] text-muted-foreground mb-4"><b className="text-foreground">概览</b><span>本地工作区</span></div>
          <div className="grid grid-cols-4 gap-2.5 mb-4">
            {tiles.map((t) => (<div key={t[0]} className="bg-secondary border rounded-xl px-3.5 py-3"><div className="text-[11.5px] text-muted-foreground">{t[0]}</div><div className="text-xl font-bold mt-0.5">{t[1]}</div></div>))}
          </div>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(26,1fr)' }}>
            {heat.map((a, i) => (<div key={i} className="aspect-square rounded-[3px]" style={{ background: `hsl(var(--primary) / ${a})` }} />))}
          </div>
          <div className="text-muted-foreground text-[12.5px] mt-3.5">你已经和 AI 协作了 {turns} 轮,在 {sessions.length} 个隔离分支里干活 —— 对外只是一个开发者。</div>
        </CardContent>
      </Card>
    </div>
  )
}
