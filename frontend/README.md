# BranchForge frontend (React + Vite + Tailwind + shadcn + Monaco)

The desktop-style GUI for BranchForge. Talks to `chat-server.mjs` over its HTTP/SSE API
(`/sessions`, `/chat`, `/fs/tree`, `/fs/read`, `/session/diff`, `/orchestrate`).

- **Home**: warm dashboard + composer (project path + task → opens a session).
- **Workbench (IDE)**: file tree · Monaco editor (read-only view) · Monaco diff (agent's
  worktree changes vs base) · agent chat on the right.
- **Team view**: `/office` (PixiJS pixel office) for parallel-worktree orchestration.

## Build & deploy

The build is a static bundle (no CDN at runtime — everything is bundled, so it works
offline / behind broken DNS). `chat-server.mjs` serves `ui/` at `/` and `/assets/*`.

```bash
cd frontend
npm install                 # via proxy if needed: HTTPS_PROXY=... npm install
npx vite build              # -> dist/
cp -R dist/* ../path-to-server/ui/   # where chat-server runs (process.cwd()/ui)
```

`dist/` and `node_modules/` are gitignored. The repo's `web/ui/` (built output) is also
gitignored — rebuild from source.

## Stack notes

- shadcn-style components in `src/components/ui/` (cva + `cn()`), theme tokens via CSS
  variables in `src/index.css` (warm palette, coral primary).
- Monaco is loaded **locally** (no CDN) — see `src/monaco-setup.js` (workers via Vite
  `?worker`, `loader.config({ monaco })`).
