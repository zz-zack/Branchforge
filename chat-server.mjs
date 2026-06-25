// chat-server.mjs — BranchForge 多会话对话工作台。
// 每个 session = 一个 git worktree + 一段可恢复(resume)的 Claude Code 对话。
// 多会话管理 + 多轮对话 + 每会话 diff/闸门,落盘持久化。零 Electron。
// 用法(从能解析 @anthropic-ai/claude-agent-sdk 的目录跑): node chat-server.mjs  开 http://localhost:8788

import http from 'node:http'
import { URL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'

const PORT = Number(process.env.PORT || 8788)
const STORE = join(process.cwd(), '.forge-sessions.json')
const OFFICE_DIR = join(process.cwd(), 'office')
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

let sessions = {}
try { if (existsSync(STORE)) sessions = JSON.parse(readFileSync(STORE, 'utf8')) } catch (e) {}
function save() { try { writeFileSync(STORE, JSON.stringify(sessions)) } catch (e) {} }
function id() { return Math.random().toString(36).slice(2, 8) }
const aborters = {}

function resolveRepo(repo) {
  if (!repo) throw new Error('请填项目路径或仓库 URL')
  if (/^(https?:|git@)/.test(repo)) {
    const name = repo.replace(/\.git$/, '').split(/[\/:]/).pop()
    const dir = join(homedir(), '.forge-repos', name)
    if (!existsSync(dir)) {
      mkdirSync(join(homedir(), '.forge-repos'), { recursive: true })
      execFileSync('git', ['clone', repo, dir], { encoding: 'utf8' })
    }
    return dir
  }
  try { git(repo, ['rev-parse', '--is-inside-work-tree']) } catch (e) {
    throw new Error('不是本地 git 仓库: ' + repo + ' (请填磁盘上的 git 项目路径,或一个仓库 URL)')
  }
  return repo
}

function createSession(repoIn, title) {
  const repo = resolveRepo(repoIn)
  const sid = id()
  const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = 'forge/s-' + sid
  const wt = join(repo, '.forge', 'wt-' + sid)
  try { git(repo, ['worktree', 'remove', '--force', wt]) } catch (e) {}
  try { git(repo, ['branch', '-D', branch]) } catch (e) {}
  try { git(repo, ['worktree', 'add', '-b', branch, wt, base]) } catch (e) {}
  sessions[sid] = { id: sid, title: title || ('session ' + sid), repo, base, branch, worktree: wt, sdk: null, history: [], cost: 0 }
  save()
  return sessions[sid]
}

function gateOf(cwd) {
  let files = []
  try { files = readdirSync(cwd) } catch (e) { return null }
  if (!files.some((f) => /\.test\.(c|m)?js$/.test(f))) return null
  try { execFileSync('node', ['--test'], { cwd, encoding: 'utf8', stdio: 'pipe' }); return 'PASS' } catch (e) { return 'FAIL' }
}
function diffFiles(s) {
  try { git(s.worktree, ['add', '-A']); const st = git(s.worktree, ['diff', '--cached', '--numstat', s.base]); return st ? st.split('\n').filter(Boolean).length : 0 } catch (e) { return 0 }
}

async function chat(s, msg, emit) {
  s.history.push({ role: 'user', text: msg })
  const ac = new AbortController(); aborters[s.id] = ac
  const opts = { cwd: s.worktree, permissionMode: 'bypassPermissions', abortController: ac }
  if (s.sdk) opts.resume = s.sdk
  let assistant = ''
  try {
    const res = query({ prompt: msg, options: opts })
    for await (const m of res) {
      if (m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'text') { assistant += b.text; emit({ type: 'chunk', text: b.text }) }
          else if (b.type === 'tool_use') emit({ type: 'tool', name: b.name })
        }
      } else if (m.type === 'result') { s.sdk = m.session_id; s.cost += m.total_cost_usd || 0 }
    }
  } catch (e) { emit({ type: 'error', message: String(e) }) }
  delete aborters[s.id]
  s.history.push({ role: 'assistant', text: assistant })
  save()
  emit({ type: 'turn-done', files: diffFiles(s), gate: gateOf(s.worktree), cost: s.cost })
}

async function runAgentText(prompt, cwd) {
  let text = '', cost = 0
  const res = query({ prompt, options: { cwd, permissionMode: 'bypassPermissions' } })
  for await (const m of res) {
    if (m.type === 'assistant') { for (const b of m.message.content) if (b.type === 'text') text += b.text }
    else if (m.type === 'result') cost = m.total_cost_usd || 0
  }
  return { text, cost }
}

