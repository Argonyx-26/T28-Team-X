# Team X (T28): who did what, and how

## Roles
| Who | Role at the event |
|---|---|
| **Samartha Puthraya K** | Lead engineer: the agents, the API, the rules engine, the web app, evaluations, deployment. From Friday evening, owner of the whole codebase. |
| **Rishabh Arun** | Early frontend scaffolding and design direction; from Friday evening: handwriting data (photographed pages), timings, demo screenshots and the pitch. From about 03:20 on Saturday, he drove the build on the same machine with Claude Code (the round 2 pages, the final audit fixes, the deck and the demo video), so the last commits carry his name. |
| **Risheeth S** | Research and the sourced evidence brief, the handwriting evidence cards and labels, the Kannada and Hindi review, the deck, the demo script and Q&A. From about 23:25 on Friday night until about 03:20, he took over the build on the same machine and continued it with Claude Code, so the commits in that window carry his name. |

## How we built it
- **Everything was made during the 24-hour window** (25 Sep 11:00 → 26 Sep 11:00). The commit history is the record.
- **Contract first.** `docs/API.md` was written before the screens; every screen reads the live API (no fixtures).
- **Rules decide, models perceive.** Exact fraction arithmetic marks right or wrong, opens and closes gaps and audits every plan; Gemini only reads handwriting and writes language.
- **Everything measured.** Every AI call carries telemetry; the evaluation numbers on `/judges` come from `data/evals/results.json`, produced by `python -m app.evals`, with labels written before the model ran.
- **Deploy often.** Two Cloud Run services; the API smoke test and the browser golden-path test gate every traffic switch.

## AI tools we used, honestly
- **Claude Code (Anthropic)** wrote most of the backend, the web app, the tests and the docs from our prompts and reviews. From Friday evening it worked as a pair on the whole repo: with Samartha until about 23:25, then with Risheeth, and from about 03:20 with Rishabh, each on the same machine.
- **Google Antigravity and Gemini** were used for early frontend scaffolding and for design critiques of screenshots.
- **The demo video** was made with Claude Code: the app footage is recorded from the live app, the animation is built with Remotion, the narration is an AI voice (Gemini text-to-speech) and the background music is AI-generated (Lyria on Vertex AI).
- **Gemini on Vertex AI** is the model inside the product (reading photos, writing lessons, plans and parent messages), and **Chirp 3 HD** speaks the voice notes.
- Every change was reviewed and tested by us before it was pushed; the test suite and the browser test run in CI and before every deploy.
