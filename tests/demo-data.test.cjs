const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createApp } = require('../server/app');
const { initializeCollections } = require('../server/database');
const { seedDemo } = require('../scripts/seed-demo.cjs');

const execute = promisify(execFile);
const silentLogger = { log() {}, warn() {} };
const people = [
  { f_name: 'Alex', l_name: 'Chen', username: 'alex_chen' },
  { f_name: 'Maya', l_name: 'Patel', username: 'maya_patel' },
  { f_name: 'Sam', l_name: 'Rivera', username: 'sam_rivera' },
];
const expectedStories = [
  ['S1', 'A', 'View campus event details', 'High', 'To Do', 'alex_chen'],
  ['S2', 'A', 'Publish event schedule', 'Medium', 'Done', 'sam_rivera'],
  ['S3', 'A', 'Filter campus events', 'Low', 'In Progress', null],
  ['S4', 'B', 'Create study groups', 'High', 'In Progress', 'maya_patel'],
  ['S5', 'B', 'View study group details', 'Low', 'Done', null],
  ['S6', 'A', 'Remove outdated event notice', 'Low', 'To Do', null],
];
let mongo, client, db, collections, server, base, temporaryDirectory, manifestPath;

async function request(route, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function register(person, password = 'OriginalPassword123!') {
  const result = await request('/signup', { method: 'POST', body: { ...person, password } });
  assert.equal(result.status, 201);
  return result.data.user;
}
async function createProject(name, lead) {
  const result = await request('/projects', {
    method: 'POST', body: { name, description: 'An existing project that must remain unchanged.', status: 'Active', project_lead_id: lead._id },
  });
  assert.equal(result.status, 201);
  return result.data.project;
}
const seed = (overrides = {}) => seedDemo(base, { manifestPath, logger: silentLogger, ...overrides });
async function snapshot() {
  const result = {};
  for (const [name, collection] of Object.entries(collections)) result[name] = await collection.find({}).sort({ _id: 1 }).toArray();
  return result;
}
function noRecordsCreated(report) {
  for (const name of ['users', 'projects', 'memberships', 'stories']) assert.equal(report.created[name].length, 0, `${name} should not be created again.`);
}
function hasActionableWarnings(report) {
  assert.equal(report.status, 'warnings');
  assert.equal(report.ready, false);
  assert.ok(report.warnings.length > 0);
  for (const warning of report.warnings) {
    for (const field of ['code', 'message', 'repair']) assert.ok(typeof warning[field] === 'string' && warning[field].trim(), `A warning needs ${field}.`);
  }
}
const editableStory = (story, overrides = {}) => ({
  title: story.title, description: story.description, priority: story.priority,
  status: story.status, assigned_user_id: story.assigned_user_id?.toString() ?? null, ...overrides,
});

before(async () => {
  // Fresh temporary replica set supports the real project API's transactions.
  // The name also permits inspect-db --local without using any saved demo port or directory.
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14', downloadDir: path.resolve(__dirname, '../.cache/mongodb-binaries') },
    replSet: { count: 1, name: 'pa3rs', storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('pa4_demo_data_test');
  collections = await initializeCollections(db);
  server = await new Promise((resolve, reject) => {
    const listener = createApp(collections.users, { ...collections, client }).listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pa4-demo-data-test-'));
  manifestPath = path.join(temporaryDirectory, 'manifest.json');
});
afterEach(async () => {
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

test('the first demo seed creates three users, two projects, the intended memberships, and six stories', async () => {
  const report = await seed();
  assert.equal(report.status, 'success');
  assert.equal(report.ready, true);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.created.users.length, 3);
  assert.equal(report.created.projects.length, 2);
  assert.equal(report.created.stories.length, 6);
  assert.equal(report.manifestPath, manifestPath);
  assert.equal(await collections.users.countDocuments(), 3);
  assert.equal(await collections.projects.countDocuments(), 2);
  assert.equal(await collections.memberships.countDocuments(), 4);
  assert.equal(await collections.stories.countDocuments(), 6);
  const projectA = await collections.projects.findOne({ _id: new ObjectId(report.ids.projects.A) });
  const projectB = await collections.projects.findOne({ _id: new ObjectId(report.ids.projects.B) });
  assert.equal(projectA.name, 'PA4 Campus Planner');
  assert.equal(projectB.name, 'PA4 Study Together');
  assert.ok(projectA.project_lead_id.equals(new ObjectId(report.ids.users.alex_chen)));
  assert.ok(projectB.project_lead_id.equals(new ObjectId(report.ids.users.maya_patel)));
  for (const [project, usernames] of [[projectA, ['alex_chen', 'maya_patel', 'sam_rivera']], [projectB, ['maya_patel']]]) {
    const members = await collections.memberships.find({ project_id: project._id }).toArray();
    assert.deepEqual(members.map(({ user_id }) => user_id.toString()).sort(), usernames.map((username) => report.ids.users[username]).sort());
    assert.ok(members.every(({ project_id, user_id }) => project_id instanceof ObjectId && user_id instanceof ObjectId));
  }
  for (const [key, project, title, priority, status, assignee] of expectedStories) {
    const story = await collections.stories.findOne({ _id: new ObjectId(report.ids.stories[key]) });
    assert.equal(story.title, title);
    assert.equal(story.priority, priority);
    assert.equal(story.status, status);
    assert.match(story.description, /^As an? .+, I want .+, so that .+\.$/);
    assert.ok(story.project_id instanceof ObjectId && story.project_id.equals(new ObjectId(report.ids.projects[project])));
    if (assignee) assert.ok(story.assigned_user_id instanceof ObjectId && story.assigned_user_id.equals(new ObjectId(report.ids.users[assignee])));
    else assert.equal(story.assigned_user_id, null);
    assert.deepEqual(Object.keys(story).sort(), ['_id', 'assigned_user_id', 'description', 'priority', 'project_id', 'status', 'title']);
  }
  assert.ok((await fs.stat(manifestPath)).isFile());
});

test('a second demo seed leaves every stored record and identifier unchanged', async () => {
  const first = await seed();
  const original = await snapshot();
  const second = await seed();
  assert.equal(second.status, 'success');
  assert.equal(second.ready, true);
  noRecordsCreated(second);
  assert.deepEqual(second.ids, first.ids);
  assert.deepEqual(await snapshot(), original);
});

test('existing account passwords and both old PA3 projects are preserved', async () => {
  const alex = await register(people[0]);
  const maya = await register(people[1]);
  const oldA = await createProject('Campus Planner', alex);
  const oldB = await createProject('Study Together', maya);
  const original = await snapshot();
  const report = await seed();
  assert.equal(report.ids.users.alex_chen, alex._id);
  assert.equal(report.ids.users.maya_patel, maya._id);
  assert.equal(report.created.users.length, 1);
  for (const user of original.users) assert.deepEqual(await collections.users.findOne({ _id: user._id }), user);
  for (const project of original.projects) assert.deepEqual(await collections.projects.findOne({ _id: project._id }), project);
  const oldIds = [oldA, oldB].map(({ _id }) => new ObjectId(_id));
  assert.deepEqual(await collections.memberships.find({ project_id: { $in: oldIds } }).sort({ _id: 1 }).toArray(), original.memberships);
  assert.equal(await collections.stories.countDocuments({ project_id: { $in: oldIds } }), 0);
  assert.equal((await request('/login', { method: 'POST', body: { username: 'alex_chen', password: 'OriginalPassword123!' } })).status, 200);
  assert.equal((await request('/login', { method: 'POST', body: { username: 'alex_chen', password: 'CampusDemo123!' } })).status, 401);
  assert.equal(await collections.projects.countDocuments(), 4);
});

test('manually edited story titles and values are reported without being overwritten or duplicated', async () => {
  const first = await seed();
  const story = await collections.stories.findOne({ _id: new ObjectId(first.ids.stories.S1) });
  const result = await request(`/projects/${first.ids.projects.A}/stories/${story._id}`, {
    method: 'PUT', body: editableStory(story, {
      title: 'My renamed story', description: 'As a student, I want saved reminders, so that I can plan ahead.',
      priority: 'Low', status: 'Done', assigned_user_id: first.ids.users.sam_rivera,
    }),
  });
  assert.equal(result.status, 200);
  const edited = await snapshot();
  const report = await seed();
  hasActionableWarnings(report);
  noRecordsCreated(report);
  assert.deepEqual(report.ids, first.ids);
  assert.deepEqual(await snapshot(), edited);
  assert.equal(await collections.stories.countDocuments(), 6);
  assert.equal(await collections.stories.countDocuments({ title: 'View campus event details' }), 0);
  await assert.rejects(execute(process.execPath, [path.resolve(__dirname, '../scripts/seed-demo.cjs')], {
    env: { ...process.env, DEMO_API_URL: base, DEMO_MANIFEST_PATH: manifestPath },
  }), error => {
    assert.equal(error.code, 2, 'The CLI must distinguish preserved differences from a successful setup.');
    assert.match(`${error.stdout}\n${error.stderr}`, /S1|My renamed story/);
    return true;
  });
  assert.deepEqual(await snapshot(), edited, 'The CLI warning must also preserve the edited data.');
});

test('an invalid manifest stops setup before database changes and is not overwritten', async () => {
  await register(people[0]);
  const original = await snapshot();
  const corrupt = '{ invalid JSON';
  await fs.writeFile(manifestPath, corrupt);
  await assert.rejects(seed());
  assert.equal(await fs.readFile(manifestPath, 'utf8'), corrupt);
  assert.deepEqual(await snapshot(), original);
  await assert.rejects(execute(process.execPath, [path.resolve(__dirname, '../scripts/seed-demo.cjs')], {
    env: { ...process.env, DEMO_API_URL: base, DEMO_MANIFEST_PATH: manifestPath },
  }), error => {
    assert.equal(error.code, 1);
    return true;
  });
  assert.equal(await fs.readFile(manifestPath, 'utf8'), corrupt);
  assert.deepEqual(await snapshot(), original);
});

test('a deleted recorded sample story is recreated once without changing other data', async () => {
  const first = await seed();
  const oldId = first.ids.stories.S6;
  assert.equal((await request(`/projects/${first.ids.projects.A}/stories/${oldId}`, { method: 'DELETE' })).status, 200);
  const missingOne = await snapshot();
  const report = await seed();
  assert.equal(report.status, 'success');
  assert.equal(report.ready, true);
  assert.equal(report.created.stories.length, 1);
  for (const name of ['users', 'projects', 'memberships']) assert.equal(report.created[name].length, 0);
  assert.notEqual(report.ids.stories.S6, oldId);
  assert.equal(await collections.stories.countDocuments(), 6);
  assert.equal(await collections.stories.findOne({ _id: new ObjectId(oldId) }), null);
  const afterRepair = await snapshot();
  assert.deepEqual({ ...afterRepair, stories: afterRepair.stories.filter(({ _id }) => _id.toString() !== report.ids.stories.S6) }, missingOne);
  const repeated = await seed();
  noRecordsCreated(repeated);
  assert.deepEqual(await snapshot(), afterRepair);
});

for (const conflict of ['wrong lead', 'duplicate project names']) {
  test(`a ${conflict} conflict is reported without adopting, modifying, or duplicating the ambiguous project`, async () => {
    const registered = [];
    for (const person of people) registered.push(await register(person));
    const lead = conflict === 'wrong lead' ? registered[2] : registered[0];
    const originalProject = await createProject('PA4 Campus Planner', lead);
    const conflictedIds = [new ObjectId(originalProject._id)];
    if (conflict === 'duplicate project names') conflictedIds.push(new ObjectId((await createProject('PA4 Campus Planner', lead))._id));
    const originals = await collections.projects.find({ _id: { $in: conflictedIds } }).sort({ _id: 1 }).toArray();
    const originalMembers = await collections.memberships.find({ project_id: { $in: conflictedIds } }).sort({ _id: 1 }).toArray();
    const report = await seed();
    hasActionableWarnings(report);
    assert.equal(await collections.projects.countDocuments({ name: 'PA4 Campus Planner' }), conflictedIds.length);
    assert.deepEqual(await collections.projects.find({ _id: { $in: conflictedIds } }).sort({ _id: 1 }).toArray(), originals);
    assert.deepEqual(await collections.memberships.find({ project_id: { $in: conflictedIds } }).sort({ _id: 1 }).toArray(), originalMembers);
    assert.equal(await collections.stories.countDocuments({ project_id: { $in: conflictedIds } }), 0);
    assert.ok(!report.ids.projects.A);
  });
}

test('a previously seeded member who was removed is reported rather than silently re-added', async () => {
  const first = await seed();
  // Maya has stories in B, but none in A, so this is a valid intentional removal.
  assert.equal((await request(`/projects/${first.ids.projects.A}/members/${first.ids.users.maya_patel}`, { method: 'DELETE' })).status, 200);
  const afterRemoval = await snapshot();
  const report = await seed();
  hasActionableWarnings(report);
  noRecordsCreated(report);
  assert.deepEqual(await snapshot(), afterRemoval);
  assert.equal(await collections.memberships.countDocuments({ project_id: new ObjectId(first.ids.projects.A), user_id: new ObjectId(first.ids.users.maya_patel) }), 0);
  assert.equal(await collections.memberships.countDocuments({ project_id: new ObjectId(first.ids.projects.B), user_id: new ObjectId(first.ids.users.maya_patel) }), 1);
});

test('a fresh manifest can adopt uniquely named existing sample data without copying it', async () => {
  const first = await seed();
  const original = await snapshot();
  const report = await seed({ manifestPath: path.join(temporaryDirectory, 'fresh-manifest.json') });
  assert.equal(report.status, 'success');
  assert.equal(report.ready, true);
  noRecordsCreated(report);
  assert.deepEqual(report.ids, first.ids);
  assert.deepEqual(await snapshot(), original);
});

test('local database inspection prints four EJSON collections with ObjectIds and only public user fields', async () => {
  const report = await seed();
  await collections.users.updateOne({ _id: new ObjectId(report.ids.users.alex_chen) }, { $set: { private_note: 'do-not-print-private-user-data' } });
  const users = await collections.users.find({}).toArray();
  const options = {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PA3_MONGO_PORT: new URL(mongo.getUri()).port, PA3_DB_NAME: db.databaseName },
    maxBuffer: 2 * 1024 * 1024,
  };
  const script = path.resolve(__dirname, '../scripts/inspect-db.cjs');
  const { stdout } = await execute(process.execPath, [script, '--local', '--ejson'], options);
  const names = ['Users', 'Projects', 'ProjectMemberships', 'UserStories'];
  const headers = names.map((name) => `${db.databaseName}.${name}`);
  const sections = {};
  for (const [index, name] of names.entries()) {
    const start = stdout.indexOf(headers[index]);
    assert.ok(start >= 0, `Missing ${name} collection output.`);
    const end = index + 1 < headers.length ? stdout.indexOf(headers[index + 1], start) : stdout.length;
    sections[name] = JSON.parse(stdout.slice(start + headers[index].length, end).trim());
  }
  assert.deepEqual(names.map((name) => sections[name].length), [3, 2, 4, 6]);
  for (const user of sections.Users) {
    assert.deepEqual(Object.keys(user).sort(), ['_id', 'f_name', 'l_name', 'username']);
    assert.match(user._id.$oid, /^[a-f\d]{24}$/);
  }
  for (const story of sections.UserStories) {
    assert.match(story._id.$oid, /^[a-f\d]{24}$/);
    assert.match(story.project_id.$oid, /^[a-f\d]{24}$/);
    if (story.assigned_user_id !== null) assert.match(story.assigned_user_id.$oid, /^[a-f\d]{24}$/);
  }
  assert.equal(stdout.includes('password'), false);
  assert.equal(stdout.includes('do-not-print-private-user-data'), false);
  for (const user of users) assert.equal(stdout.includes(user.password), false);
  const usersOnly = await execute(process.execPath, [script, '--local', '--users-only', '--ejson'], options);
  assert.ok(usersOnly.stdout.includes(headers[0]));
  for (const header of headers.slice(1)) assert.equal(usersOnly.stdout.includes(header), false);
});
