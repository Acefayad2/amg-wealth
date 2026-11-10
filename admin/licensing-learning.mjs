const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const date = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { dateStyle:'medium', timeStyle:'short' }).format(new Date(value)) : 'No saved activity';

export function learnerProgressCard(learner) {
  const courses = learner.courses || [{ id:'life', title:'Life insurance', completedLessons:learner.completedLessons || 0, totalLessons:learner.totalLessons || 60, lessons:[] }];
  const attempts = learner.attempts || [];
  const courseMarkup = courses.map(course => {
    const lessons = course.lessons || [];
    const current = lessons.filter(lesson => lesson.lastActiveAt).sort((a,b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0];
    const exams = attempts.filter(attempt => attempt.track ? attempt.track === course.id : (course.id === 'health') === /health/i.test(attempt.title));
    const mockExams = exams.filter(attempt => attempt.kind !== 'diagnostic' && !/diagnostic/i.test(attempt.title));
    return `<section class="learner-course" aria-label="${escape(course.title)} progress">
      <div class="learner-course-heading"><h3>${escape(course.title)}</h3><span>${Number(course.completedLessons)} / ${Number(course.totalLessons)} lessons</span></div>
      <progress max="${Math.max(1, Number(course.totalLessons))}" value="${Number(course.completedLessons)}" aria-label="${escape(course.title)} lessons completed"></progress>
      <p class="learner-current">${current ? `Last lesson: ${escape(current.title)}` : 'Coursework not started'}</p>
      ${lessons.length ? `<details class="learner-lessons" data-progress-detail="${escape(learner.learnerId)}-${escape(course.id)}-lessons"><summary>View lesson checklist</summary><ul>${lessons.map(lesson => `<li><span class="lesson-state${lesson.complete ? ' complete' : ''}">${lesson.complete ? '✓ Complete' : lesson.lastActiveAt ? 'In progress' : 'Not started'}</span><span>${escape(lesson.title)}</span></li>`).join('')}</ul></details>` : ''}
      <details class="learner-exams" data-progress-detail="${escape(learner.learnerId)}-${escape(course.id)}-exams" ${exams.length ? 'open' : ''}><summary>Mock exams · ${mockExams.filter(exam => exam.status === 'completed').length} finished · ${mockExams.filter(exam => exam.status !== 'completed').length} unfinished</summary>
        ${exams.length ? `<div class="attempt-list">${exams.map(exam => `<article class="attempt-row"><div><strong>${escape(exam.title)}</strong><span>${Number(exam.answered)} of ${Number(exam.total)} questions answered</span><span>${exam.status === 'completed' ? `Finished ${escape(date(exam.submittedAt))}` : `Started ${escape(date(exam.startedAt))}`}</span></div><span class="attempt-status${exam.status === 'completed' ? ' completed' : ''}">${exam.status === 'completed' ? `Score ${Number(exam.scorePercent)}%` : 'In progress'}</span><progress max="${Math.max(1, Number(exam.total))}" value="${Number(exam.answered)}" aria-label="${escape(exam.title)} questions answered"></progress></article>`).join('')}</div>` : '<p class="learner-current">No exam attempts yet.</p>'}
      </details></section>`;
  }).join('');
  return `<article class="learner-card"><header><div><h3 class="learner-name">${escape(learner.name || learner.email)}</h3><span class="learner-email">${escape(learner.email)}</span></div><span class="learner-active">Last active ${escape(date(learner.lastActiveAt))}</span></header><div class="learner-courses">${courseMarkup}</div><button type="button" class="secondary" data-license-learner="${escape(encodeURIComponent(JSON.stringify({ name:learner.name, email:learner.email })))}">Track person in pipeline</button></article>`;
}
