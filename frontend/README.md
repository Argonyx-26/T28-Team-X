# GuruGraph frontend

Next.js 16 (App Router) + React 19 + Tailwind 4, deployed to Cloud Run as `gurugraph-web`.

| Route | What it is |
|---|---|
| `/` | Landing page: the red-pen demo, the loop, the agents' debate, live numbers, a QR code to join class 7B |
| `/judges` | A 90-second tour, every number from `GET /judges/summary` with its n and method, how it's built |
| `/teacher/[code]` | Class dashboard: knowledge graph, heatmap, agent feed, Coach vs Analyst plan, projector view |
| `/teacher/[code]/scan` | Scan one notebook: the wrong step circled in red pen, with the arithmetic proof |
| `/teacher/[code]/pile` | Read a pile of notebooks, six at a time |
| `/teacher/[code]/worksheet` | Printable worksheet for an approved re-teach plan |
| `/join/[code]` | Student flow in English, Hindi or Kannada |

## Run it

```bash
cp .env.local.example .env.local   # API_URL points at a local API (default port 8010)
npm install
npm run dev
```

Every API call goes through the `/backend/*` rewrite in `next.config.ts`. Without `API_URL`, it falls back to the live API.

## Deploy

From the repo root:

```bash
gcloud run deploy gurugraph-web --source frontend --region asia-south1 \
  --set-build-env-vars API_URL=https://gurugraph-api-215071922486.asia-south1.run.app,NEXT_PUBLIC_RAAH_PID=<raah project id>
```

## Checks before a commit

`npx tsc --noEmit`, `npm run lint` and `npm run build` must be clean. The design rules are in `../GEMINI.md`.
