# Risheeth: evidence, language, QA and the pitch (you own Presentation and the DevRel angle)

**Your tools (all free):**

| Tool | Use it for |
|---|---|
| **Google AI Studio** (aistudio.google.com, choose the newest *Pro* model) | long writing: script, deck text, Q&A. Better limits than the Gemini app. If it asks for billing or hits a limit, use gemini.google.com with the same prompts |
| **NotebookLM** (notebooklm.google.com) | checking every claim against its source |
| **Google Slides** or **Canva** | the deck |
| **Clipchamp** (built into Windows) or **CapCut** | the video |
| **GitHub web** (github.com/Argonyx-26/T28-Team-X) | upload photos and fix text files. Commits from your account count in our history |

**Honesty rules (the judges check execution; one fake number sinks us):**
- Never invent a number, a teacher quote, a pilot, a user or an LOI.
- The "teacher reality" content comes only from **published surveys and reports**, with the source named: "In NCERT's PARAKH survey, …". Never write "a teacher told us".
- The 30 students in class 7B are **simulated**, and we say so. Asha is a **demo student**.
- Every number on a slide carries its source (and, for our own evals, *n* and the method).

---

## 1. Now → 1:15: the handwriting cards (the demo depends on these)
**Write 12 cards**, one problem per card or half A4 page, in pen, working line by line like a Class 7 student, with the name at the top. Each person writes their own four cards, so the handwriting varies:
- **You:** "Asha", cards A_P1–A_P4.
- **Samartha:** "Ravi", cards B_P1–B_P4.
- **Rishabh:** "Meena", cards C_P1–C_P4.

**Write exactly these lines** (also in `data/evidence/labels.csv`):

| Card | Lines to write (one per line) |
|---|---|
| A_P1 | `3/4 + 1/4` · `= (3+1)/(4+4)` · `= 4/8` |
| A_P2 | `2/3 + 1/6` · `= (2+1)/6` · `= 3/6` |
| A_P3 | `3/5 ÷ 3/10` · `= 3/5 × 3/10` · `= 9/50` |
| A_P4 | `2 cakes 3/4 cup each` · `2 × 3/4 = 6/4` · `= 1 1/2 cups` |
| B_P1 | `3/4 + 1/4` · `= (3+1)/4` · `= 4/4 = 1` |
| B_P2 | `2/3 + 1/6` · `= (2+1)/(3+6)` · `= 3/9` |
| B_P3 | `3/5 ÷ 3/10` · `= 5/3 × 3/10` · `= 15/30 = 1/2` |
| B_P4 | `2 cakes 3/4 cup each` · `2 + 3/4` · `= 2 3/4 cups` |
| C_P1 | `3/4 + 1/4` · `= 4/8` |
| C_P2 | `2/3 + 1/6` · `= 4/6 + 1/6` · `= 5/6` |
| C_P3 | `3/5 ÷ 3/10` · `= 3/5 × 10/3` · `= 30/15 = 2` |
| C_P4 | `2 cakes 3/4 cup each` · `2 × 3/4 = 6/8` · `= 3/4 cup` |

**Photograph each card twice.** Hold the phone flat above it, in daylight or bright light, with the whole card in the frame and no shadows. Name the files `A_P1_1.jpg`, `A_P1_2.jpg` and so on.

**Upload** them on GitHub web: open the repo → `data/evidence/` → **Add file → Upload files**. Put them in a folder by typing `photos/` before the names, or just drop them in, and commit. **A_P1 is the most important card** (it's Asha's notebook in the demo), so do it first and make it the neatest.

## 2. 1:15 → 1:45: language check
Open `data/fractions.json` on GitHub and read every `"hi"` and `"kn"` string (the concept names and the mistake labels). A 12-year-old must understand them.

In AI Studio, paste the file's `"concepts"` and `"tags"` parts with this prompt:
> You are a Class 7 maths teacher in Karnataka who teaches in Kannada and Hindi. Check each Hindi and Kannada string below. For each: is it grammatically correct, natural for a 12-year-old, and does it mean the same as the English? Suggest a better version only where needed, keeping maths words bilingual on first use (e.g. "ಛೇದ (denominator)"). Output a table: key | current | problem | suggested.

Fix what you agree with directly on GitHub (the pencil icon → commit), and tell Samartha in the chat.

## 3. 1:45 → 3:30: the evidence brief
Samartha is pushing `docs/research/EVIDENCE.md`: a researched list of what published surveys and reports say about teachers, fractions learning, workload, tuition and languages, each with a source link.
1. Open **every source link** for the top 8 items and confirm the number is really on that page. Mark each ✅ confirmed or ❌ drop.
2. **NotebookLM:** create a notebook, add the confirmed source URLs or PDFs as sources, then ask:
   > For each claim below, quote the exact sentence from the sources that supports it, or say "not supported". Claims: <paste the claims>
3. Keep only what survives. These become the **Problem** and **Teacher reality** content.

