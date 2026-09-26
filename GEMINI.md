# GuruGraph: project rules for AI assistants (Antigravity and Gemini CLI load this file automatically)

## What we're building
GuruGraph turns a photo of a student's fractions working into a diagnosis a teacher can act on.
- **Reading the work:** a Class 7 teacher photographs a student's handwritten working. The AI reads it, finds **the exact wrong step** and names the misconception in plain words (e.g. "added the denominators too"). The UI circles that step in red pen.
- **The class view:** a knowledge graph and a student × concept heatmap show where the class is stuck.
- **Agents that argue:** the Coach drafts a teaching plan, the Analyst challenges it with the class numbers, and the Coach revises it.
- **The student side:** each student gets a micro-lesson in **Kannada, Hindi or English** and 2 retry questions. When both are right, the gap closes.

We're built for ARGONYX '26. **Everything in this repo is made during the event (25 Sep 11:00 → 26 Sep 11:00).** Never paste in code or text from outside this repo.

## Who owns what
- **From Friday evening, one person at a time (with Claude Code) owns the entire codebase**: `backend/`, `frontend/`, `data/`, `docs/`, deployment. Samartha until about 23:25; then Risheeth until about 03:20; from then, Rishabh, all on the same machine.
- The others supply data (handwritten pages photographed on a phone, marking timings), review the Kannada and Hindi text, and build the pitch, deck and video.
- `docs/API.md` is **the contract**. The frontend must match its types exactly. Changes are additive only.
- Roles and the AI tools used are in `docs/team/TEAM.md`. Rules for AI assistants and the deploy protocol are in `CLAUDE.md`.

## Frontend stack
- **Framework:** Next.js (App Router) + TypeScript strict + Tailwind + shadcn/ui + lucide-react icons. `motion` (Framer Motion) is used only for the motion listed below.
- **API calls:** all go through `fetch("/backend/...")` with `cache: "no-store"`: the teacher and student screens use `app/teacher/[code]/_dashboard/api.ts`, whose types follow `docs/API.md`.
- **No fixtures:** the API is live, so every screen reads real data. Public URLs live in `frontend/lib/site.ts`; the landing page and `/judges` read their numbers only from `GET /judges/summary` (`frontend/lib/summary.ts`), never hard-coded.
- **Rewrite:** `next.config` rewrites `/backend/:path*` to `${process.env.API_URL}/:path*`.

## Design system: the "teacher's notebook"
The UI should feel like a clean exercise book marked by a good teacher, not a generic SaaS dashboard.

**Page:** paper `#FCFDFF` with a faint 24 px squared grid (`#E3E9F3` lines) drawn by a CSS background, on the page body only, never behind dense text.

**Colour tokens** (CSS variables in `app/globals.css`, mapped into the Tailwind theme):

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1F2B5C` | headings and primary text |
| `--ink-2` | `#3E4C85` | secondary text and links |
| `--graphite` | `#616874` | muted text |
| `--rule` | `#D6DDE9` | borders and dividers |
| `--card` | `#FFFFFF` | panels |
| `--red-pen` | `#C8372D` | wrong steps, red-pen circles, Analyst challenges, errors |
| `--green` | `#2F8A57` | mastered (≥ 0.70) |
| `--amber` | `#D89B1D` | practising (0.40–0.69) |
| `--red` | `#D2564A` | gap (< 0.40) |
| `--highlighter` | `#F7E96B` | highlights **one** outcome number per screen, like a highlighter stroke |

**Type.** Load all three with `next/font/google`:
- **Hind** (400/500/600, Latin + Devanagari) for the UI.
- **Noto Sans Kannada** (400/600) for Kannada text. Apply it when `lang="kn"`, and set `line-height` ≥ 1.6 for Indic scripts.
- **Kalam** (400/700) for handwriting: transcribed student steps, red-pen notes, and one or two accents per page. Never for body text.

**Shape:** 18 px radius on panels, 10 px on controls. 1 px `--rule` borders, and very soft shadows only.

**Mastery colours** always come in three bands: green ≥ 0.70, amber 0.40–0.69, red < 0.40. Grey hatched means not assessed. In **projector mode** (press `P`), show icons as well (✓ ~ !), so meaning never depends on colour alone.

**Motion** (all of it must mean something, and all of it respects `prefers-reduced-motion`):
- the red-pen ellipse **draws itself** around the wrong step (SVG `stroke-dashoffset`, 600 ms);
- a graph node pulses once (600 ms ring) when its value changes;
- agent-feed items slide in (200 ms);
- the gap-closed meter animates.

**Tap targets:** at least 48 px on student screens, which must work at **360 px width** on a cheap Android phone. The teacher dashboard targets a laptop and a projector (1280–1920 px), and stacks into one column on mobile.

**States:** every screen has a designed empty, loading (skeletons, not spinners) and error state. Error copy is kind and says what to do next.

**Language:** student-facing UI strings come in en/hi/kn from `frontend/lib/i18n.ts`, and the student's chosen language is used everywhere on student screens.

## Quality bar (check before every commit)
- `npm run build` passes with zero TypeScript errors, and `npm run lint` is clean.
- The page works at 360 px and at 1440 px.
- Everything has focus rings and aria labels, and body text meets 4.5:1 contrast.
- No hard-coded API URLs, no `any`, and no unused files.

## Git
- Make small commits with clear messages. Before pushing, run `git pull --rebase`.
- Never force-push. Never commit `.env*` files, keys or `node_modules`.
