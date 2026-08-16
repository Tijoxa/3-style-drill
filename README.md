# 3-Style Drill

A blindfolded **3-style** commutator trainer for the 3×3 Rubik's cube, with live smart-cube
support over Web Bluetooth (GAN gen1–4). Letter pairs appear on screen; execute the commutator
and the next pair shows up automatically. Supports Speffz and Chichu (彳亍) lettering, corner &
edge drilling, per-case subset selection, and live algorithm hints from [blddb.net](https://blddb.net).

The app is a fully client-side React SPA (no backend) — all data lives in `localStorage`.

## Development environment

The whole app lives in the [`frontend/`](./frontend) folder and is powered by **Vite**.

### Prerequisites

- **Bun** (recommended, specified in `package.json`) or **Node.js ≥ 18** (with npm/yarn/pnpm):
  - [Install Bun](https://bun.sh) (`powershell -c "irm bun.sh/install.ps1"` on Windows, `curl -fsSL https://bun.sh/install` on macOS/Linux).

### Setup & run

```bash
cd frontend
bun install     # install dependencies
bun dev         # start Vite dev server with fast HMR → http://localhost:5173
```

### Other commands

```bash
bun run build                   # production build with Vite into frontend/build
bun run preview                 # preview production build locally
bun run deploy                  # build + publish to GitHub Pages (gh-pages)
bun test                        # run the frontend unit test suite
```

> **Web Bluetooth** requires a secure context (`https://` or `http://localhost`) and a
> Chromium-based browser (Chrome/Edge). It is not available in Firefox/Safari.

See [`DEPLOY_GITHUB_PAGES.md`](./DEPLOY_GITHUB_PAGES.md) for deployment details.
