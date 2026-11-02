import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

async function migrate() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required to run the UHID index migration.');
  mongoose.set('autoIndex', false);
  await mongoose.connect(process.env.MONGODB_URI);
  const users = mongoose.connection.collection('users');
  const existingIndex = (await users.indexes()).find((index) => index.key?.uhid === 1);
  const expectedPartialFilter = { uhid: { $type: 'string' } };
  if (
    existingIndex
    && (!existingIndex.unique || JSON.stringify(existingIndex.partialFilterExpression) !== JSON.stringify(expectedPartialFilter))
  ) {
    await users.dropIndex(existingIndex.name);
  }
  await users.updateMany({ role: { $ne: 'patient' } }, { $set: { uhid: null } });
  const existingSequenceByYear = await users.aggregate([
    { $match: { role: 'patient', uhid: { $regex: /^CUR-\d{4}-\d+$/ } } },
    {
      $project: {
        year: { $substrBytes: ['$uhid', 4, 4] },
        value: {
          $convert: {
            input: { $substrBytes: ['$uhid', 9, 20] },
            to: 'long',
            onError: 0,
            onNull: 0,
          },
        },
      },
    },
    { $group: { _id: '$year', value: { $max: '$value' } } },
  ]).toArray();
  const counters = mongoose.connection.collection('counters');
  for (const { _id: year, value } of existingSequenceByYear) {
    await counters.updateOne(
      { name: `uhid-${year}` },
      { $max: { value }, $setOnInsert: { name: `uhid-${year}` } },
      { upsert: true },
    );
  }
  await users.createIndex(
    { uhid: 1 },
    { name: 'uhid_1', unique: true, partialFilterExpression: expectedPartialFilter },
  );
  console.log('UHID index migration completed; existing patient UHIDs were preserved.');
}

migrate()
  .catch((error) => {
    console.error('UHID migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
