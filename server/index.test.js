import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import app from './index.js';

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
  assert.deepEqual(await response.json(), { status: 'unavailable', database: 'disconnected' });
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('malformed JSON receives a client error instead of a server error', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'The request body contains malformed JSON.' });
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
