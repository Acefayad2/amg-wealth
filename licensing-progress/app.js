const phases = [
  ['Getting started', [['php_account', 'Activate your PHP account', 'Your recruiter can help if you need a code.']]],
  ['Prepare for your exam', [['exam_booked', 'Book your state exam', 'Add the date with your AMG team.'], ['state_exam_passed', 'Pass the state exam', 'AMG confirms your official result.']]],
  ['Apply for your license', [['license_application', 'Submit your license application'], ['fingerprints', 'Complete fingerprints, if required'], ['license_uploaded', 'Upload your license to AMG']]],
  ['Get appointed', [['aml_course', 'Finish your AML course'], ['ce_courses', 'Finish required courses'], ['eo_active', 'Activate E&O coverage'], ['carrier_request', 'Submit carrier appointment request'], ['appointed', 'Carrier appointment confirmed', 'AMG confirms this milestone.']]],
  ['First check', [['first_check', 'First check received', 'AMG confirms this milestone.']]],
];
const adminOnly = new Set(['state_exam_passed', 'appointed', 'first_check']);
const flat = phases.flatMap(([, items]) => items);
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let person;
function draw() {
  const count = flat.filter(([key]) => person.tasks?.[key]?.done === true).length;
  const percent = Math.round(count / flat.length * 100);
  $('#person-name').textContent = person.name;
  $('#percent').textContent = `${percent}%`;
  $('#progress-fill').style.width = `${percent}%`;
  const next = flat.find(([key]) => person.tasks?.[key]?.done !== true);
  $('#next-step').textContent = next ? `Next step: ${next[1]}` : 'Every step is complete. Congratulations!';
  $('#checklist').innerHTML = phases.map(([phase, items]) => `<section class="phase"><h3>${esc(phase)}</h3>${items.map(([key, label, help]) => `<label class="task${person.tasks?.[key]?.done ? ' confirmed' : ''}"><input type="checkbox" data-task="${key}" ${person.tasks?.[key]?.done ? 'checked' : ''} ${adminOnly.has(key) ? 'disabled' : ''}><span>${esc(label)}<small>${esc(help || (adminOnly.has(key) ? 'Confirmed by your AMG team.' : 'Check this when you finish.'))}</small></span></label>`).join('')}</section>`).join('');
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
    const response = await fetch('/api/licensing-pipeline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'set_task', task: input.dataset.task, done: input.checked }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Could not save your update.');
    person = payload.person; draw(); $('#status').textContent = 'Saved.';
  } catch (error) { input.checked = !input.checked; input.disabled = false; $('#status').textContent = error.message || 'Could not save your update.'; }
});
load();
