import { licensingSteps, stepDone, licensingProgress } from './steps.js';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let person;
function draw() {
  const progress = licensingProgress(person);
  const percent = progress.percent;
  $('#person-name').textContent = person.name;
  $('#percent').textContent = `${percent}%`;
  $('#progress-fill').style.width = `${percent}%`;
  $('#next-step').textContent = progress.current < 0 ? 'All 5 steps complete. Congratulations!' : progress.label;
  $('#checklist').innerHTML = licensingSteps.map((step, index) => `<section class="phase${index === progress.current ? ' current' : ''}"><h3>Step ${index + 1} of 5${index === progress.current ? ' · Current step' : stepDone(person, step) ? ' · Complete' : ''}</h3><label class="task${stepDone(person, step) ? ' confirmed' : ''}"><input type="checkbox" data-task="${step.id}" ${stepDone(person, step) ? 'checked' : ''} ${step.official ? 'disabled' : ''}><span>${esc(step.label)}<small>${esc(step.help)}</small></span></label></section>`).join('');
  $('#workspace').hidden = false;
}
async function load() {
  try {
    const response = await fetch('/api/licensing-pipeline', { cache: 'no-store' });
    if (response.status === 401) { location.replace('/login/?next=' + encodeURIComponent('/licensing-progress/')); return; }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.person) throw new Error(payload.error || 'Could not load your checklist.');
    person = payload.person; draw(); $('#status').textContent = '';
    const progress = await fetch('/api/learning?report=1', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const tracks = progress?.tracks;
    if (tracks) $('#course-summary').innerHTML = ['life', 'health'].map((track) => {
      const value = tracks[track];
      return `<article><strong>${esc(track === 'life' ? 'Life' : 'Health')} · ${Number(value?.completedLessons || 0)} / ${Number(value?.totalLessons || 60)}</strong><span>Lessons completed in AMG Learning</span></article>`;
    }).join('');
  } catch (error) { $('#status').textContent = error.message || 'Could not load your checklist.'; }
}
$('#checklist').addEventListener('change', async (event) => {
  const input = event.target.closest('[data-task]'); if (!input) return;
  input.disabled = true;
  try {
    const response = await fetch('/api/licensing-pipeline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'set_step', task: input.dataset.task, done: input.checked }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not save your update.');
    person = payload.person; draw(); $('#status').textContent = 'Saved.';
  } catch (error) { input.checked = !input.checked; input.disabled = false; $('#status').textContent = error.message || 'Could not save your update.'; }
});
load();
