import assert from 'node:assert/strict';
import { once } from 'node:events';
import process from 'node:process';
import test, { after, before } from 'node:test';
import User from './models/User.js';
import { isWithinClinicHours } from '../shared/clinic-hours.js';

process.env.ADMIN_REGISTRATION_KEY = 'test-only-admin-registration-key';
const { default: app, startServer, validateAdminRegistrationKey } = await import('./index.js');

let server;
let baseUrl;
let registrationTestIp = 1;

function registrationHeaders() {
  const headers = {
    'content-type': 'application/json',
    'x-forwarded-for': `198.51.100.${registrationTestIp}`,
  };
  registrationTestIp += 1;
  return headers;
}

before(async () => {
  app.set('trust proxy', 1);
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
    headers: registrationHeaders(),
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

test('CORS allows the configured frontend and omits authorization for other origins', async () => {
  const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  const allowed = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'OPTIONS',
    headers: {
      origin: allowedOrigin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.match(allowed.headers.get('access-control-allow-headers'), /authorization/i);

  const untrusted = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://attacker.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(untrusted.headers.get('access-control-allow-origin'), null);
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
    headers: registrationHeaders(),
    body: `{"value":"${'x'.repeat(65 * 1024)}"}`,
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Request too large' });
});

test('account registration rejects non-string phone numbers', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: registrationHeaders(),
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
    headers: registrationHeaders(),
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
  const originalExists = User.exists;
  User.exists = async () => null;
  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: registrationHeaders(),
      body: JSON.stringify({
        name: 'Test Admin',
        email: 'admin@example.test',
        password: 'a-secure-password',
        role: 'admin',
        adminRegistrationKey: 'incorrect-key',
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'Administrator setup is unavailable.');
  } finally {
    User.exists = originalExists;
  }
});

test('administrator setup rate limiting allows reasonable retries and has an actionable response', async () => {
  const originalExists = User.exists;
  User.exists = async () => null;
  try {
    const headers = {
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.240',
    };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Test Admin',
          email: `rate-limit-${attempt}@example.test`,
          password: 'a-secure-password',
          role: 'admin',
          adminRegistrationKey: 'incorrect-key',
        }),
      });
      assert.equal(response.status, 403);
    }
    const limited = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Test Admin',
        email: 'rate-limit-final@example.test',
        password: 'a-secure-password',
        role: 'admin',
        adminRegistrationKey: 'incorrect-key',
      }),
    });
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /sign in first if a previous submission may have succeeded/i);
  } finally {
    User.exists = originalExists;
  }
});

test('administrator setup clearly reports a missing server-side key', async () => {
  const originalKey = process.env.ADMIN_REGISTRATION_KEY;
  const originalExists = User.exists;
  User.exists = async () => null;
  delete process.env.ADMIN_REGISTRATION_KEY;
  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: registrationHeaders(),
      body: JSON.stringify({
        name: 'Test Admin',
        email: 'admin@example.test',
        password: 'a-secure-password',
        role: 'admin',
        adminRegistrationKey: 'not-a-real-key',
      }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'Administrator setup is unavailable.');
    assert.equal(body.error.includes('ADMIN_REGISTRATION_KEY'), false);
  } finally {
    User.exists = originalExists;
    if (originalKey === undefined) delete process.env.ADMIN_REGISTRATION_KEY;
    else process.env.ADMIN_REGISTRATION_KEY = originalKey;
  }
});

test('configured administrator keys shorter than 32 characters prevent startup', async () => {
  const originalKey = process.env.ADMIN_REGISTRATION_KEY;
  const originalUri = process.env.MONGODB_URI;
  process.env.ADMIN_REGISTRATION_KEY = 'short-key';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/unused';
  try {
    assert.throws(validateAdminRegistrationKey, /at least 32 characters/);
    await assert.rejects(startServer(), /at least 32 characters/);
  } finally {
    process.env.ADMIN_REGISTRATION_KEY = originalKey;
    if (originalUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalUri;
  }
});

test('public registration rejects staff and patient account creation', async () => {
  for (const role of ['staff', 'patient']) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: registrationHeaders(),
      body: JSON.stringify({
        name: 'Public Account',
        email: `public-${role}@example.test`,
        password: 'a-secure-password',
        role,
      }),
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /one-time setup/i);
  }
});

test('public registration never returns the configured admin key', async () => {
  const registrationKey = process.env.ADMIN_REGISTRATION_KEY;
  assert.ok(registrationKey);
  const originalExists = User.exists;
  User.exists = async () => null;
  try {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: registrationHeaders(),
      body: JSON.stringify({
        name: 'Test Admin',
        email: 'admin@example.test',
        password: 'a-secure-password',
        role: 'admin',
        adminRegistrationKey: 'incorrect-key',
      }),
    });
    const body = await response.text();
    assert.equal(response.status, 403);
    assert.equal(body.includes(registrationKey), false);
  } finally {
    User.exists = originalExists;
  }
});

test('new passwords over bcrypt’s 72-byte limit are rejected before account creation', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: registrationHeaders(),
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