## 4. Raah and LinkedIn (as soon as Rishabh's Vercel URL is live)
1. **Raah:** in the Raah dashboard, add the Vercel domain. Copy the script snippet and the badge snippet to Rishabh. Create the public **status page** with the components "Student app" and "Agents API", and post the status page URL in the chat.
2. **LinkedIn post #1** (AI Studio prompt):
   > Write a LinkedIn post (under 120 words) from a student team at the ARGONYX '26 hackathon at RV University. We are building GuruGraph during the 24 hours: a teacher photographs a student's fractions working, AI finds the exact wrong step, agents plan tomorrow's lesson, and each child gets a lesson in Kannada, Hindi or English. Include this link: <site URL>. Humble and specific, no hype words, no emojis except one. End with the tags: Studio1, SoCSE RVU, Viksha, ECell RVU, IEEE RVU.

   Tag the real pages when you post.

## 5. From ~3:30: QA tester (the quality gate)
Each time Samartha or Rishabh says "pushed", run this on **your phone** with mobile data. Send a screenshot plus one line per bug to the chat.
- **Student:** open `/join/7B` → pick ಕನ್ನಡ → answer 5 questions (get some wrong on purpose) → the lesson appears in Kannada script → 2 retries → "Gap closed". Also `/join/7B?as=asha`.
- **Scan:** `/teacher/7B/scan` → Asha + P1 → photograph card A_P1 → line 2 is circled, the label reads "added the denominators too", in ≤ 8 s.
- **Dashboard:** `/teacher/7B` → the graph, heatmap and feed update live → Analyze → draft → red challenge → revised → Approve.
- **Language:** every Kannada or Hindi screen reads naturally. Note any awkward line.

## 6. ~4:00: lesson review (native reader)
Samartha will share the Kannada and Hindi micro-lessons. For each, check: is it correct maths, is it natural, would a 12-year-old follow it? Mark each OK or FIX, with the fix.

## 7. 5:30 → 6:30: the mentor round (60 seconds)
AI Studio prompt:
> Write a 60-second spoken script for a hackathon mentor check-in, for three speakers (Risheeth: problem, 15 s; Samartha: live demo narration, 35 s; Rishabh: design choice, 10 s). Product: GuruGraph. The demo: the teacher scans Asha's notebook (3/4 + 1/4 = 4/8), the red pen circles the step where she added the denominators, and the class dashboard shows where the class is stuck. End with one question to the mentor: "What would make this a winner for you?" Plain spoken English, short sentences.

Write down the mentor's answer word for word; we act on it.

## 8. Evening: the pitch (the deck format arrives tonight; follow it exactly)
**The 5-minute script** (AI Studio; paste EVIDENCE.md's confirmed items and the deck format):
> Write a 5:00 pitch script for 3 speakers (Risheeth opens and closes the story; Rishabh drives the demo and explains one design decision; Samartha explains how the agents work). Use the deck format below, one section per slide, with timings that add up to 5:00 including a 2:00 live demo.
> - **Story:** Asha, a Class 7 student in Bengaluru, writes 3/4 + 1/4 = 4/8. Her teacher has 40 notebooks and finds the mistake only at the unit test.
> - **Solution:** photo → the wrong step circled → the class plan argued out by two agents → a lesson in Kannada → gap closed.
> - **Honest positioning:** "AI does two jobs: reading handwriting and writing in the child's language. The decisions (mastery, the next question, the Analyst's veto) are rules a teacher can trust."
> - **Business:** Bengaluru tuition centres and budget private schools first (the owner can buy on the spot), then schools and state or CSR programmes. The cost per student comes from our measured ₹ per AI call (I'll paste the number).
>
> Only use statistics from the evidence list below, and say the source aloud once for the headline number. No invented quotes, pilots or users. Close with a callback to Asha. Evidence: <paste>. Deck format: <paste>.

**The Q&A bank:**
> List the 20 hardest questions hackathon judges (founders and industry engineers) would ask about this product: accuracy, what if the AI is wrong, privacy of children's data, why teachers would adopt it, pricing, competition (answer-sheet graders, adaptive apps), scale, languages, what's built vs planned. For each, write a 2-sentence honest answer and who answers it (Samartha: tech and accuracy; Rishabh: UX and adoption; Risheeth: market and impact). Product facts: <paste the "How it works" section of the README when ready>.

**The deck:** follow the organizers' format. Every number carries its source; screenshots come from Rishabh (F8); one slide shows the live architecture (ask Samartha).

## 9. 3:15 AM: the 2-minute video
- **Script** (AI Studio):
  > Write a 2:00 demo-video script with timestamps: a 10 s hook (Asha's notebook), a 60 s product loop (scan → red circle → dashboard → agents argue → Kannada lesson → gap closed), a 20 s "how it works" (AI vs rules; Gemini on Google Cloud reads the handwriting and writes the lessons; Raah watches every agent's speed from the teacher's browser), 20 s on impact, and a 10 s close with the repo and site. Include on-screen caption text per shot.
- **Record:** screen-record the real app (Win+Alt+R, or OBS). Add a voice-over and captions in Clipchamp. Export at 1080p, upload to YouTube as **unlisted**, and keep a local copy.

## 10. Sat 8:30 → 10:30
1. The README story section (problem + evidence).
2. Rehearse ×3 with a timer.
3. **Submit on the GitHub repo** as the organizers asked.
4. LinkedIn post #2 with the video.

---
**Note (2 PM): we are not using Nebius.** Nebius needs a bank card to get an API key, so every AI call runs on Google Gemini, paid from our free Google Cloud credit. Never say "Nebius runs the agents". If asked, the honest answer is: "The code supports Nebius's API as a drop-in provider; for the event we ran on Gemini."
