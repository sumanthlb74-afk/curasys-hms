import crypto from 'node:crypto';
import dotenv from 'dotenv';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Appointment from './models/Appointment.js';
import Bed from './models/Bed.js';
import Billing from './models/Billing.js';
import ClinicalNote from './models/ClinicalNote.js';
import Prescription from './models/Prescription.js';
import User from './models/User.js';
import Vital from './models/Vital.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '.env') });

const roles = ['patient', 'doctor', 'staff', 'admin'];
const departments = ['Cardiology', 'Neurology', 'Orthopedics', 'General Medicine', 'Pediatrics', 'Emergency'];
const wards = ['ICU', 'Emergency', 'General Ward', 'Pediatrics'];
const bedStatuses = ['Available', 'Occupied', 'Maintenance'];
const appointmentStatuses = ['Scheduled', 'Completed', 'Cancelled'];
const triageLevels = ['Urgent', 'OPD Routine', 'Follow-up'];

const app = express();
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173'),
  credentials: false,
}));
app.use(express.json({ limit: '20kb' }));

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    uhid: user.uhid,
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
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
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
        if (!user || user.role !== claims.role) {
          response.status(401).json({ error: 'Your session is no longer valid. Sign in again.' });
          return;
        }
        request.user = user;
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

function validObjectId(value) {
  return mongoose.isValidObjectId(value);
}

function assignUhid() {
  const suffix = String(crypto.randomBytes(4).readUInt32BE(0) % 10000).padStart(4, '0');
  return `CUR-${new Date().getFullYear()}-${suffix}`;
}

