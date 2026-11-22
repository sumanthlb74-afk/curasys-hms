import crypto from 'node:crypto';
import dotenv from 'dotenv';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
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
import { isOptionalAddress, isOptionalPhone, isOptionalString } from './validation.js';
import {
  bloodGroups,
  appointmentStatuses,
  appointmentStatusTransitions,
  defaultClinicEndHour,
  defaultClinicStartHour,
  departments,
  paymentMethods,
  preliminaryCheckSymptoms,
  prescriptionAdviceSuggestions,
  prescriptionTimings,
  triageLevels,
  wards,
} from '../shared/constants.js';
import { isWithinClinicHours } from '../shared/clinic-hours.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '.env') });

const bedStatuses = ['Available', 'Occupied', 'Maintenance'];
const appointmentTransitionRoles = {
  'Checked in': ['receptionist'],
  'Vitals done': ['staff'],
  Consulted: ['doctor'],
  Billed: ['receptionist'],
  Paid: ['receptionist'],
  Cancelled: ['staff', 'receptionist'],
};
function configuredHour(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d{1,2}$/.test(value) || Number(value) < 0 || Number(value) > 24) {
    throw new Error(`${name} must be an hour between 0 and 24.`);
  }
  return Number(value);
}
const clinicStartHour = configuredHour('CLINIC_START_HOUR', defaultClinicStartHour);
const clinicEndHour = configuredHour('CLINIC_END_HOUR', defaultClinicEndHour);
if (clinicStartHour >= clinicEndHour) {
  throw new Error('CLINIC_START_HOUR must be earlier than CLINIC_END_HOUR.');
}

export function validateAdminRegistrationKey() {
  const key = process.env.ADMIN_REGISTRATION_KEY;
  if (key && key.length < 32) {
    throw new Error('ADMIN_REGISTRATION_KEY must be at least 32 characters when configured.');
  }
}

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
const clientOrigin = process.env.CLIENT_ORIGIN || (
  process.env.NODE_ENV === 'production' ? null : 'http://localhost:5173'
);
app.use(cors({
  origin: (origin, callback) => {
    callback(null, origin && origin === clientOrigin ? origin : false);
  },
  credentials: false,
}));
app.use(compression());
app.use(express.json({ limit: '64kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (request) => `${ipKeyGenerator(request.ip)}:${String(request.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many account registration attempts from this network. Wait before trying again, and sign in first if a previous submission may have succeeded.' },
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in 15 minutes.' },
});

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive !== false,
    uhid: user.uhid,
    mustChangePassword: user.mustChangePassword,
    phone: user.phone,
    specialization: user.specialization,
    dateOfBirth: user.dateOfBirth,
    sex: user.sex,
    bloodGroup: user.bloodGroup,
    address: user.address,
    emergencyContact: user.emergencyContact,
    allergies: user.allergies,
    chronicConditions: user.chronicConditions,
    currentMedications: user.currentMedications,
    heightCm: user.heightCm,
    weightKg: user.weightKg,
  };
}

function signToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured.');
  }
  return jwt.sign(
    { sub: user.id, role: user.role, sessionVersion: user.sessionVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '8h' },
  );
}

function authenticate(request, response, next) {
  const [scheme, token] = (request.get('authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    response.status(401).json({ error: 'Sign in to continue.' });
    return;
  }

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    User.findById(claims.sub)
      .then((user) => {
        if (
          !user
          || user.isActive === false
          || user.role !== claims.role
          || (claims.sessionVersion || 0) !== (user.sessionVersion || 0)
          || (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000))
        ) {
          response.status(401).json({ error: 'Your session is no longer valid. Sign in again.' });
          return;
        }
        request.user = user;
        if (
          user.mustChangePassword
          && request.path !== '/api/auth/me'
          && request.path !== '/api/auth/change-password'
        ) {
          response.status(403).json({ error: 'Change your temporary password before continuing.' });
          return;
        }
        next();
      })
      .catch(next);
  } catch {
    response.status(401).json({ error: 'Your session is invalid or has expired. Sign in again.' });
  }
}

function allow(...allowedRoles) {
  return (request, response, next) => {
    if (!allowedRoles.includes(request.user.role)) {
      response.status(403).json({ error: 'Your account does not have permission for this action.' });
      return;
    }
    next();
  };
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

async function audit(request, {
  action, entityType, entityId = null, patientId = null, actorId = request.user?._id || null,
  actorRole = request.user?.role || 'anonymous', note = '',
}) {
  await AuditLog.create({
    actorId,
    actorRole,
    action,
    entityType,
    entityId,
    patientId,
    note,
    ip: request.ip || '',
  });
}

function getPagination(request, response) {
  const pageValue = request.query.page ?? '1';
  const limitValue = request.query.limit ?? '50';
  const query = request.query.q ?? '';
  if (
    typeof pageValue !== 'string' || !/^\d+$/.test(pageValue)
    || typeof limitValue !== 'string' || !/^\d+$/.test(limitValue)
    || typeof query !== 'string' || query.length > 100
  ) {
    response.status(400).json({ error: 'Use positive page/limit values and a search query of at most 100 characters.' });
    return null;
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1) {
    response.status(400).json({ error: 'Page and limit must be positive integers.' });
    return null;
  }
  return { page, limit: Math.min(limit, 200), q: query.trim() };
}

function escapedRegex(value) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

async function addPatientSearch(filter, query) {
  if (!query) return filter;
  const pattern = escapedRegex(query);
  const matchingIds = await User.distinct('_id', {
    role: 'patient',
    isActive: { $ne: false },
    $or: [{ name: pattern }, { uhid: pattern }, { email: pattern }],
  });
  if (filter.patientId !== undefined) {
    const patientIdFilter = filter.patientId;
    delete filter.patientId;
    filter.$and = [...(filter.$and || []), { patientId: patientIdFilter }, { patientId: { $in: matchingIds } }];
  } else {
    filter.patientId = { $in: matchingIds };
  }
  return filter;
}

async function listPage(Model, filter, { page, limit }, { sort, populate = [], select }) {
  let query = Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
  if (select) query = query.select(select);
  for (const [field, selection] of populate) query = query.populate(field, selection);
  const [items, total] = await Promise.all([query.lean(), Model.countDocuments(filter)]);
  return { items, total, page };
}

function validObjectId(value) {
  return mongoose.isValidObjectId(value);
}

function validPassword(value) {
  if (typeof value !== 'string') return false;
  const byteLength = Buffer.byteLength(value, 'utf8');
  return byteLength >= 8 && byteLength <= 72;
}

function validPrescriptionAdvice(value) {
  if (value === undefined) return true;
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.suggestions)
    && value.suggestions.length <= prescriptionAdviceSuggestions.length
    && value.suggestions.every((suggestion) => prescriptionAdviceSuggestions.includes(suggestion))
    && new Set(value.suggestions).size === value.suggestions.length
    && (value.notes === undefined || (typeof value.notes === 'string' && value.notes.length <= 1000)),
  );
}

async function assignUhid() {
  const year = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.HOSPITAL_TZ || 'Asia/Kolkata',
    year: 'numeric',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value])).year;
  const counter = await Counter.findOneAndUpdate(
    { name: `uhid-${year}` },
    { $inc: { value: 1 } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );
  return `CUR-${year}-${String(counter.value).padStart(6, '0')}`;
}

async function nextInvoiceNumber() {
  const year = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.HOSPITAL_TZ || 'Asia/Kolkata',
    year: 'numeric',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value])).year;
  const counter = await Counter.findOneAndUpdate(
    { name: `invoice-${year}` },
    { $inc: { value: 1 } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );
  return `INV-${year}-${String(counter.value).padStart(6, '0')}`;
}

