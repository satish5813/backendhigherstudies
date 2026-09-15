# KL Placement Follow-up

The placement cell's chase list, as its own small app. One campus at a time
(Vijayawada by default): how many students have created a profile, how many
have not, whose resume scores what, and how to reach the ones who have not
turned up. Admin sign-in only — students who sign in here are told so.

It is published from the `followup/` directory of the main repository
(`backendhigherstudies`); edit there and run `npm run push:followup`.

## How it reaches the backend

The app only ever calls relative `/api` paths. `vercel.json` rewrites them to
the backend at Vercel's edge, so there is nothing to configure in Vercel — no
environment variables. The backend address lives in that one file.

## Deploy on Vercel

Import this repository. Vercel detects Vite; no settings needed.

## Local development

```bash
npm install
npm run dev      # http://localhost:5174, proxies /api to http://localhost:4000
```
