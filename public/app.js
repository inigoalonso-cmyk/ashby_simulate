const COLUMNS = [
  { stage: 'applied', label: 'Applied' },
  { stage: 'prescreen_passed', label: 'Prescreen: Passed' },
  { stage: 'prescreen_rejected', label: 'Prescreen: Rejected' },
  { stage: 'interview_in_progress', label: 'Interview: In progress' },
  { stage: 'interview_passed', label: 'Interview: Passed' },
  { stage: 'interview_failed', label: 'Interview: Failed' },
  { stage: 'recruiter_handoff', label: 'Recruiter Handoff' },
];

let jobs = [];
let candidates = [];
let currentInterviewCandidateId = null;

async function api(path, opts) {
  const res = await fetch(path, opts);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'request failed');
  return json.data;
}

function $(sel) { return document.querySelector(sel); }
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.target.closest('.modal').classList.add('hidden');
  });
});

async function loadJobs() {
  jobs = await api('/api/happyrecruiting/jobs');
  const opts = jobs.map((j) => `<option value="${j.id}" data-name="${escapeHtml(j.name)}">${escapeHtml(j.name)}</option>`).join('');
  $('#jobSelect').innerHTML = opts || '<option value="">No jobs found in HappyRecruiting</option>';
  $('#cJob').innerHTML = opts;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadCandidates() {
  candidates = await api('/api/candidates');
  renderBoard();
}

function renderBoard() {
  const board = $('#board');
  board.innerHTML = '';
  for (const col of COLUMNS) {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    const items = candidates.filter((c) => c.stage === col.stage);
    colEl.innerHTML = `<h3>${col.label} (${items.length})</h3>`;
    for (const c of items) {
      colEl.appendChild(renderCard(c));
    }
    board.appendChild(colEl);
  }
}

function renderCard(c) {
  const card = document.createElement('div');
  card.className = 'card';
  const actions = [];

  if (c.stage === 'applied') {
    actions.push(`<button data-action="prescreen" data-id="${c.id}">Run Prescreen</button>`);
  }
  if (c.stage === 'prescreen_passed') {
    actions.push(`<button data-action="start-interview" data-id="${c.id}">Start Agent Interview</button>`);
  }
  if (c.stage === 'interview_in_progress') {
    actions.push(`<button data-action="open-interview" data-id="${c.id}">Open chat</button>`);
  }
  if (c.stage === 'interview_passed') {
    actions.push(`<button data-action="handoff" data-id="${c.id}">Send to recruiter</button>`);
  }
  if (c.stage === 'recruiter_handoff') {
    actions.push(`<button data-action="view-handoff" data-id="${c.id}">View draft</button>`);
  }
  if (['prescreen_passed', 'prescreen_rejected'].includes(c.stage)) {
    actions.push(`<button class="secondary" data-action="view-prescreen" data-id="${c.id}">View score</button>`);
  }
  actions.push(`<button class="danger" data-action="delete" data-id="${c.id}">Delete</button>`);

  card.innerHTML = `
    <div class="name">${escapeHtml(c.name)}</div>
    <div class="job">${escapeHtml(c.job_name)}</div>
    <div class="actions">${actions.join('')}</div>
  `;
  return card;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try {
    if (action === 'prescreen') await runPrescreen(id);
    else if (action === 'view-prescreen') await viewPrescreen(id);
    else if (action === 'start-interview') await startInterview(id);
    else if (action === 'continue-interview') { closeModal('#prescreenModal'); await startInterview(id); }
    else if (action === 'open-interview') await openInterview(id);
    else if (action === 'handoff') await runHandoff(id);
    else if (action === 'view-handoff') await viewHandoff(id);
    else if (action === 'delete') await deleteCandidate(id);
  } catch (err) {
    alert(err.message);
  }
});

async function deleteCandidate(id) {
  if (!confirm('Remove this test candidate from the sandbox?')) return;
  await api(`/api/candidates/${id}`, { method: 'DELETE' });
  await loadCandidates();
}

// ---------- Add candidate ----------

$('#addCandidateBtn').addEventListener('click', () => openModal('#addCandidateModal'));

$('#saveCandidateBtn').addEventListener('click', async () => {
  const name = $('#cName').value.trim();
  const email = $('#cEmail').value.trim();
  const phone = $('#cPhone').value.trim();
  const jobSelect = $('#cJob');
  const job_id = jobSelect.value;
  const job_name = jobSelect.selectedOptions[0]?.dataset.name || '';
  const profile_text = $('#cProfile').value.trim();
  if (!name || !job_id || !profile_text) {
    alert('Name, job and profile text are required.');
    return;
  }
  const saveBtn = $('#saveCandidateBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Submitting…';
  try {
    const candidate = await api('/api/candidates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, phone, job_id, job_name, profile_text, source: 'manual' }),
    });
    $('#cName').value = ''; $('#cEmail').value = ''; $('#cPhone').value = ''; $('#cProfile').value = '';
    closeModal('#addCandidateModal');
    await loadCandidates();
    // Simulate "just applied" — run Prescreen immediately, no manual click needed.
    await runPrescreen(candidate.id);
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Submit application';
  }
});