async function createUser({
  name, email, password, role, phone, specialization, dateOfBirth, sex, bloodGroup,
  address, emergencyContact, allergies, chronicConditions, currentMedications, heightCm, weightKg,
  registeredBy, mustChangePassword = false, isBootstrapAdmin = false,
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await User.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        isBootstrapAdmin,
        registeredBy: registeredBy || null,
        mustChangePassword,
        passwordChangedAt: mustChangePassword ? new Date() : null,
        phone: phone?.trim() || '',
        specialization: role === 'doctor' ? specialization?.trim() || '' : '',
        dateOfBirth: dateOfBirth || null,
        sex: sex || '',
        bloodGroup: bloodGroup || '',
        address: address?.trim() || '',
        emergencyContact: emergencyContact || {},
        allergies: allergies || [],
        chronicConditions: chronicConditions || [],
        currentMedications: currentMedications || [],
        heightCm: heightCm === '' || heightCm === undefined ? null : heightCm,
        weightKg: weightKg === '' || weightKg === undefined ? null : weightKg,
        uhid: role === 'patient' ? await assignUhid() : null,
      });
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.uhid && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error('Could not generate a unique health ID.');
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isFutureAppointment(date, time) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.HOSPITAL_TZ || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const currentTime = `${parts.hour}:${parts.minute}`;
  return date > today || (date === today && time > currentTime);
}

async function doctorPatientIds(doctorId) {
  const [appointmentIds, registeredPatients] = await Promise.all([
    Appointment.distinct('patientId', { doctorId, status: { $ne: 'Cancelled' } }),
    User.distinct('_id', { role: 'patient', registeredBy: doctorId, isActive: { $ne: false } }),
  ]);
  const appointedPatients = appointmentIds.length
    ? await User.distinct('_id', {
      _id: { $in: appointmentIds },
      role: 'patient',
      isActive: { $ne: false },
    })
    : [];
  return [...new Set([...appointedPatients, ...registeredPatients].map(String))];
}

async function doctorCanAccessPatient(doctorId, patientId) {
  return Boolean(
    await Appointment.exists({ doctorId, patientId, status: { $ne: 'Cancelled' } })
    || await User.exists({ _id: patientId, role: 'patient', registeredBy: doctorId, isActive: { $ne: false } }),
  );
}

app.get('/api/health', asyncRoute(async (_request, response) => {
  if (mongoose.connection.readyState !== 1) {
    response.status(503).json({ status: 'degraded' });
    return;
  }
  try {
    await mongoose.connection.db.admin().ping();
  } catch {
    response.status(503).json({ status: 'degraded' });
    return;
  }
  response.json({ status: 'ok', database: 'connected' });
}));

app.use('/api', apiLimiter);

async function isAdministratorSetupOpen() {
  const hasAdministrator = await User.exists({ role: 'admin' });
  return Boolean(process.env.ADMIN_REGISTRATION_KEY?.trim())
    && (!hasAdministrator || process.env.ADMIN_SETUP_ENABLED === 'true');
}

app.get('/api/auth/setup-status', asyncRoute(async (_request, response) => {
  response.json({ setupOpen: await isAdministratorSetupOpen() });
}));

app.post('/api/auth/register', registrationLimiter, asyncRoute(async (request, response) => {
  const { name, email, password, role, phone, specialization, adminRegistrationKey } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || email.length > 254
    || !validPassword(password)
    || !isOptionalPhone(phone)
  ) {
    response.status(400).json({ error: 'Enter a valid name, email, and password with at least 8 characters to set up an administrator account.' });
    return;
  }
  if (role !== 'admin') {
    response.status(403).json({ error: 'Only the project administrator can be registered through this one-time setup.' });
    return;
  }
  const hasAdministrator = await User.exists({ role: 'admin' });
  const bootstrap = !hasAdministrator;
  if (!bootstrap && process.env.ADMIN_SETUP_ENABLED !== 'true') {
    response.status(403).json({ error: 'Administrator setup is closed. Ask an existing administrator to create your account.' });
    return;
  }
  if (!process.env.ADMIN_REGISTRATION_KEY?.trim()) {
    response.status(503).json({ error: 'Administrator setup is unavailable.' });
    return;
  }
  const expectedKey = crypto.createHash('sha256').update(process.env.ADMIN_REGISTRATION_KEY, 'utf8').digest();
  const providedKey = crypto.createHash('sha256')
    .update(typeof adminRegistrationKey === 'string' ? adminRegistrationKey : '', 'utf8')
    .digest();
  const validRegistrationKey = crypto.timingSafeEqual(expectedKey, providedKey);
  if (!validRegistrationKey) {
    response.status(403).json({ error: 'Administrator setup is unavailable.' });
    return;
  }
  let user;
  try {
    user = await createUser({
      name, email, password, role, phone, specialization,
      isBootstrapAdmin: bootstrap,
      mustChangePassword: false,
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.isBootstrapAdmin) {
      response.status(403).json({ error: 'Administrator setup is closed. Ask an existing administrator to create your account.' });
      return;
    }
    throw error;
  }
  await audit(request, {
    action: 'admin.registered',
    entityType: 'admin',
    entityId: user._id,
    actorRole: 'anonymous',
    note: bootstrap ? 'bootstrap' : 'key-gated',
  });
  response.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (request, response) => {
  const { email, password } = request.body ?? {};
  const selectedRole = request.body?.role;
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    response.status(400).json({ error: 'Enter your email and password.' });
    return;
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  const passwordMatches = user
    ? await user.verifyPassword(password)
    : await bcrypt.compare(password, '$2b$12$SnfE2ps00748FaTzgA3jAe/ST6CV08ai5sKmXhJKmr87TkTyn1YOe');
  if (!user || user.isActive === false || !passwordMatches || (selectedRole !== undefined && user.role !== selectedRole)) {
    await audit(request, {
      action: 'login.failed',
      entityType: 'auth',
      actorId: user?._id || null,
      actorRole: user?.role || 'anonymous',
    });
    response.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  await audit(request, {
    action: 'login.succeeded',
    entityType: 'auth',
    actorId: user._id,
    actorRole: user.role,
  });
  response.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/auth/me', authenticate, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.get('/api/users', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const query = request.query.q ?? '';
  if (typeof query !== 'string' || query.length > 100) {
    response.status(400).json({ error: 'Use a search query of at most 100 characters.' });
    return;
  }
  const trimmedQuery = query.trim();
  const filter = trimmedQuery
    ? { $or: [{ name: escapedRegex(trimmedQuery) }, { email: escapedRegex(trimmedQuery) }, { phone: escapedRegex(trimmedQuery) }, { role: escapedRegex(trimmedQuery) }] }
    : {};
  const users = await User.find(filter)
    .select('name email role phone specialization uhid isActive mustChangePassword dateOfBirth')
    .sort({ role: 1, name: 1 })
    .lean();
  response.json({ users: users.map((user) => ({ ...user, id: String(user._id) })) });
}));

app.post('/api/users/:id/reset-password', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid user ID.' });
    return;
  }
  if (request.params.id === request.user.id) {
    response.status(400).json({ error: 'Use Change password to update your own administrator password.' });
    return;
  }
  const { password } = request.body ?? {};
  if (!validPassword(password)) {
    response.status(400).json({ error: 'Enter a temporary password with at least 8 characters.' });
    return;
  }
  const user = await User.findById(request.params.id).select('+password sessionVersion');
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }
  user.password = password;
  user.mustChangePassword = true;
  user.passwordChangedAt = new Date();
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();
  await audit(request, { action: 'user.password_reset', entityType: 'user', entityId: user._id });
  response.json({ success: true, temporaryPassword: password, user: publicUser(user) });
}));

app.patch('/api/users/:id/active', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid user ID.' });
    return;
  }
  if (request.params.id === request.user.id) {
    response.status(400).json({ error: 'You cannot change your own active status.' });
    return;
  }
  const { isActive } = request.body ?? {};
  if (typeof isActive !== 'boolean') {
    response.status(400).json({ error: 'isActive must be true or false.' });
    return;
  }
  const user = await User.findById(request.params.id).select('role isActive sessionVersion');
  if (!user) {
    response.status(404).json({ error: 'User not found.' });
    return;
  }
  if (!isActive && user.role === 'admin' && await User.countDocuments({ role: 'admin', isActive: { $ne: false } }) <= 1) {
    response.status(409).json({ error: 'The last active administrator cannot be deactivated.' });
    return;
  }
  user.isActive = isActive;
  user.deletedAt = isActive ? null : new Date();
  user.deletedBy = isActive ? null : request.user._id;
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();
  await audit(request, { action: isActive ? 'user.activated' : 'user.deactivated', entityType: 'user', entityId: user._id });
  response.json({ success: true, user: publicUser(user) });
}));

app.get('/api/admins', authenticate, allow('admin'), asyncRoute(async (_request, response) => {
  const administrators = await User.find({ role: 'admin', isActive: { $ne: false } })
    .select('name email')
    .sort({ name: 1 })
    .lean();
  response.json({ administrators });
}));

