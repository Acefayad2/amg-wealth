const inquiryForm = document.querySelector('form[name="consultation"]');

if (inquiryForm && typeof crypto.randomUUID === 'function') {
  const button = inquiryForm.querySelector('button[type="submit"]');
  const buttonLabel = inquiryForm.querySelector('[data-inquiry-submit-label]');
  const errorNote = document.getElementById('inquiry-error');
  const statusNote = document.getElementById('inquiry-status');
  const submissionId = inquiryForm.elements.namedItem('submissionId');
  let pending = false;
  let completed = false;
  let previousPayload = '';
  const unconfirmedMessage = "We couldn't confirm your inquiry. Please try again. Your details are still here.";

  submissionId.value = crypto.randomUUID();

  inquiryForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || completed) return;

    const data = new FormData(inquiryForm);
    const payload = {
      fullName: String(data.get('full-name') || '').trim(),
      email: String(data.get('email') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      interest: String(data.get('interest') || '').trim(),
      message: String(data.get('goals') || '').trim(),
      botField: String(data.get('bot-field') || ''),
    };
    const serialized = JSON.stringify(payload);
    if (previousPayload && serialized !== previousPayload) submissionId.value = crypto.randomUUID();
    previousPayload = serialized;
    payload.submissionId = submissionId.value;

    pending = true;
    button.disabled = true;
    buttonLabel.textContent = 'Submitting…';
    inquiryForm.setAttribute('aria-busy', 'true');
    errorNote.hidden = true;
    errorNote.textContent = '';
    statusNote.textContent = 'Sending your inquiry…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let failureMessage = unconfirmedMessage;

    try {
      const response = await fetch('/.netlify/functions/submit-inquiry', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        failureMessage = [400, 422, 429].includes(response.status) && typeof result.error === 'string'
          ? result.error.slice(0, 300)
          : unconfirmedMessage;
        throw new Error('Inquiry was not confirmed.');
      }
      completed = true;
      statusNote.textContent = 'Inquiry received. Opening your confirmation…';
      window.location.assign('/thank-you.html');
    } catch {
      statusNote.textContent = '';
      errorNote.textContent = failureMessage;
      errorNote.hidden = false;
      errorNote.focus();
    } finally {
      clearTimeout(timeout);
      pending = false;
      inquiryForm.removeAttribute('aria-busy');
      if (!completed) {
        button.disabled = false;
        buttonLabel.textContent = 'Request My Consultation';
      }
    }
  });

  window.addEventListener('pageshow', event => {
    if (!event.persisted || !completed) return;
    completed = false;
    previousPayload = '';
    submissionId.value = crypto.randomUUID();
    button.disabled = false;
    buttonLabel.textContent = 'Request My Consultation';
    statusNote.textContent = '';
  });
}
