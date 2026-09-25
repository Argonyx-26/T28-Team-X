# Team X (T28): who did what, and how

## Roles
| Who | Role at the event |
|---|---|
| **Samartha Puthraya K** | Lead engineer: the agents, the API, the rules engine, the web app, evaluations, deployment. From Friday evening, owner of the whole codebase. |
| **Rishabh Arun** | Early frontend scaffolding and design direction; from Friday evening: handwriting data (photographed pages), timings, demo screenshots and the pitch. |
| **Risheeth S** | Research and the sourced evidence brief, the handwriting evidence cards and labels, the Kannada and Hindi review, the deck, the demo script and Q&A. From about 23:25 on Friday night, he took over the build on the same machine and continued it with Claude Code, so later commits carry his name. |

## How we built it
- **Everything was made during the 24-hour window** (25 Sep 11:00 → 26 Sep 11:00). The commit history is the record.
- **Contract first.** `docs/API.md` was written before the screens; every screen reads the live API (no fixtures).
- **Rules decide, models perceive.** Exact fraction arithmetic marks right or wrong, opens and closes gaps and audits every plan; Gemini only reads handwriting and writes language.
- **Everything measured.** Every AI call carries telemetry; the evaluation numbers on `/judges` come from `data/evals/results.json`, produced by `python -m app.evals`, with labels written before the model ran.
- **Deploy often.** Two Cloud Run services; the API smoke test and the browser golden-path test gate every traffic switch.

## AI tools we used, honestly
- **Claude Code (Anthropic)** wrote most of the backend, the web app, the tests and the docs from our prompts and reviews. From Friday evening it worked as a pair on the whole repo: with Samartha until about 23:25, then with Risheeth, who took over the same session and machine.
- **Google Antigravity and Gemini** were used for early frontend scaffolding and for design critiques of screenshots.
- **Gemini on Vertex AI** is the model inside the product (reading photos, writing lessons, plans and parent messages), and **Chirp 3 HD** speaks the voice notes.
- Every change was reviewed and tested by us before it was pushed; the test suite and the browser test run in CI and before every deploy.