app.post('/api/admins', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const { name, email, password, phone } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !validPassword(password)
    || !isOptionalPhone(phone)
  ) {
    response.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' });
    return;
  }
  const administrator = await createUser({
    name, email, password, role: 'admin', phone,
    registeredBy: request.user.id, mustChangePassword: true,
  });
  await audit(request, { action: 'admin.created', entityType: 'admin', entityId: administrator._id });
  response.status(201).json({ administrator: publicUser(administrator) });
}));

app.post('/api/auth/change-password', authenticate, asyncRoute(async (request, response) => {
  const { currentPassword, newPassword } = request.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !validPassword(newPassword)) {
    response.status(400).json({ error: 'Enter your current password and a new password with at least 8 characters.' });
    return;
  }
  const user = await User.findById(request.user.id).select('+password');
  if (!user || !(await user.verifyPassword(currentPassword))) {
    response.status(400).json({ error: 'Your current password is incorrect.' });
    return;
  }
  if (currentPassword === newPassword) {
    response.status(400).json({ error: 'Choose a new password different from your current password.' });
    return;
  }
  user.password = newPassword;
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  await user.save();
  response.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/doctors', authenticate, allow('staff', 'receptionist'), asyncRoute(async (_request, response) => {
  const doctors = await User.find({ role: 'doctor', isActive: { $ne: false } })
    .select('name email phone specialization')
    .sort({ name: 1 })
    .lean();
  response.json({ doctors });
}));

app.post('/api/doctors', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const { name, email, password, phone, specialization } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    || !validPassword(password)
    || !isOptionalPhone(phone)
    || !departments.includes(specialization)
  ) {
    response.status(400).json({ error: 'Enter a valid name, email, password, phone, and department.' });
    return;
  }
  const doctor = await createUser({
    name, email, password, phone, specialization, role: 'doctor',
    registeredBy: request.user.id, mustChangePassword: true,
  });
  await audit(request, { action: 'doctor.created', entityType: 'doctor', entityId: doctor._id });
  response.status(201).json({ doctor: publicUser(doctor) });
}));

app.put('/api/doctors/:id', authenticate, allow('audit-reader'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id) || !departments.includes(request.body?.specialization)) {
    response.status(400).json({ error: 'Choose a valid doctor and department.' });
    return;
  }
  if (await Appointment.exists({
    doctorId: request.params.id,
    status: 'Scheduled',
    department: { $ne: request.body.specialization },
  })) {
    response.status(409).json({ error: 'Reassign or cancel scheduled appointments before changing this doctor’s department.' });
    return;
  }
  const doctor = await User.findOneAndUpdate(
    { _id: request.params.id, role: 'doctor', isActive: { $ne: false } },
    { $set: { specialization: request.body.specialization } },
    { returnDocument: 'after', runValidators: true },
  );
  if (!doctor) {
    response.status(404).json({ error: 'Doctor not found.' });
    return;
  }
  await audit(request, { action: 'doctor.department_changed', entityType: 'doctor', entityId: doctor._id });
  response.json({ doctor: publicUser(doctor) });
}));

app.get('/api/patients', authenticate, allow('doctor', 'staff', 'receptionist'), asyncRoute(async (request, response) => {
  const pagination = getPagination(request, response);
  if (!pagination) return;
  const filter = { role: 'patient', isActive: { $ne: false } };
  if (request.user.role === 'doctor') filter._id = { $in: await doctorPatientIds(request.user.id) };
  if (pagination.q) {
    const pattern = escapedRegex(pagination.q);
    filter.$or = [{ name: pattern }, { uhid: pattern }, { email: pattern }];
  }
  const patientFields = ['staff', 'receptionist'].includes(request.user.role)
    ? 'name email uhid phone'
    : 'name email uhid phone dateOfBirth sex bloodGroup address emergencyContact allergies chronicConditions currentMedications heightCm weightKg';
  const { items, total, page } = await listPage(User, filter, pagination, {
    sort: { name: 1 },
    select: patientFields,
  });
  const patients = items;
  if (request.user.role === 'doctor' || request.user.role === 'staff' || request.user.role === 'receptionist') {
    await audit(request, { action: 'patients.listed', entityType: 'patient' });
  }
  response.json({ patients, items: patients, total, page });
}));

app.get('/api/audit', authenticate, allow('audit-reader'), asyncRoute(async (request, response) => {
  const page = Number.parseInt(request.query.page, 10) || 1;
  const limit = Math.min(Number.parseInt(request.query.limit, 10) || 50, 200);
  if (page < 1 || limit < 1) {
    response.status(400).json({ error: 'Page and limit must be positive integers.' });
    return;
  }
  const [items, total] = await Promise.all([
    AuditLog.find({})
      .populate('actorId', 'name role')
      .populate('patientId', 'name uhid')
      .sort({ at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments({}),
  ]);
  response.json({ items, total, page });
}));

app.post('/api/patients', authenticate, allow('doctor', 'staff', 'receptionist', 'admin'), asyncRoute(async (request, response) => {
  const {
    name, email, password, phone, dateOfBirth, sex, bloodGroup, address, emergencyContact,
    allergies, chronicConditions, currentMedications, heightCm, weightKg,
  } = request.body ?? {};
  const validOptionalString = isOptionalString;
  const validList = (value) => value === undefined || (Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === 'string' && item.trim() && item.length <= 100));
  const contact = emergencyContact ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !validPassword(password)
    || !isOptionalPhone(phone)
    || (dateOfBirth !== undefined && dateOfBirth !== '' && !validDate(dateOfBirth))
    || (sex !== undefined && !['', 'Female', 'Male', 'Intersex', 'Prefer not to say'].includes(sex))
    || (bloodGroup !== undefined && !['', ...bloodGroups].includes(bloodGroup))
    || !isOptionalAddress(address)
    || !contact || typeof contact !== 'object' || Array.isArray(contact)
    || !validOptionalString(contact.name, 100)
    || !validOptionalString(contact.relationship, 50)
    || !validOptionalString(contact.phone, 30)
    || !validList(allergies) || !validList(chronicConditions) || !validList(currentMedications)
    || (heightCm !== undefined && heightCm !== '' && (!Number.isFinite(Number(heightCm)) || Number(heightCm) < 30 || Number(heightCm) > 250))
    || (weightKg !== undefined && weightKg !== '' && (!Number.isFinite(Number(weightKg)) || Number(weightKg) < 1 || Number(weightKg) > 500))
  ) {
    response.status(400).json({ error: 'Check the patient identity, date of birth, contact, medical history, and measurement fields.' });
    return;
  }
  const patient = await createUser({
    name, email, password, role: 'patient', phone, dateOfBirth, sex, bloodGroup, address,
    emergencyContact: contact, allergies, chronicConditions, currentMedications, heightCm, weightKg,
    registeredBy: request.user.id, mustChangePassword: true,
  });
  await audit(request, { action: 'patient.created', entityType: 'patient', entityId: patient._id, patientId: patient._id });
  response.status(201).json({ patient: publicUser(patient) });
}));

app.get('/api/staff', authenticate, allow('admin'), asyncRoute(async (_request, response) => {
  const staff = await User.find({ role: 'staff', isActive: { $ne: false } })
    .select('name email uhid phone')
    .sort({ name: 1 })
    .lean();
  response.json({ staff });
}));

app.post('/api/staff', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const { name, email, password, phone } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !validPassword(password)
    || !isOptionalPhone(phone)
  ) {
    response.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' });
    return;
  }
  const staff = await createUser({
    name, email, password, role: 'staff', phone,
    registeredBy: request.user.id, mustChangePassword: true,
  });
  await audit(request, { action: 'staff.created', entityType: 'staff', entityId: staff._id });
  response.status(201).json({ staff: publicUser(staff) });
}));

app.get('/api/receptionists', authenticate, allow('admin'), asyncRoute(async (_request, response) => {
  const receptionists = await User.find({ role: 'receptionist', isActive: { $ne: false } })
    .select('name email phone')
    .sort({ name: 1 })
    .lean();
  response.json({ receptionists });
}));