async function createUser({
  name, email, password, role, phone, specialization, dateOfBirth, sex, bloodGroup,
  address, emergencyContact, allergies, chronicConditions, currentMedications, heightCm, weightKg,
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await User.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
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
        uhid: assignUhid(),
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

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.post('/api/auth/register', asyncRoute(async (request, response) => {
  const { name, email, password, role, phone, specialization, adminRegistrationKey } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== 'string' || password.length < 8
    || !roles.includes(role)
    || (role === 'doctor' && (typeof specialization !== 'string' || !specialization.trim()))
  ) {
    response.status(400).json({ error: 'Enter a valid name, email, password (at least 8 characters), role, and doctor specialization when applicable.' });
    return;
  }
  if (role === 'patient' || role === 'staff') {
    response.status(403).json({ error: 'Patient and medical staff accounts must be created by an administrator.' });
    return;
  }
  if (role === 'admin' && (!process.env.ADMIN_REGISTRATION_KEY || adminRegistrationKey !== process.env.ADMIN_REGISTRATION_KEY)) {
    response.status(403).json({ error: 'Admin registration requires the private ADMIN_REGISTRATION_KEY configured by the project owner.' });
    return;
  }

  const user = await createUser({ name, email, password, role, phone, specialization });
  response.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

app.post('/api/auth/login', asyncRoute(async (request, response) => {
  const { email, password, role } = request.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !roles.includes(role)) {
    response.status(400).json({ error: 'Enter your email, password, and account role.' });
    return;
  }

  const user = await User.findOne({ email: email.trim().toLowerCase(), role }).select('+password');
  if (!user || !(await user.verifyPassword(password))) {
    response.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }
  response.json({ token: signToken(user), user: publicUser(user) });
}));

app.get('/api/auth/me', authenticate, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

app.get('/api/doctors', authenticate, asyncRoute(async (_request, response) => {
  const doctors = await User.find({ role: 'doctor' })
    .select('name email uhid specialization')
    .sort({ name: 1 })
    .lean();
  response.json({ doctors });
}));

app.get('/api/patients', authenticate, allow('doctor', 'staff', 'admin'), asyncRoute(async (request, response) => {
  const patientFields = request.user.role === 'staff'
    ? 'name email uhid phone'
    : 'name email uhid phone dateOfBirth sex bloodGroup address emergencyContact allergies chronicConditions currentMedications heightCm weightKg';
  const patients = await User.find({ role: 'patient' })
    .select(patientFields)
    .sort({ name: 1 })
    .lean();
  response.json({ patients });
}));

app.post('/api/patients', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const {
    name, email, password, phone, dateOfBirth, sex, bloodGroup, address, emergencyContact,
    allergies, chronicConditions, currentMedications, heightCm, weightKg,
  } = request.body ?? {};
  const validOptionalString = (value, maxLength) => value === undefined || (typeof value === 'string' && value.length <= maxLength);
  const validList = (value) => value === undefined || (Array.isArray(value) && value.length <= 20 && value.every((item) => typeof item === 'string' && item.trim() && item.length <= 100));
  const contact = emergencyContact ?? {};
  if (
    typeof name !== 'string' || !name.trim() || name.trim().length > 100
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== 'string' || password.length < 8
    || !validOptionalString(phone, 30)
    || (dateOfBirth !== undefined && dateOfBirth !== '' && !validDate(dateOfBirth))
    || (sex !== undefined && !['', 'Female', 'Male', 'Intersex', 'Prefer not to say'].includes(sex))
    || (bloodGroup !== undefined && !['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(bloodGroup))
    || !validOptionalString(address, 500)
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
  });
  response.status(201).json({ patient: publicUser(patient) });
}));

app.get('/api/staff', authenticate, allow('admin'), asyncRoute(async (_request, response) => {
  const staff = await User.find({ role: 'staff' })
    .select('name email uhid phone')
    .sort({ name: 1 })
    .lean();
  response.json({ staff });
}));

app.post('/api/staff', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const { name, email, password, phone } = request.body ?? {};
  if (
    typeof name !== 'string' || !name.trim()
    || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || typeof password !== 'string' || password.length < 8
  ) {
    response.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' });
    return;
  }
  const staff = await createUser({ name, email, password, role: 'staff', phone });
  response.status(201).json({ staff: publicUser(staff) });
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
    || (update.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email))
    || (update.dateOfBirth !== undefined && update.dateOfBirth !== '' && !validDate(update.dateOfBirth))
    || (update.sex !== undefined && !['', 'Female', 'Male', 'Intersex', 'Prefer not to say'].includes(update.sex))
    || (update.bloodGroup !== undefined && !['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(update.bloodGroup))
    || (update.address !== undefined && (typeof update.address !== 'string' || update.address.length > 500))
    || (update.emergencyContact !== undefined && (!update.emergencyContact || typeof update.emergencyContact !== 'object' || Array.isArray(update.emergencyContact)))
    || (['allergies', 'chronicConditions', 'currentMedications'].some((field) => update[field] !== undefined && !validList(update[field])))
    || (update.heightCm !== undefined && update.heightCm !== null && (!Number.isFinite(Number(update.heightCm)) || Number(update.heightCm) < 30 || Number(update.heightCm) > 250))
    || (update.weightKg !== undefined && update.weightKg !== null && (!Number.isFinite(Number(update.weightKg)) || Number(update.weightKg) < 1 || Number(update.weightKg) > 500))
  ) {
    response.status(400).json({ error: 'Provide valid patient account and medical profile details to update.' });
    return;
  }
  const patient = await User.findOneAndUpdate(
    { _id: request.params.id, role: 'patient' },
    update,
    { new: true, runValidators: true },
  );
  if (!patient) {
    response.status(404).json({ error: 'Patient not found.' });
    return;
  }
  response.json({ patient: publicUser(patient) });
}));

app.delete('/api/patients/:id', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid patient ID.' });
    return;
  }
  const patient = await User.findOneAndDelete({ _id: request.params.id, role: 'patient' });
  if (!patient) {
    response.status(404).json({ error: 'Patient not found.' });
    return;
  }
  await Promise.all([
    Appointment.deleteMany({ patientId: patient.id }),
    Bed.updateMany({ patientId: patient.id }, { $set: { patientId: null, status: 'Available' } }),
    Billing.deleteMany({ patientId: patient.id }),
    ClinicalNote.deleteMany({ patientId: patient.id }),
    Prescription.deleteMany({ patientId: patient.id }),
    Vital.deleteMany({ patientId: patient.id }),
  ]);
  response.json({ success: true });
}));

