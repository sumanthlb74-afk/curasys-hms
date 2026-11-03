import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import User from '../models/User.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? '' : process.argv[index + 1] || '';
}

export async function createOrResetAdmin({ name, email, password }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw new Error('Provide --name with a name of at most 100 characters.');
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('Provide --email with a valid email address.');
  }
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('NEW_ADMIN_PASSWORD must be between 8 and 72 UTF-8 bytes.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail }).select('+password');
  if (existingUser && existingUser.role !== 'admin') {
    throw new Error('That email belongs to a non-administrator account. Choose another email.');
  }
  if (existingUser) {
    existingUser.password = password;
    existingUser.mustChangePassword = true;
    existingUser.passwordChangedAt = new Date();
    existingUser.sessionVersion = (existingUser.sessionVersion || 0) + 1;
    await existingUser.save();
    return { action: 'reset', user: existingUser };
  }

  const administrator = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password,
    role: 'admin',
    mustChangePassword: true,
    passwordChangedAt: new Date(),
  });
  return { action: 'created', user: administrator };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required in the environment or server/.env.');
  if (!process.env.NEW_ADMIN_PASSWORD) throw new Error('Set NEW_ADMIN_PASSWORD in the environment; never pass a password as a command-line argument.');
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await createOrResetAdmin({
    name: option('name'),
    email: option('email'),
    password: process.env.NEW_ADMIN_PASSWORD,
  });
  console.log(`Administrator ${result.action}: ${result.user.email}. Sign in and change the temporary password.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .catch((error) => {
      console.error(`Administrator recovery failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}