app.post('/api/receptionists', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const { name, email, password, phone } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !validPassword(password)
    || !isOptionalPhone(phone)
  ) {
    response.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' });
    return;
  }
  const receptionist = await createUser({
    name, email, password, role: 'receptionist', phone,
    registeredBy: request.user.id, mustChangePassword: true,
  });
  await audit(request, { action: 'receptionist.created', entityType: 'receptionist', entityId: receptionist._id });
  response.status(201).json({ receptionist: publicUser(receptionist) });
}));

app.put('/api/patients/:id', authenticate, asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid patient ID.' });
    return;
  }
  if (request.user.role !== 'admin') {
    response.status(403).json({ error: 'Only administrators can update patient account details.' });
    return;
  }
  const allowedFields = [
    'name', 'email', 'phone', 'dateOfBirth', 'sex', 'bloodGroup', 'address',
    'emergencyContact', 'allergies', 'chronicConditions', 'currentMedications', 'heightCm', 'weightKg',
  ];
  const update = Object.fromEntries(allowedFields
    .filter((field) => request.body?.[field] !== undefined)
    .map((field) => [field, typeof request.body[field] === 'string' ? request.body[field].trim() : request.body[field]]));
  const validList = (value) => Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === 'string' && item.trim() && item.length <= 100);
  if (
    !Object.keys(update).length
    || (update.name !== undefined && (!update.name || update.name.length > 100))
    || (update.email !== undefined && (update.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)))
    || !isOptionalPhone(update.phone)
    || (update.dateOfBirth !== undefined && update.dateOfBirth !== '' && !validDate(update.dateOfBirth))
    || (update.sex !== undefined && !['', 'Female', 'Male', 'Intersex', 'Prefer not to say'].includes(update.sex))
    || (update.bloodGroup !== undefined && !['', ...bloodGroups].includes(update.bloodGroup))
    || !isOptionalAddress(update.address)
    || (update.emergencyContact !== undefined && (
      !update.emergencyContact
      || typeof update.emergencyContact !== 'object'
      || Array.isArray(update.emergencyContact)
      || ['name', 'relationship', 'phone'].some((field) => (
        update.emergencyContact[field] !== undefined
        && (typeof update.emergencyContact[field] !== 'string'
          || update.emergencyContact[field].length > (field === 'relationship' ? 50 : field === 'name' ? 100 : 30))
      ))
    ))
    || (['allergies', 'chronicConditions', 'currentMedications'].some((field) => update[field] !== undefined && !validList(update[field])))
    || (update.heightCm !== undefined && update.heightCm !== null && (!Number.isFinite(Number(update.heightCm)) || Number(update.heightCm) < 30 || Number(update.heightCm) > 250))
    || (update.weightKg !== undefined && update.weightKg !== null && (!Number.isFinite(Number(update.weightKg)) || Number(update.weightKg) < 1 || Number(update.weightKg) > 500))
  ) {
    response.status(400).json({ error: 'Provide valid patient account and medical profile details to update.' });
    return;
  }
  const patient = await User.findOneAndUpdate(
    { _id: request.params.id, role: 'patient', isActive: { $ne: false } },
    update,
    { returnDocument: 'after', runValidators: true },
  );
  if (!patient) {
    response.status(404).json({ error: 'Patient not found.' });
    return;
  }
  response.json({ patient: publicUser(patient) });
}));

app.delete('/api/patients/:id', authenticate, allow('audit-reader'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid patient ID.' });
    return;
  }
  const patient = await User.findOneAndUpdate(
    { _id: request.params.id, role: 'patient', isActive: { $ne: false } },
    {
      $set: { isActive: false, deletedAt: new Date(), deletedBy: request.user._id },
      $inc: { sessionVersion: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!patient) {
    response.status(404).json({ error: 'Patient not found.' });
    return;
  }
  await audit(request, { action: 'patient.deactivated', entityType: 'patient', entityId: patient._id, patientId: patient._id });
  response.json({ success: true, message: 'Patient account deactivated; the medical record has been retained.' });
}));

app.post('/api/patients/:id/reset-password', authenticate, allow('doctor', 'staff'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid patient ID.' });
    return;
  }
  const { password } = request.body ?? {};
  if (!validPassword(password)) {
    response.status(400).json({ error: 'Enter a temporary password with at least 8 characters.' });
    return;
  }
  const patient = await User.findOne({
    _id: request.params.id,
    role: 'patient',
    isActive: { $ne: false },
  }).select('+password registeredBy sessionVersion');
  if (!patient) {
    response.status(404).json({ error: 'Patient not found.' });
    return;
  }
  if (
    request.user.role === 'doctor'
    && String(patient.registeredBy) !== request.user.id
    && !await doctorCanAccessPatient(request.user.id, patient.id)
  ) {
    response.status(403).json({ error: 'Only the registering doctor or a doctor assigned to this patient can reset the password.' });
    return;
  }
  patient.password = password;
  patient.mustChangePassword = true;
  patient.passwordChangedAt = new Date();
  patient.sessionVersion = (patient.sessionVersion || 0) + 1;
  await patient.save();
  await audit(request, { action: 'patient.password_reset', entityType: 'patient', entityId: patient._id, patientId: patient._id });
  response.json({ success: true });
}));

app.get('/api/appointments', authenticate, allow('doctor', 'staff', 'receptionist'), asyncRoute(async (request, response) => {
  const pagination = getPagination(request, response);
  if (!pagination) return;
  const filter = request.user.role === 'patient'
    ? { patientId: request.user.id }
    : request.user.role === 'doctor'
      ? { doctorId: request.user.id }
      : {};
  await addPatientSearch(filter, pagination.q);
  const result = await listPage(Appointment, filter, pagination, {
    sort: { date: 1, time: 1 },
    populate: [['patientId', 'name uhid phone'], ['doctorId', 'name specialization']],
  });
  response.json({ appointments: result.items, ...result });
}));

app.post('/api/appointments', authenticate, allow('staff', 'receptionist'), asyncRoute(async (request, response) => {
  const { doctorId, department, date, time, symptoms, triage } = request.body ?? {};
  const patientId = request.body?.patientId;
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient', isActive: { $ne: false } })
    || typeof department !== 'string' || !departments.includes(department)
    || !validDate(date)
    || !isWithinClinicHours(time, clinicStartHour, clinicEndHour)
    || !isFutureAppointment(date, time)
    || typeof symptoms !== 'string' || !symptoms.trim() || symptoms.length > 2000
    || (triage !== undefined && !triageLevels.includes(triage))
  ) {
    response.status(400).json({ error: `Choose an active patient and enter a future appointment during clinic hours (${String(clinicStartHour).padStart(2, '0')}:00–${String(clinicEndHour).padStart(2, '0')}:00), with a valid department, symptoms, and triage level.` });
    return;
  }
  if (doctorId && (!validObjectId(doctorId) || !await User.exists({ _id: doctorId, role: 'doctor', isActive: { $ne: false } }))) {
    response.status(400).json({ error: 'Choose a valid doctor.' });
    return;
  }
  if (doctorId) {
    const doctor = await User.findById(doctorId).select('specialization');
    if (!doctor || doctor.specialization !== department) {
      response.status(400).json({ error: 'The selected doctor does not match this department.' });
      return;
    }
    if (await Appointment.exists({
      doctorId,
      date: new Date(`${date}T00:00:00.000Z`),
      time,
      status: { $in: appointmentStatuses.filter((status) => !['Cancelled', 'Completed'].includes(status)) },
    })) {
      response.status(409).json({ error: 'This doctor already has an appointment in that one-hour slot. Choose another time.' });
      return;
    }
  }
  const appointment = await Appointment.create({
    patientId,
    doctorId: doctorId || null,
    department,
    date: new Date(`${date}T00:00:00.000Z`),
    time,
    symptoms: symptoms.trim(),
    triage: triage || 'OPD Routine',
  });
  response.status(201).json({ appointment });
}));

