const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { createApp } = require('../server/app');

let mongo, client, users, server, base;
const person = { f_name: 'Alex', l_name: 'Chen', username: 'alex_test', password: 'DemoPass123!' };
const listen = (app) => new Promise((resolve) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
const close = (listener) => new Promise((resolve) => listener.close(resolve));

async function post(endpoint, body, url = base) {
  const response = await fetch(`${url}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.14', downloadDir: path.resolve(__dirname, '../.cache/mongodb-binaries') } });
  client = await new MongoClient(mongo.getUri()).connect();
  users = client.db('pa2_test').collection('users');
  await users.createIndex({ username: 1 }, { unique: true });
  server = await listen(createApp(users));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await users.deleteMany({}); });
after(async () => {
  if (server) await close(server);
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

for (const field of Object.keys(person)) {
  test(`signup rejects an empty ${field}`, async () => {
    assert.equal((await post('signup', { ...person, [field]: '   ' })).status, 400);
    assert.equal(await users.countDocuments(), 0);
  });
}

test('signup rejects missing fields, null, and non-string values', async () => {
  for (const payload of [{}, null, { ...person, username: { $ne: null } }, { ...person, password: 123 }]) {
    assert.equal((await post('signup', payload)).status, 400);
  }
});

test('signup writes exactly the required document fields with a hashed password', async () => {
  const result = await post('signup', { ...person, f_name: ' Alex ', username: ' Alex_Test ' });
  assert.equal(result.status, 201);
  const saved = await users.findOne({ username: person.username });
  assert.deepEqual(Object.keys(saved).sort(), ['_id', 'f_name', 'l_name', 'password', 'username']);
  assert.equal(saved.f_name, 'Alex');
  assert.match(saved.password, /^scrypt\$/);
  assert.notEqual(saved.password, person.password);
  assert.equal(result.data.user._id, saved._id.toString());
  assert.equal('password' in result.data.user, false);
});

test('duplicate usernames, including different case, return 409', async () => {
  await post('signup', person);
  assert.equal((await post('signup', person)).status, 409);
  assert.equal((await post('signup', { ...person, username: ' ALEX_TEST ' })).status, 409);
  assert.equal(await users.countDocuments(), 1);
});

test('the unique MongoDB index prevents simultaneous duplicate signups', async () => {
  const results = await Promise.all([post('signup', person), post('signup', person)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(await users.countDocuments(), 1);
});

test('equal passwords receive different salts', async () => {
  await post('signup', person);
  await post('signup', { ...person, username: 'second_user' });
  const saved = await users.find({}).toArray();
  assert.notEqual(saved[0].password, saved[1].password);
});

for (const field of ['username', 'password']) {
  test(`login rejects an empty ${field}`, async () => {
    assert.equal((await post('login', { ...person, [field]: '' })).status, 400);
  });
}

test('an unknown username returns 401 and creates no user', async () => {
  assert.equal((await post('login', person)).status, 401);
  assert.equal(await users.countDocuments(), 0);
});

test('a wrong password returns 401 without disclosing which credential failed', async () => {
  await post('signup', person);
  const wrong = await post('login', { ...person, password: 'wrong' });
  const unknown = await post('login', { ...person, username: 'unknown' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
});

test('correct credentials succeed, with case-insensitive usernames and no password in the response', async () => {
  await post('signup', person);
  const result = await post('login', { username: ' ALEX_TEST ', password: person.password });
  assert.equal(result.status, 200);
  assert.match(result.data.message, /Login successful/);
  assert.equal(result.data.user.f_name, 'Alex');
  assert.equal('password' in result.data.user, false);
  assert.equal(await users.countDocuments(), 1);
});

test('password spaces are preserved and compared exactly', async () => {
  await post('signup', { ...person, password: ' secret ' });
  assert.equal((await post('login', { ...person, password: 'secret' })).status, 401);
  assert.equal((await post('login', { ...person, password: ' secret ' })).status, 200);
});

test('login rejects a MongoDB query object', async () => {
  assert.equal((await post('login', { username: { $ne: null }, password: person.password })).status, 400);
});

test('malformed JSON and an oversized body return understandable JSON errors', async () => {
  const malformed = await fetch(`${base}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).message, /valid JSON/);
  assert.equal((await post('signup', { ...person, f_name: 'x'.repeat(17000) })).status, 413);
});

test('development frontend origin is allowed by CORS', async () => {
  const response = await fetch(`${base}/login`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('a disconnected database returns a safe 500 response from both routes', async () => {
  const disconnected = await new MongoClient(mongo.getUri()).connect();
  const collection = disconnected.db('pa2_test').collection('users');
  await disconnected.close();
  const logs = [];
  const failingServer = await listen(createApp(collection, { logger: { error: (...args) => logs.push(args) } }));
  try {
    const url = `http://127.0.0.1:${failingServer.address().port}`;
    for (const endpoint of ['signup', 'login']) {
      const result = await post(endpoint, person, url);
      assert.equal(result.status, 500);
      assert.match(result.data.message, /server or database error/);
      assert.equal(JSON.stringify(result.data).includes('mongodb://'), false);
    }
    assert.equal(logs.length, 2);
  } finally { await close(failingServer); }
});
