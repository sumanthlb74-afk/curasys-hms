import assert from 'node:assert/strict';
import test from 'node:test';
import { getApiErrorMessage } from './api-error-message.js';

test('API timeouts explain the cold start and warn against duplicate submissions', () => {
  const message = getApiErrorMessage({ code: 'ECONNABORTED' });
  assert.match(message, /90 seconds/);
  assert.match(message, /Render may be waking/);
  assert.match(message, /check whether your change succeeded/);
});

test('API errors prefer a server validation message', () => {
  assert.equal(getApiErrorMessage({
    response: { data: { error: 'Email is already registered.' } },
    message: 'Request failed',
  }), 'Email is already registered.');
});