app.put('/api/appointments/:id', authenticate, allow('doctor', 'staff', 'receptionist'), asyncRoute(async (request, response) => {
  const { status, triage, doctorId } = request.body ?? {};
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid appointment ID.' });
    return;
  }
  const update = {};
  if (request.user.role === 'doctor' && doctorId !== undefined) {
    response.status(403).json({ error: 'Doctors cannot reassign appointments to another doctor.' });
    return;
  }
  if (status !== undefined) {
    if (!appointmentStatuses.includes(status)) {
      response.status(400).json({ error: 'Choose a valid appointment status.' });
      return;
    }
    update.status = status;
  }
  if (triage !== undefined) {
    if (!triageLevels.includes(triage)) {
      response.status(400).json({ error: 'Choose a valid triage level.' });
      return;
    }
    update.triage = triage;
  }
  if (doctorId !== undefined) {
    if (doctorId && (!validObjectId(doctorId) || !await User.exists({ _id: doctorId, role: 'doctor', isActive: { $ne: false } }))) {
      response.status(400).json({ error: 'Choose a valid doctor.' });
      return;
    }
    update.doctorId = doctorId || null;
  }
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide a valid status, triage, or doctor assignment.' });
    return;
  }
  const appointmentFilter = request.user.role === 'doctor'
    ? { _id: request.params.id, doctorId: request.user.id }
    : { _id: request.params.id };
  const existingAppointment = await Appointment.findOne(appointmentFilter);
  if (!existingAppointment) {
    response.status(404).json({ error: 'Appointment not found.' });
    return;
  }
  if (status !== undefined && status !== existingAppointment.status) {
    const allowedTransitions = appointmentStatusTransitions[existingAppointment.status] || [];
    if (!allowedTransitions.includes(status) || !appointmentTransitionRoles[status]?.includes(request.user.role)) {
      response.status(409).json({ error: `Cannot move an appointment from ${existingAppointment.status} to ${status} for this role.` });
      return;
    }
  }
  const nextDoctorId = update.doctorId === undefined ? existingAppointment.doctorId : update.doctorId;
  const nextStatus = update.status || existingAppointment.status;
  if (nextDoctorId) {
    const doctor = await User.findOne({
      _id: nextDoctorId,
      role: 'doctor',
      isActive: { $ne: false },
    }).select('specialization');
    if (!doctor || doctor.specialization !== existingAppointment.department) {
      response.status(400).json({ error: 'The selected doctor does not match this appointment department.' });
      return;
    }
  }
  if (nextDoctorId && nextStatus === 'Scheduled' && await Appointment.exists({
    _id: { $ne: existingAppointment.id },
    doctorId: nextDoctorId,
    date: existingAppointment.date,
    time: existingAppointment.time,
    status: { $in: appointmentStatuses.filter((status) => !['Cancelled', 'Completed'].includes(status)) },
  })) {
    response.status(409).json({ error: 'This doctor already has an appointment in that one-hour slot.' });
    return;
  }
  const appointment = await Appointment.findOneAndUpdate(appointmentFilter, update, { returnDocument: 'after', runValidators: true })
    .populate('patientId', 'name uhid')
    .populate('doctorId', 'name specialization');
  if (!appointment) {
    response.status(404).json({ error: 'Appointment not found.' });
    return;
  }
  response.json({ appointment });
}));

app.delete('/api/appointments/:id', authenticate, allow('staff', 'receptionist'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid appointment ID.' });
    return;
  }
  const appointment = await Appointment.findByIdAndUpdate(
    request.params.id,
    { status: 'Cancelled' },
    { returnDocument: 'after', runValidators: true },
  );
  if (!appointment) {
    response.status(404).json({ error: 'Appointment not found.' });
    return;
  }
  response.json({ appointment });
}));

app.get('/api/beds', authenticate, allow('doctor', 'staff'), asyncRoute(async (request, response) => {
  const patientIds = request.user.role === 'doctor' ? await doctorPatientIds(request.user.id) : null;
  const filter = patientIds ? { patientId: { $in: patientIds } } : {};
  const [beds, totals] = await Promise.all([
    Bed.find(filter).populate('patientId', 'name uhid').sort({ ward: 1, bedNumber: 1 }).lean(),
    Bed.aggregate([
      { $match: filter },
      { $group: { _id: '$ward', total: { $sum: 1 }, occupied: { $sum: { $cond: [{ $eq: ['$status', 'Occupied'] }, 1, 0] } }, available: { $sum: { $cond: [{ $eq: ['$status', 'Available'] }, 1, 0] } } } },
    ]),
  ]);
  response.json({ beds, totals });
}));

app.post('/api/beds', authenticate, allow('staff'), asyncRoute(async (request, response) => {
  const { bedNumber, ward } = request.body ?? {};
  if (typeof bedNumber !== 'string' || !/^[A-Z0-9-]{2,20}$/i.test(bedNumber.trim()) || !wards.includes(ward)) {
    response.status(400).json({ error: 'Enter a valid bed number and ward.' });
    return;
  }
  const bed = await Bed.create({ bedNumber: bedNumber.trim().toUpperCase(), ward });
  response.status(201).json({ bed });
}));

app.put('/api/beds/:id', authenticate, allow('staff'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid bed ID.' });
    return;
  }
  const { status, patientId, bedNumber, ward } = request.body ?? {};
  const update = {};
  if (status !== undefined) {
    if (!bedStatuses.includes(status)) {
      response.status(400).json({ error: 'Choose a valid bed status.' });
      return;
    }
    update.status = status;
  }
  const isDischarge = status === 'Available' || status === 'Maintenance';
  if (isDischarge) {
    update.patientId = null;
  } else if (patientId !== undefined) {
    if (patientId && (!validObjectId(patientId) || !await User.exists({ _id: patientId, role: 'patient', isActive: { $ne: false } }))) {
      response.status(400).json({ error: 'Choose a valid patient.' });
      return;
    }
    update.patientId = patientId || null;
    if (status === undefined) update.status = patientId ? 'Occupied' : 'Available';
    if (patientId && status !== undefined && status !== 'Occupied') {
      response.status(400).json({ error: 'An assigned patient requires the bed to be occupied.' });
      return;
    }
  }
  if (bedNumber !== undefined) {
    if (typeof bedNumber !== 'string' || !/^[A-Z0-9-]{2,20}$/i.test(bedNumber.trim())) {
      response.status(400).json({ error: 'Enter a valid bed number.' });
      return;
    }
    update.bedNumber = bedNumber.trim().toUpperCase();
  }
  if (ward !== undefined) {
    if (!wards.includes(ward)) {
      response.status(400).json({ error: 'Choose a valid ward.' });
      return;
    }
    update.ward = ward;
  }
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide valid bed fields to update.' });
    return;
  }
  const currentBed = await Bed.findById(request.params.id);
  if (!currentBed) {
    response.status(404).json({ error: 'Bed not found.' });
    return;
  }
  const assignedPatient = update.patientId === undefined ? currentBed.patientId : update.patientId;
  if (update.status === 'Occupied' && !assignedPatient) {
    response.status(400).json({ error: 'Assign a patient before marking a bed occupied.' });
    return;
  }
  if (update.status === 'Occupied' && assignedPatient && await Bed.exists({
    _id: { $ne: currentBed.id },
    patientId: assignedPatient,
    status: 'Occupied',
  })) {
    response.status(409).json({ error: 'This patient is already assigned to another occupied bed.' });
    return;
  }
  const bedFilter = { _id: request.params.id };
  if (update.status === 'Occupied' && assignedPatient) {
    bedFilter.$or = [
      { status: { $ne: 'Occupied' } },
      { patientId: assignedPatient },
    ];
  }
  const bed = await Bed.findOneAndUpdate(bedFilter, update, { returnDocument: 'after', runValidators: true })
    .populate('patientId', 'name uhid');
  if (!bed) {
    if (await Bed.exists({ _id: request.params.id })) {
      response.status(409).json({ error: 'Discharge the current patient first.' });
      return;
    }
    response.status(404).json({ error: 'Bed not found.' });
    return;
  }
  response.json({ bed });
}));

app.delete('/api/beds/:id', authenticate, allow('staff'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid bed ID.' });
    return;
  }
  const existingBed = await Bed.findById(request.params.id);
  if (existingBed?.status === 'Occupied' || existingBed?.patientId) {
    response.status(409).json({ error: 'Discharge the patient before removing this bed.' });
    return;
  }
  const bed = await Bed.findByIdAndDelete(request.params.id);
  if (!bed) {
    response.status(404).json({ error: 'Bed not found.' });
    return;
  }
  response.json({ success: true });
}));

