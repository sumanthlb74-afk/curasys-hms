import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import app from './index.js';
import { isWithinClinicHours } from '../shared/clinic-hours.js';

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.close();
    await once(server, 'close');
  }
});

test('health endpoint reports an unavailable database with a failing status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'degraded' });
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('malformed JSON receives a client error instead of a server error', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON body' });
});

test('unauthenticated requests cannot access patient intake or directories', async () => {
  const intake = await fetch(`${baseUrl}/api/patients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const directory = await fetch(`${baseUrl}/api/patients`);
  assert.equal(intake.status, 401);
  assert.equal(directory.status, 401);
});

test('clinic-hour validation accepts only hourly slots in the configured range', () => {
  assert.equal(isWithinClinicHours('08:00', 8, 20), true);
  assert.equal(isWithinClinicHours('19:00', 8, 20), true);
  assert.equal(isWithinClinicHours('07:00', 8, 20), false);
  assert.equal(isWithinClinicHours('20:00', 8, 20), false);
  assert.equal(isWithinClinicHours('09:30', 8, 20), false);
});

test('oversized JSON receives a 413 response', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: `{"value":"${'x'.repeat(65 * 1024)}"}`,
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Request too large' });
});

test('account registration rejects non-string phone numbers', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Admin',
      email: 'admin@example.test',
      password: 'a-secure-password',
      phone: 123,
      role: 'admin',
    }),
  });
  assert.equal(response.status, 400);
});

test('public registration cannot create doctor accounts', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Public Doctor',
      email: 'public-doctor@example.test',
      password: 'a-secure-password',
      role: 'doctor',
      specialization: 'Cardiology',
    }),
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /administrator/i);
});

test('administrator setup rejects an invalid registration key', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Admin',
      email: 'admin@example.test',
      password: 'a-secure-password',
      role: 'admin',
      adminRegistrationKey: 'incorrect-key',
    }),
  });
  assert.equal(response.status, 403);
});

test('new passwords over bcrypt’s 72-byte limit are rejected before account creation', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Admin',
      email: 'admin@example.test',
      password: 'é'.repeat(37),
      role: 'admin',
      adminRegistrationKey: 'not-used',
    }),
  });
  assert.equal(response.status, 400);
});

test('login limits repeated attempts for the same email and IP', async () => {
  const request = () => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'limited@example.test', password: '' }),
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await request()).status, 400);
  }
  const limitedResponse = await request();
  assert.equal(limitedResponse.status, 429);
  assert.match((await limitedResponse.json()).error, /too many authentication attempts/i);
});
