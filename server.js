// Zero-dependency server: only Node.js built-ins. `npm install` has nothing
// to fetch, so this runs anywhere Node 18+ runs.

// Tiny built-in .env loader (avoids depending on the `dotenv` package).
(function loadEnvFile() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const http = require('http');
const path = require('path');
const { URL } = require('url');
const { createRouter, readBody, serveStatic } = require('./http-helpers');
const db = require('./db');
const hr = require('./happyrecruiting');
const { runPrescreen } = require('./scoring');
const { nextAgentMessage, judgeInterview } = require('./interview');

const PORT = process.env.PORT || 3100;
const publicDir = path.join(__dirname, 'public');
const serveFile = serveStatic(publicDir);
const router = createRouter();

function ok(res, data) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, data }));
}
function fail(res, err, code = 500) {
  console.error(err);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
}

// ---------- Read-only pass-through to the real HappyRecruiting instance ----------

router.get('/api/happyrecruiting/jobs', async (req, res) => {
  try { ok(res, await hr.listJobs()); } catch (e) { fail(res, e); }
});

router.get('/api/happyrecruiting/settings', async (req, res) => {
  try {
    const s = await hr.getSettings();
    delete s.secrets;
    ok(res, s);
  } catch (e) { fail(res, e); }
});

router.get('/api/happyrecruiting/criteria/:jobId', async (req, res, params) => {
  try { ok(res, await hr.getCombinedCriteria(params.jobId)); } catch (e) { fail(res, e); }
});

router.get('/api/happyrecruiting/killer-questions/:jobId', async (req, res, params) => {
  try { ok(res, await hr.getKillerQuestions(params.jobId)); } catch (e) { fail(res, e); }
});

router.get('/api/happyrecruiting/job-info/:jobTitle', async (req, res, params) => {
  try { ok(res, await hr.getJobInfo(params.jobTitle)); } catch (e) { fail(res, e); }
});

router.get('/api/happyrecruiting/recruiters/:jobTitle', async (req, res, params) => {
  try { ok(res, await hr.getRecruiters(params.jobTitle)); } catch (e) { fail(res, e); }
});

// ---------- Local candidates ----------

router.get('/api/candidates', async (req, res) => {
  ok(res, db.listCandidates());
});

router.post('/api/candidates', async (req, res) => {
  const body = await readBody(req);
  const { name, email, phone, job_id, job_name, profile_text, resume_url, source } = body;
  if (!name || !job_id || !job_name || (!profile_text && !resume_url)) {
    return fail(res, new Error('name, job_id, job_name and (profile_text or resume_url) are required'), 400);
  }
  ok(res, db.createCandidate({ name, email, phone, job_id, job_name, profile_text, resume_url, source }));
});

router.get('/api/candidates/:id', async (req, res, params) => {
  const candidate = db.getCandidate(params.id);
  if (!candidate) return fail(res, new Error('not found'), 404);
  ok(res, {
    candidate,
    evaluations: db.listEvaluations(candidate.id),
    messages: db.listMessages(candidate.id),
    handoff: db.getLatestHandoff(candidate.id),
  });
});

router.delete('/api/candidates/:id', async (req, res, params) => {
  db.deleteCandidate(params.id);
  ok(res, { deleted: params.id });
});

router.patch('/api/candidates/:id/stage', async (req, res, params) => {
  const body = await readBody(req);
  ok(res, db.updateCandidateStage(params.id, body.stage));
});

// ---------- Workflow-facing endpoints ----------
// These exist so the REAL HappyRobot workflows can use this dashboard as
// their data source/sink instead of Ashby. No Ashby credential, no Ashby
// action node, no risk to any real pipeline — the workflow does its own
// thinking (its own Scoring Agent / interview agent) and just reads
// candidates from here and reports results back here.

// Equivalent of Ashby's "List Applications (Intake Stage Only)".
// GET /api/workflow/applications?stage=applied
router.get('/api/workflow/applications', async (req, res, params, query) => {
  const stage = query.get('stage') || 'applied';
  const rows = db.listCandidates({ stage }).map((c) => ({
    id: c.id, name: c.name, email: c.email, phone: c.phone,
    job_id: c.job_id, job_name: c.job_name, profile_text: c.profile_text, resume_url: c.resume_url, stage: c.stage,
  }));
  ok(res, rows);
});

