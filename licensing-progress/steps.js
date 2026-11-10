export const licensingSteps = [
  { id: 'exam_booked', label: 'Book exam', tasks: ['exam_booked'], help: 'Schedule your state licensing exam.' },
  { id: 'state_exam_passed', label: 'Pass exam', tasks: ['state_exam_passed'], official: true, help: 'Your AMG team confirms your passing result.' },
  { id: 'license_uploaded', label: 'Buy and upload license', tasks: ['license_application', 'license_uploaded'], help: 'Purchase your state license and upload it to AMG.' },
  { id: 'ce_courses', label: 'CE and E&O', tasks: ['ce_courses', 'eo_active'], help: 'Complete required CE and activate your E&O coverage.' },
  { id: 'appointed', label: 'Appointment with carriers', tasks: ['appointed'], official: true, help: 'Your AMG team confirms your carrier appointment.' },
];
export function taskDone(person, key) {
  const stored = person.tasks?.[key]?.done;
  if (typeof stored === 'boolean') return stored;
  if (key === 'state_exam_passed') return person.exam_status === 'passed';
  if (key === 'exam_booked') return !!person.exam_date || ['scheduled', 'rescheduled', 'passed'].includes(person.exam_status);
  return false;
}
export const stepDone = (person, step) => step.tasks.every(key => taskDone(person, key));
export function licensingProgress(person) {
  const completed = licensingSteps.filter(step => stepDone(person, step)).length;
  const current = licensingSteps.findIndex(step => !stepDone(person, step));
  return { completed, percent: completed * 20, current, label: current < 0 ? 'Licensing complete' : `Step ${current + 1} of 5 · ${licensingSteps[current].label}` };
}
export function stepUpdates(selected, source) {
  const updatedAt = new Date().toISOString();
  return Object.fromEntries(licensingSteps.flatMap(step => step.tasks.map(key => [key, { done: selected.includes(step.id), source, updatedAt }])));
}