app.get('/api/appointments', authenticate, asyncRoute(async (request, response) => {
  const filter = request.user.role === 'patient'
    ? { patientId: request.user.id }
    : request.user.role === 'doctor'
      ? {
        $or: [
          { doctorId: request.user.id },
          { doctorId: null, ...(request.user.specialization ? { department: request.user.specialization } : {}) },
        ],
      }
      : {};
  const appointments = await Appointment.find(filter)
    .populate('patientId', 'name uhid email phone')
    .populate('doctorId', 'name specialization')
    .sort({ date: 1, time: 1 })
    .lean();
  response.json({ appointments });
}));

app.post('/api/appointments', authenticate, allow('staff', 'admin'), asyncRoute(async (request, response) => {
  const { doctorId, department, date, time, symptoms, triage } = request.body ?? {};
  const patientId = request.body?.patientId;
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient' })
    || typeof department !== 'string' || !departments.includes(department)
    || !validDate(date) || date < new Date().toISOString().slice(0, 10)
    || typeof time !== 'string' || !/^([01]\d|2[0-3]):00$/.test(time)
    || typeof symptoms !== 'string' || !symptoms.trim() || symptoms.length > 2000
    || (triage !== undefined && !triageLevels.includes(triage))
  ) {
    response.status(400).json({ error: 'Enter a valid department, date, time, symptoms, and triage level.' });
    return;
  }
  if (doctorId && (!validObjectId(doctorId) || !await User.exists({ _id: doctorId, role: 'doctor' }))) {
    response.status(400).json({ error: 'Choose a valid doctor.' });
    return;
  }
  if (doctorId) {
    const doctor = await User.findById(doctorId).select('specialization');
    if (doctor.specialization && doctor.specialization !== department) {
      response.status(400).json({ error: 'The selected doctor does not match this department.' });
      return;
    }
    if (await Appointment.exists({
      doctorId,
      date: new Date(`${date}T00:00:00.000Z`),
      time,
      status: 'Scheduled',
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

app.put('/api/appointments/:id', authenticate, allow('doctor', 'staff', 'admin'), asyncRoute(async (request, response) => {
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
  if (status !== undefined && appointmentStatuses.includes(status)) update.status = status;
  if (triage !== undefined && triageLevels.includes(triage)) update.triage = triage;
  if (doctorId !== undefined) {
    if (doctorId && (!validObjectId(doctorId) || !await User.exists({ _id: doctorId, role: 'doctor' }))) {
      response.status(400).json({ error: 'Choose a valid doctor.' });
      return;
    }
    update.doctorId = doctorId || null;
  }
  if (request.user.role === 'doctor') update.doctorId = request.user.id;
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide a valid status, triage, or doctor assignment.' });
    return;
  }
  const appointmentFilter = request.user.role === 'doctor'
    ? {
      _id: request.params.id,
      $or: [
        { doctorId: request.user.id },
        { doctorId: null, ...(request.user.specialization ? { department: request.user.specialization } : {}) },
      ],
    }
    : { _id: request.params.id };
  if (update.doctorId && update.status !== 'Cancelled') {
    const appointmentToAssign = await Appointment.findById(request.params.id).select('date time status');
    if (appointmentToAssign && (update.status === 'Scheduled' || appointmentToAssign.status === 'Scheduled') && await Appointment.exists({
      _id: { $ne: appointmentToAssign.id },
      doctorId: update.doctorId,
      date: appointmentToAssign.date,
      time: appointmentToAssign.time,
      status: 'Scheduled',
    })) {
      response.status(409).json({ error: 'This doctor already has an appointment in that one-hour slot.' });
      return;
    }
  }
  const appointment = await Appointment.findOneAndUpdate(appointmentFilter, update, { new: true, runValidators: true })
    .populate('patientId', 'name uhid')
    .populate('doctorId', 'name specialization');
  if (!appointment) {
    response.status(404).json({ error: 'Appointment not found.' });
    return;
  }
  response.json({ appointment });
}));

app.delete('/api/appointments/:id', authenticate, allow('admin', 'staff'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid appointment ID.' });
    return;
  }
  const appointment = await Appointment.findByIdAndUpdate(
    request.params.id,
    { status: 'Cancelled' },
    { new: true, runValidators: true },
  );
  if (!appointment) {
    response.status(404).json({ error: 'Appointment not found.' });
    return;
  }
  response.json({ appointment });
}));

app.get('/api/beds', authenticate, allow('admin', 'doctor', 'staff'), asyncRoute(async (_request, response) => {
  const [beds, totals] = await Promise.all([
    Bed.find().populate('patientId', 'name uhid').sort({ ward: 1, bedNumber: 1 }).lean(),
    Bed.aggregate([{ $group: { _id: '$ward', total: { $sum: 1 }, occupied: { $sum: { $cond: [{ $eq: ['$status', 'Occupied'] }, 1, 0] } }, available: { $sum: { $cond: [{ $eq: ['$status', 'Available'] }, 1, 0] } } } }]),
  ]);
  response.json({ beds, totals });
}));

app.post('/api/beds', authenticate, allow('admin', 'staff'), asyncRoute(async (request, response) => {
  const { bedNumber, ward } = request.body ?? {};
  if (typeof bedNumber !== 'string' || !/^[A-Z0-9-]{2,20}$/i.test(bedNumber.trim()) || !wards.includes(ward)) {
    response.status(400).json({ error: 'Enter a valid bed number and ward.' });
    return;
  }
  const bed = await Bed.create({ bedNumber: bedNumber.trim().toUpperCase(), ward });
  response.status(201).json({ bed });
}));

app.put('/api/beds/:id', authenticate, allow('admin', 'staff'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid bed ID.' });
    return;
  }
  const { status, patientId, bedNumber, ward } = request.body ?? {};
  const update = {};
  if (status !== undefined && bedStatuses.includes(status)) update.status = status;
  if (patientId !== undefined) {
    if (patientId && (!validObjectId(patientId) || !await User.exists({ _id: patientId, role: 'patient' }))) {
      response.status(400).json({ error: 'Choose a valid patient.' });
      return;
    }
    update.patientId = patientId || null;
  }
  if (bedNumber !== undefined && typeof bedNumber === 'string' && /^[A-Z0-9-]{2,20}$/i.test(bedNumber.trim())) update.bedNumber = bedNumber.trim().toUpperCase();
  if (ward !== undefined && wards.includes(ward)) update.ward = ward;
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
  if (update.status === 'Available' || update.status === 'Maintenance') update.patientId = null;
  const bed = await Bed.findByIdAndUpdate(request.params.id, update, { new: true, runValidators: true })
    .populate('patientId', 'name uhid');
  if (!bed) {
    response.status(404).json({ error: 'Bed not found.' });
    return;
  }
  response.json({ bed });
}));

app.delete('/api/beds/:id', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid bed ID.' });
    return;
  }
  const bed = await Bed.findByIdAndDelete(request.params.id);
  if (!bed) {
    response.status(404).json({ error: 'Bed not found.' });
    return;
  }
  response.json({ success: true });
}));

