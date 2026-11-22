import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Appointment from './models/Appointment.js';
import AuditLog from './models/AuditLog.js';
import Bed from './models/Bed.js';
import Billing from './models/Billing.js';
import ClinicalNote from './models/ClinicalNote.js';
import Counter from './models/Counter.js';
import Prescription from './models/Prescription.js';
import User from './models/User.js';
import Vital from './models/Vital.js';
import { ensureUserIndexes } from './migrations/ensure-indexes.js';
import { createOrResetAdmin } from './scripts/create-admin.js';

const configuredTestUri = process.env.MONGODB_TEST_URI;
let testUri;
let app;
let server;
let baseUrl;
let dbConnected = false;

function isolatedTestUri(uri) {
  const parsed = new URL(uri);
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '::1', 'mongodb']);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (
    parsed.protocol !== 'mongodb:'
    || !allowedHosts.has(parsed.hostname)
    || !database.startsWith('curasys_hms_test')
  ) {
    throw new Error('MONGODB_TEST_URI must target a local MongoDB database whose name begins with curasys_hms_test.');
  }
  parsed.pathname = `/${database}_${process.pid}_${Date.now()}`;
  return parsed.toString();
}

if (configuredTestUri) testUri = isolatedTestUri(configuredTestUri);

before(async () => {
  if (!testUri) return;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'integration-test-secret-with-at-least-32-characters';
  process.env.ADMIN_REGISTRATION_KEY = 'integration-test-admin-registration-key';
  process.env.HOSPITAL_TZ = 'UTC';
  process.env.CLINIC_START_HOUR = '0';
  process.env.CLINIC_END_HOUR = '24';
  process.env.MONGODB_URI = testUri;
  ({ default: app } = await import('./index.js'));
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });
  dbConnected = true;
  await Promise.all([
    User.init(),
    Appointment.init(),
    AuditLog.init(),
    Bed.init(),
    Billing.init(),
    ClinicalNote.init(),
    Counter.init(),
    Prescription.init(),
    Vital.init(),
  ]);
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
  if (dbConnected) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function api(path, { method = 'GET', token, body, sourceIp } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (sourceIp) headers['x-forwarded-for'] = sourceIp;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function login(email, password, role) {
  return api('/api/auth/login', { method: 'POST', body: { email, password, ...(role ? { role } : {}) } });
}

async function registerPatient(token, name, email) {
  return api('/api/patients', {
    method: 'POST',
    token,
    body: { name, email, password: 'TemporaryPatient1!' },
  });
}

test('isolated MongoDB API workflows enforce roles, ownership, and unique indexes', {
  skip: !configuredTestUri && 'Set MONGODB_TEST_URI to run isolated API integration tests.',
}, async () => {
  const usersIndexes = await mongoose.connection.collection('users').indexes();
  const appointmentIndexes = await mongoose.connection.collection('appointments').indexes();
  const bedIndexes = await mongoose.connection.collection('beds').indexes();
  const billingIndexes = await mongoose.connection.collection('billings').indexes();
  const auditIndexes = await mongoose.connection.collection('auditlogs').indexes();
  const counterIndexes = await mongoose.connection.collection('counters').indexes();
  assert.ok(usersIndexes.some((index) => index.key.email === 1 && index.unique));
  assert.ok(usersIndexes.some((index) => index.name === 'unique_bootstrap_admin' && index.unique));
  assert.ok(usersIndexes.some((index) => index.key.uhid === 1 && index.unique));
  assert.ok(appointmentIndexes.some((index) => index.key.doctorId === 1 && index.key.date === 1 && index.key.time === 1 && index.unique));
  assert.ok(bedIndexes.some((index) => index.key.bedNumber === 1 && index.unique));
  assert.ok(bedIndexes.some((index) => index.key.patientId === 1 && index.unique));
  assert.ok(billingIndexes.some((index) => index.key.invoiceNumber === 1 && index.unique));
  assert.ok(auditIndexes.some((index) => index.key.at === -1));
  assert.ok(counterIndexes.some((index) => index.key.name === 1 && index.unique));

  const usersCollection = mongoose.connection.collection('users');
  await usersCollection.drop();
  const initializedEmptyCollection = await ensureUserIndexes(mongoose.connection);
  assert.equal(initializedEmptyCollection.createdUsersCollection, true);
  assert.ok((await usersCollection.indexes()).some((index) => index.name === 'uhid_1' && index.unique));
  await User.createIndexes();
  await usersCollection.dropIndex('uhid_1');
  await usersCollection.createIndex({ uhid: 1 }, { name: 'uhid_1', unique: true });
  await User.create([
    {
      name: 'Existing indexed patient',
      email: 'legacy-index-patient@example.test',
      password: 'LegacyPassword1!',
      role: 'patient',
      uhid: 'CUR-2099-000007',
    },
    {
      name: 'Legacy non-patient UHID',
      email: 'legacy-index-doctor@example.test',
      password: 'LegacyPassword1!',
      role: 'doctor',
      uhid: 'LEGACY-DOCTOR-ID',
    },
  ]);
  const migratedIndexes = await ensureUserIndexes(mongoose.connection);
  assert.equal(migratedIndexes.droppedLegacyIndex, true);
  assert.equal(migratedIndexes.normalizedAccounts, 1);
  assert.equal(migratedIndexes.seededCounters, 1);
  assert.equal((await Counter.findOne({ name: 'uhid-2099' })).value, 7);
  assert.equal((await User.findOne({ email: 'legacy-index-doctor@example.test' })).uhid, null);
  const repeatedMigration = await ensureUserIndexes(mongoose.connection);
  assert.equal(repeatedMigration.droppedLegacyIndex, false);
  assert.equal(repeatedMigration.indexCreated, false);
  await User.create([
    { name: 'Index doctor one', email: 'index-doctor-one@example.test', password: 'IndexPassword1!', role: 'doctor' },
    { name: 'Index doctor two', email: 'index-doctor-two@example.test', password: 'IndexPassword2!', role: 'doctor' },
  ]);
  assert.equal(await User.countDocuments({ email: /^index-doctor-/ }), 2);
  await usersCollection.deleteOne({ email: 'legacy-index-patient@example.test' });

  const unauthenticated = await api('/api/patients');
  assert.equal(unauthenticated.status, 401);

  const bootstrap = await Promise.all([
    api('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Test Administrator',
        email: 'admin-one@example.test',
        password: 'AdminPassword1!',
        role: 'admin',
        adminRegistrationKey: process.env.ADMIN_REGISTRATION_KEY,
      },
      sourceIp: '198.51.100.10',
    }),
    api('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Racing Administrator',
        email: 'admin-two@example.test',
        password: 'AdminPassword2!',
        role: 'admin',
        adminRegistrationKey: process.env.ADMIN_REGISTRATION_KEY,
      },
      sourceIp: '198.51.100.10',
    }),
  ]);
  assert.equal(bootstrap.filter(({ status }) => status === 201).length, 1);
  assert.equal(bootstrap.filter(({ status }) => status === 403).length, 1);
  const admin = bootstrap.find(({ status }) => status === 201);
  const adminToken = admin.body.token;
  assert.equal(admin.body.user.role, 'admin');
  assert.equal(await User.countDocuments({ role: 'admin' }), 1);
  assert.equal(await User.countDocuments({ isBootstrapAdmin: true }), 1);
  assert.equal(admin.body.user.mustChangePassword, false);
  const storedAdmin = await User.findById(admin.body.user.id).select('+password');
  assert.notEqual(storedAdmin.password, 'AdminPassword1!');
  const setupStatus = await api('/api/auth/setup-status');
  assert.deepEqual(setupStatus.body, { setupOpen: false });
  const setupClosed = await api('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Blocked Administrator',
      email: 'blocked-admin@example.test',
      password: 'AdminPassword7!',
      role: 'admin',
      adminRegistrationKey: process.env.ADMIN_REGISTRATION_KEY,
    },
    sourceIp: '198.51.100.13',
  });
  assert.equal(setupClosed.status, 403);
  assert.equal(setupClosed.body.error, 'Administrator setup is closed. Ask an existing administrator to create your account.');
  assert.equal(setupClosed.body.error.includes('ADMIN_REGISTRATION_KEY'), false);
  const originalSetupFlag = process.env.ADMIN_SETUP_ENABLED;
  process.env.ADMIN_SETUP_ENABLED = 'true';
  assert.deepEqual((await api('/api/auth/setup-status')).body, { setupOpen: true });

  for (const [name, email, password] of [
    ['Additional Administrator', 'additional-admin@example.test', 'AdminPassword3!'],
    ['Another Administrator', 'another-admin@example.test', 'AdminPassword4!'],
  ]) {
    const additionalAdministrator = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name,
        email,
        password,
        role: 'admin',
        adminRegistrationKey: process.env.ADMIN_REGISTRATION_KEY,
      },
      sourceIp: '198.51.100.11',
    });
    assert.equal(additionalAdministrator.status, 201);
    assert.equal(additionalAdministrator.body.user.mustChangePassword, false);
    if (email === 'additional-admin@example.test') {
      const duplicateAdministrator = await api('/api/auth/register', {
        method: 'POST',
        body: {
          name,
          email,
          password,
          role: 'admin',
          adminRegistrationKey: process.env.ADMIN_REGISTRATION_KEY,
        },
        sourceIp: '198.51.100.12',
      });
      assert.equal(duplicateAdministrator.status, 409);
      assert.match(duplicateAdministrator.body.error, /sign in with that email and password/i);
    }
    const additionalLogin = await login(email, password);
    assert.equal(additionalLogin.status, 200);
    assert.equal(additionalLogin.body.user.mustChangePassword, false);
  }
  assert.equal(await User.countDocuments({ role: 'admin', isActive: { $ne: false } }), 3);

  for (const [name, email, password] of [
    ['Dashboard Administrator One', 'dashboard-admin-one@example.test', 'AdminPassword5!'],
    ['Dashboard Administrator Two', 'dashboard-admin-two@example.test', 'AdminPassword6!'],
  ]) {
    const creation = await api('/api/admins', {
      method: 'POST',
      token: adminToken,
      body: { name, email, password },
    });
    assert.equal(creation.status, 201);
    assert.equal(creation.body.administrator.role, 'admin');
    assert.equal(creation.body.administrator.mustChangePassword, true);
    const administratorLogin = await login(email, password);
    assert.equal(administratorLogin.status, 200);
    assert.equal(administratorLogin.body.user.mustChangePassword, true);
  }
  assert.equal(await User.countDocuments({ role: 'admin', isActive: { $ne: false } }), 5);
  assert.equal((await api('/api/admins', { token: adminToken })).body.administrators.length, 5);
  assert.equal((await api('/api/admins')).status, 401);
  const adminRegistrationAudits = await AuditLog.find({ action: 'admin.registered' }).lean();
  assert.equal(adminRegistrationAudits.length, 3);
  assert.ok(adminRegistrationAudits.some((entry) => entry.note === 'bootstrap' && entry.actorRole === 'anonymous' && entry.entityId));
  assert.ok(adminRegistrationAudits.some((entry) => entry.note === 'key-gated' && entry.actorRole === 'anonymous' && entry.entityId));
  assert.equal(await AuditLog.countDocuments({ action: 'admin.created', actorRole: 'admin' }), 2);
  if (originalSetupFlag === undefined) delete process.env.ADMIN_SETUP_ENABLED;
  else process.env.ADMIN_SETUP_ENABLED = originalSetupFlag;

  const recoveryEmail = `recovered-admin-${process.pid}@example.test`;
  const recoveredAdministrator = await createOrResetAdmin({
    name: 'Recovered Administrator',
    email: recoveryEmail,
    password: 'RecoveryPassword1!',
  });
  assert.equal(recoveredAdministrator.action, 'created');
  assert.equal(recoveredAdministrator.user.role, 'admin');
  assert.equal(recoveredAdministrator.user.mustChangePassword, true);
  const recoveredVersion = recoveredAdministrator.user.sessionVersion;
  const resetAdministrator = await createOrResetAdmin({
    name: 'Recovered Administrator',
    email: recoveryEmail,
    password: 'RecoveryPassword2!',
  });
  assert.equal(resetAdministrator.action, 'reset');
  assert.equal(resetAdministrator.user.mustChangePassword, true);
  assert.equal(resetAdministrator.user.sessionVersion, recoveredVersion + 1);
  assert.equal((await login(recoveryEmail, 'RecoveryPassword2!')).status, 200);

  for (const role of ['doctor', 'staff', 'receptionist', 'patient']) {
    const response = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Public Account',
        email: `public-${role}@example.test`,
        password: 'PublicPassword1!',
        role,
      },
      sourceIp: `198.51.100.${20 + ['doctor', 'staff', 'patient'].indexOf(role)}`,
    });
    assert.equal(response.status, 403);
  }

  const doctorCreation = await api('/api/doctors', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Cardiology Doctor',
      email: 'doctor@example.test',
      password: 'DoctorPassword1!',
      specialization: 'Cardiology',
    },
  });
  assert.equal(doctorCreation.status, 201);
  assert.equal(await AuditLog.countDocuments({ action: 'doctor.created', entityId: doctorCreation.body.doctor.id, actorRole: 'admin' }), 1);
  const invalidDoctorCreation = await api('/api/doctors', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Invalid Department Doctor',
      email: 'doctor-invalid@example.test',
      password: 'DoctorPassword1!',
      specialization: 'Unlisted specialty',
    },
  });
  assert.equal(invalidDoctorCreation.status, 400);
  assert.equal((await api('/api/doctors', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Duplicate Doctor',
      email: 'doctor@example.test',
      password: 'DoctorPassword1!',
      specialization: 'Cardiology',
    },
  })).status, 409);
  const doctorLogin = await login('doctor@example.test', 'DoctorPassword1!');
  assert.equal(doctorLogin.status, 200);
  assert.equal(doctorLogin.body.user.mustChangePassword, true);
  assert.equal((await login('doctor@example.test', 'DoctorPassword1!', 'receptionist')).status, 401);
  assert.equal((await login('doctor@example.test', 'DoctorPassword1!', 'doctor')).status, 200);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    assert.equal((await login('doctor@example.test', 'DoctorPassword1!')).status, 200);
  }
  assert.equal((await api('/api/admins', { token: doctorLogin.body.token })).status, 403);
  assert.equal((await api('/api/admins', {
    method: 'POST',
    token: adminToken,
    body: { name: 'Invalid Administrator', email: 'invalid-admin@example.test', password: 'short' },
  })).status, 400);
  const doctorPasswordChange = await api('/api/auth/change-password', {
    method: 'POST',
    token: doctorLogin.body.token,
    body: { currentPassword: 'DoctorPassword1!', newPassword: 'DoctorPassword2!' },
  });
  assert.equal(doctorPasswordChange.status, 200);
  const doctorToken = doctorPasswordChange.body.token;

  const secondDoctorCreation = await api('/api/doctors', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Neurology Doctor',
      email: 'doctor-two@example.test',
      password: 'DoctorPassword1!',
      specialization: 'Neurology',
    },
  });
  assert.equal(secondDoctorCreation.status, 201);
  const departmentChange = await api(`/api/doctors/${secondDoctorCreation.body.doctor.id}`, {
    method: 'PUT',
    token: adminToken,
    body: { specialization: 'Cardiology' },
  });
  assert.equal(departmentChange.status, 403);
  assert.equal(await AuditLog.countDocuments({
    action: 'doctor.department_changed',
    entityId: secondDoctorCreation.body.doctor.id,
    actorRole: 'admin',
  }), 0);

  const staffCreation = await api('/api/staff', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Clinic Staff',
      email: 'staff@example.test',
      password: 'StaffPassword1!',
    },
  });
  assert.equal(staffCreation.status, 201);
  assert.equal(await AuditLog.countDocuments({ action: 'staff.created', entityId: staffCreation.body.staff.id, actorRole: 'admin' }), 1);
  const staffLogin = await login('staff@example.test', 'StaffPassword1!');
  assert.equal(staffLogin.status, 200);
  const staffPasswordChange = await api('/api/auth/change-password', {
    method: 'POST',
    token: staffLogin.body.token,
    body: { currentPassword: 'StaffPassword1!', newPassword: 'StaffPassword2!' },
  });
  assert.equal(staffPasswordChange.status, 200);
  const staffToken = staffPasswordChange.body.token;
  const receptionistCreation = await api('/api/receptionists', {
    method: 'POST',
    token: adminToken,
    body: {
      name: 'Clinic Receptionist',
      email: 'receptionist@example.test',
      password: 'ReceptionPassword1!',
    },
  });
  assert.equal(receptionistCreation.status, 201);
  assert.equal(receptionistCreation.body.receptionist.role, 'receptionist');
  assert.equal(receptionistCreation.body.receptionist.mustChangePassword, true);
  assert.equal(await AuditLog.countDocuments({
    action: 'receptionist.created',
    entityId: receptionistCreation.body.receptionist.id,
    actorRole: 'admin',
  }), 1);
  const receptionistLogin = await login('receptionist@example.test', 'ReceptionPassword1!');
  assert.equal(receptionistLogin.status, 200);
  assert.equal(receptionistLogin.body.user.mustChangePassword, true);
  const receptionistPasswordChange = await api('/api/auth/change-password', {
    method: 'POST',
    token: receptionistLogin.body.token,
    body: { currentPassword: 'ReceptionPassword1!', newPassword: 'ReceptionPassword2!' },
  });
  assert.equal(receptionistPasswordChange.status, 200);
  const receptionistToken = receptionistPasswordChange.body.token;
  assert.equal((await api('/api/receptionists', { token: receptionistToken })).status, 403);
  assert.equal((await api('/api/clinical-notes', { token: receptionistToken })).status, 403);
  assert.equal((await api('/api/vitals', { token: receptionistToken })).status, 403);
  assert.equal((await api('/api/users', { token: doctorToken })).status, 403);
  assert.equal((await api(`/api/users/${doctorCreation.body.doctor.id}/reset-password`, {
    method: 'POST',
    token: staffToken,
    body: { password: 'ShouldBeDenied1!' },
  })).status, 403);
  assert.equal((await api('/api/doctors', {
    method: 'POST',
    token: staffToken,
    body: {
      name: 'Unauthorized Doctor',
      email: 'unauthorized-doctor@example.test',
      password: 'DoctorPassword1!',
      specialization: 'Cardiology',
    },
  })).status, 403);
  assert.equal((await api('/api/staff', {
    method: 'POST',
    token: doctorToken,
    body: {
      name: 'Unauthorized Staff',
      email: 'unauthorized-staff@example.test',
      password: 'StaffPassword1!',
    },
  })).status, 403);
  assert.equal((await api('/api/prescriptions', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: admin.body.user.id,
      diagnosis: 'Should be denied',
      medicines: [{ name: 'Medicine', dosage: '1 mg', frequency: 'Daily', duration: '1 day' }],
    },
  })).status, 403);
  assert.equal((await api('/api/clinical-notes', {
    method: 'POST',
    token: staffToken,
    body: { patientId: admin.body.user.id },
  })).status, 403);

  const doctorPatient = await registerPatient(doctorToken, 'Doctor Patient', 'doctor-patient@example.test');
  const staffPatient = await registerPatient(staffToken, 'Staff Patient', 'staff-patient@example.test');
  const adminPatient = await registerPatient(adminToken, 'Admin Patient', 'admin-patient@example.test');
  const receptionistPatient = await registerPatient(receptionistToken, 'Reception Patient', 'reception-patient@example.test');
  for (const result of [doctorPatient, staffPatient, adminPatient, receptionistPatient]) {
    assert.equal(result.status, 201);
    assert.equal(result.body.patient.mustChangePassword, true);
    assert.ok(result.body.patient.registeredBy === undefined);
  }
  assert.equal(await User.countDocuments({ role: 'patient' }), 4);
  assert.equal(new Set([doctorPatient.body.patient.uhid, staffPatient.body.patient.uhid, adminPatient.body.patient.uhid, receptionistPatient.body.patient.uhid]).size, 4);
  assert.equal(await User.countDocuments({ role: 'patient', registeredBy: { $exists: true, $ne: null } }), 4);
  await assert.rejects(User.create({
    name: 'Duplicate UHID Patient',
    email: 'duplicate-uhid@example.test',
    password: 'TemporaryPatient1!',
    role: 'patient',
    uhid: doctorPatient.body.patient.uhid,
  }), { code: 11000 });
  const duplicatePatient = await registerPatient(doctorToken, 'Duplicate Patient', 'doctor-patient@example.test');
  assert.equal(duplicatePatient.status, 409);

  const patientLogin = await login('doctor-patient@example.test', 'TemporaryPatient1!');
  const otherPatientLogin = await login('staff-patient@example.test', 'TemporaryPatient1!');
  assert.equal(patientLogin.status, 200);
  assert.equal(patientLogin.body.user.role, 'patient');
  assert.equal(patientLogin.body.user.mustChangePassword, true);
  assert.equal(otherPatientLogin.status, 200);
  assert.equal(otherPatientLogin.body.user.role, 'patient');
  const adminPatientLogin = await login(' ADMIN-patient@example.test ', 'TemporaryPatient1!');
  assert.equal(adminPatientLogin.status, 200);
  assert.equal(adminPatientLogin.body.user.role, 'patient');
  assert.equal((await login('admin-patient@example.test', 'WrongPassword1!')).status, 401);
  const otherPatientPasswordChange = await api('/api/auth/change-password', {
    method: 'POST',
    token: otherPatientLogin.body.token,
    body: { currentPassword: 'TemporaryPatient1!', newPassword: 'PatientTwoPassword2!' },
  });
  assert.equal(otherPatientPasswordChange.status, 200);
  const otherPatientToken = otherPatientPasswordChange.body.token;

  const wrongPassword = await login('doctor-patient@example.test', 'WrongPassword1!');
  const unknownEmail = await login('not-registered@example.test', 'WrongPassword1!');
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.equal((await api('/api/patients', {
    method: 'POST',
    token: patientLogin.body.token,
    body: { name: 'Other Patient', email: 'patient-self-register@example.test', password: 'TemporaryPatient1!' },
  })).status, 403);
  assert.equal((await api('/api/audit', { token: patientLogin.body.token })).status, 403);
  assert.equal((await api('/api/prescriptions', { token: staffToken })).status, 403);
  assert.equal((await api('/api/clinical-notes', { token: staffToken })).status, 403);
  const staffVitalsBeforeChecks = await api('/api/vitals', { token: staffToken });
  assert.equal(staffVitalsBeforeChecks.status, 200);
  assert.equal(staffVitalsBeforeChecks.body.vitals.length, 0);
  assert.equal((await api('/api/doctors', { token: patientLogin.body.token })).status, 403);
  assert.equal((await api('/api/vitals', { token: patientLogin.body.token })).status, 403);
  assert.equal((await api('/api/clinical-notes', { token: patientLogin.body.token })).status, 403);
  assert.equal((await api('/api/appointments', { token: patientLogin.body.token })).status, 403);
  assert.equal((await api('/api/beds/not-an-id', { method: 'PUT', token: staffToken, body: { status: 'Available' } })).status, 400);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: { $ne: null }, password: 'x' } })).status, 400);

  const expiredToken = jwt.sign(
    { sub: patientLogin.body.user.id, role: 'patient', sessionVersion: 0 },
    process.env.JWT_SECRET,
    { expiresIn: -1 },
  );
  const tamperedToken = `${patientLogin.body.token.slice(0, -1)}${patientLogin.body.token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal((await api('/api/auth/me', { token: expiredToken })).status, 401);
  assert.equal((await api('/api/auth/me', { token: tamperedToken })).status, 401);

  const patientPasswordChange = await api('/api/auth/change-password', {
    method: 'POST',
    token: patientLogin.body.token,
    body: { currentPassword: 'TemporaryPatient1!', newPassword: 'PatientPassword2!' },
  });
  assert.equal(patientPasswordChange.status, 200);
  assert.equal(patientPasswordChange.body.user.mustChangePassword, false);
  assert.equal((await api('/api/auth/me', { token: patientLogin.body.token })).status, 401);
  const patientToken = patientPasswordChange.body.token;

  const patientListAsDoctor = await api('/api/patients', { token: doctorToken });
  assert.deepEqual(patientListAsDoctor.body.patients.map(({ email }) => email), ['doctor-patient@example.test']);
  const unrelatedNote = await api('/api/clinical-notes', { token: doctorToken });
  assert.equal(unrelatedNote.status, 200);
  assert.equal(unrelatedNote.body.clinicalNotes.length, 0);
  const unrelatedNoteWrite = await api('/api/clinical-notes', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: staffPatient.body.patient.id,
      chiefComplaint: 'Unrelated patient attempt',
      assessment: 'Must be rejected',
      plan: 'Must be rejected',
    },
  });
  assert.equal(unrelatedNoteWrite.status, 400);

  const wrongDoctorBooking = await api('/api/appointments', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      doctorId: secondDoctorCreation.body.doctor.id,
      department: 'Neurology',
      date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      time: '09:00',
      symptoms: 'Department mismatch',
    },
  });
  assert.equal(wrongDoctorBooking.status, 400);

  const date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const appointmentPayload = {
    patientId: doctorPatient.body.patient.id,
    doctorId: doctorCreation.body.doctor.id,
    department: 'Cardiology',
    date,
    time: '09:00',
    symptoms: 'Routine review',
  };
  const concurrentAppointments = await Promise.all([
    api('/api/appointments', { method: 'POST', token: staffToken, body: appointmentPayload }),
    api('/api/appointments', { method: 'POST', token: staffToken, body: appointmentPayload }),
  ]);
  assert.equal(concurrentAppointments.filter(({ status }) => status === 201).length, 1);
  assert.equal(concurrentAppointments.filter(({ status }) => status === 409).length, 1);
  const patientAppointment = await api('/api/appointments', { token: patientToken });
  assert.equal(patientAppointment.status, 403);

  const patientOneAppointment = await api('/api/appointments', {
    method: 'POST',
    token: staffToken,
    body: { ...appointmentPayload, time: '10:00' },
  });
  assert.equal(patientOneAppointment.status, 201);
  const patientTwoAppointment = await api('/api/appointments', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: staffPatient.body.patient.id,
      doctorId: secondDoctorCreation.body.doctor.id,
      department: 'Cardiology',
      date,
      time: '11:00',
      symptoms: 'Neurology review',
    },
  });
  assert.equal(patientTwoAppointment.status, 201);
  const receptionistAppointment = await api('/api/appointments', {
    method: 'POST',
    token: receptionistToken,
    body: {
      ...appointmentPayload,
      patientId: receptionistPatient.body.patient.id,
      date,
      time: '12:00',
    },
  });
  assert.equal(receptionistAppointment.status, 201);
  const checkedIn = await api(`/api/appointments/${receptionistAppointment.body.appointment._id}`, {
    method: 'PUT',
    token: receptionistToken,
    body: { status: 'Checked in' },
  });
  assert.equal(checkedIn.status, 200);
  assert.equal(checkedIn.body.appointment.status, 'Checked in');
  assert.equal((await api(`/api/appointments/${receptionistAppointment.body.appointment._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { status: 'Consulted' },
  })).status, 409);
  const nurseAppointmentCheck = await api('/api/vitals', {
    method: 'POST',
    token: staffToken,
    body: {
      appointmentId: receptionistAppointment.body.appointment._id,
      patientId: receptionistPatient.body.patient.id,
      heartRate: 74,
      temperatureC: 36.8,
      systolic: 118,
      diastolic: 78,
      oxygenSaturation: 99,
      symptoms: ['Headache and body ache'],
      notes: 'Preliminary check for today queue.',
    },
  });
  assert.equal(nurseAppointmentCheck.status, 201);
  const appointmentAfterCheck = await api('/api/appointments', { token: staffToken });
  assert.equal(appointmentAfterCheck.body.appointments.find(({ _id }) => _id === receptionistAppointment.body.appointment._id).status, 'Vitals done');
  const consultedPrescription = await api('/api/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: {
      appointmentId: receptionistAppointment.body.appointment._id,
      patientId: receptionistPatient.body.patient.id,
      diagnosis: 'Consultation after preliminary check',
      medicines: [{ name: 'Consult medicine', dosage: '10 mg', frequency: 'Once daily', duration: '5 days', timing: 'After food' }],
    },
  });
  assert.equal(consultedPrescription.status, 201);
  const appointmentAfterConsultation = await api('/api/appointments', { token: doctorToken });
  assert.equal(appointmentAfterConsultation.body.appointments.find(({ _id }) => _id === receptionistAppointment.body.appointment._id).status, 'Consulted');
  assert.equal((await api('/api/appointments/not-an-id', {
    method: 'PUT',
    token: staffToken,
    body: { status: 'Cancelled' },
  })).status, 400);

  const clinicalNoteWrite = await api('/api/clinical-notes', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      chiefComplaint: 'Routine checkup',
      assessment: 'Stable',
      plan: 'Continue observation',
    },
  });
  const prescriptionWrite = await api('/api/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      diagnosis: 'Routine checkup',
      medicines: [{ name: 'Example medicine', dosage: '10 mg', frequency: 'Once daily', duration: '5 days' }],
      advice: { suggestions: ['Exercise regularly', 'Drink more water'], notes: 'Stay hydrated.' },
    },
  });
  const vitalWrite = await api('/api/vitals', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      heartRate: 72,
      systolic: 120,
      diastolic: 80,
      temperatureC: 37,
      oxygenSaturation: 98,
      symptoms: ['Fever and cold'],
      notes: 'Recorded by nurse.',
    },
  });
  assert.equal(clinicalNoteWrite.status, 201);
  assert.equal(prescriptionWrite.status, 201);
  assert.equal(vitalWrite.status, 201);
  assert.equal(vitalWrite.body.vital.enteredByRole, 'staff');
  const editedPrescription = await api(`/api/prescriptions/${prescriptionWrite.body.prescription._id}`, {
    method: 'PUT',
    token: doctorToken,
    body: {
      diagnosis: 'Updated routine checkup',
      advice: { suggestions: ['Exercise regularly'], notes: 'Continue the plan.' },
    },
  });
  assert.equal(editedPrescription.status, 200);
  assert.equal(editedPrescription.body.prescription.diagnosis, 'Updated routine checkup');
  assert.equal(await AuditLog.countDocuments({
    action: 'prescription.updated',
    entityId: prescriptionWrite.body.prescription._id,
    actorRole: 'doctor',
  }), 1);
  assert.equal((await api('/api/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      diagnosis: 'Invalid advice',
      medicines: [{ name: 'Example medicine', dosage: '10 mg', frequency: 'Once daily', duration: '5 days' }],
      advice: { suggestions: ['Invented suggestion'], notes: '' },
    },
  })).status, 400);
  assert.equal((await api('/api/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      diagnosis: 'Invalid timing',
      medicines: [{ name: 'Example medicine', dosage: '10 mg', frequency: 'Once daily', duration: '5 days', timing: 'With dinner' }],
    },
  })).status, 400);
  assert.equal((await api('/api/vitals', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      heartRate: 72,
      symptoms: ['Invented symptom'],
    },
  })).status, 400);
  assert.equal((await api('/api/vitals', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      heartRate: 72,
      symptoms: ['Other'],
    },
  })).status, 400);
  const editedVital = await api(`/api/vitals/${vitalWrite.body.vital._id}`, {
    method: 'PUT',
    token: doctorToken,
    body: {
      heartRate: 76,
      symptoms: ['Headache and body ache', 'Other'],
      symptomOther: 'Light sensitivity',
      notes: 'Reviewed by doctor.',
    },
  });
  assert.equal(editedVital.status, 200);
  assert.equal(String(editedVital.body.vital.editedBy), doctorCreation.body.doctor.id);
  assert.equal(await AuditLog.countDocuments({
    action: 'vital.updated',
    entityId: vitalWrite.body.vital._id,
    actorRole: 'doctor',
  }), 1);
  const doctorVitals = await api('/api/vitals', { token: doctorToken });
  const auditedVital = doctorVitals.body.vitals.find(({ _id }) => _id === vitalWrite.body.vital._id);
  assert.equal(auditedVital.heartRate, 76);
  assert.equal(auditedVital.editedBy.name, 'Cardiology Doctor');
  assert.equal((await api(`/api/vitals/${vitalWrite.body.vital._id}`, {
    method: 'DELETE',
    token: doctorToken,
  })).status, 403);
  assert.equal((await api('/api/clinical-notes', { token: staffToken })).status, 403);
  assert.equal((await api('/api/clinical-notes', {
    method: 'POST',
    token: patientToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      chiefComplaint: 'Patient write attempt',
      assessment: 'Not permitted',
      plan: 'Not permitted',
    },
  })).status, 403);
  assert.equal((await api(`/api/clinical-notes/${clinicalNoteWrite.body.clinicalNote._id}`, {
    method: 'PUT',
    token: patientToken,
    body: { assessment: 'Patient edit attempt' },
  })).status, 403);

  const secondDoctorLogin = await login('doctor-two@example.test', 'DoctorPassword1!');
  assert.equal(secondDoctorLogin.status, 200);
  const secondDoctorChange = await api('/api/auth/change-password', {
    method: 'POST',
    token: secondDoctorLogin.body.token,
    body: { currentPassword: 'DoctorPassword1!', newPassword: 'DoctorPassword2!' },
  });
  assert.equal(secondDoctorChange.status, 200);
  const secondDoctorToken = secondDoctorChange.body.token;
  const otherClinicalNote = await api('/api/clinical-notes', {
    method: 'POST',
    token: secondDoctorToken,
    body: {
      patientId: staffPatient.body.patient.id,
      chiefComplaint: 'Neurology review',
      assessment: 'Stable',
      plan: 'Follow up as scheduled',
    },
  });
  const otherPrescription = await api('/api/prescriptions', {
    method: 'POST',
    token: secondDoctorToken,
    body: {
      patientId: staffPatient.body.patient.id,
      diagnosis: 'Neurology review',
      medicines: [{ name: 'Other medicine', dosage: '5 mg', frequency: 'Once daily', duration: '3 days' }],
    },
  });
  const otherVital = await api('/api/vitals', {
    method: 'POST',
    token: staffToken,
    body: {
      patientId: staffPatient.body.patient.id,
      heartRate: 80,
      symptoms: ['Headache and body ache'],
    },
  });
  assert.equal(otherClinicalNote.status, 201);
  assert.equal(otherPrescription.status, 201);
  assert.equal(otherVital.status, 201);
  assert.equal((await api('/api/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: staffPatient.body.patient.id,
      diagnosis: 'Unrelated patient attempt',
      medicines: [{ name: 'Example medicine', dosage: '10 mg', frequency: 'Once daily', duration: '5 days' }],
    },
  })).status, 400);
  assert.equal((await api(`/api/prescriptions/${otherPrescription.body.prescription._id}`, {
    method: 'PUT',
    token: doctorToken,
    body: { diagnosis: 'Unauthorized edit' },
  })).status, 404);
  assert.equal((await api(`/api/prescriptions/${otherPrescription.body.prescription._id}`, {
    method: 'DELETE',
    token: doctorToken,
  })).status, 404);
  const deletablePrescription = await api('/api/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      diagnosis: 'Temporary prescription for delete audit test',
      medicines: [{ name: 'Example medicine', dosage: '10 mg', frequency: 'Once daily', duration: '1 day' }],
    },
  });
  assert.equal(deletablePrescription.status, 201);
  assert.equal((await api(`/api/prescriptions/${deletablePrescription.body.prescription._id}`, {
    method: 'DELETE',
    token: doctorToken,
  })).status, 200);
  assert.equal(await AuditLog.countDocuments({
    action: 'prescription.deleted',
    entityId: deletablePrescription.body.prescription._id,
    actorRole: 'doctor',
  }), 1);
  assert.equal((await api(`/api/clinical-notes/${otherClinicalNote.body.clinicalNote._id}`, {
    method: 'PUT',
    token: doctorToken,
    body: { assessment: 'Unrelated doctor edit attempt' },
  })).status, 404);

  const patientNotes = await api('/api/clinical-notes', { token: patientToken });
  const patientPrescriptions = await api('/api/prescriptions', { token: patientToken });
  const patientVitals = await api('/api/vitals', { token: patientToken });
  assert.equal(patientNotes.status, 403);
  assert.equal(patientPrescriptions.body.prescriptions.length, 1);
  assert.equal(patientVitals.status, 403);
  assert.equal(String(patientPrescriptions.body.prescriptions[0].patientId._id), doctorPatient.body.patient.id);
  assert.equal((await api('/api/appointments', { token: patientToken })).status, 403);
  const otherPatientNotes = await api('/api/clinical-notes', { token: otherPatientToken });
  const otherPatientPrescriptions = await api('/api/prescriptions', { token: otherPatientToken });
  const otherPatientVitals = await api('/api/vitals', { token: otherPatientToken });
  assert.equal(otherPatientNotes.status, 403);
  assert.equal(otherPatientPrescriptions.body.prescriptions.length, 1);
  assert.equal(otherPatientVitals.status, 403);
  assert.equal(String(otherPatientPrescriptions.body.prescriptions[0].patientId._id), staffPatient.body.patient.id);

  const bedCreate = await api('/api/beds', {
    method: 'POST',
    token: staffToken,
    body: { bedNumber: 'A-101', ward: 'General Ward' },
  });
  assert.equal(bedCreate.status, 201);
  assert.equal((await api('/api/beds', {
    method: 'POST',
    token: staffToken,
    body: { bedNumber: 'A-101', ward: 'General Ward' },
  })).status, 409);
  const bedAssignment = await api(`/api/beds/${bedCreate.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { patientId: doctorPatient.body.patient.id },
  });
  assert.equal(bedAssignment.status, 200);
  assert.equal(bedAssignment.body.bed.status, 'Occupied');
  const resavedBedAssignment = await api(`/api/beds/${bedCreate.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { status: 'Occupied', patientId: doctorPatient.body.patient.id },
  });
  assert.equal(resavedBedAssignment.status, 200);
  const secondBed = await api('/api/beds', {
    method: 'POST',
    token: staffToken,
    body: { bedNumber: 'A-102', ward: 'General Ward' },
  });
  const displacementAttempt = await api(`/api/beds/${bedCreate.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { patientId: staffPatient.body.patient.id },
  });
  assert.equal(displacementAttempt.status, 409);
  assert.equal(displacementAttempt.body.error, 'Discharge the current patient first.');
  const duplicateBedAssignment = await api(`/api/beds/${secondBed.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { patientId: doctorPatient.body.patient.id },
  });
  assert.equal(duplicateBedAssignment.status, 409);
  const discharged = await api(`/api/beds/${bedCreate.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { status: 'Available', patientId: doctorPatient.body.patient.id },
  });
  assert.equal(discharged.status, 200);
  assert.equal(discharged.body.bed.status, 'Available');
  assert.equal(discharged.body.bed.patientId, null);
  const secondBedAssignment = await api(`/api/beds/${secondBed.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { patientId: staffPatient.body.patient.id },
  });
  assert.equal(secondBedAssignment.status, 200);
  const maintenanceDischarge = await api(`/api/beds/${secondBed.body.bed._id}`, {
    method: 'PUT',
    token: staffToken,
    body: { status: 'Maintenance', patientId: staffPatient.body.patient.id },
  });
  assert.equal(maintenanceDischarge.status, 200);
  assert.equal(maintenanceDischarge.body.bed.status, 'Maintenance');
  assert.equal(maintenanceDischarge.body.bed.patientId, null);

  const billOne = await api('/api/billing', {
    method: 'POST',
    token: receptionistToken,
    body: {
      patientId: doctorPatient.body.patient.id,
      lineItems: [{ description: 'Consultation', amount: 125.5 }],
      totalAmount: 1,
      totalPaise: 1,
    },
  });
  const billTwo = await api('/api/billing', {
    method: 'POST',
    token: receptionistToken,
    body: {
      patientId: staffPatient.body.patient.id,
      lineItems: [
        { description: 'Consultation', amount: 150 },
        { description: 'Supplies', amount: 50 },
      ],
      discount: 10,
    },
  });
  assert.equal(billOne.status, 201);
  assert.equal(billOne.body.bill.totalPaise, 12550);
  assert.equal(billOne.body.bill.lineItems[0].amountPaise, 12550);
  assert.equal(billTwo.status, 201);
  assert.equal(billTwo.body.bill.totalPaise, 19000);
  assert.notEqual(billOne.body.bill.invoiceNumber, billTwo.body.bill.invoiceNumber);
  await assert.rejects(Billing.create({
    patientId: doctorPatient.body.patient.id,
    createdBy: admin.body.user.id,
    totalPaise: 100,
    description: 'Duplicate invoice test',
    invoiceNumber: billOne.body.bill.invoiceNumber,
  }), { code: 11000 });
  const patientBills = await api('/api/billing', { token: patientToken });
  assert.deepEqual(patientBills.body.bills.map(({ _id }) => _id), [billOne.body.bill._id]);
  const otherPatientBills = await api('/api/billing', { token: otherPatientToken });
  assert.deepEqual(otherPatientBills.body.bills.map(({ _id }) => _id), [billTwo.body.bill._id]);
  const receptionistBills = await api('/api/billing', { token: receptionistToken });
  assert.equal(receptionistBills.status, 200);
  assert.equal(receptionistBills.body.bills.length, 2);
  const receptionistReport = await api(`/api/prescriptions?patientId=${doctorPatient.body.patient.id}`, { token: receptionistToken });
  assert.equal(receptionistReport.status, 200);
  assert.equal(receptionistReport.body.prescriptions.length, 1);
  assert.equal(receptionistReport.body.prescriptions[0].advice.suggestions.includes('Exercise regularly'), true);
  const paidBill = await api(`/api/billing/${billOne.body.bill._id}`, {
    method: 'PUT',
    token: receptionistToken,
    body: { status: 'Paid', paymentMethod: 'UPI QR', paymentReference: 'demo-reference' },
  });
  assert.equal(paidBill.status, 200);
  assert.equal(paidBill.body.bill.status, 'Paid');
  assert.equal(paidBill.body.bill.paymentMethod, 'UPI QR');
  assert.equal(String(paidBill.body.bill.paidBy), receptionistCreation.body.receptionist.id);
  assert.equal((await api(`/api/billing/${billTwo.body.bill._id}`, {
    method: 'PUT',
    token: receptionistToken,
    body: { status: 'Void' },
  })).status, 403);

  const auditAsAdmin = await api('/api/audit', { token: adminToken });
  assert.equal(auditAsAdmin.status, 403);

  const reset = await api(`/api/patients/${doctorPatient.body.patient.id}/reset-password`, {
    method: 'POST',
    token: staffToken,
    body: { password: 'PatientPassword3!' },
  });
  assert.equal(reset.status, 200);
  assert.equal((await api('/api/auth/me', { token: patientToken })).status, 401);
  assert.equal((await login('doctor-patient@example.test', 'PatientPassword2!')).status, 401);
  const resetPatientLogin = await login('doctor-patient@example.test', 'PatientPassword3!');
  assert.equal(resetPatientLogin.status, 200);
  assert.equal(resetPatientLogin.body.user.mustChangePassword, true);

  for (const [id, email, oldPassword, temporaryPassword] of [
    [doctorCreation.body.doctor.id, 'doctor@example.test', 'DoctorPassword2!', 'DoctorReset3!'],
    [staffCreation.body.staff.id, 'staff@example.test', 'StaffPassword2!', 'StaffReset3!'],
    [receptionistCreation.body.receptionist.id, 'receptionist@example.test', 'ReceptionPassword2!', 'ReceptionReset3!'],
    [doctorPatient.body.patient.id, 'doctor-patient@example.test', 'PatientPassword3!', 'PatientReset4!'],
  ]) {
    const adminReset = await api(`/api/users/${id}/reset-password`, {
      method: 'POST',
      token: adminToken,
      body: { password: temporaryPassword },
    });
    assert.equal(adminReset.status, 200);
    assert.equal(adminReset.body.temporaryPassword, temporaryPassword);
    assert.equal(adminReset.body.user.mustChangePassword, true);
    assert.equal((await login(email, oldPassword)).status, 401);
    const resetLogin = await login(email, temporaryPassword);
    assert.equal(resetLogin.status, 200);
    assert.equal(resetLogin.body.user.mustChangePassword, true);
  }

  const deactivate = await api(`/api/users/${doctorPatient.body.patient.id}/active`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: false },
  });
  assert.equal(deactivate.status, 200);
  assert.equal((await login('doctor-patient@example.test', 'PatientReset4!')).status, 401);
  assert.equal((await api('/api/auth/me', { token: resetPatientLogin.body.token })).status, 401);
  const reactivate = await api(`/api/users/${doctorPatient.body.patient.id}/active`, {
    method: 'PATCH',
    token: adminToken,
    body: { isActive: true },
  });
  assert.equal(reactivate.status, 200);

  const preservedHistory = await User.findOne({ email: 'doctor-patient@example.test' }).lean();
  assert.ok(preservedHistory);
  await api(`/api/users/${preservedHistory._id}/active`, { method: 'PATCH', token: adminToken, body: { isActive: false } });
  assert.ok(await User.exists({ _id: preservedHistory._id, isActive: false }));
  assert.equal(await ClinicalNote.countDocuments({ patientId: preservedHistory._id }), 1);
});