// Lead:评估目标 -> 决定单工作区还是拆成并行 parts(只产出 JSON 计划,不改 repo)
async function leadPlan(repo, goal) {
  resolveRepo(repo)
  const tmp = mkdtempSync(join(homedir(), '.forge-lead-'))
  const prompt = 'You are a tech lead. Goal: ' + goal + '\n\n' +
    'Decide if this needs ONE workspace or should split into INDEPENDENT parallel parts (isolated agents, disjoint files). ' +
    'Prefer ONE unless the goal clearly has separable pieces buildable in parallel. ' +
    'Output ONLY JSON: {"mode":"single"|"parallel","reason":"short","parts":[{"id":"a","title":"short","task":"what to do"}]}'
  const r = await runAgentText(prompt, tmp)
  let plan
  try { plan = JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]) } catch (e) { plan = { mode: 'single', reason: 'fallback', parts: [{ id: 'a', title: goal.slice(0, 30), task: goal }] } }
  plan.cost = r.cost || 0
  return plan
}

// 批准后:为每个 part 自动建会话(worktree)并并行跑,带预算 kill-switch
async function orchestrate(repo, plan, budget, emit) {
  let spent = plan.cost || 0
  const abort = new AbortController()
  async function runPart(p) {
    if (abort.signal.aborted) { emit({ type: 'part-done', id: p.id, skipped: true }); return }
    const s = createSession(repo, p.title)
    emit({ type: 'session-created', id: s.id, title: s.title, branch: s.branch })
    await chat(s, p.task, (e) => { if (e.type === 'turn-done') emit({ type: 'part-done', id: p.id, sid: s.id, files: e.files, gate: e.gate, cost: e.cost }) })
    spent += s.cost
    if (spent > budget && !abort.signal.aborted) { emit({ type: 'kill' }); abort.abort() }
  }
  const cap = Math.min(3, plan.parts.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(cap, plan.parts.length) }, async () => {
    while (i < plan.parts.length) { const idx = i++; await runPart(plan.parts[idx]) }
  }))
  emit({ type: 'orchestrate-done', spent })
}

