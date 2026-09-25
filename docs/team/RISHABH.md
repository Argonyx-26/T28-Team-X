# Rishabh: frontend + UI (you own Best UI/UX)

**Your tool is Google Antigravity** (antigravity.google), Google's free agentic IDE.
- **Why not Gemini CLI:** its free tier ended on 18 June 2026, when Google replaced it with Antigravity.
- **What's free:** the Individual plan comes with a weekly quota, and it includes **Gemini 3.1 Pro** and **Claude Sonnet/Opus 4.6**.
- **The browser agent** can open our pages, resize them and screenshot them. That's how you'll check every screen at 360 px without doing it by hand.
- **Rules load automatically:** Antigravity reads `GEMINI.md` at the repo root (our rules and design system) into every prompt.

**Which model:**

| Model | Use it for |
|---|---|
| **Claude Opus 4.6** | the design-heavy steps: F3 scan, F5 dashboard, F6 debate, and the screenshot critiques |
| **Gemini 3.1 Pro** | everything else |
| Flash models | tiny edits only |

If a model says its quota is used up, switch to another model in the dropdown and carry on.

**How to work:**
- Use **Planning mode** for every F-step: the agent writes a plan, you skim it and press Proceed.
- Paste **one prompt at a time**, and run the **Check** before moving on.
- If something breaks, paste the exact error back: "Fix this error: …".
- Stuck for more than 20 min? Tell the team chat.
- **If the weekly quota runs out:** tell Samartha. He'll give your Google account access to our GCP project, and you switch to Gemini CLI on Vertex AI (paid from our $300 credit):
  ```
  npm i -g @google/gemini-cli
  gcloud auth application-default login
  set GOOGLE_GENAI_USE_VERTEXAI=true
  set GOOGLE_CLOUD_PROJECT=project-b3549f11-8db5-4ca2-9e4
  set GOOGLE_CLOUD_LOCATION=global
  gemini
  ```
  The same prompts work there.

