import { createHash } from 'node:crypto';
import { createMockBank } from './mock-rotation.mjs';
import { schema } from './learning-schema.mjs';

export { schema };
// Tracks (for example Health) share the lesson rules and, once they have forms, the assessment rules.
export const tracks = Object.values(schema.tracks || {});
export const lessonByKey = new Map([...schema.lessons, ...tracks.flatMap(track => track.lessons)].map(lesson => [lesson.key, lesson]));
function assessmentSchema(track,key,version,lessons,forms,extras) {
  const bank=createMockBank(track,forms,extras);
  return {key,version,forms,bank,lessonKeys:new Set(lessons.map(l=>l.key)),formById:new Map(forms.map(f=>[f.id,f])),
    questionIds:new Set([...lessons.flatMap(l=>l.questions),...forms.flatMap(f=>f.questions),...extras].map(q=>q.id))};
}
const lifeAssessment = assessmentSchema('life',schema.assessmentKey,schema.assessmentVersion,schema.lessons,schema.forms,schema.extraQuestions);
export const assessmentSchemas = new Map([lifeAssessment,...tracks.filter(t=>t.forms.length).map(t=>assessmentSchema(t.id,t.assessmentKey,t.assessmentVersion,t.lessons,t.forms,t.extraQuestions))].map(s=>[s.key,s]));
export const formById = lifeAssessment.formById;
export const allowedKeys = [...lessonByKey.keys(), ...assessmentSchemas.keys()];
const MAX_ATTEMPTS = 500;
const DAY = 86400000;

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const assert = (valid, message) => { if (!valid) throw new InputError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function fields(value, allowed, required = allowed) {
  assert(object(value), 'Expected an object');
  assert(Object.keys(value).every(key => allowed.includes(key)), 'Unexpected field');
  assert(required.every(key => own(value, key)), 'Missing field');
}
function string(value, max = 160) { assert(typeof value === 'string' && value.length > 0 && value.length <= max, 'Invalid text field'); }
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function numericTime(value, now, future = 300000) { assert(Number.isFinite(value) && value > 0 && value <= now + future, 'Invalid timestamp'); }
function isoTime(value, now) { assert(typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)), 'Invalid date'); numericTime(Date.parse(value), now); }
function array(value, length, check) { assert(Array.isArray(value) && value.length === length && value.every(check), 'Invalid answer or state array'); }
const choice = (answer, question) => answer === null || integer(answer, 0, question.options - 1);
const bool = value => typeof value === 'boolean';

export function validateLesson(value, lesson, now) {
  fields(value, ['practiceAttemptId', 'answers', 'firstAnswers', 'firstAnswerAt', 'attempts', 'videoEnded', 'transcriptRead', 'complete', 'position', 'completedAt']);
  string(value.practiceAttemptId);
  const n = lesson.questions.length;
  array(value.answers, n, (answer, i) => choice(answer, lesson.questions[i]));
  array(value.firstAnswers, n, (answer, i) => choice(answer, lesson.questions[i]));
  array(value.attempts, n, count => integer(count, 0, 1000000));
  array(value.firstAnswerAt, n, at => at === null || (isoTime(at, now), true));
  assert([value.videoEnded, value.transcriptRead, value.complete].every(bool), 'Invalid completion flags');
  assert(Number.isFinite(value.position) && value.position >= 0 && value.position <= lesson.maxPosition, 'Invalid playback position');
  if (value.completedAt !== null) isoTime(value.completedAt, now);
  const ready = value.videoEnded || value.transcriptRead;
  value.answers.forEach((answer, i) => {
    assert(answer === null || (ready && value.firstAnswers[i] !== null && value.attempts[i] > 0), 'Answers require content completion and attempt evidence');
    assert(value.firstAnswers[i] === null ? value.firstAnswerAt[i] === null && value.attempts[i] === 0 : ready && value.attempts[i] > 0, 'Invalid first-answer evidence');
  });
  assert(!value.complete || (ready && value.completedAt !== null && value.answers.every((answer, i) => answer === lesson.questions[i].answer)), 'Completion requires content and every correct answer');
  return value;
}