app.get('/api/billing', authenticate, allow('patient', 'admin'), asyncRoute(async (request, response) => {
  const filter = request.user.role === 'patient' ? { patientId: request.user.id } : {};
  const bills = await Billing.find(filter)
    .populate('patientId', 'name uhid')
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .lean();
  response.json({ bills });
}));

app.post('/api/billing', authenticate, allow('admin'), asyncRoute(async (request, response) => {
  const { patientId, totalAmount, description } = request.body ?? {};
  const totalPaise = typeof totalAmount === 'number' ? Math.round(totalAmount * 100) : NaN;
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient' })
    || typeof totalAmount !== 'number'
    || !Number.isFinite(totalAmount)
    || totalAmount <= 0
    || totalAmount > 100_000_000
    || Math.abs(totalAmount * 100 - totalPaise) > 1e-7
    || !Number.isSafeInteger(totalPaise)
    || typeof description !== 'string'
    || !description.trim()
    || description.trim().length > 1000
  ) {
    response.status(400).json({ error: 'Select a patient and enter a valid total bill and description.' });
    return;
  }
  const bill = await Billing.create({
    patientId,
    createdBy: request.user.id,
    totalPaise,
    description: description.trim(),
  });
  response.status(201).json({ bill });
}));

app.get('/api/prescriptions', authenticate, allow('patient', 'doctor', 'admin'), asyncRoute(async (request, response) => {
  const filter = request.user.role === 'patient'
    ? { patientId: request.user.id }
    : request.user.role === 'doctor'
      ? { doctorId: request.user.id }
      : {};
  const prescriptions = await Prescription.find(filter)
    .populate('patientId', 'name uhid')
    .populate('doctorId', 'name specialization')
    .sort({ createdAt: -1 })
    .lean();
  response.json({ prescriptions });
}));

