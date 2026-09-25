# GuruGraph: the 5-minute pitch and live demo (all three of us speak)

**Setup, 15 minutes before:** on the laptop, open `/present`, paste the admin token, press **Warm the demo** (it runs
every beat and resets), then open the demo tabs in order. On the demo phone, open `/join/7B?as=asha` and leave it on
the first question. Projector: the dashboard tab, projector view (press `P`). Hotspot ready.

Times are cumulative. **Bold** = what is on screen.

## 0:00–0:35 · Risheeth · The problem (slide 1–2)
"In India's 2024 national survey of 21 lakh children, Class 6 got only 29% of fraction questions right, their weakest
maths skill. The mistakes are predictable: children add the tops and the bottoms. A teacher with 40 notebooks sees a
red cross, not the reason. And Indian trials show that a diagnosis alone changes nothing unless tomorrow's lesson
changes. So: **GuruGraph. Homework comes back already marked, in the child's language, and the teacher gets tomorrow's
first five minutes.**"

## 0:35–1:05 · Rishabh · The mentors' objection, answered (slide 3)
"At the mentor round we were asked: why would a teacher upload notebooks? They wouldn't. **Teachers don't upload
anything.** Three things instead:
1. Homework comes back already marked: the child or a parent photographs it at home, on the family phone.
2. When the teacher does check notebooks, flipping pages under a phone is faster than a red pen, and every page files
   itself by the roll number written at the top.
3. It works on any fraction problem in the textbook, not only ours, because the AI only reads: arithmetic judges."

## 1:05–2:20 · Samartha · Live: the child's homework, then the teacher's phone
**Phone (mirrored): `/join/7B?as=asha` → Check my homework.** Photograph the page with `2/5 + 1/3 = 3/8`.
"Asha photographs her homework. Gemini transcribes the lines. Exact arithmetic finds the first wrong line, and a
mal-rule recomputes it: adding the denominators too gives exactly 3/8. That's the evidence, not a guess. The feedback
is in Kannada. She taps **Fix this now**: a short lesson in Kannada, two retry questions from a verified bank, and
the gap closes." *(Do the two retries; show Gap closed.)*

**Laptop: `/teacher/7B` (projector view).** "On the teacher's dashboard this morning: the digest says how many pages
came in overnight and what gaps opened. The teacher uploaded nothing."

**Laptop: `/teacher/7B/snap`.** *(Hold two real pages under the webcam or phone; they auto-capture.)* "When she does
check notebooks: she flips pages under the phone. Each page is read, filed by its roll number, and the heatmap fills
in. We measured N seconds per notebook against our own stopwatch marking by hand; that is an internal test, not a
teacher study, and the number is on the judges page."

## 2:20–3:20 · Samartha · Agents that argue, the teacher decides
**Laptop: Plan tomorrow's lesson.** "The Coach drafts from what a mark book shows. The Analyst checks every child's
answers and its veto is binding: *Only 13 of 31 students show this mistake; re-teaching everyone wastes the period.*
The Coach revises: Group A re-learns, Group B practises. The teacher approves and prints the group's worksheet.
Rules make every decision that matters; the model only reads and writes."

## 3:20–3:50 · Rishabh · Proof, honestly (slide 6)
"Every number on `/judges` carries its n and method. Real phone photos: wrong step circled 6 of 6, mistake named 6 of 6,
still 6 of 6 when rotated, compressed, shrunk or darkened. Twelve labelled pages by three writers: 12 of 12 right or
wrong, 8 of 8 wrong steps and 8 of 8 mistakes by arithmetic alone, no model. AI cost ₹3.64 per child per month,
measured. What we don't claim: no classroom trial, no users yet; the 30 students in 7B and the classes 7A and 7C are
simulated, and we label them."

## 3:50–4:30 · Risheeth · Who pays and where it goes (slide 7)
"Karnataka has 19,105 private unaided schools where one teacher marks a pile of notebooks every night, and only 8.2%
of its students take private coaching, so the fix has to happen in school. Budget private schools first, then
government clusters through the state. The unit never changes: one child, one problem, one wrong step, one named
mistake. The school view already rolls it up; a district is the same query. Privacy by design: photos stay in memory,
a nickname and a roll number are all we keep."

## 4:30–5:00 · All · Close (slide 8)
Risheeth: "Teachers don't upload anything. Homework comes back already marked."
Rishabh: "And when they do check notebooks, flipping pages under a phone is faster than a red pen."
Samartha: "The AI reads. Arithmetic judges. The teacher decides. GuruGraph. Try it now: scan the QR."

## Q&A (2 min)
Answers in [QA.md](QA.md). Lead with the mentors' objection if it comes up again.

## If the Wi-Fi dies
1. Switch the laptop and the phone to the hotspot (already paired).
2. Every demo answer is cached on the API, so a slow link still gets the beats in under two seconds.
3. If the API itself is unreachable: play the 2-minute video (link on `/judges`) and narrate over it; the screenshots in
   `docs/pitch/screens/` are on the laptop.
4. The scan screen's "Any other problem" needs a live model call; if the link is bad, use Asha's page (cached) instead.

## Before leaving the room
Reset the demo class from `/present` so the next judge sees a fresh Asha.
