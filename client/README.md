# KL Placement Readiness — frontend

React 18 + Vite + Tailwind. This repository is the deployable frontend; it is
published from the `client/` directory of the main repository
(`backendhigherstudies`), where development happens. Do not edit here — edit
there and run `npm run push:client`.

## How it reaches the backend

The image serves the built app with nginx and **proxies `/api` and `/uploads`
to the backend**, so the browser only ever talks to this origin. No CORS, and
the session cookie behaves exactly as when Express serves the bundle itself.

| Variable       | Meaning                                              | Default                                              |
|----------------|------------------------------------------------------|------------------------------------------------------|
| `API_UPSTREAM` | Backend host name, no scheme. Changed without rebuild | `bl2mqfd6tm3nk2az3xl36mpo.187.127.135.148.sslip.io` |

## Deploy on Coolify

New resource → Public repository → this repo, branch `main`, build pack
**Dockerfile**, port **80**. Set `API_UPSTREAM` if the backend moves.

Then set `APP_URL` on the **backend** to this frontend's address, so links in
sign-in emails open here.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to http://localhost:4000
```
