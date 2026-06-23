// server.mjs — BranchForge 本地 Web 产品(M5 的「可用产品」,零 Electron)。
// Node HTTP 服务:浏览器输入任务 -> 后台跑 harness(隔离worktree+并行治理+验证内循环)
// -> SSE 把每个 worktree 的流式输出/闸门/diff/成本实时推到页面。
// 用法(从能解析 @anthropic-ai/claude-agent-sdk 的目录跑): node server.mjs   然后开 http://localhost:8787

import http from 'node:http'
import { URL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { query } from '@anthropic-ai/claude-agent-sdk'

const PORT = Number(process.env.PORT || 8787)
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

function runGate(cwd) {
  let files = []
  try { files = readdirSync(cwd) } catch { return { gated: false } }
  if (!files.some((f) => /\.test\.(c|m)?js$/.test(f))) return { gated: false }
  try {
    execFileSync('node', ['--test'], { cwd, encoding: 'utf8', stdio: 'pipe' })
    return { gated: true, passed: true }
  } catch (e) {
    return { gated: true, passed: false, out: ((e.stdout || '') + (e.stderr || '')).slice(-1200) }
  }
}

async function runHarness(opts, emit) {
  const { repo, task, variants, budget, maxFix } = opts
  const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  let spent = 0
  const abort = new AbortController()
  emit({ type: 'start', variants, budget, base })

  async function runVariant(letter) {
    if (abort.signal.aborted) { emit({ type: 'ws', id: letter, status: 'skipped' }); return }
    const branch = 'forge/' + letter
    const wt = repo + '/.forge/wt-' + letter
    try { git(repo, ['worktree', 'remove', '--force', wt]) } catch (e) {}
    try { git(repo, ['branch', '-D', branch]) } catch (e) {}
    try { git(repo, ['worktree', 'add', '-b', branch, wt, base]) } catch (e) {}
    emit({ type: 'ws', id: letter, status: 'running', branch })
    let cost = 0, sid = null, lastFail = '', gate = { gated: false }, attempt = 0
    for (attempt = 1; attempt <= maxFix; attempt++) {
      if (abort.signal.aborted) break
      const prompt = attempt === 1 ? task : 'Tests failed. Fix the code so they pass. Output:\n' + lastFail
      const qo = { cwd: wt, permissionMode: 'bypassPermissions', abortController: abort }
      if (sid) qo.resume = sid
      emit({ type: 'ws', id: letter, status: 'streaming' })
      try {
        const res = query({ prompt, options: qo })
        for await (const m of res) {
          if (m.type === 'assistant') {
            for (const b of m.message.content) {
              if (b.type === 'text') emit({ type: 'chunk', id: letter, text: b.text })
              else if (b.type === 'tool_use') emit({ type: 'tool', id: letter, name: b.name })
            }
          } else if (m.type === 'result') { sid = m.session_id; cost += m.total_cost_usd || 0 }
        }
      } catch (e) { break }
      gate = runGate(wt)
      emit({ type: 'gate', id: letter, gated: gate.gated, passed: gate.passed, attempt })
      if (!gate.gated || gate.passed) break
      lastFail = gate.out
    }
    spent += cost
    if (spent > budget && !abort.signal.aborted) { emit({ type: 'kill' }); abort.abort() }
    let files = 0, diff = ''
    try { git(wt, ['add', '-A']); const s = git(wt, ['diff', '--cached', '--numstat', base]); files = s ? s.split('\n').filter(Boolean).length : 0; diff = git(wt, ['diff', '--cached', base]).slice(0, 4000) } catch (e) {}
    emit({ type: 'result', id: letter, branch, cost, attempts: attempt, gate: !gate.gated ? 'none' : gate.passed ? 'PASS' : 'FAIL', files, diff })
  }

  const cap = Math.min(variants, 3)
  const letters = Array.from({ length: variants }, (_, i) => String.fromCharCode(97 + i))
  let i = 0
  await Promise.all(Array.from({ length: Math.min(cap, letters.length) }, async () => {
    while (i < letters.length) { const idx = i++; await runVariant(letters[idx]) }
  }))
  emit({ type: 'done', spent })
}

const HTML = `<!doctype html><html lang="zh"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>BranchForge</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui,"PingFang SC",sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px}
h1{margin:0 0 2px;font-size:24px}.sub{color:#94a3b8;font-size:13px;margin:0 0 16px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
input{padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:14px}
input:focus{outline:none;border-color:#7c3aed}
button{padding:8px 16px;border-radius:6px;border:none;background:#7c3aed;color:#fff;cursor:pointer;font-size:14px}
button:disabled{opacity:.5;cursor:default}
.bar{height:6px;background:#1e293b;border-radius:999px;overflow:hidden;margin:6px 0 16px}
.bar > i{display:block;height:100%;background:#7c3aed;width:0}
.grid{display:grid;gap:12px;grid-template-columns:1fr 1fr}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
.card{border:1px solid #334155;border-radius:8px;background:#1e293b;padding:12px}
.ch{display:flex;justify-content:space-between;align-items:center}
.br{font-weight:600;font-family:ui-monospace,monospace}
.badge{padding:2px 9px;border-radius:999px;font-size:12px;background:#1e40af}
.b-await{background:#854d0e}.b-pass{background:#14532d}.b-fail{background:#7f1d1d}.b-skip{background:#475569}
.meta{color:#94a3b8;font-size:12px;margin:4px 0}
.log{background:#0b1220;border-radius:6px;padding:8px;max-height:200px;overflow:auto;font-size:12px;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;margin-top:6px}
</style></head><body><div class="wrap">
<h1>BranchForge</h1><p class="sub">Git-native Agentic Harness — 输入任务,看并行 agent 在隔离 worktree 里干活</p>
<div class="row">
<input id="repo" placeholder="项目根目录(git 仓库)" style="width:240px"/>
<input id="task" placeholder="任务描述" style="flex:1;min-width:200px"/>
<input id="variants" type="number" value="2" min="1" max="6" style="width:64px" title="variants"/>
<input id="budget" type="number" value="0.5" step="0.1" style="width:72px" title="budget USD"/>
<button id="run" onclick="start()">Run</button>
</div>
<div class="bar"><i id="costbar"></i></div>
<div class="grid" id="grid"></div>
</div>
<script>
var nodes={}, budget=0.5, spent=0;
function badge(s){return s==='PASS'?'b-pass':s==='FAIL'?'b-fail':s==='awaiting'?'b-await':s==='skipped'?'b-skip':''}
function render(){
  var g=document.getElementById('grid');g.innerHTML='';
  Object.keys(nodes).forEach(function(id){
    var n=nodes[id], c=document.createElement('div');c.className='card';
    var st=n.gate||n.status||'';
    c.innerHTML='<div class="ch"><span class="br">'+(n.branch||('forge/'+id))+'</span><span class="badge '+badge(st)+'">'+st+'</span></div>'+
      '<div class="meta">'+(n.files!=null?('+'+n.files+' files . '):'')+(n.attempts?('try '+n.attempts+' . '):'')+'$'+(n.cost||0).toFixed(4)+'</div>'+
      '<pre class="log">'+(n.log||'...')+'</pre>';
    g.appendChild(c);
  });
  document.getElementById('costbar').style.width=Math.min(100,spent/budget*100)+'%';
}
function start(){
  var repo=document.getElementById('repo').value, task=document.getElementById('task').value;
  if(!repo||!task)return;
  budget=parseFloat(document.getElementById('budget').value)||0.5; spent=0; nodes={}; render();
  document.getElementById('run').disabled=true;
  var q='repo='+encodeURIComponent(repo)+'&task='+encodeURIComponent(task)+'&variants='+document.getElementById('variants').value+'&budget='+budget;
  var es=new EventSource('/run?'+q);
  es.onmessage=function(ev){
    var e=JSON.parse(ev.data);
    if(e.type==='start'){budget=e.budget;}
    else if(e.type==='ws'){nodes[e.id]=nodes[e.id]||{log:''};nodes[e.id].status=e.status;if(e.branch)nodes[e.id].branch=e.branch;}
    else if(e.type==='chunk'){nodes[e.id]=nodes[e.id]||{log:''};nodes[e.id].log+=e.text;}
    else if(e.type==='tool'){nodes[e.id]=nodes[e.id]||{log:''};nodes[e.id].log+='\\n[tool] '+e.name+'\\n';}
    else if(e.type==='gate'){nodes[e.id].gate=e.gated?(e.passed?'PASS':'FAIL'):'';}
    else if(e.type==='result'){var n=nodes[e.id];n.branch=e.branch;n.cost=e.cost;n.files=e.files;n.attempts=e.attempts;n.gate=e.gate;spent+=e.cost;}
    else if(e.type==='done'){es.close();document.getElementById('run').disabled=false;}
    render();
  };
  es.onerror=function(){es.close();document.getElementById('run').disabled=false;};
}
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost')
  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(HTML)
    return
  }
  if (u.pathname === '/run') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const emit = (e) => res.write('data: ' + JSON.stringify(e) + '\n\n')
    try {
      await runHarness({
        repo: u.searchParams.get('repo'),
        task: u.searchParams.get('task'),
        variants: Number(u.searchParams.get('variants') || 2),
        budget: Number(u.searchParams.get('budget') || 0.5),
        maxFix: 3,
      }, emit)
    } catch (e) { emit({ type: 'error', message: String(e) }) }
    res.end()
    return
  }
  res.writeHead(404)
  res.end('not found')
})
server.listen(PORT, () => console.log('BranchForge UI -> http://localhost:' + PORT))
