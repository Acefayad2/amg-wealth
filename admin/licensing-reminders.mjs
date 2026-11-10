import { licensingProgress } from '../licensing-progress/steps.js';
import { normalizeUsPhone } from '../netlify/functions/_shared/us-phone.mjs';

const checklistUrl = 'https://anointedmoneygroup.com/licensing-progress/';
const dayKey = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function licensingReminder(person, now = new Date()) {
  const firstName = String(person.name || '').trim().split(/\s+/)[0] || 'there';
  const track = { life: 'Life', health: 'Health', both: 'Life and Health' }[person.track] || 'licensing';
  const current = licensingProgress(person).current;
  const examDay = /^\d{4}-\d{2}-\d{2}$/.test(person.exam_date || '') ? new Date(`${person.exam_date}T12:00:00Z`) : null;
  const examDate = examDay && !Number.isNaN(examDay.valueOf()) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' }).format(examDay) : null;
  const steps = [
    { subject: 'Let’s get your exam booked', text: `Your next step is to book your ${track} exam. Once it’s scheduled, please send us the date. If you need help booking it, reply here.`, detail: 'Choose a date you can prepare for, book through your exam provider, and let your licensing coordinator know when you are scheduled.' },
    { subject: 'Checking in on your exam', text: `You’re at the ${track} exam step. Keep working through your practice questions, and let us know when you have your result. Need help preparing? Reply here.`, detail: 'Continue your study plan and practice exams. Once you have your official result, share it with your licensing coordinator so we can update your progress.' },
    { subject: 'Next up: your license', text: 'Your next step is to buy your state license and upload a copy for your licensing coordinator. Let us know once both are done, or reply if you need help with the application.', detail: 'Complete the state license application and payment, then provide your issued license through your team’s upload process. Your licensing coordinator can help you find the right place to submit it.' },
    { subject: 'Let’s finish CE and E&O', text: 'Your next step is CE and E&O. Please finish any required CE and activate your E&O coverage, then send confirmation to your licensing coordinator. Not sure what applies to you? Reply here.', detail: 'Check with your licensing coordinator about the courses and coverage required for your situation. Complete those items and share confirmation so your team can move you forward.' },
    { subject: 'Next up: carrier appointments', text: 'You’re at carrier appointments. Please complete any requested carrier paperwork and let your licensing coordinator know what’s submitted or still pending. Reply if anything is holding you up.', detail: 'Review any carrier appointment requests from your team, complete the requested paperwork, and share what is submitted or still pending. Your licensing coordinator will confirm when the appointment is complete.' },
  ];
  let draft = steps[current] || { subject: 'Your licensing steps are complete', text: 'Congratulations! All five licensing steps are marked complete in your AMG checklist. Thank you for getting everything in. Reach out if you need help with what comes next.', detail: 'Your checklist is complete. Your licensing coordinator can help with your next onboarding steps or any updates to your records.' };
  if (current === 1 && person.exam_status === 'failed') {
    draft = { subject: 'Let’s plan your exam retake', text: `Let’s get your ${track} exam retake planned. Please review the areas you want help with and send us your new exam date when it’s booked. Reply here if you’d like help with your study plan.`, detail: 'Review the areas you need to strengthen with your licensing coordinator, continue your practice questions, and share your next exam date when it is booked.' };
  } else if (current === 1 && examDate) {
    const past = person.exam_date < dayKey(now);
    draft = past
      ? { subject: 'How did your exam go?', text: `How did your ${track} exam on ${examDate} go? Please send your result or let us know if the date changed so we can help with your next step.`, detail: 'Send your official result to your licensing coordinator. If you rescheduled, share the new date so your team can keep your progress up to date.' }
      : { ...draft, subject: `Your exam on ${examDate}`, text: `We have your ${track} exam scheduled for ${examDate}. Keep working through your practice questions, and send us your result afterward. If your date changes or you need help, reply here.` };
  }
  return {
    subject: `${firstName}, ${draft.subject.charAt(0).toLowerCase() + draft.subject.slice(1)} | AMG`,
    text: `Hi ${firstName}, it’s the AMG licensing team. ${draft.text}`,
    email: `Hi ${firstName},\n\n${draft.text}\n\n${draft.detail}\n\nYou can review your checklist here:\n${checklistUrl}\n\nReply to this email if you need a hand.\n\nAMG Licensing Team`,
  };
}

export function licensingReminderLinks(person, platform = {}, now = new Date()) {
  const draft = licensingReminder(person, now);
  const phone = normalizeUsPhone(person.phone);
  // Apple Messages uses &body; Android uses the SMS URI query form.
  const apple = /iPhone|iPad|iPod|Mac/i.test(`${platform.userAgent || ''} ${platform.platform || ''}`);
  return {
    text: phone ? `sms:${phone}${apple ? '&' : '?'}body=${encodeURIComponent(draft.text)}` : null,
    email: person.email ? `mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.email)}` : null,
  };
}

export function licensingGroupTextLink(person, platform = {}, now = new Date()) {
  const agent = normalizeUsPhone(person.phone);
  const upline = normalizeUsPhone(person.recruiter_phone);
  if (!agent || !upline || agent === upline) return null;
  const draft = licensingReminder(person, now);
  const name = String(person.recruiter || '').trim().split(/\s+/)[0];
  const text = name ? draft.text.replace(', it’s the AMG licensing team.', ` and ${name}, it’s the AMG licensing team.`) : draft.text;
  const apple = /iPhone|iPad|iPod|Mac/i.test(`${platform.userAgent || ''} ${platform.platform || ''}`);
  return `sms:${agent},${upline}${apple ? '&' : '?'}body=${encodeURIComponent(text)}`;
}
