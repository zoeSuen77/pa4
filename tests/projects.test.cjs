const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createApp } = require('../server/app');
const { initializeCollections } = require('../server/database');

let mongo, client, db, collections, server, base, people;
const listen = (app) => new Promise((resolve) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
const close = (listener) => new Promise((resolve) => listener.close(resolve));
const validProject = (overrides = {}) => ({ name: 'Campus Planner', description: 'Coordinate campus activities.', status: 'Planning', project_lead_id: people[0]._id.toString(), ...overrides });

async function request(endpoint, { method = 'GET', body, url = base } = {}) {
  const response = await fetch(`${url}${endpoint}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const post = (endpoint, body, url) => request(endpoint, { method: 'POST', body, url });
async function makeProject(overrides) {
  const result = await post('/projects', validProject(overrides));
  assert.equal(result.status, 201);
  return result.data.project;
}
async function addMember(project, person = people[1]) {
  assert.equal((await post(`/projects/${project._id}/members`, { user_id: person._id.toString() })).status, 201);
}
const storyChanges = (story, overrides = {}) => ({
  title: story.title, description: story.description, priority: story.priority,
  status: story.status, assigned_user_id: story.assigned_user_id, ...overrides,
});
async function makeAssignedStory(project, person, status = 'To Do') {
  const created = await post(`/projects/${project._id}/stories`, {
    title: 'Coordinate campus events',
    description: 'As a student, I want an event schedule, so that I can plan my week.',
    priority: 'High', assigned_user_id: person._id.toString(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  if (status === 'To Do') return created.data.story;
  const updated = await request(`/projects/${project._id}/stories/${created.data.story._id}`, {
    method: 'PUT', body: storyChanges(created.data.story, { status }),
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  return updated.data.story;
}
async function assignmentState() {
  return {
    memberships: await collections.memberships.find({}).sort({ _id: 1 }).toArray(),
    stories: await collections.stories.find({}).sort({ _id: 1 }).toArray(),
  };
}

before(async () => {
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '7.0.14', downloadDir: path.resolve(__dirname, '../.cache/mongodb-binaries') },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('pa3_test');
  collections = await initializeCollections(db);
  server = await listen(createApp(collections.users, { ...collections, client }));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
  people = [
    { _id: new ObjectId(), f_name: 'Alex', l_name: 'Chen', username: 'alex', password: 'private-hash' },
    { _id: new ObjectId(), f_name: 'Sam', l_name: 'Rivera', username: 'sam', password: 'private-hash' },
    { _id: new ObjectId(), f_name: 'Jordan', l_name: 'Park', username: 'jordan', password: 'private-hash' },
  ];
  await collections.users.insertMany(people);
});
after(async () => {
  if (server) await close(server);
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

test('user options expose names and IDs, but no stored password', async () => {
  const result = await request('/users');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.users.map((user) => user.username), ['alex', 'jordan', 'sam']);
  assert.deepEqual(Object.keys(result.data.users[0]).sort(), ['_id', 'f_name', 'l_name', 'username']);
  assert.equal(JSON.stringify(result.data).includes('private-hash'), false);
});

test('an empty database returns useful empty lists', async () => {
  await collections.users.deleteMany({});
  assert.deepEqual((await request('/users')).data, { users: [] });
  assert.deepEqual((await request('/projects')).data, { projects: [] });
});

test('project creation stores ObjectId references and automatically joins the lead', async () => {
  const project = await makeProject({ name: ' Campus Planner ', description: ' Plan campus activities. ' });
  const saved = await collections.projects.findOne({ _id: new ObjectId(project._id) });
  assert.deepEqual(Object.keys(saved).sort(), ['_id', 'description', 'name', 'project_lead_id', 'status']);
  assert.equal(saved.name, 'Campus Planner');
  assert.equal(saved.description, 'Plan campus activities.');
  assert.ok(saved.project_lead_id instanceof ObjectId);
  assert.ok(saved.project_lead_id.equals(people[0]._id));
  const membership = await collections.memberships.findOne({ project_id: saved._id });
  assert.deepEqual(Object.keys(membership).sort(), ['_id', 'project_id', 'user_id']);
  assert.ok(membership.project_id instanceof ObjectId);
  assert.ok(membership.user_id instanceof ObjectId);
  assert.ok(membership.user_id.equals(people[0]._id));
  assert.equal(project.member_count, 1);
  assert.equal(project.project_lead.username, 'alex');
  const result = await request(`/projects/${project._id}/members`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.members, [{ _id: people[0]._id.toString(), f_name: 'Alex', l_name: 'Chen', username: 'alex', is_lead: true }]);
});

test('all allowed statuses work and the project list resolves lead names', async () => {
  for (const status of ['Planning', 'Active', 'Completed']) await makeProject({ status });
  const result = await request('/projects');
  assert.equal(result.status, 200);
  assert.equal(result.data.projects.length, 3);
  assert.deepEqual(result.data.projects.map((project) => project.status).sort(), ['Active', 'Completed', 'Planning']);
  for (const project of result.data.projects) {
    assert.equal(project.project_lead.f_name, 'Alex');
    assert.equal(project.project_lead_id, people[0]._id.toString());
    assert.equal(project.member_count, 1);
  }
  assert.equal(JSON.stringify(result.data).includes('password'), false);
});

test('project required fields, types, limits, and statuses are validated', async () => {
  const invalid = [
    {}, null, validProject({ name: ' ' }), validProject({ description: '' }),
    validProject({ name: 'x'.repeat(121) }), validProject({ description: 'x'.repeat(3001) }),
    validProject({ name: { $ne: null } }), validProject({ description: 5 }),
    validProject({ status: '' }), validProject({ status: 'active' }), validProject({ status: 'Archived' }),
    validProject({ status: ['Active'] }), validProject({ project_lead_id: '' }),
    validProject({ project_lead_id: 'not-an-id' }), validProject({ project_lead_id: { $ne: null } }),
  ];
  for (const payload of invalid) assert.equal((await post('/projects', payload)).status, 400);
  assert.equal(await collections.projects.countDocuments(), 0);
  assert.equal(await collections.memberships.countDocuments(), 0);
});

test('project field length limits are inclusive', async () => {
  await makeProject({ name: 'x'.repeat(120), description: 'y'.repeat(3000) });
});

test('a valid but unknown lead returns 404 without creating a project', async () => {
  assert.equal((await post('/projects', validProject({ project_lead_id: new ObjectId().toString() }))).status, 404);
  assert.equal(await collections.projects.countDocuments(), 0);
});

test('a user can belong to multiple projects and counts update after adding and removing', async () => {
  const first = await makeProject();
  const second = await makeProject({ name: 'Second project', project_lead_id: people[2]._id.toString() });
  for (const project of [first, second]) {
    assert.equal((await post(`/projects/${project._id}/members`, { user_id: people[1]._id.toString() })).status, 201);
    const members = (await request(`/projects/${project._id}/members`)).data.members;
    assert.equal(members.length, 2);
    assert.equal(members.find((user) => user.username === 'sam').is_lead, false);
    assert.equal(JSON.stringify(members).includes('password'), false);
  }
  assert.ok((await request('/projects')).data.projects.every((project) => project.member_count === 2));
  assert.equal((await request(`/projects/${first._id}/members/${people[1]._id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/projects/${first._id}/members`)).data.members.length, 1);
  assert.equal((await request(`/projects/${second._id}/members`)).data.members.length, 2);
  assert.equal((await request('/projects')).data.projects.find((project) => project._id === first._id).member_count, 1);
});

test('duplicate members and duplicate leads return 409, including simultaneous adds', async () => {
  const project = await makeProject();
  const endpoint = `/projects/${project._id}/members`;
  assert.equal((await post(endpoint, { user_id: people[0]._id.toString() })).status, 409);
  const results = await Promise.all([post(endpoint, { user_id: people[1]._id.toString() }), post(endpoint, { user_id: people[1]._id.toString() })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal((await post(endpoint, { user_id: people[1]._id.toString() })).status, 409);
  assert.equal(await collections.memberships.countDocuments({ project_id: new ObjectId(project._id) }), 2);
});

test('the lead cannot be removed and the membership remains present', async () => {
  const project = await makeProject();
  const result = await request(`/projects/${project._id}/members/${people[0]._id}`, { method: 'DELETE' });
  assert.equal(result.status, 403);
  assert.match(result.data.message, /lead.*cannot be removed/);
  assert.equal(await collections.memberships.countDocuments({ project_id: new ObjectId(project._id), user_id: people[0]._id }), 1);
});

for (const status of ['To Do', 'In Progress', 'Done']) {
  test(`a member with a ${status} story cannot be removed and both records remain unchanged`, async () => {
    const project = await makeProject();
    await addMember(project);
    await makeAssignedStory(project, people[1], status);
    const original = await assignmentState();
    const result = await request(`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE' });
    assert.equal(result.status, 409);
    for (const action of [/reassign/i, /unassign/i, /delet/i, /Done/]) assert.match(result.data.message, action);
    assert.deepEqual(await assignmentState(), original);
    assert.equal((await request(`/projects/${project._id}/members`)).data.members.length, 2);
  });
}

test('releasing only some assigned stories still blocks member removal', async () => {
  const project = await makeProject();
  await addMember(project);
  const first = await makeAssignedStory(project, people[1]);
  await makeAssignedStory(project, people[1], 'Done');
  assert.equal((await request(`/projects/${project._id}/stories/${first._id}`, {
    method: 'PUT', body: storyChanges(first, { assigned_user_id: null }),
  })).status, 200);
  const original = await assignmentState();
  const result = await request(`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE' });
  assert.equal(result.status, 409);
  assert.deepEqual(await assignmentState(), original);
});

for (const release of ['reassigning', 'unassigning', 'deleting']) {
  test(`${release} all of a member's stories through the API permits removal without changing remaining stories`, async () => {
    const project = await makeProject();
    await addMember(project);
    const stories = [await makeAssignedStory(project, people[1]), await makeAssignedStory(project, people[1], 'Done')];
    // Another person's assigned story in the same project must not block Sam's removal.
    await makeAssignedStory(project, people[0], 'In Progress');
    for (const story of stories) {
      const result = await request(`/projects/${project._id}/stories/${story._id}`, release === 'deleting' ? { method: 'DELETE' } : {
        method: 'PUT', body: storyChanges(story, { assigned_user_id: release === 'reassigning' ? people[0]._id.toString() : null }),
      });
      assert.equal(result.status, 200);
    }
    const beforeRemoval = await assignmentState();
    assert.equal((await request(`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE' })).status, 200);
    const afterRemoval = await assignmentState();
    assert.deepEqual(afterRemoval.stories, beforeRemoval.stories);
    assert.deepEqual(afterRemoval.memberships, beforeRemoval.memberships.filter((membership) => !membership.user_id.equals(people[1]._id)));
    const members = (await request(`/projects/${project._id}/members`)).data.members;
    assert.deepEqual(members.map(({ username }) => username), ['alex']);
    assert.equal((await request('/projects')).data.projects.find(({ _id }) => _id === project._id).member_count, 1);
  });
}

test('assignments in another project do not block removal or change that project membership and stories', async () => {
  const first = await makeProject();
  const second = await makeProject({ name: 'Second project', project_lead_id: people[2]._id.toString() });
  await addMember(first);
  await addMember(second);
  await makeAssignedStory(second, people[1], 'Done');
  await makeAssignedStory(second, people[1], 'In Progress');
  const original = await assignmentState();
  assert.equal((await request(`/projects/${first._id}/members/${people[1]._id}`, { method: 'DELETE' })).status, 200);
  const afterRemoval = await assignmentState();
  assert.deepEqual(afterRemoval.stories, original.stories);
  assert.deepEqual(afterRemoval.memberships, original.memberships.filter((membership) => !(membership.project_id.equals(new ObjectId(first._id)) && membership.user_id.equals(people[1]._id))));
  assert.deepEqual((await request(`/projects/${second._id}/members`)).data.members.map(({ username }) => username), ['jordan', 'sam']);
  assert.equal((await request(`/projects/${second._id}/members/${people[1]._id}`, { method: 'DELETE' })).status, 409);
  assert.deepEqual(await assignmentState(), afterRemoval);
});

test('a lead with assigned stories still receives lead protection rather than the story conflict', async () => {
  const project = await makeProject();
  await makeAssignedStory(project, people[0], 'Done');
  const original = await assignmentState();
  const result = await request(`/projects/${project._id}/members/${people[0]._id}`, { method: 'DELETE' });
  assert.equal(result.status, 403);
  assert.match(result.data.message, /lead.*cannot be removed/);
  assert.deepEqual(await assignmentState(), original);
});

test('removed members cannot receive new or edited story assignments', async () => {
  const project = await makeProject();
  await addMember(project);
  const story = await makeAssignedStory(project, people[0]);
  assert.equal((await request(`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE' })).status, 200);
  const original = await assignmentState();
  const rejectedCreate = await post(`/projects/${project._id}/stories`, {
    title: 'New story', description: story.description, priority: 'Low', assigned_user_id: people[1]._id.toString(),
  });
  assert.equal(rejectedCreate.status, 400);
  assert.match(rejectedCreate.data.message, /member/i);
  const rejectedEdit = await request(`/projects/${project._id}/stories/${story._id}`, {
    method: 'PUT', body: storyChanges(story, { assigned_user_id: people[1]._id.toString() }),
  });
  assert.equal(rejectedEdit.status, 400);
  assert.match(rejectedEdit.data.message, /member/i);
  assert.deepEqual(await assignmentState(), original);
});

test('a missing membership returns 404 even if an inconsistent assigned story remains', async () => {
  const project = await makeProject();
  await addMember(project);
  await makeAssignedStory(project, people[1], 'Done');
  // Deliberately inconsistent fixture models an external database edit, not a valid API removal.
  await collections.memberships.deleteOne({ project_id: new ObjectId(project._id), user_id: people[1]._id });
  const original = await assignmentState();
  const result = await request(`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE' });
  assert.equal(result.status, 404);
  assert.match(result.data.message, /not a member/i);
  assert.deepEqual(await assignmentState(), original);
});

test('a story lookup failure never deletes membership and returns a safe server error', async () => {
  const project = await makeProject();
  await addMember(project);
  await makeAssignedStory(project, people[1], 'Done');
  const original = await assignmentState();
  const logs = [];
  const failingStories = { findOne: async () => { throw new Error('private-database-details mongodb://example.invalid'); } };
  const failingServer = await listen(createApp(collections.users, {
    ...collections, stories: failingStories, client, logger: { error: (...args) => logs.push(args) },
  }));
  const url = `http://127.0.0.1:${failingServer.address().port}`;
  try {
    const result = await request(`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE', url });
    assert.equal(result.status, 500);
    assert.match(result.data.message, /server or database error/);
    assert.equal(JSON.stringify(result.data).includes('private-database-details'), false);
    assert.equal(JSON.stringify(result.data).includes('mongodb://'), false);
    assert.equal(Object.hasOwn(result.data, 'stack'), false);
    assert.equal(logs.length, 1);
    assert.deepEqual(await assignmentState(), original);
  } finally { await close(failingServer); }
});

test('invalid and absent project IDs are rejected for every membership route', async () => {
  for (const [id, expected] of [['invalid', 400], [new ObjectId().toString(), 404]]) {
    const endpoint = `/projects/${id}/members`;
    assert.equal((await request(endpoint)).status, expected);
    assert.equal((await post(endpoint, { user_id: people[1]._id.toString() })).status, expected);
    assert.equal((await request(`${endpoint}/${people[1]._id}`, { method: 'DELETE' })).status, expected);
  }
});

test('missing, invalid, and unknown users are rejected when adding and deleting', async () => {
  const project = await makeProject();
  const endpoint = `/projects/${project._id}/members`;
  for (const payload of [{}, null, { user_id: '' }, { user_id: 'invalid' }, { user_id: { $ne: null } }]) {
    assert.equal((await post(endpoint, payload)).status, 400);
  }
  const unknown = new ObjectId().toString();
  assert.equal((await post(endpoint, { user_id: unknown })).status, 404);
  assert.equal((await request(`${endpoint}/invalid`, { method: 'DELETE' })).status, 400);
  assert.equal((await request(`${endpoint}/${unknown}`, { method: 'DELETE' })).status, 404);
  assert.equal((await request(`${endpoint}/${people[1]._id}`, { method: 'DELETE' })).status, 404);
});

test('a failed lead membership write rolls the project back', async () => {
  const logs = [];
  const failingMemberships = { ...collections.memberships, insertOne: async () => { throw new Error('simulated membership write failure'); } };
  const failingServer = await listen(createApp(collections.users, { ...collections, memberships: failingMemberships, client, logger: { error: (...args) => logs.push(args) } }));
  try {
    const result = await post('/projects', validProject(), `http://127.0.0.1:${failingServer.address().port}`);
    assert.equal(result.status, 500);
    assert.match(result.data.message, /server or database error/);
    assert.equal(await collections.projects.countDocuments(), 0);
    assert.equal(await collections.memberships.countDocuments(), 0);
    assert.equal(logs.length, 1);
  } finally { await close(failingServer); }
});

test('database errors on all project routes return safe JSON responses', async () => {
  const project = await makeProject();
  const disconnected = await new MongoClient(mongo.getUri()).connect();
  const disconnectedDb = disconnected.db('pa3_test');
  const broken = { users: disconnectedDb.collection('Users'), projects: disconnectedDb.collection('Projects'), memberships: disconnectedDb.collection('ProjectMemberships'), stories: disconnectedDb.collection('UserStories') };
  await disconnected.close();
  const logs = [];
  const failingServer = await listen(createApp(broken.users, { ...broken, client: disconnected, logger: { error: (...args) => logs.push(args) } }));
  const url = `http://127.0.0.1:${failingServer.address().port}`;
  try {
    const cases = [
      ['/users', {}], ['/projects', {}], ['/projects', { method: 'POST', body: validProject() }],
      [`/projects/${project._id}/members`, {}],
      [`/projects/${project._id}/members`, { method: 'POST', body: { user_id: people[1]._id.toString() } }],
      [`/projects/${project._id}/members/${people[1]._id}`, { method: 'DELETE' }],
    ];
    for (const [endpoint, options] of cases) {
      const result = await request(endpoint, { ...options, url });
      assert.equal(result.status, 500);
      assert.match(result.data.message, /server or database error/);
      assert.equal(JSON.stringify(result.data).includes('mongodb://'), false);
    }
    assert.equal(logs.length, cases.length);
  } finally { await close(failingServer); }
});

test('collection initialization is repeatable and can reuse PA2 users by name', async () => {
  const existingId = new ObjectId();
  await db.collection('users').insertOne({ _id: existingId, username: 'old_pa2' });
  const reused = await initializeCollections(db, { usersCollection: 'users' });
  assert.ok((await reused.users.findOne({ username: 'old_pa2' }))._id.equals(existingId));
  assert.equal(reused.projects.collectionName, 'Projects');
  assert.equal(reused.memberships.collectionName, 'ProjectMemberships');
  await initializeCollections(db);
  const indexes = await collections.memberships.indexes();
  assert.ok(indexes.some((index) => index.unique && index.key.project_id === 1 && index.key.user_id === 1));
});