// Equivalent of Ashby's "Get Application" + "Get Candidate" combined —
// this dashboard doesn't separate the two, one record has everything.
router.get('/api/workflow/candidates/:id', async (req, res, params) => {
  const c = db.getCandidate(params.id);
  if (!c) return fail(res, new Error('not found'), 404);
  ok(res, {
    id: c.id, name: c.name, email: c.email, phone: c.phone,
    job_id: c.job_id, job_name: c.job_name, profile_text: c.profile_text, resume_url: c.resume_url, stage: c.stage,
  });
});

// Equivalent of "Submit Score" + "Branch on Result" + "Advance to
// Interview"/"Archive Application" all in one call. The workflow does its
// own scoring (its own Scoring Agent node calls its own LLM) and just posts
// the result here; this endpoint decides pass/fail using HappyRecruiting's
// pass_threshold and updates the local stage accordingly.
// POST /api/workflow/candidates/:id/prescreen-result
// body: { score: number, rationale: string }
router.post('/api/workflow/candidates/:id/prescreen-result', async (req, res, params) => {
  try {
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);
    const body = await readBody(req);
    if (typeof body.score !== 'number') return fail(res, new Error('score (number) is required'), 400);

    const settings = await hr.getSettings();
    const passThreshold = settings.pass_threshold ?? 8;
    const passed = body.score >= passThreshold;

    const evaluation = db.addEvaluation(candidate.id, 'prescreen', passed, {
      score: body.score,
      rationale: body.rationale || null,
      pass_threshold: passThreshold,
      source: 'real_workflow',
    });
    const newStage = passed ? 'prescreen_passed' : 'prescreen_rejected';
    db.updateCandidateStage(candidate.id, newStage);

    ok(res, { evaluation, stage: newStage, pass_threshold: passThreshold });
  } catch (e) { fail(res, e); }
});

// Same pattern for the Agent Interview workflow, once we wire that one too.
// POST /api/workflow/candidates/:id/interview-result
// body: { passed: boolean, rationale: string, question_results: [...] }
router.post('/api/workflow/candidates/:id/interview-result', async (req, res, params) => {
  try {
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);
    const body = await readBody(req);
    if (typeof body.passed !== 'boolean') return fail(res, new Error('passed (boolean) is required'), 400);

    const evaluation = db.addEvaluation(candidate.id, 'interview', body.passed, {
      rationale: body.rationale || null,
      question_results: body.question_results || [],
      source: 'real_workflow',
    });
    const newStage = body.passed ? 'interview_passed' : 'interview_failed';
    db.updateCandidateStage(candidate.id, newStage);

    ok(res, { evaluation, stage: newStage });
  } catch (e) { fail(res, e); }
});

// ---------- Layer 1: Prescreening (local standalone testing, uses this sandbox's own Claude key) ----------

router.post('/api/candidates/:id/prescreen', async (req, res, params) => {
  try {
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);

    const [criteria, killerQuestions, settings] = await Promise.all([
      hr.getCombinedCriteria(candidate.job_id),
      hr.getKillerQuestions(candidate.job_id),
      hr.getSettings(),
    ]);

    const result = await runPrescreen({
      candidateName: candidate.name,
      jobTitle: candidate.job_name,
      profileText: candidate.profile_text,
      criteria,
      killerQuestions,
    });

    const passThreshold = settings.pass_threshold ?? 8;
    const passed = Number(result.score) >= passThreshold;

    const evaluation = db.addEvaluation(candidate.id, 'prescreen', passed, { ...result, pass_threshold: passThreshold });
    const newStage = passed ? 'prescreen_passed' : 'prescreen_rejected';
    db.updateCandidateStage(candidate.id, newStage);

    ok(res, { evaluation: { id: evaluation.id, passed, ...result, pass_threshold: passThreshold }, stage: newStage });
  } catch (e) { fail(res, e); }
});

