# 3-Style Drill

A blindfolded **3-style** commutator trainer for the 3×3 Rubik's cube, with live smart-cube
support over Web Bluetooth (GAN gen1–4). Letter pairs appear on screen; execute the commutator
and the next pair shows up automatically. Supports Speffz and Chichu (彳亍) lettering, corner &
edge drilling, per-case subset selection, and live algorithm hints from [blddb.net](https://blddb.net).

The app is a fully client-side React SPA (no backend) — all data lives in `localStorage`.

## Development environment

The whole app lives in the [`frontend/`](./frontend) folder.

### Prerequisites

- **Node.js ≥ 18** (tested on 20). Install via [nodejs.org](https://nodejs.org) or [nvm](https://github.com/nvm-sh/nvm):
  ```bash
  nvm install 20 && nvm use 20
  ```
- **Yarn (classic, v1)** — enable it through Corepack (bundled with Node), or install globally:
  ```bash
  corepack enable          # recommended
  # or:
  npm install -g yarn
  ```

### Setup & run

```bash
cd frontend
yarn install     # install dependencies
yarn start       # dev server with hot reload → http://localhost:3000
```

### Other commands

```bash
yarn build                      # production build into frontend/build
yarn deploy                     # build + publish to GitHub Pages (gh-pages)
node src/lib/cube.test.mjs      # run the cube-engine unit tests
```

> **Web Bluetooth** requires a secure context (`https://` or `http://localhost`) and a
> Chromium-based browser (Chrome/Edge). It is not available in Firefox/Safari.

See [`DEPLOY_GITHUB_PAGES.md`](./DEPLOY_GITHUB_PAGES.md) for deployment details.
