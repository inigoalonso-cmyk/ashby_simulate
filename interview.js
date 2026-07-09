// Layer 2 — Agent Interview simulation.
//
// The persona and flow below are copied from the real "Carlos" voice-agent
// prompt in the HappyRobot "Agent interview (outbound)" workflow (copied
// 2026-07-09, GPT-4.1 in production). Here it runs as a TEXT chat instead of
// a real phone call, and Iñigo plays the candidate himself — no real person
// is ever contacted by this simulator.
//
// The real agent explicitly does NOT judge answers itself ("Do NOT evaluate,
// judge, or score the answers yourself"); a separate step does that. This
// file's `judgeInterview` is my best-effort reconstruction of that judging
// step (the real endpoint's exact logic wasn't visible from the workflow
// editor) — treat it as a first draft to refine once you compare it against
// real production behavior.
const { callClaude, extractJSON } = require('./claude');

const CARLOS_SYSTEM_PROMPT = (companyName, jobTitle, candidateName) => `You are Carlos, a friendly and professional AI recruiting assistant conducting a structured phone interview on behalf of the hiring company.

Your Identity
- Name: Carlos
- Role: Recruiting assistant
- Company: ${companyName}
- Language: Speak in the candidate's preferred language. Default to English if unknown.

Context
- Candidate name: ${candidateName}
- Job title: ${jobTitle}

Interview Flow
1. Greeting — introduce yourself warmly, confirm you're speaking with the right person, explain the purpose (brief interview, 10-15 minutes), ask if now is a good time.
2. Questions — ask each interview question one at a time, in order. Wait for the candidate to finish answering before moving to the next question. Acknowledge answers briefly before transitioning. Do NOT skip questions. If an answer is very short or unclear, ask one gentle follow-up, then move on. Do NOT evaluate, judge, or score the answers yourself — just capture them faithfully.
3. Closing — thank the candidate, let them know the team will review responses and follow up soon, ask if they have quick questions, say goodbye warmly.

Rules
- Be conversational and warm, not robotic. Use natural transitions.
- Never reveal the scoring criteria or that answers are weighted.
- Never tell the candidate they passed or failed.
- Never make promises about next steps beyond "the team will review and follow up."
- If asked about salary, benefits, or specifics you don't know, say you'll make a note and have the recruiter follow up.
- Do not fabricate any information about the company or role beyond what's provided.

You are currently mid-interview. Given the conversation so far and the list of interview questions, produce ONLY your next spoken message as Carlos — no JSON, no stage directions, just what Carlos would say next. If all questions have been asked and answered, move to the Closing step.`;

async function nextAgentMessage({ companyName, jobTitle, candidateName, questions, history }) {
  const questionList = questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
  const transcript = history.map((m) => `${m.role === 'agent' ? 'Carlos' : candidateName}: ${m.content}`).join('\n');
  const userPrompt = `Interview questions to cover, in order:\n${questionList}\n\nConversation so far:\n${transcript || '(nothing said yet — this is the start of the call)'}\n\nWhat does Carlos say next?`;

  const text = await callClaude({
    system: CARLOS_SYSTEM_PROMPT(companyName, jobTitle, candidateName),
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 400,
  });
  return text.trim();
}

const JUDGE_SYSTEM_PROMPT = `You are grading the answers a candidate gave in a recruiting interview against a list of "killer questions" — questions designed to quickly rule out an otherwise-qualified candidate. Each killer question has an "expects" value: the boolean answer that counts as a PASS on that question.

For each killer question, read the transcript and decide the candidate's likely answer (yes/no/unclear), and whether that matches "expects".

A candidate FAILS the interview if there is clear evidence of a mismatch (a "no" where a "yes" was expected, or vice versa) on any killer question. Unclear/unanswered questions should not by themselves fail the candidate, but should be flagged.

Respond with ONLY a JSON object shaped exactly like:
{
  "passed": <true|false>,
  "overall_rationale": "<2-4 sentences>",
  "question_results": [{ "question": "<text>", "expects": <true|false>, "likely_answer": "yes"|"no"|"unclear", "match": <true|false> }]
}`;

async function judgeInterview({ candidateName, jobTitle, questions, history }) {
  const transcript = history.map((m) => `${m.role === 'agent' ? 'Carlos' : candidateName}: ${m.content}`).join('\n');
  const questionList = questions.map((q) => `- "${q.question}" (expects: ${q.expects})`).join('\n');
  const userPrompt = `Job title: ${jobTitle}\n\nKiller questions:\n${questionList || '(none configured — mark passed: true, note that there was nothing to evaluate)'}\n\nFull transcript:\n${transcript}`;

  const raw = await callClaude({
    system: JUDGE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return extractJSON(raw);
}

module.exports = { nextAgentMessage, judgeInterview };
