# Ashby Dashboard — Sandbox

A local kanban board that simulates the Ashby recruiting pipeline, so you can test the Prescreening / Agent Interview / Recruiter Handoff logic **without ever touching real Ashby data or the real HappyRecruiting history.**

## What this is (and isn't)

- It reads criteria, killer questions, job facts, and recruiter/calendar info **read-only** from your real HappyRecruiting instance (`uirecruitingplatform-production.up.railway.app`) — same source of truth, zero risk, because it only ever sends GET requests there (see `happyrecruiting.js`).
- It never calls the Ashby API, directly or indirectly.
- It never triggers the real HappyRobot workflows (Prescreening / Agent interview / Candidate Advancement & Scheduling) — those stay exactly as they are in the HappyRobot editor.
- The Prescreen scorer and the "Carlos" interview-chat agent are **faithful copies of the real prompts** from those HappyRobot workflows (copied 2026-07-09), re-run here on Claude instead of GPT-4.1, against test candidates you add yourself.
- Everything this app creates (candidates, scores, chat transcripts, recruiter-handoff drafts) lives in its own local SQLite file, `dashboard.db`, next to this README. Delete that file any time to reset the sandbox.
- The recruiter-handoff "email" is a **draft only** — it's never sent. You'd copy/send it yourself if you liked what you saw.

## Setup

```bash
npm install
cp .env.example .env
# edit .env and add your ANTHROPIC_API_KEY
npm start
```

Then open http://localhost:3100.

## How to use it

1. Pick a job from the dropdown (pulled live from HappyRecruiting) and click **+ Add test candidate**. Paste in a résumé / application text — start with yourself.
2. In the **Applied** column, click **Run Prescreen**. This calls Claude with the real Scoring Agent prompt, using whatever criteria + killer questions are currently configured for that job in HappyRecruiting (if none are configured yet, it'll tell you so — go add some in HappyRecruiting first).
3. If it passes (score ≥ the pass threshold from HappyRecruiting's settings), click **Start Agent Interview**. You'll get a chat window where "Carlos" (the same persona as the real voice agent) asks the real killer questions for that job, one at a time — you type answers as the candidate.
4. Click **Finish & judge** when you're done. It'll tell you pass/fail per killer question and overall.
5. If the interview passes, click **Send to recruiter** to see the draft handoff — the congrats message plus whichever recruiter's calendar link is configured in HappyRecruiting for that job title.

## What's still a draft / to improve

- The real HappyRobot "Agent interview" workflow makes an actual phone call; this sandbox only does a text chat where you play the candidate. Good enough for validating the questions and judging logic, not a substitute for testing the voice call itself.
- The interview pass/fail judging logic (`judgeInterview` in `interview.js`) is my best reconstruction of "killer questions rule out a candidate on a mismatch" — the real HappyRecruiting endpoint that the workflow posts results to wasn't inspected in detail, so compare notes once you've run a few tests.
- CSV import of the ~1000 exported Ashby candidates isn't built yet — that's the last step, once you're happy with how Layers 1–3 score/judge things on a handful of test candidates.
- No real email sending or calendar booking — by design, until you decide you want that for real.
