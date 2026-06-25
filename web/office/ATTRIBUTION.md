# Office prototype — assets & attribution

The "team office" visualization (`index.html`) is a standalone prototype: a 2D pixel
office where each AI engineer = a worktree session, the Lead reviews finished work in a
queue, and approved work walks a PR to the `main` board (rejected work goes back to rework).

## Why assets aren't committed

The pixel characters are **Liberated Pixel Cup (LPC)** spritesheets, which are multi-licensed
(**CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0**) and **require attribution + share-alike**. To keep
this repo's licensing clean, the binaries are not committed — fetch them locally instead:

```bash
bash fetch-assets.sh        # downloads pixi.min.js + assets/*.png
python3 -m http.server 8911 # then open http://localhost:8911
```

## Credits

- **Characters**: Universal LPC Spritesheet — https://github.com/jrconway3/Universal-LPC-spritesheet
  (Liberated Pixel Cup; CC-BY-SA 3.0 / GPL 3.0). Contributors per the LPC project.
- **Renderer**: [PixiJS](https://pixijs.com/) (MIT).

If LPC art ships in a distributed build, include the LPC attribution file alongside it.

## Status

Prototype with fake data (buttons drive the scene). Next step: drive it from the real
`chat-server.mjs` orchestrate SSE — `session-created → spawn`, `part-done(gate) → ✓/✗ badge`,
`Lead review → real git merge / re-prompt rework`.
