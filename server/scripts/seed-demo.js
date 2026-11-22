import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import User from '../models/User.js';
import Appointment from '../models/Appointment.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const demoAccounts = [
  { key: 'admin', name: 'Curasys Demo Administrator', email: 'demo-admin@example.test', role: 'admin' },
  { key: 'doctor', name: 'Curasys Demo Doctor', email: 'demo-doctor@example.test', role: 'doctor', specialization: 'General Medicine' },
  { key: 'staff', name: 'Curasys Demo Nurse', email: 'demo-nurse@example.test', role: 'staff' },
  { key: 'receptionist', name: 'Curasys Demo Receptionist', email: 'demo-receptionist@example.test', role: 'receptionist' },
  { key: 'patient', name: 'Curasys Demo Patient', email: 'demo-patient@example.test', role: 'patient', uhid: 'CUR-DEMO-PATIENT' },
];

function validPassword(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') >= 8 && Buffer.byteLength(value, 'utf8') <= 72;
}

async function seed() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed refuses to run with NODE_ENV=production.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in server/.env.');
  if (!validPassword(process.env.DEMO_SEED_PASSWORD)) {
    throw new Error('Set DEMO_SEED_PASSWORD to a temporary 8-72 byte password in the local environment; never pass it on the command line.');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const users = {};
  for (const account of demoAccounts) {
    let user = await User.findOne({ email: account.email }).select('+password');
    if (user && user.role !== account.role) throw new Error(`The demo email ${account.email} belongs to a different role.`);
    if (!user) user = new User(account);
    user.name = account.name;
    user.password = process.env.DEMO_SEED_PASSWORD;
    user.role = account.role;
    user.isActive = true;
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    if (account.specialization) user.specialization = account.specialization;
    if (account.uhid) user.uhid = account.uhid;
    if (account.role === 'patient') user.dateOfBirth = new Date('2000-01-01T00:00:00.000Z');
    await user.save();
    users[account.key] = user;
  }
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(9, 0, 0, 0);
  const appointment = await Appointment.findOneAndUpdate(
    { patientId: users.patient._id, doctorId: users.doctor._id, symptoms: 'Demo appointment for walkthrough' },
    {
      $set: {
        patientId: users.patient._id,
        doctorId: users.doctor._id,
        department: 'General Medicine',
        date: tomorrow,
        time: '09:00',
        symptoms: 'Demo appointment for walkthrough',
        status: 'Booked',
        triage: 'OPD Routine',
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return appointment;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  seed()
    .then(() => console.log('Local demo seed completed.'))
    .catch((error) => {
      console.error(`Local demo seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

export { seed };
