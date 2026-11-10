type RegistrationAuthError = { code?: string; message?: string; status?: number };

export function registrationAuthFailure(error: RegistrationAuthError | null | undefined) {
  if (error?.code === 'weak_password') return {
    status: 400, field: 'password',
    error: 'Choose a unique password. This one is commonly used or has appeared in a data breach.',
  };
  const message = error?.message?.toLowerCase() || '';
  if (['email_exists', 'user_already_exists'].includes(error?.code || '') || message.includes('already') || message.includes('registered')) return {
    status: 409, field: 'email', error: 'A CFT account already exists for this email. Use trainer login instead.',
  };
  if (error?.code === 'email_address_invalid') return { status: 400, field: 'email', error: 'Enter a valid work email address.' };
  return { status: 503, field: '', error: 'Account creation is temporarily unavailable. Please try again shortly.' };
}
