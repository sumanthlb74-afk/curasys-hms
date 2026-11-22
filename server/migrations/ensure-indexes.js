const expectedUhidIndex = {
  key: { uhid: 1 },
  name: 'uhid_1',
  unique: true,
  partialFilterExpression: { uhid: { $type: 'string' } },
};

function isExpectedUhidIndex(index) {
  return index?.unique === true
    && index.key?.uhid === 1
    && Object.keys(index.key).length === 1
    && index.partialFilterExpression?.uhid?.$type === 'string'
    && Object.keys(index.partialFilterExpression).length === 1;
}

function isIndexConflict(error) {
  return error.code === 85
    || error.code === 86
    || error.codeName === 'IndexOptionsConflict'
    || error.codeName === 'IndexKeySpecsConflict';
}

export async function ensureUserIndexes(connection) {
  if (!connection?.db || connection.readyState !== 1) {
    throw new Error('A connected MongoDB connection is required to ensure user indexes.');
  }

  let createdUsersCollection = false;
  const usersCollectionExists = await connection.db.listCollections({ name: 'users' }, { nameOnly: true }).hasNext();
  if (!usersCollectionExists) {
    try {
      await connection.db.createCollection('users');
      createdUsersCollection = true;
    } catch (error) {
      if (error.code !== 48 && error.codeName !== 'NamespaceExists') throw error;
    }
  }

  const users = connection.collection('users');
  const counters = connection.collection('counters');
  const initialIndexes = await users.indexes();
  const existingUhidIndexes = initialIndexes.filter((index) => index.key?.uhid === 1);
  const hasExpectedIndex = existingUhidIndexes.some(isExpectedUhidIndex);
  let droppedLegacyIndex = false;
  for (const index of existingUhidIndexes) {
    if (isExpectedUhidIndex(index)) continue;
    try {
      await users.dropIndex(index.name);
      droppedLegacyIndex = true;
    } catch (error) {
      if (error.code !== 27 && error.codeName !== 'IndexNotFound') throw error;
    }
  }

  const normalizedAccounts = await users.updateMany(
    { role: { $ne: 'patient' }, uhid: { $ne: null } },
    { $set: { uhid: null } },
  );
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
  for (const { _id: year, value } of existingSequenceByYear) {
    await counters.updateOne(
      { name: `uhid-${year}` },
      { $max: { value }, $setOnInsert: { name: `uhid-${year}` } },
      { upsert: true },
    );
  }

  let indexCreated = false;
  if (!hasExpectedIndex) {
    try {
      await users.createIndex(expectedUhidIndex.key, {
        name: expectedUhidIndex.name,
        unique: expectedUhidIndex.unique,
        partialFilterExpression: expectedUhidIndex.partialFilterExpression,
      });
      indexCreated = true;
    } catch (error) {
      if (!isIndexConflict(error)) throw error;
      const currentIndexes = await users.indexes();
      if (!currentIndexes.some(isExpectedUhidIndex)) throw error;
    }
  }

  return {
    createdUsersCollection,
    droppedLegacyIndex,
    normalizedAccounts: normalizedAccounts.modifiedCount,
    seededCounters: existingSequenceByYear.length,
    indexCreated,
  };
}