// ---------- Layer 2: Agent Interview (chat simulation) ----------

router.post('/api/candidates/:id/interview/start', async (req, res, params) => {
  try {
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);

    db.clearMessages(candidate.id);

    const killerQuestions = await hr.getKillerQuestions(candidate.job_id);
    const firstMessage = await nextAgentMessage({
      companyName: 'the company',
      jobTitle: candidate.job_name,
      candidateName: candidate.name,
      questions: killerQuestions,
      history: [],
    });

    db.addMessage(candidate.id, 'agent', firstMessage);
    db.updateCandidateStage(candidate.id, 'interview_in_progress');

    ok(res, { message: firstMessage, questionCount: killerQuestions.length });
  } catch (e) { fail(res, e); }
});

router.post('/api/candidates/:id/interview/reply', async (req, res, params) => {
  try {
    const body = await readBody(req);
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);

    db.addMessage(candidate.id, 'candidate', body.content);

    const killerQuestions = await hr.getKillerQuestions(candidate.job_id);
    const history = db.listMessages(candidate.id);

    const agentMessage = await nextAgentMessage({
      companyName: 'the company',
      jobTitle: candidate.job_name,
      candidateName: candidate.name,
      questions: killerQuestions,
      history,
    });

    db.addMessage(candidate.id, 'agent', agentMessage);

    ok(res, { message: agentMessage });
  } catch (e) { fail(res, e); }
});

router.post('/api/candidates/:id/interview/finish', async (req, res, params) => {
  try {
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);

    const killerQuestions = await hr.getKillerQuestions(candidate.job_id);
    const history = db.listMessages(candidate.id);

    const verdict = await judgeInterview({
      candidateName: candidate.name,
      jobTitle: candidate.job_name,
      questions: killerQuestions,
      history,
    });

    const evaluation = db.addEvaluation(candidate.id, 'interview', verdict.passed, verdict);
    const newStage = verdict.passed ? 'interview_passed' : 'interview_failed';
    db.updateCandidateStage(candidate.id, newStage);

    ok(res, { evaluation: { id: evaluation.id, ...verdict }, stage: newStage });
  } catch (e) { fail(res, e); }
});

// ---------- Layer 3: Recruiter handoff (draft only — never auto-sent) ----------

router.post('/api/candidates/:id/handoff', async (req, res, params) => {
  try {
    const candidate = db.getCandidate(params.id);
    if (!candidate) return fail(res, new Error('not found'), 404);

    const recruiters = await hr.getRecruiters(candidate.job_name);
    const primary = Array.isArray(recruiters) ? recruiters[0] : null;

    const subject = `Great news about your application for ${candidate.job_name}!`;
    const body = `Hi ${candidate.name},

Congratulations — you've made it through to the next stage for the ${candidate.job_name} role!

${primary
    ? `The next step is a quick conversation with ${primary.name}. You can grab a time that works for you here: ${primary.calendar_link}`
    : `We don't have a recruiter contact configured for this job yet in HappyRecruiting, so add one in the Recruiters tab before sending this for real.`}

Looking forward to speaking with you.`;

    const handoff = db.addHandoff(candidate.id, {
      recruiter_name: primary?.name || null,
      recruiter_email: primary?.email || null,
      calendar_link: primary?.calendar_link || null,
      email_subject: subject,
      email_body: body,
    });

    db.updateCandidateStage(candidate.id, 'recruiter_handoff');

    ok(res, handoff);
  } catch (e) { fail(res, e); }
});

// ---------- HTTP server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const match = router.match(req.method, pathname);
    if (!match) return fail(res, new Error('not found'), 404);
    try {
      await match.handler(req, res, match.params, url.searchParams);
    } catch (e) {
      fail(res, e);
    }
    return;
  }

  const served = serveFile(req, res, pathname);
  if (!served) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`ashby-dashboard-sim running at http://localhost:${PORT}`);
  console.log(`Reading criteria/killer-questions/recruiters read-only from ${hr.BASE}`);
  console.log('This app never calls Ashby and never writes back to HappyRecruiting.');
});