// ---------- Layer 1: Prescreen ----------

async function runPrescreen(id) {
  const btn = document.querySelector(`button[data-action="prescreen"][data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Scoring…'; }
  try {
    await api(`/api/candidates/${id}/prescreen`, { method: 'POST' });
    await loadCandidates();
    await viewPrescreen(id);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Prescreen'; }
  }
}

async function viewPrescreen(id) {
  const { candidate, evaluations } = await api(`/api/candidates/${id}`);
  const evals = evaluations.filter((e) => e.type === 'prescreen');
  const last = evals[evals.length - 1];
  if (!last) { alert('No prescreen evaluation yet.'); return; }
  const d = last.data;
  const breakdown = (d.criteria_breakdown || []).map((c) => `
    <div class="criterion-row"><strong>${escapeHtml(c.criterion)}</strong> (weight ${c.weight})<br/>${escapeHtml(c.assessment)}</div>
  `).join('') || '<p class="hint">No per-criterion breakdown returned.</p>';
  const flags = (d.killer_question_flags || []).map((k) => `
    <div class="kq-flag ${k.concerning ? 'concerning' : ''}">${k.concerning ? '⚠️' : '✅'} "${escapeHtml(k.question)}" — expects pass=${k.expected_pass_answer}, likely answer: ${k.likely_answer}</div>
  `).join('') || '<p class="hint">No killer questions configured for this job.</p>';

  $('#prescreenBody').innerHTML = `
    <div class="score-pill ${last.passed ? 'pass' : 'fail'}">Score: ${d.score}/10 — ${last.passed ? 'PASSED' : 'REJECTED'} (threshold ${d.pass_threshold})</div>
    <p>${escapeHtml(d.rationale)}</p>
    <h3>Criteria breakdown</h3>
    ${breakdown}
    <h3>Killer questions</h3>
    ${flags}
    ${candidate.stage === 'prescreen_passed' ? `<div class="modal-actions" style="justify-content:flex-start;margin-top:16px;">
      <button data-action="continue-interview" data-id="${candidate.id}">Continue to Agent Interview →</button>
    </div>` : ''}
  `;
  openModal('#prescreenModal');
}

// ---------- Layer 2: Agent Interview ----------

async function startInterview(id) {
  await api(`/api/candidates/${id}/interview/start`, { method: 'POST' });
  await loadCandidates();
  await openInterview(id);
}

async function openInterview(id) {
  currentInterviewCandidateId = id;
  const { candidate, messages } = await api(`/api/candidates/${id}`);
  $('#interviewCandidateName').textContent = candidate.name;
  renderChat(messages);
  openModal('#interviewModal');
}

function renderChat(messages) {
  const log = $('#chatLog');
  log.innerHTML = messages.map((m) => `
    <div class="chat-msg ${m.role}">
      <div class="who">${m.role === 'agent' ? 'Carlos (AI)' : 'You (candidate)'}</div>
      ${escapeHtml(m.content)}
    </div>
  `).join('');
  log.scrollTop = log.scrollHeight;
}

$('#chatSendBtn').addEventListener('click', sendChat);
$('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const input = $('#chatInput');
  const content = input.value.trim();
  if (!content || !currentInterviewCandidateId) return;
  input.value = '';
  input.disabled = true;
  try {
    await api(`/api/candidates/${currentInterviewCandidateId}/interview/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const { messages } = await api(`/api/candidates/${currentInterviewCandidateId}`);
    renderChat(messages);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

$('#finishInterviewBtn').addEventListener('click', async () => {
  if (!currentInterviewCandidateId) return;
  const { evaluation, stage } = await api(`/api/candidates/${currentInterviewCandidateId}/interview/finish`, { method: 'POST' });
  closeModal('#interviewModal');
  await loadCandidates();
  alert(`Interview judged: ${evaluation.passed ? 'PASSED' : 'FAILED'}\n\n${evaluation.overall_rationale}`);
});

// ---------- Layer 3: Recruiter handoff ----------

async function runHandoff(id) {
  await api(`/api/candidates/${id}/handoff`, { method: 'POST' });
  await loadCandidates();
  await viewHandoff(id);
}

async function viewHandoff(id) {
  const { handoff } = await api(`/api/candidates/${id}`);
  if (!handoff) { alert('No handoff draft yet.'); return; }
  $('#handoffBody').innerHTML = `
    <p><strong>To:</strong> ${escapeHtml(handoff.recruiter_email || '(no recruiter email configured in HappyRecruiting for this job)')}</p>
    <p><strong>Subject:</strong> ${escapeHtml(handoff.email_subject)}</p>
    <pre style="white-space:pre-wrap;font-family:inherit;background:#f4f5f7;padding:10px;border-radius:8px;">${escapeHtml(handoff.email_body)}</pre>
    <p class="hint">Status: ${handoff.status} — this is a draft only. Nothing gets emailed or booked automatically.</p>
  `;
  openModal('#handoffModal');
}

// ---------- Init ----------

(async function init() {
  await loadJobs();
  await loadCandidates();
})();
