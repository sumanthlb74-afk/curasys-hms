import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureUserIndexes } from './ensure-indexes.js';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

async function migrate() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required to run the UHID index migration.');
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await ensureUserIndexes(mongoose.connection);
  console.log('UHID index migration completed.', result);
}

migrate()
  .catch((error) => {
    console.error('UHID migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
