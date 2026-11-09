// Persistent local replica set supports atomic project and lead membership creation.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { startServer } = require('../server/server');
const root = path.resolve(__dirname, '..');
let mongo, api, frontend;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const closed = frontend && frontend.exitCode === null ? new Promise(resolve => {
    frontend.once('exit', resolve); frontend.kill('SIGTERM');
  }) : Promise.resolve();
  if (api) await api.close();
  await closed;
  if (mongo) await mongo.stop();
}
async function main() {
  const dbPath = path.resolve(process.env.PA3_DATA_DIR || path.join(root, '.local-data', 'mongo'));
  const dbName = process.env.PA3_DB_NAME || 'pa3';
  const mongoPort = Number(process.env.PA3_MONGO_PORT || 27018);
  const apiPort = Number(process.env.PA3_API_PORT || 9000);
  const frontendPort = Number(process.env.PA3_FRONTEND_PORT || 5173);
  fs.mkdirSync(dbPath, { recursive: true });
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14', downloadDir: path.join(root, '.cache', 'mongodb-binaries') },
    instanceOpts: [{ port: mongoPort, dbPath }],
    // Let this launcher stop MongoDB after the API closes; terminal Ctrl+C must not stop it first.
    replSet: { count: 1, name: 'pa3rs', storageEngine: 'wiredTiger', spawn: { detached: true } },
  });
  if (Number(new URL(mongo.getUri()).port) !== mongoPort) {
    const error = new Error(`MongoDB port ${mongoPort} is already in use. Stop the other instance before starting this demo.`);
    error.code = 'LOCAL_PORT_CHANGED';
    throw error;
  }
  process.env.MONGO_URI = mongo.getUri();
  process.env.DB_NAME = dbName;
  process.env.USERS_COLLECTION = 'Users';
  process.env.PORT = String(apiPort);
  process.env.CLIENT_ORIGINS = `http://localhost:${frontendPort},http://127.0.0.1:${frontendPort}`;
  api = await startServer();
  console.log(`Local MongoDB: mongodb://127.0.0.1:${mongoPort}/?replicaSet=pa3rs (database: ${dbName})`);
  console.log('Collections: Users, Projects, ProjectMemberships, UserStories. Records persist in .local-data.');
  if (process.argv.includes('--seed')) await require('./seed-demo.cjs').seedDemo(`http://127.0.0.1:${apiPort}`);
  const viteEntry = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  frontend = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
    cwd: path.join(root, 'client'), stdio: 'inherit',
    env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${apiPort}` },
  });
  frontend.once('error', async error => { console.error('Frontend failed:', error.name); process.exitCode = 1; await stop(); });
  frontend.once('exit', code => { if (!stopping) { process.exitCode = code || 0; stop(); } });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch(async error => {
  console.error('Could not start the local demo:', error.name);
  if (error.code === 'LOCAL_PORT_CHANGED') console.error(error.message);
  console.error('Check internet access for the first MongoDB download and that the application ports are free.');
  await stop(); process.exitCode = 1;
});
