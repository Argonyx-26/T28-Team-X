# Handoff: state at 16:50, Fri 25 Sep

## Live
| What | Where |
|---|---|
| App (Cloud Run `gurugraph-web`) | https://gurugraph-web-215071922486.asia-south1.run.app |
| API (Cloud Run `gurugraph-api`) | https://gurugraph-api-215071922486.asia-south1.run.app (see `/docs`) |

**GCP project:** `project-b3549f11-8db5-4ca2-9e4`, region `asia-south1`. Everything is paid from the free $300 credit. There is no Nebius: it needs a card, so everything runs on Gemini.

**Admin token:** `PROD_ADMIN_TOKEN` in `backend/.env` on Samartha's laptop. It is never committed.

**Deploy commands** (run from the repo root):
```
gcloud run deploy gurugraph-api --source . --region asia-south1 --project project-b3549f11-8db5-4ca2-9e4
gcloud run deploy gurugraph-web --source frontend --region asia-south1 --project project-b3549f11-8db5-4ca2-9e4 --set-build-env-vars API_URL=https://gurugraph-api-215071922486.asia-south1.run.app
```

**Checks:**
- Smoke test: `cd backend && .venv/Scripts/python -m app.tools smoke https://gurugraph-api-215071922486.asia-south1.run.app` (8 steps).
- Reset the demo class: `POST /admin/reset` with the header `X-Admin-Token`.

## Done (all tested on the live app)
**Screens:**

| Screen | Route | What it does |
|---|---|---|
| Teacher dashboard | `/teacher/7B` | Graph, heatmap, live agent feed. Coach vs Analyst debate → Approve → printable worksheet. Student sheet with a Kannada parent message and voice note. Projector view |
| Scan screen | `/teacher/7B/scan` | Red-pen circle on the wrong line, an exact-arithmetic proof, one-tap teacher confirm or correct, sample notebooks |
| Student flow | `/join/7B?as=asha` | Kannada quiz → "Fix this now" → lesson → 2 retries → gap closed |
| Notebook pile | `/teacher/7B/pile` | Reads 6 photos at a time into a live grid, then a summary |
| Worksheet | `/teacher/7B/worksheet?concept=C4&tag=add_denominators` | Printable sheet for the re-teach group |
| Judges numbers | `GET /judges/summary` | See below |

**The `/judges` numbers:**
- 37 verified questions.
- Typed-answer eval: 27/30.
- AI cost ₹3.64 per student per month (measured, `data/evals/unit_costs.json`).
- Teacher agreement.
- Live photo time.

**Backend:** 114 tests, CI green. Photo reads are hedged across two Gemini models. There are 24 pre-generated lessons (en/hi/kn), and `docs/research/LESSONS_REVIEW.md` is waiting for a native reader.

**Docs:**
- `README.md` (the full story, evals, runbook).
- `docs/research/EVIDENCE.md` (sourced statistics).
- `docs/API.md` (the API contract).
- Team playbooks: `docs/team/RISHABH.md` and `docs/team/RISHEETH.md`.

## Left, in priority order
1. **Real handwriting.** Risheeth uploads the 24 card photos to `data/evidence/photos/` (names like `A_P1_1.jpg`, labels in `data/evidence/labels.csv`). Then run `cd backend && .venv/Scripts/python -m app.evals photos` and put the results in the README and on `/judges`. So far only generated samples have been tested: 10 of 10 correct.
2. **Mentor round at 18:30.** Run the demo once at about 18:10 on the live link to warm the saved AI answers: scan Asha → dashboard → "Plan tomorrow's lesson" → Asha on a phone. Reset right before.
3. **Rishabh:** the landing page `/`, `/judges`, Raah (script, events, badge, status page; `data-domain` must be our domain), polish, and screenshots for the deck. He shouldn't edit `app/teacher/[code]/**` or `app/join/**`, which Samartha's AI owns.
4. **Risheeth:**
   - the 60-second mentor script;
   - check the Kannada and Hindi lessons and labels;
   - verify the top evidence items;
   - the deck (the organizers send the ~8-slide format tonight), the 5:00 script and Q&A;
   - the video at 3:15 AM.
5. **Evening (optional):** drop the live "median photo time" from `/judges` once the photo eval exists (our own testing inflates it). Then hardening, and the 12:30 AM freeze. At 3 AM the full path must pass 3 times in a row.

## Competitors (read-only scan, 15:30)
- **Same-idea edtech rivals:**
  - T27 "Misconception Mapper": multiple-choice + confidence, English only. Its default mode serves canned AI answers, and its first commit, 90 minutes in, was 26,000 lines.
  - T12 "LearnLens": text answers, item-response-theory scoring, a trained classifier, no UI.
  - T29 "Knowledge Twin": its AI isn't implemented.
  - T17: empty files.
- **Strongest team overall:** T14 "ARGUS" (security). Real footage, measured results, and a full pitch pack already done.
- **13 org repos are empty,** so those teams are working elsewhere or haven't started.
- **Our edge:** we start from the handwritten notebook (the exact wrong step), work in Kannada and Hindi with a parent voice note, have agents with a binding veto, the teacher has the last word, it's live, and the numbers come with n and method.
- **Business:** lead with budget private schools. Karnataka's coaching share is only 8.2%.