app.get('/api/billing', authenticate, allow('patient', 'receptionist'), asyncRoute(async (request, response) => {
  const pagination = getPagination(request, response);
  if (!pagination) return;
  const filter = request.user.role === 'patient' ? { patientId: request.user.id } : {};
  await addPatientSearch(filter, pagination.q);
  const result = await listPage(Billing, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [['patientId', 'name uhid'], ['createdBy', 'name']],
    select: request.user.role === 'patient'
      ? 'invoiceNumber totalPaise lineItems discountPaise status paymentMethod createdAt'
      : undefined,
  });
  response.json({ bills: result.items, ...result });
}));

app.post('/api/billing', authenticate, allow('receptionist'), asyncRoute(async (request, response) => {
  const { patientId, appointmentId, lineItems, discount, notes } = request.body ?? {};
  const validAmount = (value) => typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 100_000_000
    && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7;
  const itemAmounts = Array.isArray(lineItems)
    ? lineItems.map((item) => validAmount(item?.amount) ? Math.round(item.amount * 100) : NaN)
    : [];
  const subtotalPaise = itemAmounts.reduce((total, amount) => total + amount, 0);
  const discountPaise = discount === undefined || discount === '' ? 0
    : validAmount(discount) ? Math.round(discount * 100) : NaN;
  const totalPaise = subtotalPaise - discountPaise;
  let appointment = null;
  if (appointmentId !== undefined) {
    appointment = validObjectId(appointmentId)
      ? await Appointment.findOne({ _id: appointmentId, patientId })
      : null;
    if (!appointment || appointment.status !== 'Consulted') {
      response.status(409).json({ error: 'Choose a consulted appointment that is awaiting billing.' });
      return;
    }
  }
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient', isActive: { $ne: false } })
    || !Array.isArray(lineItems) || lineItems.length < 1 || lineItems.length > 50
    || lineItems.some((item) => !item || typeof item !== 'object'
      || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 250)
    || itemAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 1)
    || !Number.isFinite(discountPaise) || discountPaise < 0 || discountPaise >= subtotalPaise
    || !Number.isSafeInteger(totalPaise)
    || totalPaise < 1 || totalPaise > 10_000_000_000
    || (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000))
  ) {
    response.status(400).json({ error: 'Select a patient and enter valid line items, discount, and notes.' });
    return;
  }
  const bill = await Billing.create({
    patientId,
    appointmentId: appointment?._id || null,
    createdBy: request.user.id,
    totalPaise,
    description: lineItems.map(({ description: itemDescription }) => itemDescription.trim()).join(', ').slice(0, 1000),
    lineItems: lineItems.map((item, index) => ({
      description: item.description.trim(),
      amountPaise: itemAmounts[index],
    })),
    discountPaise,
    notes: notes || '',
    invoiceNumber: await nextInvoiceNumber(),
  });
  if (appointment) {
    appointment.status = 'Billed';
    await appointment.save();
  }
  await audit(request, { action: 'billing.issued', entityType: 'billing', entityId: bill._id, patientId });
  response.status(201).json({ bill });
}));

app.put('/api/billing/:id', authenticate, allow('admin', 'receptionist'), asyncRoute(async (request, response) => {
  const { status, paymentMethod, paymentReference = '' } = request.body ?? {};
  if (!validObjectId(request.params.id) || !['Paid', 'Void'].includes(status)) {
    response.status(400).json({ error: 'Choose a valid bill and status.' });
    return;
  }
  if (status === 'Void' && request.user.role !== 'admin') {
    response.status(403).json({ error: 'Only administrators can void bills.' });
    return;
  }
  if (status === 'Paid' && request.user.role !== 'receptionist') {
    response.status(403).json({ error: 'Only receptionists can record payments.' });
    return;
  }
  if (status === 'Paid' && (
    !paymentMethods.includes(paymentMethod)
    || typeof paymentReference !== 'string'
    || paymentReference.length > 200
  )) {
    response.status(400).json({ error: 'Choose a valid payment method and optional reference.' });
    return;
  }
  const bill = await Billing.findById(request.params.id);
  if (!bill) {
    response.status(404).json({ error: 'Bill not found.' });
    return;
  }
  if (bill.status !== 'Unpaid') {
    response.status(409).json({ error: 'Only unpaid bills can be marked paid or voided.' });
    return;
  }
  bill.status = status;
  bill.paidAt = status === 'Paid' ? new Date() : null;
  if (status === 'Paid') {
    bill.paymentMethod = paymentMethod;
    bill.paymentReference = paymentReference.trim();
    bill.paidBy = request.user.id;
  }
  await bill.save();
  if (status === 'Paid' && bill.appointmentId) {
    await Appointment.findOneAndUpdate({ _id: bill.appointmentId, status: 'Billed' }, { status: 'Paid' });
  }
  await audit(request, { action: `billing.${bill.status.toLowerCase()}`, entityType: 'billing', entityId: bill._id, patientId: bill.patientId });
  response.json({ bill });
}));

app.get('/api/prescriptions', authenticate, allow('patient', 'doctor', 'receptionist'), asyncRoute(async (request, response) => {
  const pagination = getPagination(request, response);
  if (!pagination) return;
  if (request.user.role === 'receptionist' && !validObjectId(request.query.patientId)) {
    response.status(400).json({ error: 'Choose a patient to view their doctor report.' });
    return;
  }
  const filter = request.user.role === 'patient'
    ? { patientId: request.user.id }
    : request.user.role === 'doctor'
      ? { patientId: { $in: await doctorPatientIds(request.user.id) } }
      : request.user.role === 'receptionist'
        ? { patientId: request.query.patientId }
        : {};
  if (request.user.role === 'receptionist' && !await User.exists({
    _id: request.query.patientId,
    role: 'patient',
    isActive: { $ne: false },
  })) {
    response.status(404).json({ error: 'Patient not found.' });
    return;
  }
  await addPatientSearch(filter, pagination.q);
  const result = await listPage(Prescription, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [['patientId', 'name uhid'], ['doctorId', 'name specialization']],
  });
  response.json({ prescriptions: result.items, ...result });
}));

app.get('/api/clinical-notes', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  const pagination = getPagination(request, response);
  if (!pagination) return;
  const filter = request.user.role === 'patient'
    ? { patientId: request.user.id }
    : { patientId: { $in: await doctorPatientIds(request.user.id) } };
  await addPatientSearch(filter, pagination.q);
  const result = await listPage(ClinicalNote, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [['patientId', 'name uhid'], ['doctorId', 'name specialization']],
  });
  response.json({ clinicalNotes: result.items, ...result });
}));

app.post('/api/clinical-notes', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  const { patientId, chiefComplaint, historyOfPresentIllness, examination, assessment, plan, followUp } = request.body ?? {};
  const optionalNotes = [
    { value: historyOfPresentIllness, maxLength: 3000 },
    { value: examination, maxLength: 3000 },
    { value: followUp, maxLength: 1000 },
  ];
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient', isActive: { $ne: false } })
    || !await doctorCanAccessPatient(request.user.id, patientId)
    || typeof chiefComplaint !== 'string' || !chiefComplaint.trim() || chiefComplaint.length > 1000
    || typeof assessment !== 'string' || !assessment.trim() || assessment.length > 2000
    || typeof plan !== 'string' || !plan.trim() || plan.length > 3000
    || optionalNotes.some(({ value, maxLength }) => value !== undefined && (typeof value !== 'string' || value.length > maxLength))
  ) {
    response.status(400).json({ error: 'Select a patient and provide the complaint, assessment, plan, and valid note details.' });
    return;
  }
  const clinicalNote = await ClinicalNote.create({
    patientId,
    doctorId: request.user.id,
    chiefComplaint,
    historyOfPresentIllness,
    examination,
    assessment,
    plan,
    followUp,
  });
  await audit(request, { action: 'clinical_note.created', entityType: 'clinical_note', entityId: clinicalNote._id, patientId });
  response.status(201).json({ clinicalNote });
}));

