# Recording a 2-minute demo video by hand: shot list

The produced demo video (4:08) is at https://github.com/Argonyx-26/T28-Team-X/releases/tag/demo-video. This shot list is for recording a shorter version by hand.

Every beat below replays a saved answer or runs on rules, so nothing in it depends on a live model call or the Wi-Fi.
Record on the live app: https://gurugraph-web-215071922486.asia-south1.run.app

## Before you press record
1. **Reset the demo.** Open `/present`, then press **Warm the demo** (it runs every beat and ends on a fresh Asha).
   From the command line, `python -m app.tools warm $API` in `backend/` does the same.
2. **Set up the laptop screen.** Chrome at 1920×1080, zoom 110%, bookmarks bar hidden, no other tabs showing.
   Record with Win+Alt+R (Game Bar) or OBS.
3. **Set up the phone beat.** Either mirror a real phone, or use DevTools device mode (iPhone 12 Pro, 390×844) on `/join/7B?as=asha`.
4. **Open these tabs in order:**
   - `/`
   - `/join/7B?as=asha`
   - `/teacher/7B/scan`
   - `/teacher/7B/pile`
   - `/teacher/7B`
   - `/judges`

## Shots (times are cumulative)
| Time | Screen | What to do | Voice-over |
|---|---|---|---|
| 0:00–0:12 | `/` | Let the red-pen circle draw on Asha's page. | "In NCERT's 2024 PARAKH survey, Class 6 got only 29% of fraction questions right. A teacher with 40 notebooks sees a red cross, not the reason." |
| 0:12–0:40 | Phone: `/join/7B?as=asha` | Tap **2/6** for 1/3 + 1/3, then **Fix this now** (ಈಗಲೇ ಸರಿಪಡಿಸಿ). Show the Kannada lesson and tap **Listen**. Then tap **Do 2 more questions**, answer **3/4** and **1/2**, and check both. Show **Gap closed**. | "Asha added the denominators too. GuruGraph names the mistake in Kannada, teaches it back in a short lesson, and two retry questions from a verified bank close the gap." |
| 0:40–1:05 | `/teacher/7B/scan` | Tap **Asha's page: 3/4 + 1/4 (real photo)**. Hold on the red circle, the small exact values and the green "Checked by exact arithmetic" line. Tap **Yes, that's the mistake**. | "The teacher photographs a notebook. Gemini only reads the handwriting. Exact arithmetic finds the first wrong line, and a mal-rule proves the mistake: adding the denominators too gives exactly 4/8. The teacher has the last word." |
| 1:05–1:15 | `/teacher/7B/pile` | Tap **Use 6 sample notebooks**, then **Read all 6 notebooks**. | "A whole pile at once: two right, four with a mistake, each filed under the right child." |
| 1:15–1:40 | `/teacher/7B` | Show the heatmap, then tap **Plan tomorrow's lesson**. Scroll through the debate to **Your plan for tomorrow**, then tap **Approve plan**. | "The Coach drafts from the mark book. The Analyst checks every child's answers, and its veto is binding: only 13 of 31 show this mistake, so re-teaching everyone wastes the period. Final plan: 13 re-learn, the other 18 practise. The class is simulated, and the screen says so." |
| 1:40–1:52 | `/judges` | Scroll to the numbers, then to **What we don't claim**. | "Every number shows its sample size and method, and we say what we haven't done: no classroom trial yet." |
| 1:52–2:00 | `/` hero, or the QR on `/judges` | Hold on the screen. | "The AI reads. Arithmetic judges. The teacher decides. GuruGraph, by Team X." |

## Say it straight
- Asha is a demo student. The other 30 students in class 7B are simulated. Say so if the heatmap is on screen for more than a moment.
- Only use numbers from `/judges` or `docs/research/EVIDENCE.md`.

## After recording
1. Upload the video (YouTube unlisted or Drive, "anyone with the link").
2. Put the link in `video` in `frontend/lib/site.ts`.
3. Redeploy the web app only, following CLAUDE.md step 3.
4. Reset the demo from `/present`.
