// Local-only storage. Nothing in this file ever talks to the network.
// This is the entire "source of truth" for the simulator — completely
// separate from HappyRecruiting's own history and from Ashby.
//
// Plain JSON file instead of a native SQLite binding on purpose: zero native
// dependencies to compile, so `npm install` just works everywhere.
const fs = require('fs');
const path = require('path');
const { randomUUID: uuid } = require('crypto');

const FILE = path.join(__dirname, 'dashboard.json');

function load() {
  if (!fs.existsSync(FILE)) {
    return { candidates: [], evaluations: [], messages: [], handoffs: [] };
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

let state = load();

function persist() { save(state); }

// ---------- candidates ----------

function listCandidates(filter) {
  let rows = [...state.candidates];
  if (filter && filter.stage) rows = rows.filter((c) => c.stage === filter.stage);
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function createCandidate({ name, email, phone, job_id, job_name, profile_text, source }) {
  const now = new Date().toISOString();
  const candidate = {
    id: uuid(), name, email: email || null, phone: phone || null, job_id, job_name, profile_text,
    stage: 'applied', source: source || 'manual', created_at: now, updated_at: now,
  };
  state.candidates.push(candidate);
  persist();
  return candidate;
}

function getCandidate(id) {
  return state.candidates.find((c) => c.id === id) || null;
}

function updateCandidateStage(id, stage) {
  const c = getCandidate(id);
  if (!c) return null;
  c.stage = stage;
  c.updated_at = new Date().toISOString();
  persist();
  return c;
}

function deleteCandidate(id) {
  state.candidates = state.candidates.filter((c) => c.id !== id);
  state.evaluations = state.evaluations.filter((e) => e.candidate_id !== id);
  state.messages = state.messages.filter((m) => m.candidate_id !== id);
  state.handoffs = state.handoffs.filter((h) => h.candidate_id !== id);
  persist();
}

// ---------- evaluations ----------

function addEvaluation(candidateId, type, passed, data) {
  const evalRow = {
    id: uuid(), candidate_id: candidateId, type, passed: !!passed, data,
    created_at: new Date().toISOString(),
  };
  state.evaluations.push(evalRow);
  persist();
  return evalRow;
}

function listEvaluations(candidateId) {
  return state.evaluations
    .filter((e) => e.candidate_id === candidateId)
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
}

// ---------- interview messages ----------

function addMessage(candidateId, role, content) {
  const msg = { id: uuid(), candidate_id: candidateId, role, content, created_at: new Date().toISOString() };
  state.messages.push(msg);
  persist();
  return msg;
}

function listMessages(candidateId) {
  return state.messages
    .filter((m) => m.candidate_id === candidateId)
    .sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
}

function clearMessages(candidateId) {
  state.messages = state.messages.filter((m) => m.candidate_id !== candidateId);
  persist();
}

// ---------- recruiter handoffs ----------

function addHandoff(candidateId, fields) {
  const handoff = {
    id: uuid(), candidate_id: candidateId, status: 'drafted',
    created_at: new Date().toISOString(), ...fields,
  };
  state.handoffs.push(handoff);
  persist();
  return handoff;
}

function getLatestHandoff(candidateId) {
  const rows = state.handoffs
    .filter((h) => h.candidate_id === candidateId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return rows[0] || null;
}

module.exports = {
  listCandidates, createCandidate, getCandidate, updateCandidateStage, deleteCandidate,
  addEvaluation, listEvaluations,
  addMessage, listMessages, clearMessages,
  addHandoff, getLatestHandoff,
};