app.put('/api/clinical-notes/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid clinical note ID.' });
    return;
  }
  const allowedFields = ['chiefComplaint', 'historyOfPresentIllness', 'examination', 'assessment', 'plan', 'followUp'];
  const update = Object.fromEntries(allowedFields
    .filter((field) => request.body?.[field] !== undefined)
    .map((field) => [field, request.body[field]]));
  if (
    !Object.keys(update).length
    || (update.chiefComplaint !== undefined && (typeof update.chiefComplaint !== 'string' || !update.chiefComplaint.trim() || update.chiefComplaint.length > 1000))
    || (update.assessment !== undefined && (typeof update.assessment !== 'string' || !update.assessment.trim() || update.assessment.length > 2000))
    || (update.plan !== undefined && (typeof update.plan !== 'string' || !update.plan.trim() || update.plan.length > 3000))
    || (['historyOfPresentIllness', 'examination', 'followUp'].some((field) => update[field] !== undefined && (typeof update[field] !== 'string' || update[field].length > (field === 'followUp' ? 1000 : 3000))))
  ) {
    response.status(400).json({ error: 'Provide valid clinical note fields to update.' });
    return;
  }
  const clinicalNote = await ClinicalNote.findOneAndUpdate(
    { _id: request.params.id, doctorId: request.user.id },
    update,
    { returnDocument: 'after', runValidators: true },
  );
  if (!clinicalNote) {
    response.status(404).json({ error: 'Clinical note not found or you do not have permission to update it.' });
    return;
  }
  await audit(request, {
    action: 'clinical_note.updated',
    entityType: 'clinical_note',
    entityId: clinicalNote._id,
    patientId: clinicalNote.patientId,
  });
  response.json({ clinicalNote });
}));

app.delete('/api/clinical-notes/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid clinical note ID.' });
    return;
  }
  const clinicalNote = await ClinicalNote.findOneAndDelete({ _id: request.params.id, doctorId: request.user.id });
  if (!clinicalNote) {
    response.status(404).json({ error: 'Clinical note not found or you do not have permission to delete it.' });
    return;
  }
  await audit(request, {
    action: 'clinical_note.deleted',
    entityType: 'clinical_note',
    entityId: clinicalNote._id,
    patientId: clinicalNote.patientId,
  });
  response.json({ success: true });
}));

app.post('/api/prescriptions', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  const { patientId, appointmentId, diagnosis, medicines, instructions, followUp, advice } = request.body ?? {};
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient', isActive: { $ne: false } })
    || !await doctorCanAccessPatient(request.user.id, patientId)
    || typeof diagnosis !== 'string' || !diagnosis.trim()
    || !Array.isArray(medicines) || medicines.length < 1 || medicines.length > 30
    || medicines.some((medicine) => !medicine || typeof medicine !== 'object'
      || !['name', 'dosage', 'frequency', 'duration'].every((field) => typeof medicine[field] === 'string' && medicine[field].trim())
      || (medicine.timing !== undefined && !prescriptionTimings.includes(medicine.timing))
      || ['route', 'instructions'].some((field) => medicine[field] !== undefined && (typeof medicine[field] !== 'string' || medicine[field].length > (field === 'route' ? 50 : 500))))
    || (instructions !== undefined && (typeof instructions !== 'string' || instructions.length > 2000))
    || (followUp !== undefined && (typeof followUp !== 'string' || followUp.length > 500))
    || !validPrescriptionAdvice(advice)
  ) {
    response.status(400).json({ error: 'Select a patient and provide a diagnosis and at least one complete medicine.' });
    return;
  }
  let appointment = null;
  if (appointmentId !== undefined) {
    appointment = validObjectId(appointmentId)
      ? await Appointment.findOne({ _id: appointmentId, patientId, doctorId: request.user.id })
      : null;
    if (!appointment) {
      response.status(400).json({ error: 'Choose one of your appointments for this patient.' });
      return;
    }
    if (!(appointmentStatusTransitions[appointment.status] || []).includes('Consulted')) {
      response.status(409).json({ error: `This appointment is ${appointment.status} and is not ready for consultation.` });
      return;
    }
  }
  const prescription = await Prescription.create({
    patientId,
    doctorId: request.user.id,
    diagnosis: diagnosis.trim(),
    medicines,
    instructions,
    followUp,
    advice,
  });
  if (appointment) {
    appointment.status = 'Consulted';
    await appointment.save();
  }
  await audit(request, { action: 'prescription.created', entityType: 'prescription', entityId: prescription._id, patientId });
  response.status(201).json({ prescription });
}));

app.put('/api/prescriptions/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid prescription ID.' });
    return;
  }
  const filter = { _id: request.params.id, doctorId: request.user.id };
  const { diagnosis, medicines, instructions, followUp, advice } = request.body ?? {};
  const update = {};
  if (typeof diagnosis === 'string' && diagnosis.trim()) update.diagnosis = diagnosis.trim();
  if (Array.isArray(medicines) && medicines.length > 0 && medicines.length <= 30
    && medicines.every((medicine) => medicine && typeof medicine === 'object'
      && ['name', 'dosage', 'frequency', 'duration'].every((field) => typeof medicine[field] === 'string' && medicine[field].trim())
      && (medicine.timing === undefined || prescriptionTimings.includes(medicine.timing))
      && ['route', 'instructions'].every((field) => medicine[field] === undefined || (typeof medicine[field] === 'string' && medicine[field].length <= (field === 'route' ? 50 : 500))))) {
    update.medicines = medicines;
  }
  if (typeof instructions === 'string' && instructions.length <= 2000) update.instructions = instructions;
  if (typeof followUp === 'string' && followUp.length <= 500) update.followUp = followUp;
  if (advice !== undefined && validPrescriptionAdvice(advice)) update.advice = advice;
  if (advice !== undefined && !validPrescriptionAdvice(advice)) {
    response.status(400).json({ error: 'Choose only the listed lifestyle suggestions and provide notes up to 1000 characters.' });
    return;
  }
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide a diagnosis or medicines to update.' });
    return;
  }
  const prescription = await Prescription.findOneAndUpdate(filter, update, { returnDocument: 'after', runValidators: true });
  if (!prescription) {
    response.status(404).json({ error: 'Prescription not found or you do not have permission to update it.' });
    return;
  }
  await audit(request, {
    action: 'prescription.updated',
    entityType: 'prescription',
    entityId: prescription._id,
    patientId: prescription.patientId,
  });
  response.json({ prescription });
}));

app.delete('/api/prescriptions/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid prescription ID.' });
    return;
  }
  const prescription = await Prescription.findOneAndDelete({ _id: request.params.id, doctorId: request.user.id });
  if (!prescription) {
    response.status(404).json({ error: 'Prescription not found or you do not have permission to delete it.' });
    return;
  }
  await audit(request, {
    action: 'prescription.deleted',
    entityType: 'prescription',
    entityId: prescription._id,
    patientId: prescription.patientId,
  });
  response.json({ success: true });
}));

app.get('/api/vitals', authenticate, allow('doctor', 'staff'), asyncRoute(async (request, response) => {
  const pagination = getPagination(request, response);
  if (!pagination) return;
  const filter = request.user.role === 'doctor'
    ? { patientId: { $in: await doctorPatientIds(request.user.id) } }
    : {};
  await addPatientSearch(filter, pagination.q);
  const result = await listPage(Vital, filter, pagination, {
    sort: { createdAt: -1 },
    populate: [['patientId', 'name uhid'], ['recordedBy', 'name role'], ['enteredBy', 'name role'], ['editedBy', 'name']],
  });
  response.json({ vitals: result.items, ...result });
}));

