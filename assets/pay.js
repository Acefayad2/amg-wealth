const form = document.querySelector('#payment-form');
const button = document.querySelector('#checkout-button');
const status = document.querySelector('#form-status');
const canceledNotice = document.querySelector('#canceled-notice');
const fields = {
  amount: document.querySelector('#amount'),
  name: document.querySelector('#name'),
  email: document.querySelector('#email'),
  description: document.querySelector('#description'),
  reference: document.querySelector('#reference')
};

const params = new URLSearchParams(window.location.search);
const queryValues = {
  amount: params.get('amount'),
  name: params.get('name'),
  email: params.get('email'),
  description: params.get('for') || params.get('description'),
  reference: params.get('reference')
};

Object.entries(queryValues).forEach(([key, value]) => {
  if (value && fields[key]) fields[key].value = value.slice(0, key === 'email' ? 160 : 120);
});

if (params.get('canceled') === '1') canceledNotice.hidden = false;

function setError(name, message) {
  const field = fields[name];
  const error = document.querySelector(`#${name}-error`);
  if (!field || !error) return;
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
  error.textContent = message;
}

function validate() {
  const amount = Number(fields.amount.value);
  const values = {
    amount,
    name: fields.name.value.trim(),
    email: fields.email.value.trim(),
    description: fields.description.value.trim(),
    reference: fields.reference.value.trim()
  };

  const errors = {
    amount: Number.isFinite(amount) && amount >= 1 && amount <= 50000 ? '' : 'Enter an amount from $1 to $50,000.',
    name: values.name ? '' : 'Enter your full name.',
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email) ? '' : 'Enter a valid email address.',
    description: values.description ? '' : 'Tell us what this payment is for.'
  };

  Object.entries(errors).forEach(([name, message]) => setError(name, message));
  const firstError = Object.entries(errors).find(([, message]) => message);
  if (firstError) {
    fields[firstError[0]].focus();
    return null;
  }
  return values;
}

Object.keys(fields).forEach((name) => {
  fields[name].addEventListener('input', () => {
    if (name !== 'reference') setError(name, '');
    status.textContent = '';
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = validate();
  if (!values) return;

  const originalLabel = button.querySelector('span').textContent;
  button.disabled = true;
  button.querySelector('span').textContent = 'Preparing secure checkout';
  status.textContent = '';

  try {
    const response = await fetch('/api/amg-checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...values, requestId: crypto.randomUUID() })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) throw new Error(result.error || 'Checkout could not be started. Please try again.');
    window.location.assign(result.url);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Checkout could not be started. Please try again.';
    button.disabled = false;
    button.querySelector('span').textContent = originalLabel;
  }
});
