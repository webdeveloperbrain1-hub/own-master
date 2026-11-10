export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;
export const PASSWORD_REQUIREMENTS = 'Use at least 8 characters, including a lowercase letter, uppercase letter, number, and special character.';

export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return '/dashboard';
  try {
    const url = new URL(value, 'https://ownmasters.invalid');
    if (
      url.origin !== 'https://ownmasters.invalid' ||
      (url.pathname !== '/dashboard' && !url.pathname.startsWith('/dashboard/'))
    )
      return '/dashboard';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/dashboard';
  }
}

export function passwordValidation(
  password: string,
  confirmation: string,
): string {
  if (Array.from(password).length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Use no more than ${MAX_PASSWORD_LENGTH} characters for your password.`;
  if (!/\p{Ll}/u.test(password) || !/\p{Lu}/u.test(password) || !/\p{Nd}/u.test(password) || !/[\p{P}\p{S}]/u.test(password))
    return 'Include at least one lowercase letter, uppercase letter, number, and special character.';
  if (password !== confirmation) return 'Your passwords do not match.';
  return '';
}

export function authErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : '';
}

export function authErrorMessage(error: unknown): string {
  switch (authErrorCode(error)) {
    case 'invalid_credentials':
      return 'Your email or password is incorrect. Please try again.';
    case 'email_not_confirmed':
      return 'Confirm your email before logging in. You can resend the confirmation below.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a moment before trying again.';
    case 'signup_disabled':
      return 'Account sign-up is currently unavailable. Please try again later.';
    case 'same_password':
      return 'Choose a password different from your current one.';
    case 'reauthentication_needed':
      return 'Request a fresh password-reset link, then try again.';
    case 'session_not_found':
    case 'session_expired':
      return 'Your sign-in has expired. Log in again or request a new reset link.';
  }
  if (error instanceof Error) {
    if (/fetch|network|load failed|timeout|timed out/i.test(error.message))
      return 'We could not reach the account service. Please try again shortly.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export function hasAuthLinkError(search: string, hash: string): boolean {
  return [search, hash].some((part) => {
    const params = new URLSearchParams(part.replace(/^[?#]/, ''));
    return (
      params.has('error') ||
      params.has('error_code') ||
      params.has('error_description')
    );
  });
}
