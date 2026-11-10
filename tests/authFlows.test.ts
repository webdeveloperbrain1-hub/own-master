import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  authErrorMessage,
  hasAuthLinkError,
  passwordValidation,
  safeReturnPath,
} from '../src/app/auth/authFlows.ts';

test('return links preserve a contract page, query, and fragment', () => {
  const path = '/dashboard/contracts/drafts/example/edit?project=song#document';
  assert.equal(safeReturnPath(path), path);
});
test('return links reject external and escaped destinations', () => {
  for (const path of [
    null,
    '',
    '//evil.test/dashboard',
    'https://evil.test',
    '/dashboard/../../login',
    '/dashboard-other',
    '/\\evil.test/dashboard',
    '/dashboard\n/evil',
  ])
    assert.equal(safeReturnPath(path), '/dashboard');
});
test('password confirmation catches mistakes before submitting credentials', () => {
  assert.match(passwordValidation('Aa1!abc', 'Aa1!abc'), /at least 8/);
  assert.equal(
    passwordValidation('Abcdef1!', 'different-password'),
    'Your passwords do not match.',
  );
  assert.equal(passwordValidation('Abcdef1!', 'Abcdef1!'), '');
  assert.match(passwordValidation('x'.repeat(257), 'x'.repeat(257)), /no more than 256/);
  for (const password of ['ABCDEF1!', 'abcdef1!', 'Abcdefg!', 'Abcdef12', 'Abcdef1 '])
    assert.match(passwordValidation(password, password), /lowercase letter, uppercase letter, number, and special character/);
  assert.equal(passwordValidation('Éabcde1!', 'Éabcde1!'), '');
  assert.equal(passwordValidation('Abcdef1_', 'Abcdef1_'), '');
  assert.match(passwordValidation('Aa1!😀😀', 'Aa1!😀😀'), /at least 8/);
});
test('expired links offer recovery rather than treating the visitor as signed in', () => {
  assert.equal(
    hasAuthLinkError('', '#error=access_denied&error_code=otp_expired'),
    true,
  );
  assert.equal(hasAuthLinkError('?error_description=Expired', ''), true);
  assert.equal(hasAuthLinkError('', '#token=test-only-value'), false);
});
test('connection and login errors have useful messages', () => {
  assert.match(
    authErrorMessage(new TypeError('Failed to fetch')),
    /could not reach the account service/,
  );
  assert.match(
    authErrorMessage({ code: 'invalid_credentials' }),
    /email or password is incorrect/,
  );
  assert.match(
    authErrorMessage({ code: 'over_request_rate_limit' }),
    /wait a moment/,
  );
});
