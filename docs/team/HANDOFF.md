# Handoff: state at 23:10, Fri 25 Sep

## Live
| What | Where |
|---|---|
| App (Cloud Run `gurugraph-web`) | https://gurugraph-web-215071922486.asia-south1.run.app |
| API (Cloud Run `gurugraph-api`) | https://gurugraph-api-215071922486.asia-south1.run.app (see `/docs`; contract in `docs/API.md`) |

**GCP project:** `project-b3549f11-8db5-4ca2-9e4`, region `asia-south1`, paid from the $300 credit. Everything runs on Gemini on Vertex AI.

**Deploys, checks and rules** are in [CLAUDE.md](../../CLAUDE.md). The admin token lives only in `backend/.env` (gitignored) and in the presenter's browser.

## Screens
| Screen | Route | What it does |
|---|---|---|
| Landing | `/` | the red-pen demo, the loop, the agents' debate, live numbers, a QR to join 7B |
| For judges | `/judges` | a six-stop tour, every number with its n and method, how it's built |
| Class dashboard | `/teacher/7B` | graph, heatmap, live agent feed, the morning digest, Coach vs Analyst plan, approve, worksheet, student sheet with a Kannada parent voice note, projector view (P) |
| Scan one notebook | `/teacher/7B/scan` | the wrong line circled on the photo or the transcript, each line's exact value, the arithmetic proof, "any other fraction problem", teacher confirm or correct |
| Snap notebooks | `/teacher/7B/snap` | the rear camera captures each page by itself; the roll number files it; unassigned tray; seconds per notebook |
| Notebook pile | `/teacher/7B/pile` | reads 6 photos at a time (gallery) |
| Student | `/join/7B?as=asha` | Kannada quiz → Fix this now → lesson → 2 retries → gap closed; **Check my homework** (red pen in the child's language, Listen, Send to my parent) |
| School view | `/school/demo` | 7A, 7B, 7C: classes × concepts, top mistakes, which class needs which re-teach (7A and 7C simulated) |
| Create a class | `/teacher/new` | a name gives a join code, a QR and a teacher link; paste a roll list |
| Presenter | `/present` | reset, warm every demo beat, health, the demo tabs, notes (needs the admin token) |

## Checks (last run 23:10)
- Backend: 217 tests, ruff clean. Frontend: tsc, lint and build clean.
- Browser tests (`e2e/`): golden path, homework check and snap mode (Chrome's fake camera), 7 of 7 passing on the live URL three times in a row.
- Lighthouse on the live URL, mobile: performance 99 (`/`), 98 (`/judges`), 90 (`/join/7B`), 90 (scan); accessibility 100 on all nine pages checked.

## Numbers (all on `/judges` with n and method)
Real phone photos 6/6 wrong step and 6/6 mistake, still 6/6 rotated, compressed, shrunk or darkened; the verifier alone 12/12, 8/8, 8/8 on 12 labelled pages by 3 writers; typed-answer fallback 27/30; load: 440 requests, 0 errors, p95 180 ms; ₹3.64 per student per month.

## Waiting on the team (data, not code)
1. **Handwritten pages from all three writers**, with "Roll n" at the top, 1–3 problems per page, some planted mistakes, and the right answers and mistakes written down before any model run. Each page photographed twice as files (not WhatsApp photos). They go in `data/evidence/photos/` with rows in `data/evidence/labels.csv`.
2. **A stopwatch time for marking 10 notebooks by hand**, and the same 10 in snap mode on a phone, to compare seconds per notebook (an internal test, labelled so).
3. **A native-speaker check** of the Kannada and Hindi lessons (`docs/research/LESSONS_REVIEW.md`) and of the new homework strings.
4. The Raah project id, and the deck format.

## Pitch
- `docs/pitch/DEMO_SCRIPT.md`: 5 minutes, all three speak, with a Wi-Fi fallback.
- `docs/pitch/QA.md`: hard questions with honest answers, the mentors' objection first.
- `docs/pitch/screens/`: screenshots of every new flow.
- `docs/SCALE.md`: class to district, cost at scale, privacy by design.
