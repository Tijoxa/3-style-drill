# Frontend — 3-Style Drill

This project is built with [React 19](https://react.dev) and [Vite 5](https://vitejs.dev).

## Available Scripts

In the `frontend` directory, you can run:

### `bun dev` (or `bun start`)

Runs the app in development mode using Vite with Instant Hot Module Replacement (HMR).\
Open [http://localhost:5173](http://localhost:5173) to view it in your browser.

### `bun run build`

Builds the app for production to the `build` folder using Vite.\
It correctly bundles React in production mode and optimizes the build for the best performance.

Output is stored in `build/` (matching GitHub Pages deployment requirements).

### `bun test`

Runs the deterministic unit suite for cube logic, lettering and subsets, BLDDB caching,
spaced repetition, seeded randomness, and commutator notation.

### `bun run preview`

Locally previews the production build stored in `build/`.

### `bun run deploy`

Builds the app with Vite and publishes the `build` folder to the `gh-pages` branch.

## Project Structure

- `index.html` — Entry point for Vite.
- `vite.config.js` — Vite configuration (React plugin, path alias `@`, relative base path, build target).
- `src/` — React application source code.
- `src/vendor/smartcube` — Vendored Web Bluetooth smart-cube library.