app.get('/api/clinical-notes', authenticate, allow('patient', 'doctor'), asyncRoute(async (request, response) => {
  const filter = request.user.role === 'patient'
    ? { patientId: request.user.id }
    : { doctorId: request.user.id };
  const clinicalNotes = await ClinicalNote.find(filter)
    .populate('patientId', 'name uhid')
    .populate('doctorId', 'name specialization')
    .sort({ createdAt: -1 })
    .lean();
  response.json({ clinicalNotes });
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
    || !await User.exists({ _id: patientId, role: 'patient' })
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
    { new: true, runValidators: true },
  );
  if (!clinicalNote) {
    response.status(404).json({ error: 'Clinical note not found or you do not have permission to update it.' });
    return;
  }
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
  response.json({ success: true });
}));

app.post('/api/prescriptions', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  const { patientId, diagnosis, medicines, instructions, followUp } = request.body ?? {};
  if (
    !validObjectId(patientId)
    || !await User.exists({ _id: patientId, role: 'patient' })
    || typeof diagnosis !== 'string' || !diagnosis.trim()
    || !Array.isArray(medicines) || medicines.length < 1 || medicines.length > 30
    || medicines.some((medicine) => !medicine || typeof medicine !== 'object'
      || !['name', 'dosage', 'frequency', 'duration'].every((field) => typeof medicine[field] === 'string' && medicine[field].trim())
      || ['route', 'instructions'].some((field) => medicine[field] !== undefined && (typeof medicine[field] !== 'string' || medicine[field].length > (field === 'route' ? 50 : 500))))
    || (instructions !== undefined && (typeof instructions !== 'string' || instructions.length > 2000))
    || (followUp !== undefined && (typeof followUp !== 'string' || followUp.length > 500))
  ) {
    response.status(400).json({ error: 'Select a patient and provide a diagnosis and at least one complete medicine.' });
    return;
  }
  const prescription = await Prescription.create({
    patientId,
    doctorId: request.user.id,
    diagnosis: diagnosis.trim(),
    medicines,
    instructions,
    followUp,
  });
  response.status(201).json({ prescription });
}));

app.put('/api/prescriptions/:id', authenticate, allow('doctor', 'admin'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid prescription ID.' });
    return;
  }
  const filter = request.user.role === 'doctor'
    ? { _id: request.params.id, doctorId: request.user.id }
    : { _id: request.params.id };
  const { diagnosis, medicines, instructions, followUp } = request.body ?? {};
  const update = {};
  if (typeof diagnosis === 'string' && diagnosis.trim()) update.diagnosis = diagnosis.trim();
  if (Array.isArray(medicines) && medicines.length > 0 && medicines.length <= 30
    && medicines.every((medicine) => medicine && typeof medicine === 'object'
      && ['name', 'dosage', 'frequency', 'duration'].every((field) => typeof medicine[field] === 'string' && medicine[field].trim())
      && ['route', 'instructions'].every((field) => medicine[field] === undefined || (typeof medicine[field] === 'string' && medicine[field].length <= (field === 'route' ? 50 : 500))))) {
    update.medicines = medicines;
  }
  if (typeof instructions === 'string' && instructions.length <= 2000) update.instructions = instructions;
  if (typeof followUp === 'string' && followUp.length <= 500) update.followUp = followUp;
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide a diagnosis or medicines to update.' });
    return;
  }
  const prescription = await Prescription.findOneAndUpdate(filter, update, { new: true, runValidators: true });
  if (!prescription) {
    response.status(404).json({ error: 'Prescription not found or you do not have permission to update it.' });
    return;
  }
  response.json({ prescription });
}));

