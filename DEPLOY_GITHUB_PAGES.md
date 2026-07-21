# Deploying to GitHub Pages

This app is fully client-side (no backend needed): training stats and settings are
stored in `localStorage`, and the smart-cube library runs in the browser via Web Bluetooth.
The smart-cube library is **vendored** (pre-compiled) into `frontend/src/vendor/smartcube`,
so the project builds anywhere without any install-time build step.

## Option A — Automatic (GitHub Actions, recommended)
1. Push this repo to GitHub with the default branch named `main`.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow at `.github/workflows/deploy.yml` builds `frontend/` and publishes it on every push to `main`.
4. Your site will be at `https://<user>.github.io/<repo>/`.

## Option B — Manual (`gh-pages` branch)
```bash
cd frontend
yarn install
yarn deploy        # builds and pushes ./build to the gh-pages branch
```
Then set **Settings → Pages → Source: Deploy from a branch → gh-pages / (root)**.

## Notes
- `frontend/package.json` sets `"homepage": "."`, so assets load correctly from any sub-path.
- **Web Bluetooth requires HTTPS** (GitHub Pages is HTTPS ✔) and works on Chrome/Edge on
  desktop or Android. It is **not supported on iOS/Safari** — the manual move buttons /
  keyboard still work there.
- Only the `frontend/` folder is deployed; the `backend/` template is unused.