app.post('/api/vitals', authenticate, allow('staff'), asyncRoute(async (request, response) => {
  const {
    patientId, appointmentId, heartRate, systolic, diastolic, temperatureC, oxygenSaturation,
    heightCm, weightKg, symptoms, symptomOther, notes,
  } = request.body ?? {};
  const ranges = {
    heartRate: [20, 300],
    systolic: [40, 300],
    diastolic: [20, 200],
    temperatureC: [25, 45],
    oxygenSaturation: [1, 100],
    heightCm: [30, 250],
    weightKg: [1, 500],
  };
  const hasInvalidMeasurement = Object.entries(ranges).some(([field, [min, max]]) => {
    const value = request.body?.[field];
    return value !== undefined && value !== null && value !== ''
      && (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max);
  });
  if (!validObjectId(patientId) || !await User.exists({ _id: patientId, role: 'patient', isActive: { $ne: false } })) {
    response.status(400).json({ error: 'Choose a valid patient.' });
    return;
  }
  let appointment = null;
  if (appointmentId !== undefined) {
    appointment = validObjectId(appointmentId)
      ? await Appointment.findOne({ _id: appointmentId, patientId })
      : null;
    if (!appointment) {
      response.status(400).json({ error: 'Choose a valid appointment for this patient.' });
      return;
    }
    if (!(appointmentStatusTransitions[appointment.status] || []).includes('Vitals done')) {
      response.status(409).json({ error: `This appointment is ${appointment.status} and is not awaiting a preliminary check.` });
      return;
    }
  }
  const values = { heartRate, systolic, diastolic, temperatureC, oxygenSaturation, heightCm, weightKg };
  const hasVital = Object.values(values).some((value) => value !== undefined && value !== null && value !== '');
  if (
    !hasVital || hasInvalidMeasurement
    || !Array.isArray(symptoms) || symptoms.length < 1
    || symptoms.some((symptom) => !preliminaryCheckSymptoms.includes(symptom))
    || new Set(symptoms).size !== symptoms.length
    || (symptoms.includes('Other') && (typeof symptomOther !== 'string' || !symptomOther.trim() || symptomOther.length > 200))
    || (!symptoms.includes('Other') && symptomOther !== undefined && symptomOther !== '')
    || (systolic !== undefined && systolic !== '' && (diastolic === undefined || diastolic === ''))
    || (diastolic !== undefined && diastolic !== '' && (systolic === undefined || systolic === ''))
    || (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000))
  ) {
    response.status(400).json({ error: 'Enter valid measurements, select allowed symptoms, and provide Other details when selected.' });
    return;
  }
  const vital = await Vital.create({
    patientId,
    recordedBy: request.user.id,
    enteredBy: request.user.id,
    enteredByRole: request.user.role,
    symptoms,
    symptomOther: symptomOther || '',
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === '' ? null : value])),
    notes: notes || '',
  });
  await audit(request, { action: 'vital.created', entityType: 'vital', entityId: vital._id, patientId });
  if (appointment) {
    appointment.status = 'Vitals done';
    await appointment.save();
  }
  response.status(201).json({ vital });
}));

app.put('/api/vitals/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid vital record ID.' });
    return;
  }
  const vital = await Vital.findById(request.params.id);
  if (!vital) {
    response.status(404).json({ error: 'Vital record not found.' });
    return;
  }
  if (!await doctorCanAccessPatient(request.user.id, vital.patientId)) {
    response.status(404).json({ error: 'Vital record not found.' });
    return;
  }
  const fields = [
    'heartRate', 'systolic', 'diastolic', 'respiratoryRate', 'temperatureC', 'bloodGlucose',
    'oxygenSaturation', 'heightCm', 'weightKg', 'notes', 'symptoms', 'symptomOther',
  ];
  const update = Object.fromEntries(fields.filter((field) => request.body?.[field] !== undefined).map((field) => [field, request.body[field]]));
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide at least one vital value to update.' });
    return;
  }
  if (
    (update.symptoms !== undefined && (
      !Array.isArray(update.symptoms)
      || update.symptoms.some((symptom) => !preliminaryCheckSymptoms.includes(symptom))
      || new Set(update.symptoms).size !== update.symptoms.length
    ))
    || (update.symptomOther !== undefined && (typeof update.symptomOther !== 'string' || update.symptomOther.length > 200))
    || (update.notes !== undefined && (typeof update.notes !== 'string' || update.notes.length > 1000))
  ) {
    response.status(400).json({ error: 'Provide only allowed symptoms and text within the field limits.' });
    return;
  }
  const measurementRanges = {
    heartRate: [20, 300],
    systolic: [40, 300],
    diastolic: [20, 200],
    respiratoryRate: [1, 100],
    temperatureC: [25, 45],
    bloodGlucose: [1, 2000],
    oxygenSaturation: [1, 100],
    heightCm: [30, 250],
    weightKg: [1, 500],
  };
  const hasInvalidMeasurement = Object.entries(measurementRanges).some(([field, [min, max]]) => {
    const value = update[field];
    return value !== undefined && value !== null && value !== ''
      && (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max);
  });
  const nextSymptoms = update.symptoms ?? vital.symptoms;
  const nextSymptomOther = update.symptomOther ?? vital.symptomOther;
  const nextSystolic = update.systolic !== undefined ? update.systolic : vital.systolic;
  const nextDiastolic = update.diastolic !== undefined ? update.diastolic : vital.diastolic;
  const hasSystolic = nextSystolic !== undefined && nextSystolic !== null && nextSystolic !== '';
  const hasDiastolic = nextDiastolic !== undefined && nextDiastolic !== null && nextDiastolic !== '';
  if (
    hasInvalidMeasurement
    || (hasSystolic !== hasDiastolic)
    || (nextSymptoms?.includes('Other') && (typeof nextSymptomOther !== 'string' || !nextSymptomOther.trim() || nextSymptomOther.length > 200))
  ) {
    response.status(400).json({ error: 'Keep measurements within their allowed ranges and provide details for Other symptoms.' });
    return;
  }
  if (!nextSymptoms?.includes('Other')) update.symptomOther = '';
  Object.assign(vital, update);
  if (request.user.role === 'doctor') {
    vital.editedBy = request.user.id;
    vital.editedAt = new Date();
  }
  await vital.save();
  await audit(request, {
    action: 'vital.updated',
    entityType: 'vital',
    entityId: vital._id,
    patientId: vital.patientId,
  });
  response.json({ vital });
}));

app.delete('/api/vitals/:id', authenticate, allow('audit-reader'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid vital record ID.' });
    return;
  }
  const vital = await Vital.findOneAndDelete({ _id: request.params.id, recordedBy: request.user.id });
  if (!vital) {
    response.status(404).json({ error: 'Vital record not found.' });
    return;
  }
  await audit(request, {
    action: 'vital.deleted',
    entityType: 'vital',
    entityId: vital._id,
    patientId: vital.patientId,
  });
  response.json({ success: true });
}));

if (process.env.NODE_ENV === 'production') {
  const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(clientDist));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) {
      next();
      return;
    }
    response.sendFile(resolve(clientDist, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found.' });
});

app.use((error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error.code === 11000) {
    if (error.keyPattern?.email || error.keyValue?.email) {
      response.status(409).json({
        error: 'An account with that email already exists. If you already submitted this account, sign in with that email and password; otherwise use a different email.',
      });
      return;
    }
    if (error.keyPattern?.doctorId && error.keyPattern?.date && error.keyPattern?.time) {
      response.status(409).json({ error: 'That slot was just taken. Choose another time.' });
      return;
    }
    response.status(409).json({ error: 'The submitted identifier or schedule conflicts with an existing record.' });
    return;
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    response.status(400).json({ error: 'The submitted data is invalid. Check the fields and try again.' });
    return;
  }
  const status = Number(error.status || error.statusCode);
  if (status === 400 && error.type === 'entity.parse.failed') {
    response.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  if (status === 413 || error.type === 'entity.too.large') {
    response.status(413).json({ error: 'Request too large' });
    return;
  }
  if (status >= 400 && status < 500) {
    response.status(status).json({ error: 'The request could not be accepted.' });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'The server could not complete the request.' });
});

export async function startServer() {
  validateAdminRegistrationKey();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required. Add your MongoDB Atlas connection string to server/.env.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random secret of at least 32 characters in server/.env.');
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: process.env.HOSPITAL_TZ || 'Asia/Kolkata' }).format(new Date());
  } catch {
    throw new Error('HOSPITAL_TZ must be a valid IANA time zone.');
  }
  mongoose.set('autoIndex', false);
  const indexModels = [Appointment, Bed, Billing, ClinicalNote, Counter, Prescription, Vital, AuditLog];
  for (const model of indexModels) {
    model.on('index', (error) => {
      if (error) console.error(`Could not build indexes for ${model.modelName}:`, error.message);
    });
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const indexResult = await ensureUserIndexes(mongoose.connection);
  console.log('Ensured patient UHID index:', indexResult);
  await User.createIndexes();
  await Promise.all(indexModels.map(async (model) => {
    try {
      await model.createIndexes();
    } catch (error) {
      console.error(`Could not build indexes for ${model.modelName}:`, error.message);
    }
  }));
  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  return app.listen(port, '0.0.0.0', () => {
    console.log(`Curasys API listening on port ${port} (MongoDB connected)`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().then((server) => {
    const shutdown = () => {
      server.close(() => {
        mongoose.disconnect().catch((error) => {
          console.error('Could not disconnect from MongoDB cleanly:', error.message);
          process.exitCode = 1;
        });
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  }).catch((error) => {
    console.error('Could not start Curasys API:', error.message);
    process.exitCode = 1;
  });
}

export default app;