app.delete('/api/prescriptions/:id', authenticate, allow('doctor', 'admin'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid prescription ID.' });
    return;
  }
  const filter = request.user.role === 'doctor'
    ? { _id: request.params.id, doctorId: request.user.id }
    : { _id: request.params.id };
  const prescription = await Prescription.findOneAndDelete(filter);
  if (!prescription) {
    response.status(404).json({ error: 'Prescription not found or you do not have permission to delete it.' });
    return;
  }
  response.json({ success: true });
}));

app.get('/api/vitals', authenticate, allow('patient', 'doctor', 'admin'), asyncRoute(async (request, response) => {
  const filter = request.user.role === 'patient' ? { patientId: request.user.id } : {};
  const vitals = await Vital.find(filter)
    .populate('patientId', 'name uhid')
    .populate('recordedBy', 'name role')
    .sort({ createdAt: -1 })
    .lean();
  response.json({ vitals });
}));

app.post('/api/vitals', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  const {
    patientId, heartRate, systolic, diastolic, respiratoryRate, temperatureC,
    bloodGlucose, oxygenSaturation, heightCm, weightKg, notes,
  } = request.body ?? {};
  const targetPatientId = patientId;
  if (!validObjectId(targetPatientId) || !await User.exists({ _id: targetPatientId, role: 'patient' })) {
    response.status(400).json({ error: 'Choose a valid patient.' });
    return;
  }
  const values = { heartRate, systolic, diastolic, respiratoryRate, temperatureC, bloodGlucose, oxygenSaturation, heightCm, weightKg };
  const hasVital = Object.values(values).some((value) => value !== undefined && value !== null && value !== '');
  if (!hasVital || (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000))) {
    response.status(400).json({ error: 'Enter at least one vital measurement and valid notes.' });
    return;
  }
  const vital = await Vital.create({
    patientId: targetPatientId,
    recordedBy: request.user.id,
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === '' ? null : value])),
    notes: notes || '',
  });
  response.status(201).json({ vital });
}));

app.put('/api/vitals/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid vital record ID.' });
    return;
  }
  const fields = ['heartRate', 'systolic', 'diastolic', 'respiratoryRate', 'temperatureC', 'bloodGlucose', 'oxygenSaturation', 'heightCm', 'weightKg', 'notes'];
  const update = Object.fromEntries(fields.filter((field) => request.body?.[field] !== undefined).map((field) => [field, request.body[field]]));
  if (!Object.keys(update).length) {
    response.status(400).json({ error: 'Provide at least one vital value to update.' });
    return;
  }
  const vital = await Vital.findOneAndUpdate(
    { _id: request.params.id, recordedBy: request.user.id },
    update,
    { new: true, runValidators: true },
  );
  if (!vital) {
    response.status(404).json({ error: 'Vital record not found.' });
    return;
  }
  response.json({ vital });
}));

app.delete('/api/vitals/:id', authenticate, allow('doctor'), asyncRoute(async (request, response) => {
  if (!validObjectId(request.params.id)) {
    response.status(400).json({ error: 'Invalid vital record ID.' });
    return;
  }
  const vital = await Vital.findOneAndDelete({ _id: request.params.id, recordedBy: request.user.id });
  if (!vital) {
    response.status(404).json({ error: 'Vital record not found.' });
    return;
  }
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
  console.error(error);
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error.code === 11000) {
    response.status(409).json({ error: 'That email or UHID is already in use.' });
    return;
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    response.status(400).json({ error: error.message });
    return;
  }
  response.status(500).json({ error: 'The server could not complete the request.' });
});

export async function startServer() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required. Add your MongoDB Atlas connection string to server/.env.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set JWT_SECRET to a random secret of at least 32 characters in server/.env.');
  await mongoose.connect(process.env.MONGODB_URI);
  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  return app.listen(port, '0.0.0.0', () => {
    console.log(`Curasys API listening on port ${port} (MongoDB connected)`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().catch((error) => {
    console.error('Could not start Curasys API:', error.message);
    process.exitCode = 1;
  });
}

export default app;