export function validateAssessment(value, now, previous = null, assessment = lifeAssessment) {
  const { formById, questionIds, bank } = assessment;
  fields(value, ['version', 'attempts', 'seen', 'reviews', 'lessonImports']);
  assert(value.version === assessment.version, 'Unsupported assessment version');
  assert(Array.isArray(value.attempts) && value.attempts.length <= MAX_ATTEMPTS, 'Too many assessment attempts');
  assert(Array.isArray(value.seen) && value.seen.length <= assessment.forms.length + 1 && new Set(value.seen).size === value.seen.length && value.seen.every(id => id === bank.id || formById.has(id)), 'Invalid form history');
  const used = new Set();
  for (const attempt of value.attempts) {
    fields(attempt, ['id', 'form', 'startedAt', 'deadline', 'submittedAt', 'expired', 'fresh', 'answers', 'flags', 'uncertain', 'reviewed', 'current', ...(attempt?.form === bank.id ? ['questionIds'] : [])]);
    string(attempt.id);
    assert(!used.has(attempt.id), 'Duplicate attempt ID'); used.add(attempt.id);
    const form = bank.formFor(attempt); assert(form, 'Unknown assessment form or invalid track question set');
    numericTime(attempt.startedAt, now);
    assert(attempt.deadline === (form.minutes ? attempt.startedAt + form.minutes * 60000 : null), 'Timer deadline cannot change');
    if (attempt.submittedAt !== null) {
      numericTime(attempt.submittedAt, now);
      assert(attempt.submittedAt >= attempt.startedAt, 'Submission precedes attempt');
      assert(!attempt.deadline || attempt.submittedAt <= attempt.deadline, 'Submission exceeds timer deadline');
    }
    assert([attempt.expired, attempt.fresh].every(bool), 'Invalid attempt flags');
    assert(!attempt.expired || (attempt.deadline !== null && attempt.submittedAt === attempt.deadline), 'Invalid expired attempt');
    const n = form.questions.length;
    array(attempt.answers, n, (answer, i) => choice(answer, form.questions[i]));
    for (const key of ['flags', 'uncertain', 'reviewed']) array(attempt[key], n, bool);
    assert(integer(attempt.current, 0, n - 1), 'Invalid current question');
    assert(value.seen.includes(attempt.form), 'Attempt missing from form history');
  }
  if (previous) {
    const nextById = new Map(value.attempts.map(attempt => [attempt.id, attempt]));
    for (const old of previous.attempts) {
      const next = nextById.get(old.id);
      assert(next, 'Saved attempt history cannot be removed');
      for (const key of ['form', 'startedAt', 'deadline', 'fresh']) assert(next[key] === old[key], 'Saved attempt identity cannot change');
      if (old.questionIds) assert(canonical(next.questionIds) === canonical(old.questionIds), 'Saved mock questions cannot change');
      if (old.submittedAt !== null) {
        for (const key of ['answers', 'submittedAt', 'expired']) assert(canonical(next[key]) === canonical(old[key]), 'Submitted answers and result cannot change');
      }
    }
    assert(previous.seen.every(id => value.seen.includes(id)), 'Form exposure history cannot be removed');
  }
  assert(object(value.reviews) && Object.keys(value.reviews).length <= questionIds.size, 'Invalid review queue');
  for (const [id, review] of Object.entries(value.reviews)) {
    assert(questionIds.has(id), 'Unknown review question');
    fields(review, ['stage', 'nextDue', 'history', 'lastMissAt', 'lastMissId']);
    assert(integer(review.stage, 0, 3), 'Invalid review stage');
    numericTime(review.nextDue, now, 8 * DAY);
    if (review.lastMissAt !== null) numericTime(review.lastMissAt, now);
    if (review.lastMissId !== null) string(review.lastMissId, 360);
    assert(Array.isArray(review.history) && review.history.length <= 1000, 'Review history too large');
    for (const entry of review.history) {
      fields(entry, ['questionId', 'at', 'correct']);
      assert(questionIds.has(entry.questionId) && bool(entry.correct), 'Invalid reviewed question');
      numericTime(entry.at, now);
    }
  }
  assert(object(value.lessonImports) && Object.keys(value.lessonImports).length <= assessment.lessonKeys.size, 'Invalid lesson review imports');
  for (const [key, fingerprint] of Object.entries(value.lessonImports)) { assert(assessment.lessonKeys.has(key), 'Unknown imported lesson for this track'); string(fingerprint, 6000); }
  return value;
}

