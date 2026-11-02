import assert from 'node:assert/strict';
import test from 'node:test';
import Appointment from './Appointment.js';
import Bed from './Bed.js';
import Billing from './Billing.js';
import ClinicalNote from './ClinicalNote.js';
import Prescription from './Prescription.js';
import User from './User.js';
import Vital from './Vital.js';
import { isOptionalAddress, isOptionalPhone, isOptionalString } from '../validation.js';

test('shared contact validators reject wrong types and oversized values', () => {
  assert.equal(isOptionalPhone(123), false);
  assert.equal(isOptionalPhone('1'.repeat(31)), false);
  assert.equal(isOptionalPhone('123456'), true);
  assert.equal(isOptionalAddress({}), false);
  assert.equal(isOptionalAddress('a'.repeat(501)), false);
  assert.equal(isOptionalString(undefined, 20), true);
});

async function getValidationError(document) {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return error;
  }
}

test('user schema requires identity, role, password, and generated UHID', () => {
  const errorPromise = getValidationError(new User({ email: 'not-an-email', role: 'guest' }));
  return errorPromise.then((error) => {
    assert.ok(error);
    assert.ok(error.errors.name);
    assert.ok(error.errors.password);
    assert.ok(error.errors.uhid);
    assert.ok(error.errors.role);
    assert.ok(error.errors.email);
  });
});

test('user schema accepts the medical staff role', async () => {
  const error = await getValidationError(new User({
    name: 'Clinic Staff',
    email: 'staff@example.test',
    password: 'a-secure-password',
    role: 'staff',
    uhid: 'CUR-2026-1234',
  }));
  assert.equal(error, null);
});

test('user schema defaults new accounts to active and current-password sessions', () => {
  const user = new User({
    name: 'Test User',
    email: 'user@example.test',
    password: 'a-secure-password',
    role: 'patient',
    uhid: 'CUR-2026-123456789ABC',
  });
  assert.equal(user.isActive, true);
  assert.equal(user.mustChangePassword, false);
  assert.equal(user.passwordChangedAt, null);
  assert.equal(user.sessionVersion, 0);
});

test('patient profile validates demographics and medical history fields', async () => {
  const patient = new User({
    name: 'Test Patient',
    email: 'patient@example.test',
    password: 'a-secure-password',
    role: 'patient',
    uhid: 'CUR-2026-1234',
    bloodGroup: 'O+',
    heightCm: 170,
    weightKg: 65,
    allergies: ['Pollen'],
    chronicConditions: ['Diabetes'],
  });
  assert.equal(await getValidationError(patient), null);
  const invalid = await getValidationError(new User({
    name: 'Test Patient',
    email: 'patient2@example.test',
    password: 'a-secure-password',
    role: 'patient',
    uhid: 'CUR-2026-1235',
    bloodGroup: 'Unknown',
    heightCm: 900,
  }));
  assert.ok(invalid.errors.bloodGroup);
  assert.ok(invalid.errors.heightCm);
});

test('appointment schema validates role workflow status and time', async () => {
  const appointment = new Appointment({
    patientId: '507f1f77bcf86cd799439011',
    department: 'Cardiology',
    date: new Date(),
    time: '25:88',
    symptoms: 'Checkup',
    status: 'Open',
  });
  const error = await getValidationError(appointment);
  assert.ok(error.errors.time);
  assert.ok(error.errors.status);
  const nonHourlyTime = await getValidationError(new Appointment({
    patientId: '507f1f77bcf86cd799439011',
    department: 'Cardiology',
    date: new Date(),
    time: '09:30',
    symptoms: 'Checkup',
  }));
  assert.ok(nonHourlyTime.errors.time);
});

test('scheduled appointments have a unique doctor and time-slot index', () => {
  const slotIndex = Appointment.schema.indexes().find(([fields, options]) => (
    fields.doctorId === 1 && fields.date === 1 && fields.time === 1 && options.unique
  ));
  assert.ok(slotIndex);
  assert.deepEqual(slotIndex[1].partialFilterExpression, {
    status: 'Scheduled',
    doctorId: { $type: 'objectId' },
  });
});

test('bed schema rejects unsupported ward and status values', async () => {
  const error = await getValidationError(new Bed({ bedNumber: 'A-1', ward: 'Unknown', status: 'Busy' }));
  assert.ok(error.errors.ward);
  assert.ok(error.errors.status);
});

test('prescription requires at least one fully specified medicine', async () => {
  const error = await getValidationError(new Prescription({
    patientId: '507f1f77bcf86cd799439011',
    doctorId: '507f1f77bcf86cd799439012',
    diagnosis: 'Test',
    medicines: [],
  }));
  assert.ok(error.errors.medicines);
});

test('billing requires a patient, administrator, positive whole-paise amount, and description', async () => {
  const valid = new Billing({
    patientId: '507f1f77bcf86cd799439011',
    createdBy: '507f1f77bcf86cd799439012',
    totalPaise: 12345,
    description: 'Consultation and prescribed treatment',
  });
  assert.equal(await getValidationError(valid), null);
  const invalid = await getValidationError(new Billing({
    patientId: '507f1f77bcf86cd799439011',
    createdBy: '507f1f77bcf86cd799439012',
    totalPaise: 0,
  }));
  assert.ok(invalid.errors.totalPaise);
  assert.ok(invalid.errors.description);
});

test('clinical note requires chief complaint, assessment, and plan', async () => {
  const error = await getValidationError(new ClinicalNote({
    patientId: '507f1f77bcf86cd799439011',
    doctorId: '507f1f77bcf86cd799439012',
    chiefComplaint: 'Headache',
  }));
  assert.ok(error.errors.assessment);
  assert.ok(error.errors.plan);
});

test('vital schema rejects measurements outside validated ranges', async () => {
  const error = await getValidationError(new Vital({
    patientId: '507f1f77bcf86cd799439011',
    recordedBy: '507f1f77bcf86cd799439012',
    oxygenSaturation: 140,
    temperatureC: 80,
  }));
  assert.ok(error.errors.oxygenSaturation);
  assert.ok(error.errors.temperatureC);
});
