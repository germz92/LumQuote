require('dotenv').config();
const mongoose = require('mongoose');

function buildUri(dbName) {
  const raw = process.env.MONGODB_URI;
  const qIndex = raw.indexOf('?');
  const query = qIndex >= 0 ? raw.slice(qIndex) : '';
  const withoutQuery = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const base = withoutQuery.replace(/\/[^/]*$/, '');
  return `${base}/${dbName}${query}`;
}

async function inspect(dbName) {
  const uri = buildUri(dbName);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const users = mongoose.connection.db.collection('users');
  const total = await users.countDocuments();
  const withPhoto = await users.countDocuments({
    profilePhoto: { $exists: true, $nin: [null, ''] }
  });
  const sample = await users.findOne(
    { profilePhoto: { $exists: true, $nin: [null, ''] } },
    { projection: { fullName: 1, email: 1, profilePhoto: 1 } }
  );
  console.log(JSON.stringify({
    dbName,
    totalUsers: total,
    withProfilePhoto: withPhoto,
    sampleName: sample?.fullName || null,
    hasPhotoUrl: Boolean(sample?.profilePhoto)
  }));
  await mongoose.disconnect();
}

(async () => {
  for (const db of ['LumetryMedia', 'test', 'lumdash', 'LumDash']) {
    try {
      await inspect(db);
    } catch (error) {
      console.log(JSON.stringify({ dbName: db, error: error.message }));
      await mongoose.disconnect().catch(() => {});
    }
  }
})();