> **Change at 1:30 PM: the teacher dashboard `/teacher/[code]` is DONE (built by Samartha's Claude; open `/teacher/7B`)** (the graph, heatmap, agent feed, debate panel, parent message and voice note). It lives only in `frontend/app/teacher/[code]/page.tsx` and `frontend/app/teacher/[code]/_dashboard/`. **Don't create or edit those files.** Skip F5 and F6, and skip the `/teacher/[code]` shell in F1. You still own everything else, including `/teacher/[code]/scan`, the shared design tokens and fonts in `globals.css`/`layout.tsx`, and `lib/`. The dashboard reads your CSS variables (`--ink`, `--red-pen`, …) when they exist. If a `git pull` ever conflicts on a dashboard file, keep Samartha's version: `git checkout --theirs <file> && git add <file>`.

## 0. Setup (10 min)
1. Install Antigravity from antigravity.google and sign in with your personal Google account.
2. Install the Antigravity browser extension when it asks. It lets the agent test pages.
3. Clone the repo:
   ```
   cd C:\dev
   git clone https://github.com/Argonyx-26/T28-Team-X.git
   ```
4. In Antigravity, open the folder `C:\dev\T28-Team-X`. In the agent panel, ask: "What rules are you following for this project?" It should summarise GEMINI.md (the notebook design system, `docs/API.md` as the contract).
5. **Scaffold the app.** If you already made `frontend/`, skip to step 6. Otherwise run this in the terminal:
   ```
   npx create-next-app@latest frontend --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
   cd frontend
   npx shadcn@latest init -d
   npx shadcn@latest add button card input badge progress dialog sheet tabs sonner skeleton tooltip
   npm i lucide-react motion qrcode.react react-markdown
   ```
6. **After every step that passes its Check:**
   ```
   git add -A && git commit -m "<what you built>" && git pull --rebase && git push
   ```

**Review prompt.** Use this after every build step. It's the biggest quality lever:
> Review everything you changed in the last step against GEMINI.md (the design system and quality bar) and docs/API.md (the types). List every problem: visual, accessibility, 360 px layout, missing states, type mismatches. Then fix them all, and run `npm run build` and `npm run lint` until both are clean.

**Screenshot critique.** Use it on every screen at least once, with Claude Opus 4.6. The dev server must be running (`npm run dev` in `frontend/`):
> Use the browser to open http://localhost:3000<route> at 360×740 and at 1440×900, and screenshot both. Critique them like a senior product designer against GEMINI.md: hierarchy, spacing, alignment, typography, colour use, Kannada text rendering, and whether it feels like a teacher's notebook rather than a generic dashboard. List the 8 biggest issues in priority order, fix them, then screenshot again and show me before and after.

---

## F1 (now → ~1:30): the foundation
> Read GEMINI.md and docs/API.md. In `frontend/`, set up the foundation. Don't build pages yet beyond simple shells.
> 1. The design system from GEMINI.md:
>    - the colour tokens as CSS variables in `app/globals.css`, mapped into the Tailwind theme;
>    - the squared-paper page background;
>    - the fonts Hind, Noto Sans Kannada and Kalam via `next/font/google`, exposed as `font-sans`, `font-kn` and `font-hand`.
>
>    Update the shadcn theme variables so buttons, cards and inputs use our tokens (ink primary, 10 px control radius, 18 px card radius).
> 2. `lib/types.ts`: copy every type from docs/API.md exactly.
> 3. `lib/api.ts`: one typed function per endpoint in docs/API.md, using `fetch("/backend/...", {cache: "no-store"})`. Parse `{error:{code,message}}` into a thrown `ApiError`. The photo upload uses `FormData`. When `process.env.NEXT_PUBLIC_USE_FIXTURES === "1"`, return data from `lib/fixtures.ts` after a 400 ms delay.
> 4. `lib/fixtures.ts`: realistic fixtures for every response type. Use class 7B with 31 students, including Asha (kind demo, language kn) and 30 simulated Indian first names; 8 concepts C1–C8 named as in docs/API.md; and the focus concept C4 with add_denominators as the top mistake for 9 students. Include a PhotoResponse for "3/4 + 1/4" with steps `["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"]` and `error_step: 2`, and an AnalyzeResponse with draft → Analyst "revise" ("Only 9 of 31 students show 'added the denominators too' on Adding and subtracting fractions; re-teaching everyone wastes the period. Split the class.") → revised → accept.
> 5. `lib/i18n.ts`: the student UI strings in en, hi and kn (join, question N of M, check answer, correct, not quite, the answer is, lesson, "Try 2 more to close this gap", gap closed, keep practising, "your teacher has been notified", loading, error, retry). Write natural Hindi and Kannada a 12-year-old understands.
> 6. `next.config.ts`: rewrite `/backend/:path*` to `${process.env.API_URL}/:path*`.
> 7. Route shells with the right layout and a heading only: `/`, `/join/[code]`, `/teacher/[code]`, `/teacher/[code]/scan`, `/judges`. Add `app/error.tsx` (a kind error card, which also calls `window.reportError?.(error)`) and `app/not-found.tsx`.
> 8. `.env.local.example` with `API_URL=http://localhost:8000` and `NEXT_PUBLIC_USE_FIXTURES=1`.
>
> Run `npm run build` and fix everything until it passes.

**Check:**
1. Copy `.env.local.example` to `.env.local`, then run `npm run dev`.
2. Every route opens.
3. The paper grid and the fonts show.
4. The build is green.

**Deploy it now.** This gives the team a URL early.
```
npm i -g vercel
cd frontend
vercel
vercel env add NEXT_PUBLIC_USE_FIXTURES production   (value: 1 for now)
vercel --prod
```
When `vercel` asks, pick a new project named `gurugraph`. Use the Vercel CLI only; the GitHub import needs an org admin. Post the URL in the chat.

---

## F2 (~1:30 → 2:30): the student flow, `/join/[code]`
> Build the student flow at `/join/[code]` for phones (360 px first). Follow GEMINI.md and use `lib/api.ts` only.
> 1. **Join screen:** the class name (from `lookupSession`), a nickname input, and three big language buttons: English / हिन्दी / ಕನ್ನಡ. Save `student_id` and the language in localStorage (key per class code). If `?as=asha` is in the URL, auto-join with nickname "Asha" and language kn, then skip straight to the quiz.
> 2. **Question screen:** "Question N of 5", a progress bar, and the stem in large type. MCQ options are full-width 56 px tap targets. Typed questions get an input with `inputMode="text"` and a hint like "e.g. 3/4 or 1 1/2", plus a Check button. The whole screen uses the student's language (`lib/i18n.ts`); the maths stays as written.
> 3. **Feedback card** after each answer:
>    - correct: a green tick that animates in, then "Correct!";
>    - wrong: a red-pen underline on the student's answer, the `label` in plain words, and "The answer is X".
>
>    Then a Next button. **If the answer has `gap_opened: true`, also show a primary "Fix this now" button**. It goes straight to the lesson and the 2 retries (step 4), then back to the quiz. This is the demo path: the judge playing Asha taps one wrong answer and reaches "Gap closed" in under a minute.
> 4. **When `next` returns `done`**, call `curatorLesson`. While `generating`, show a friendly skeleton ("Your mini-lesson is being written…") and poll every 1.5 s. When `ready`, render the lesson:
>    - the markdown in the student's language, with a Kalam heading and the Kannada font for kn;
>    - a small language badge; show "English (translation unavailable)" if `translated` is false;
>    - the 3 practice items, each hiding its answer until tapped.
> 5. **"Try 2 more to close this gap"** leads to the 2 retry questions (same components), then `examinerRetry`. If `gap_closed`: a celebration (a highlighter swipe over "Gap closed" plus a small confetti burst, respecting reduced motion). Otherwise "Keep practising", with "Your teacher has been notified".
> 6. **If the lesson status is `none`:** "You're all caught up!"
> 7. **States:** skeletons while loading; if the class code is unknown, "Ask your teacher for the class code"; on network errors, a retry button. Never lose progress on refresh.
>
> Check it at 360 × 740 in Chrome device mode and fix any overflow.

**Check:** on fixtures, the whole flow clicks through on your phone via the Vercel URL, in Kannada. Then run the review prompt and the screenshot critique.

---

## F3 (~2:30 → 3:30): the scan screen, `/teacher/[code]/scan`
> Build `/teacher/[code]/scan`, a phone screen for the teacher.
> 1. A student picker (from the dashboard's `heatmap.students`, default Asha) and a question picker (from `getTopic().photo_questions`, default P1). Show the question stem.
> 2. A big "Scan notebook" button using `<input type="file" accept="image/*" capture="environment">`, with an image preview and a Submit button. During upload, show a scanning animation over the photo (a light line sweeping down).
> 3. **The result view.** This is the hero moment of the demo:
>    - The transcribed `steps`, one per line, in Kalam at 22–26 px on a lined-paper card, like the student's notebook.
>    - An SVG **red-pen ellipse that draws itself** around line `error_step` (stroke `--red-pen`, width 3, a slightly irregular hand-drawn path, `stroke-dashoffset` animation over 600 ms).
>    - A red-pen margin note in Kalam with the `label`, e.g. "added the denominators too".
>    - Below it, the confidence as a small bar, then the telemetry chip (`provider · model · 1.2 s · ₹0.04`).
>    - If `correct`: a green tick instead of the circle.
>    - If `needs_typed_answer`: "I couldn't read this clearly, so please type the final answer", a typed input, and a submit that calls the answer endpoint for that student.
> 4. **Buttons:** "Scan next" and "Open class dashboard".
>
> It must look stunning at 360 px, and on a projector when mirrored.

**Check:** on fixtures, the ellipse draws around line 2. Run the review prompt and the screenshot critique.

---

## F4 (when Samartha posts the API URL, ~3:30): go live
```
vercel env rm NEXT_PUBLIC_USE_FIXTURES production
vercel env add API_URL production   (value: the API URL Samartha posts)
vercel --prod
```
Locally, set the same in `.env.local`, then paste this:
> Fixtures are off now. Walk every page against the real API. For each call, compare the real JSON with `lib/types.ts`, and fix any mismatch in the UI (not in the types, unless docs/API.md changed). Then add Raah analytics: put the script snippet I paste below in the root layout, and create `lib/raah.ts` with `track(name, props)`, which calls `window.raah?.track?.(name, props)` safely. Send these events:
> - `joined {lang}`
> - `diagnosed {source, correct}`
> - `lesson_viewed {lang}`
> - `gap_closed {concept}`
> - `plan_approved {flagged}`
> - `photo_diagnosed {ms, provider}`
>
> Props must be string values, and no key may be named token, session or secret. Never send events when the student kind is simulated.

(Get the Raah snippet from whoever owns the Raah account.)

**Check:** a real quiz works on your phone on the Vercel URL.

---

## F5 (~4:00 → 6:15): the teacher dashboard, `/teacher/[code]`
This is the screen the judges stare at. Make it the best thing you've ever built.

> Build the teacher dashboard at `/teacher/[code]` for a laptop or projector (1280–1920 px); on mobile it stacks into one column. Poll `getDashboard` every 2 s and `getEvents(after)` every 1.5 s, appending events.
>
> **Layout:** a header, then three columns (graph 30% · heatmap 40% · agent feed 30%), then a bottom bar.
> 1. **Header:**
>    - "GuruGraph" in Kalam, the class name and "N students joined", with "(30 simulated)" in muted text;
>    - a join-code chip "Join code 7B" that opens a dialog with a large QR code for `${origin}/join/7B` (qrcode.react);
>    - the buttons **Analyze class** (primary) and **Scan** (→ the scan page).
> 2. **The knowledge graph (SVG, viewBox 0 0 400 520).**
>    - **Nodes** (radius 30) at C1 (200,60) · C2 (100,175) · C3 (300,175) · C6 (100,300) · C4 (240,305) · C5 (350,305) · C7 (100,420) · C8 (240,445). Draw the prerequisite arrows from `edges` with curved paths and small arrowheads in `--rule`.
>    - **Fill:** green, amber or red by `avg` (grey hatched when null), with `round(avg*100)` inside in bold and the concept `short` name below.
>    - **Focus concept:** a double ring in `--red-pen` plus a small "Focus" label in Kalam.
>    - **Changes:** when a node's value changes between polls, pulse a ring once (600 ms).
>    - **Hover or tap:** a tooltip with the name, avg, responders and the top mistakes.
> 3. **The heatmap:**
>    - rows are students (the nickname; a small "sim" tag for simulated; a star for Asha); columns are C1–C8 with rotated headers;
>    - cells are 28 px squares, coloured by band, grey hatched when null;
>    - rows scroll, and the header stays sticky;
>    - clicking a row opens a side Sheet with `getStudent`: mastery bars per concept, open gaps with labels, recent answers, and a **"Message parent"** button (see F6).
> 4. **The agent feed:**
>    - each item has an avatar circle with a letter: E Examiner, D Diagnostician, Cu Curator, A Analyst, C Coach, S Simulator, T Teacher. Each agent gets its own subtle colour; the Analyst's is `--red-pen`;
>    - then the agent name and action, the `reason` in one line, and telemetry chips (`nebius · qwen3 · 1.2 s · ₹0.04`, or "rules · 0 ms" when telemetry is empty);
>    - **Analyst `challenge` items get a 3 px red-pen left border;**
>    - new items slide in over 200 ms; the newest sit on top; show at most 60.
> 5. **The bottom bar:** "Gaps closed this session: **X of Y**", with X in a highlighter swipe, and an animated progress bar. Then chips for Re-teach N · Practise N · Extend N · Not yet N on the focus concept.
> 6. **States:** skeletons on first load; if there are no students yet, a big QR code with "Scan to join"; if a poll fails, a small "reconnecting…" pill (keep showing the old data).

**Check:** run the simulator from the backend `/docs` page (or ask Samartha), and the dashboard fills live. Then the review prompt, and the screenshot critique on a 1440 px screenshot.

---

## F6 (~6:45 → 9:00): the debate + approve + parent message
> Add the Analyze flow to the dashboard.
> 1. **Clicking Analyze class** opens a right-side panel, "Tomorrow's plan". Call `analyzeClass`. While waiting (up to 25 s), show "Coach is drafting… Analyst is checking the numbers…" with the two avatars pulsing.
> 2. **Render `steps` as a vertical timeline**, revealing each step 900 ms apart so it plays like a conversation:
>    - Coach `propose`: a draft card with a "Draft" badge, the headline, audience, plan steps, worked example (in Kalam) and why;
>    - Analyst `critique`: for each critique, a card with a 3 px red-pen left border (revise) or a green border (accept). The reason is in bold ink, with the numbers highlighted;
>    - Coach `revise`: a revised card with a "Revised" badge;
>    - then the final cards, with **Approve plan** (primary) and **Edit** (inline edit of the headline and steps; keep it local).
>
>    Flagged plans show an amber "Needs your judgement" banner with the `analyst_note`.
> 3. **After Approve:** a toast, the card shows "Approved ✓", and the bottom bar is unchanged.
> 4. **Parent message** (in the student Sheet): call `parentMessage`. Show the message in the parent's language in a WhatsApp-style bubble, with "Open in WhatsApp" (`whatsapp_url`) and "Copy". If `audio_url` is set, add a voice-note player styled like a WhatsApp voice message: a play button, a waveform made of bars, and the duration. Its src is `"/backend" + audio_url`. Show "Recording voice note…" until the audio can play.

**Check:**
1. Analyze plays out as draft → red challenge → revised → approve.
2. The parent message opens WhatsApp.

Then the review prompt.

---

## F7 (~9:30 PM → 12:30 AM): landing, judges, projector mode, polish
> 1. **`/`, the landing page:**
>    - hero: "See *why* they got it wrong." with the subline "Snap a notebook page. GuruGraph finds the wrong step, tells the teacher what to re-teach tomorrow, and gives each child a lesson in their own language.";
>    - three feature cards: Reads handwriting · Agents that argue · Kannada, Hindi, English;
>    - buttons: "Try it as a student (Asha)" → `/join/7B?as=asha`, and "Open teacher dashboard" → `/teacher/7B`;
>    - an embedded video slot, and links to the repo and the status page;
>    - a footer with the Raah badge snippet (from whoever owns the Raah account).
> 2. **`/judges`:**
>    - the numbers from `getJudgesSummary` as big stat cards, each showing its `n` and `method` in small text (the highlighter on the single most important number);
>    - links to the video, repo, status page and app;
>    - a big "Try it as Asha" button and a QR code to this page.
> 3. **Projector mode:** press `P` anywhere on the dashboard. Type goes to 125%, contrast goes up, the heatmap cells get ✓ ~ ! icons, and a small "Projector" badge appears. `P` again turns it off.
> 4. **The polish pass on every page:**
>    - empty, loading and error states;
>    - focus rings and aria labels;
>    - 360 px and 1440 px layouts;
>    - no layout shift while polling;
>    - a Lighthouse accessibility score ≥ 95.

---

## F8 (12:30 → 3:00 AM): screenshots for the deck
- Take 1440 px screenshots of the dashboard (after Analyze), the scan result with the red circle, and the student lesson in Kannada on a phone frame.
- Keep a clean Chrome profile with no extensions for the demo, because ad blockers hide Raah.
