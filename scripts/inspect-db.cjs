const path = require('node:path');
const { inspect } = require('node:util');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), quiet: true });
const { MongoClient, BSON } = require('mongodb');
async function main() {
  const local = process.argv.includes('--local');
  const uri = local ? `mongodb://127.0.0.1:${process.env.PA3_MONGO_PORT || 27018}/?replicaSet=pa3rs` : process.env.MONGO_URI;
  if (!uri) throw new Error('Configure server/.env or pass --local while npm run demo runs.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const db = client.db(local ? process.env.PA3_DB_NAME || 'pa3' : process.env.DB_NAME || 'pa3');
    const userCollection = local ? 'Users' : process.env.USERS_COLLECTION || 'Users';
    const names = process.argv.includes('--users-only') ? [userCollection] : [userCollection, 'Projects', 'ProjectMemberships', 'UserStories'];
    for (const name of names) {
      const projection = name === userCollection ? { _id: 1, f_name: 1, l_name: 1, username: 1 } : {};
      const records = await db.collection(name).find({}, { projection }).sort({ _id: 1 }).limit(50).toArray();
      console.log(`${db.databaseName}.${name}`);
      console.log(process.argv.includes('--ejson')
        ? BSON.EJSON.stringify(records, null, 2, { relaxed: false })
        : inspect(records, { depth: null, colors: false }));
      const total = await db.collection(name).countDocuments();
      if (total > records.length) console.log(`Showing ${records.length} of ${total} records. Use MongoDB Compass to view all records.`);
    }
  } finally { await client.close(); }
}
main().catch(error => { console.error('Could not inspect database:', error.name); process.exitCode = 1; });
