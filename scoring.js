// Layer 1 — Prescreening.
//
// This replicates, as closely as possible, the real "Scoring Agent" prompt
// from the HappyRobot "Prescreening" workflow (copied verbatim from the
// workflow editor on 2026-07-09, GPT-4.1 in production — here run on Claude
// since that's the model available in this sandbox). It adds an optional
// per-criterion breakdown on top, purely for visibility while testing; the
// pass/fail rule (score >= pass_threshold) matches the real workflow.
const { callClaude, extractJSON } = require('./claude');

function formatCriteria(criteria) {
  if (!criteria.length) return '(no criteria configured yet in HappyRecruiting for this job)';
  return criteria
    .map((c) => `- ${c.name} (weight: ${c.importance ?? c.weight ?? 'n/a'})${c.added_by ? ` [added by ${c.added_by}]` : ''}`)
    .join('\n');
}

function formatKillerQuestions(questions) {
  if (!questions.length) return '(no killer questions configured yet in HappyRecruiting for this job)';
  return questions
    .map((q) => `- "${q.question}" — expected answer counts as pass: ${q.expects}`)
    .join('\n');
}

const SYSTEM_PROMPT = `You are a recruiting assistant that performs a first-pass CV screening for job applications.

Task
Evaluate how well this candidate's profile matches the job, using the criteria and killer questions provided. Return a score from 0 to 10 and a short rationale.

Rules
- Base your evaluation only on information present in the candidate profile. Do not infer facts that aren't stated.
- The criteria list includes a weight per parameter — give more weight to higher-weighted parameters when forming the overall score.
- The criteria also include killer questions. For each one, judge from the profile whether the answer is likely yes or no. If there's clear evidence of a "no" on any killer question, cap the score at 3 or below regardless of other criteria, and say so in the rationale.
- Do not consider age, gender, name, nationality, or photo. Evaluate strictly on professional fit.
- If the profile is incomplete or missing key information, reflect that in a lower score and explain why.
- Keep the rationale concise (2-4 sentences), referencing specific evidence from the profile.

Respond with ONLY a JSON object, no prose, no markdown fence, shaped exactly like:
{
  "score": <number 0-10>,
  "rationale": "<2-4 sentences>",
  "criteria_breakdown": [{ "criterion": "<name>", "weight": <number>, "assessment": "<1 sentence>" }],
  "killer_question_flags": [{ "question": "<text>", "expected_pass_answer": <true|false>, "likely_answer": "yes"|"no"|"unclear", "concerning": <true|false>}]
}`;

async function runPrescreen({ candidateName, jobTitle, profileText, criteria, killerQuestions }) {
  const userPrompt = `Candidate name: ${candidateName}
Job title: ${jobTitle}

Candidate profile:
${profileText}

Criteria:
${formatCriteria(criteria)}

Killer questions:
${formatKillerQuestions(killerQuestions)}`;

  const raw = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const parsed = extractJSON(raw);
  return parsed;
}

module.exports = { runPrescreen };
