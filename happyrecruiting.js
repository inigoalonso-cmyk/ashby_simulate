// Read-only client for the REAL HappyRecruiting instance.
//
// HARD RULE: this file must only ever issue GET requests. Never add a
// POST/PUT/PATCH/DELETE call to HAPPYRECRUITING_BASE_URL here. That app is a
// real, shared tool — we read its criteria/killer-questions/job-info/
// recruiter data to make this simulator realistic, but we never write
// anything back to it, and we never touch Ashby.

const BASE = process.env.HAPPYRECRUITING_BASE_URL || 'https://uirecruitingplatform-production.up.railway.app';

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HappyRecruiting GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

// [{ id, name, ashby_job_id, created_at }, ...]
async function listJobs() {
  return getJSON(`${BASE}/api/jobs`);
}

// Criteria that apply to every job.
async function getGeneralParameters() {
  return getJSON(`${BASE}/api/jobs/general/parameters`);
}

// Criteria specific to one job.
async function getJobParameters(jobId) {
  return getJSON(`${BASE}/api/jobs/${encodeURIComponent(jobId)}/parameters`);
}

// [{ question, added_by, expects }, ...]
async function getKillerQuestions(jobId) {
  return getJSON(`${BASE}/api/jobs/${encodeURIComponent(jobId)}/killer-questions`);
}

// [{ label, value }, ...]
async function getJobInfo(jobTitle) {
  return getJSON(`${BASE}/api/jobinfo/lookup?job=${encodeURIComponent(jobTitle)}`);
}

// Recruiter contact + calendar booking link for a job title. First entry is primary.
async function getRecruiters(jobTitle) {
  return getJSON(`${BASE}/api/recruiters?job=${encodeURIComponent(jobTitle)}`);
}

// { pass_threshold, max_call_attempts, call_recording_enabled, ashby: {...} }
async function getSettings() {
  return getJSON(`${BASE}/api/settings`);
}

// Merge general + job-specific criteria into one weighted list.
async function getCombinedCriteria(jobId) {
  const [general, specific] = await Promise.all([
    getGeneralParameters(),
    getJobParameters(jobId),
  ]);
  return [...(general || []), ...(specific || [])];
}

module.exports = {
  BASE,
  listJobs,
  getGeneralParameters,
  getJobParameters,
  getKillerQuestions,
  getJobInfo,
  getRecruiters,
  getSettings,
  getCombinedCriteria,
};