export function validateValue(key, value, now, previous) {
  assert(allowedKeys.includes(key), 'Unknown progress key');
  const assessment = assessmentSchemas.get(key);
  return assessment ? validateAssessment(value, now, previous, assessment) : validateLesson(value, lessonByKey.get(key), now);
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export const userPrefix = uid => 'users/' + hash(uid) + '/';
const percent = (correct, total) => total ? Math.round(correct / total * 10000) / 100 : null;
const iso = value => value === null || value === undefined ? null : new Date(value).toISOString();

export function scoreAttempt(attempt, assessment = lifeAssessment) {
  const form = assessment.bank.formFor(attempt);
  const scored = form.questions.map((q, i) => ({ q, i })).filter(({ q }) => q.scored);
  const unscored = form.questions.map((q, i) => ({ q, i })).filter(({ q }) => !q.scored);
  const correct = scored.filter(({ q, i }) => attempt.answers[i] === q.answer).length;
  return { correct, total: scored.length, percentage: percent(correct, scored.length), unscoredCorrect: unscored.filter(({ q, i }) => attempt.answers[i] === q.answer).length, unscoredTotal: unscored.length };
}

function submittedAttempts(records, assessment) {
  if (!assessment) return [];
  const saved = [...(records[assessment.key]?.value.attempts || [])].sort((a, b) => a.startedAt - b.startedAt);
  const seen = new Set();
  const results = [];
  for (const attempt of saved) {
    const form = assessment.bank.formFor(attempt);
    const fresh = form.questions.every(q=>!seen.has(q.id));
    for (const q of form.questions) seen.add(q.id);
    if (attempt.submittedAt === null) continue;
    results.push({
      attemptId: attempt.id, formId: attempt.form, title: form.title,
      startedAt: iso(attempt.startedAt), submittedAt: iso(attempt.submittedAt), expired: attempt.expired,
      fresh, ...scoreAttempt(attempt, assessment),
    });
  }
  return results.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export function buildReport(user, records) {
  const lessons = schema.lessons.map(lesson => {
    const record = records[lesson.key], value = record?.value;
    const ready = value?.videoEnded === true || value?.transcriptRead === true;
    const correct = ready ? lesson.questions.filter((q, i) => value.answers[i] === q.answer).length : 0;
    const complete = Boolean(ready && value?.complete === true && correct === lesson.questions.length);
    return { lessonId: lesson.id, title: lesson.title, complete, completedAt: complete ? record.firstCompletedAt || value.completedAt : null, correct, total: lesson.questions.length, firstCorrect: ready ? lesson.questions.filter((q, i) => value.firstAnswers[i] === q.answer).length : 0, firstAnswered: ready ? value.firstAnswers.filter(answer => answer !== null).length : 0, position: value?.position || 0, lastActiveAt: record?.updatedAt || null };
  });
  const attempts = submittedAttempts(records, lifeAssessment);
  const completedLessons = lessons.filter(lesson => lesson.complete).length;
  const diagnostic = attempts.filter(attempt => attempt.formId === 'D').at(-1);
  const mocks = attempts.filter(attempt => attempt.formId !== 'D');
  const active = lessons.filter(lesson => lesson.lastActiveAt).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0];
  const timestamps = Object.values(records).map(record => record.updatedAt).filter(Boolean).sort();
  const trackReports = Object.fromEntries(tracks.map(track => {
    const items = track.lessons.map(lesson => { const value = records[lesson.key]?.value; const ready = value?.videoEnded === true || value?.transcriptRead === true; const correct = ready ? lesson.questions.filter((q, i) => value.answers[i] === q.answer).length : 0; return { lessonId: lesson.id, title: lesson.title, complete: Boolean(ready && value?.complete === true && correct === lesson.questions.length), correct, total: lesson.questions.length, lastActiveAt: records[lesson.key]?.updatedAt || null }; });
    const attempts = submittedAttempts(records, assessmentSchemas.get(track.assessmentKey));
    const mocks = attempts.filter(attempt => attempt.formId !== 'D');
    return [track.id, {
      completedLessons: items.filter(item => item.complete).length, totalLessons: items.length, lessons: items,
      attempts, practiceAttempts: attempts.length, latestMockScore: mocks.at(-1)?.percentage ?? null,
      bestMockScore: mocks.length ? Math.max(...mocks.map(attempt => attempt.percentage)) : null,
    }];
  }));
  return { summary: { uid: user.id, name: user.name || '', email: user.email, completedLessons, totalLessons: 60, progressPercent: percent(completedLessons, 60), currentLesson: active?.lessonId || null, lastActiveAt: timestamps.at(-1) || null, questionMastery: percent(lessons.reduce((count, lesson) => count + lesson.correct, 0), lessons.reduce((count, lesson) => count + lesson.total, 0)), diagnosticScore: diagnostic?.percentage ?? null, bestMockScore: mocks.length ? Math.max(...mocks.map(attempt => attempt.percentage)) : null, latestMockScore: mocks.at(-1)?.percentage ?? null, practiceAttempts: attempts.length, courseCompletedAt: completedLessons === 60 ? lessons.map(lesson => lesson.completedAt).sort().at(-1) : null }, lessons, attempts, tracks: trackReports };
}

// Position and active-question navigation remain cloud-saved without a Sheets write.
export function reportingSignature(key, value) {
  if (assessmentSchemas.has(key)) return hash((value?.attempts || []).filter(attempt => attempt.submittedAt !== null).map(({ id, form, startedAt, submittedAt, expired, answers }) => ({ id, form, startedAt, submittedAt, expired, answers })));
  const empty = Array(lessonByKey.get(key).questions.length).fill(null);
  return hash({ answers: value?.answers || empty, firstAnswers: value?.firstAnswers || empty, complete: value?.complete === true, videoEnded: value?.videoEnded === true, transcriptRead: value?.transcriptRead === true });
}
