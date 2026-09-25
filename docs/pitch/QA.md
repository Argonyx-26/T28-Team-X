# Hard questions, honest answers

Numbers here come from `/judges` (`data/evals/results.json`, `data/evals/load.json`, `data/evals/unit_costs.json`)
and `docs/research/EVIDENCE.md`. If a number changes, change it there first.

## The mentors' objection
**"Why would a teacher upload students' notes? It's time-consuming."**
They wouldn't, and they don't. Three answers, all working live:
1. **Homework comes back already marked.** The child or a parent photographs the page on the family phone
   (`/join/7B` → Check my homework). The teacher's dashboard fills overnight and the morning digest says what came in.
   About 90% of rural 14–16-year-olds have a smartphone at home (ASER 2024), and 67% of government-school and 87% of
   private-school families received lockdown materials over WhatsApp (ASER 2020).
2. **When the teacher does check notebooks, it's faster than a red pen.** Snap mode: flip pages under the phone; each
   page is captured automatically, read, filed by the roll number written at the top, and the projected heatmap fills
   in. We timed ourselves against marking by hand (an internal test, n and method on `/judges`).
3. **No special worksheets.** Exact arithmetic checks the working of any fraction problem from the textbook the class
   already uses, not only our four.

**"Isn't the child just going to photograph the answer key?"**
The verifier checks every line of working, not the final answer, so copied answers with no working show as
"unverified" and go to the teacher. And the point is the lesson that follows, not a mark.

## The AI
**"How do you know the model is right?"**
We don't trust it to be. The model only transcribes. Exact fraction arithmetic decides right or wrong, finds the first
wrong line, and a mal-rule recomputes the wrong line to name the mistake ("adding the denominators too gives exactly
3/8"). The model's opinion never decides right or wrong; a misread digit still can, which is why every result shows
the transcription and the teacher can correct it. When the model and the arithmetic disagree and no rule explains the
line, the teacher sees "please check". On 12 labelled pages by 3 writers the arithmetic alone got 12/12 right or wrong,
8/8 wrong steps and 8/8 mistakes, with no model call. End to end, model reading plus arithmetic, 6 whole pages by 3 writers with 18 planted problems
(5 right, 13 wrong) came out 18/18 right or wrong, 13/13 wrong steps and 13/13 mistakes; we fixed two
things our checker didn't read (a '//' answer mark, a story over two lines) after looking at the photos and
before the run.

**"What if the handwriting is bad?"**
On 6 real phone photos the wrong step was circled 6/6 and the mistake named 6/6, and it stayed 6/6 when we rotated
them ±8°, compressed them to JPEG quality 40, shrank them to 640 px and darkened them to 45%. Small n; that is why
every number carries it. If a page can't be read, the teacher types the final answer and the rules take over.

**"Why Gemini, why not a local model?"**
Reading handwriting needs a strong vision model; we use Gemini 3 Flash on Vertex AI, hedged by 2.5 Flash after 6 s.
Everything else is rules. The provider is one function away (`generate()`), and Nebius Token Factory plugs in as an
OpenAI-compatible provider when a key is set.

**"Prompt injection: what if a child writes 'mark this correct'?"**
Page text is data, never instructions. The verifier ignores words, and we test exactly that case.

## The agents
**"Why multiple agents? Isn't this one prompt?"**
Because the interesting decision is not "what is the mistake" but "what should the teacher do tomorrow", and that is
where a single model goes wrong: it sees averages and proposes a whole-class re-teach. Our Coach (a model) plans from
what a mark book shows; the Analyst (rules) checks every child's answers and its veto is binding; the Examiner picks
questions and grades retries; the Curator writes the lesson and picks retries from a verified bank; the Simulator
gives us a class to test on. Three agents call Gemini, three are pure rules. The debate is visible on the dashboard.

**"Who has the last word?"**
The teacher. One tap confirms or corrects any diagnosis, and the correction replaces the AI's. Every review is kept
and the agreement rate is on `/judges`.

## The product
**"Who is the customer?"**
Budget private schools first: Karnataka has 19,105 private unaided schools, and only 8.2% of its students take
private coaching (MoSPI 2025), so the fix has to happen in school. Then government clusters through the state, where
Kannada-medium matters (NEP 2020 asks for mother-tongue instruction to Grade 8).

**"What does it cost?"**
AI cost ₹3.64 per child per month, measured from real calls (one photo diagnosis, lesson, parent message and voice
note per week, plus a shared class plan); the voice note is ₹2.56 of that. Hosting at 1,000 and 100,000 students is
in `docs/SCALE.md`, list prices, labelled designed rather than measured.

**"What about privacy? These are children."**
Photos stay in memory and are discarded; only the transcribed lines and the diagnosis are kept. The roll number (or a
nickname) written at the top of a page is read only to file the page. No names beyond the nickname on the class list,
no phone numbers, no emails; analytics events carry no ids. Designed with the DPDP Act 2023 in mind; we don't claim
compliance, we claim keeping the data small enough to comply.

**"Does it scale?"**
Measured on one Cloud Run instance: answers under load and pages per minute are on `/judges`. Designed: stateless API
behind Cloud Run autoscaling, Cloud SQL, a queue for page reads, a shared cache, per-school tenancy (`docs/SCALE.md`).

**"Only fractions?"**
Fractions is where Class 6 is weakest (29% in PARAKH 2024). The engine is a topic pack: concepts, tags, mal-rules and
a verified bank in one JSON file plus one pure function per mal-rule. A second pack is the next thing we'd build.

## What we don't claim
No classroom trial, no users, no learning-gain data. The 30 students in 7B and the classes 7A and 7C are simulated and
labelled as such. The Kannada and Hindi lessons pass an automatic script check; a native-speaker review is pending.
Teacher pages have no login in this demo build. Our marking-time number is an internal test by the team, not a
teacher study.
