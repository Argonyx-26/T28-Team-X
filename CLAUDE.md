# GuruGraph: rules for the build (ARGONYX '26, Team X / T28)

Multi-agent diagnosis of Class 6–7 fraction misconceptions. FastAPI + SQLite API, Next.js 16 web, Gemini on Vertex AI.
Read first: README.md, docs/API.md (the contract), GEMINI.md (design system), frontend/AGENTS.md (Next 16 changes).

## Rules
- Everything in this repo was made during the event (25 Sep 11:00 → 26 Sep 11:00). Never paste in older material.
- Honesty: no invented users, pilots, quotes or savings. Every number carries n and method; statistics only from docs/research/EVIDENCE.md. Label simulated students, sample pages, cached answers and template fallbacks in the UI.
- The live demo must never break: main stays deployable, API changes are additive, the golden path stays green.
- Secrets live in backend/.env (gitignored). Never print, log or commit them. Working notes go in .notes/ (gitignored).
- Don't rewrite working subsystems, swap frameworks or databases, or change IAM. SQLite stays.

## Commands
```
cd backend && .venv/Scripts/python -m pytest -q && .venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
cd frontend && npx tsc --noEmit && npm run lint && npm run build
cd backend && .venv/Scripts/python -m app.tools smoke <API_URL>        # 8 steps against a live API, own class
cd backend && PYTHONIOENCODING=utf-8 .venv/Scripts/python -m app.evals photos   # or: typed, verifier
cd e2e && npm test                                                        # golden-path browser test (Playwright)
```
Windows: use backend/.venv/Scripts/python; set PYTHONIOENCODING=utf-8 when printing ₹ or Kannada.

## Deploy protocol (Cloud Run, project project-b3549f11-8db5-4ca2-9e4, asia-south1)
1. Gate: pytest, ruff check + format, tsc, lint, build, smoke test, golden-path test.
2. API: `gcloud run deploy gurugraph-api --source . --region asia-south1 --no-traffic --tag next` → smoke-test the tag URL → `gcloud run services update-traffic gurugraph-api --to-latest --region asia-south1` → warm, then reset from /present.
3. Web: `gcloud run deploy gurugraph-web --source frontend --region asia-south1 --no-traffic --tag next --set-build-env-vars API_URL=https://gurugraph-api-215071922486.asia-south1.run.app` → golden-path test against the tag URL → switch traffic.
4. Every API redeploy wipes SQLite (data and AI cache): the cache seed in data/llm_cache_seed.jsonl loads at boot; warm and reset afterwards.
5. Public links (video etc.) live in frontend/lib/site.ts; feature flags in frontend/lib/flags.ts and backend settings.