const HTML = `<!doctype html><html lang="zh"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>BranchForge Chat</title>
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:#0f172a;color:#e2e8f0;font-family:system-ui,"PingFang SC",sans-serif;display:flex}
.side{width:264px;border-right:1px solid #334155;display:flex;flex-direction:column;padding:14px;gap:8px}
.side h1{font-size:18px;margin:0 0 2px}.side .sub{color:#94a3b8;font-size:12px;margin:0 0 8px}
input,textarea{padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:13px;font-family:inherit}
input:focus,textarea:focus{outline:none;border-color:#7c3aed}
button{padding:8px 12px;border-radius:6px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-size:13px}
button:disabled{opacity:.5}
.slist{flex:1;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-top:6px}
.sitem{padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;cursor:pointer;font-size:13px}
.sitem.on{border-color:#7c3aed;background:#241b4d}
.sitem .b{font-family:ui-monospace,monospace;font-size:11px;color:#94a3b8}
.main{flex:1;display:flex;flex-direction:column}
.bar{padding:10px 16px;border-bottom:1px solid #334155;font-size:13px;color:#94a3b8;display:flex;gap:14px;align-items:center}
.badge{padding:2px 9px;border-radius:999px;font-size:12px}
.b-pass{background:#14532d}.b-fail{background:#7f1d1d}
.chat{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:78%;padding:10px 12px;border-radius:10px;white-space:pre-wrap;font-size:14px;line-height:1.55}
.u{align-self:flex-end;background:#4c1d95}
.a{align-self:flex-start;background:#1e293b;border:1px solid #334155;font-family:ui-monospace,Menlo,monospace;font-size:13px}
.foot{padding:12px 16px;border-top:1px solid #334155;display:flex;gap:8px}
.foot textarea{flex:1;resize:none;height:44px}
.empty{color:#64748b;margin:auto;font-size:14px}
</style></head><body>
<div class="side">
  <h1>BranchForge</h1><p class="sub">多会话对话工作台</p>
  <input id="repo" placeholder="项目根目录(git 仓库)"/>
  <button onclick="newSession()">+ 新会话</button>
  <input id="goal" placeholder="大目标(Lead 自动编排)" style="margin-top:6px"/>
  <button onclick="planGoal()">规划并运行</button>
  <div class="slist" id="slist"></div>
</div>
<div class="main">
  <div class="bar" id="bar"><span>选择或新建一个会话</span></div>
  <div class="chat" id="chat"><div class="empty">每个会话 = 一个隔离 worktree + 一段可恢复的对话</div></div>
  <div class="foot">
    <textarea id="msg" placeholder="跟这个会话说点什么…(Enter 发送)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();send()}"></textarea>
    <button id="sendb" onclick="send()">发送</button><button onclick="stop()" style="margin-left:6px;background:#7f1d1d">停止</button>
  </div>
</div>
<script>
var cur=null, streaming=false;
function api(p){return fetch(p).then(function(r){return r.json()})}
function loadSessions(){
  api('/sessions').then(function(list){
    var el=document.getElementById('slist');el.innerHTML='';
    list.forEach(function(s){
      var d=document.createElement('div');d.className='sitem'+(cur===s.id?' on':'');
      d.innerHTML='<div>'+s.title+'</div><div class="b">'+s.branch+' . '+s.turns+' turns . $'+(s.cost||0).toFixed(3)+'</div>';
      d.onclick=function(){selectSession(s)};el.appendChild(d);
    });
  });
}
function newSession(){
  var repo=document.getElementById('repo').value;if(!repo)return;
  fetch('/session/new?repo='+encodeURIComponent(repo)+'&title='+encodeURIComponent('session')).then(function(r){return r.json()}).then(function(s){
    cur=s.id;loadSessions();selectSession(s);
  });
}
function selectSession(s){
  cur=s.id;loadSessions();
  document.getElementById('bar').innerHTML='<span style="font-family:ui-monospace">'+s.branch+'</span><span id="diff"></span><span id="gate"></span><button onclick="mergeSession()" style="margin-left:auto;padding:4px 12px">合并到主干</button><span id="mergeres" style="margin-left:8px"></span>';
  api('/session/history?id='+s.id).then(function(h){
    var c=document.getElementById('chat');c.innerHTML='';
    h.forEach(function(m){addMsg(m.role,m.text)});
    if(!h.length)c.innerHTML='<div class="empty">开始对话吧</div>';
  });
}
function addMsg(role,text){
  var c=document.getElementById('chat');
  if(c.querySelector('.empty'))c.innerHTML='';
  var d=document.createElement('div');d.className='msg '+(role==='user'?'u':'a');d.textContent=text;c.appendChild(d);
  c.scrollTop=c.scrollHeight;return d;
}
function send(){
  if(!cur||streaming)return;
  var ta=document.getElementById('msg');var msg=ta.value.trim();if(!msg)return;ta.value='';
  addMsg('user',msg);streaming=true;document.getElementById('sendb').disabled=true;
  var bubble=addMsg('assistant','');var acc='';
  var es=new EventSource('/chat?session='+cur+'&msg='+encodeURIComponent(msg));
  es.onmessage=function(ev){
    var e=JSON.parse(ev.data);
    if(e.type==='chunk'){acc+=e.text;bubble.textContent=acc;}
    else if(e.type==='tool'){acc+='\\n[tool] '+e.name+'\\n';bubble.textContent=acc;}
    else if(e.type==='turn-done'){
      var diff=document.getElementById('diff');if(diff)diff.textContent='+'+e.files+' files';
      var gate=document.getElementById('gate');if(gate&&e.gate)gate.innerHTML='<span class="badge '+(e.gate==='PASS'?'b-pass':'b-fail')+'">'+e.gate+'</span>';
    }
    else if(e.type==='error'){acc+='\\n[error] '+e.message;bubble.textContent=acc;}
    else if(e.type==='done'){es.close();streaming=false;document.getElementById('sendb').disabled=false;loadSessions();}
    document.getElementById('chat').scrollTop=document.getElementById('chat').scrollHeight;
  };
  es.onerror=function(){es.close();streaming=false;document.getElementById('sendb').disabled=false;};
}
function planGoal(){
  var repo=document.getElementById('repo').value, goal=document.getElementById('goal').value;
  if(!repo||!goal)return;
  var c=document.getElementById('chat');c.innerHTML='<div class="empty">Lead 规划中…</div>';
  fetch('/plan?repo='+encodeURIComponent(repo)+'&goal='+encodeURIComponent(goal)).then(function(r){return r.json()}).then(function(p){showPlan(repo,p)}).catch(function(){c.innerHTML='<div class="empty">规划失败</div>'});
}
function showPlan(repo,p){
  var c=document.getElementById('chat');c.innerHTML='';
  var box=document.createElement('div');box.className='msg a';
  var t='Lead 计划('+p.mode+'): '+(p.reason||'')+'\\n\\n';
  (p.parts||[]).forEach(function(pt){t+='. ['+pt.id+'] '+pt.title+' — '+pt.task+'\\n'});
  box.textContent=t;c.appendChild(box);
  var btn=document.createElement('button');btn.style.margin='4px 0';btn.textContent='批准并并行运行 '+(p.parts||[]).length+' 个工作区';
  btn.onclick=function(){runPlan(repo,p)};c.appendChild(btn);
}
function runPlan(repo,p){
  var c=document.getElementById('chat');c.innerHTML='';
  var log=document.createElement('div');log.className='msg a';log.textContent='编排中…\\n';c.appendChild(log);
  var es=new EventSource('/orchestrate?repo='+encodeURIComponent(repo)+'&budget=1.5&plan='+encodeURIComponent(JSON.stringify(p)));
  es.onmessage=function(ev){
    var e=JSON.parse(ev.data);
    if(e.type==='session-created'){log.textContent+='+ 工作区 '+e.title+' ('+e.branch+')\\n';loadSessions();}
    else if(e.type==='part-done'){log.textContent+='. part '+e.id+(e.skipped?' skipped':(' done — +'+e.files+' files'+(e.gate?(' . gate '+e.gate):'')+' . $'+(e.cost||0).toFixed(3)))+'\\n';loadSessions();}
    else if(e.type==='kill'){log.textContent+='!! 预算超限,kill-switch\\n';}
    else if(e.type==='orchestrate-done'){log.textContent+='\\n编排完成,总成本 $'+(e.spent||0).toFixed(3)+'。点左侧会话看详情、继续对话。';es.close();loadSessions();}
    else if(e.type==='error'){log.textContent+='[error] '+e.message;es.close();}
    c.scrollTop=c.scrollHeight;
  };
  es.onerror=function(){es.close()};
}
loadSessions();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost')
  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    try { res.end(readFileSync(join(process.cwd(), 'ui', 'index.html'))) }
    catch (e) { try { res.end(readFileSync(join(process.cwd(), 'home.html'))) } catch (e2) { res.end(HTML) } }
    return
  }
  if (u.pathname.startsWith('/assets/')) {
    try {
      const data = readFileSync(join(process.cwd(), 'ui', u.pathname))
      const ext = u.pathname.split('.').pop()
      const ct = ext === 'js' ? 'text/javascript' : ext === 'css' ? 'text/css' : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': ct }); res.end(data)
    } catch (e) { res.writeHead(404); res.end('not found') }
    return
  }
  if (u.pathname === '/sessions') {
    const list = Object.values(sessions).map((s) => ({ id: s.id, title: s.title, repo: s.repo, branch: s.branch, cost: s.cost, turns: s.history.length }))
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(list)); return
  }
  if (u.pathname === '/session/new') {
    try { const s = createSession(u.searchParams.get('repo'), u.searchParams.get('title')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s)) }
    catch (e) { res.writeHead(400); res.end(String(e)) }
    return
  }
  if (u.pathname === '/session/history') {
    const s = sessions[u.searchParams.get('id')]
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s ? s.history : [])); return
  }
  if (u.pathname === '/session/interrupt') {
    const ac = aborters[u.searchParams.get('id')]
    if (ac) ac.abort()
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: !!ac })); return
  }
  if (u.pathname === '/session/merge') {
    const s = sessions[u.searchParams.get('id')]
    if (!s) { res.writeHead(404); res.end('no session'); return }
    try {
      try { git(s.worktree, ['add', '-A']); git(s.worktree, ['commit', '-q', '-m', 'forge session ' + s.id]) } catch (e) {}
      git(s.repo, ['checkout', s.base])
      const out = git(s.repo, ['merge', '--no-ff', '-m', 'merge ' + s.branch, s.branch])
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, out }))
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }))
    }
    return
  }
  if (u.pathname === '/chat') {
    const s = sessions[u.searchParams.get('session')]
    if (!s) { res.writeHead(404); res.end('no session'); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const emit = (e) => res.write('data: ' + JSON.stringify(e) + '\n\n')
    await chat(s, u.searchParams.get('msg') || '', emit)
    emit({ type: 'done' }); res.end(); return
  }
  if (u.pathname === '/plan') {
    try { const p = await leadPlan(u.searchParams.get('repo'), u.searchParams.get('goal')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(p)) }
    catch (e) { res.writeHead(400); res.end(String(e)) }
    return
  }
  if (u.pathname === '/orchestrate') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const emit = (e) => res.write('data: ' + JSON.stringify(e) + '\n\n')
    try { await orchestrate(u.searchParams.get('repo'), JSON.parse(u.searchParams.get('plan')), Number(u.searchParams.get('budget') || 1.0), emit) }
    catch (e) { emit({ type: 'error', message: String(e) }) }
    emit({ type: 'done' }); res.end(); return
  }
  if (u.pathname === '/office') { res.writeHead(302, { Location: '/office/' }); res.end(); return }
  if (u.pathname.startsWith('/office/')) {
    const rel = u.pathname === '/office/' ? 'index.html' : u.pathname.slice(8)
    try {
      const data = readFileSync(join(OFFICE_DIR, rel))
      const ext = rel.split('.').pop()
      const ct = ext === 'html' ? 'text/html; charset=utf-8' : ext === 'js' ? 'text/javascript' : ext === 'png' ? 'image/png' : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': ct }); res.end(data)
    } catch (e) { res.writeHead(404); res.end('not found') }
    return
  }
  res.writeHead(404); res.end('not found')
})
server.listen(PORT, () => console.log('BranchForge chat -> http://localhost:' + PORT))
