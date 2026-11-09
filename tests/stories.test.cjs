const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { createApp } = require('../server/app');
const { initializeCollections } = require('../server/database');

let mongo, client, db, collections, server, base, people, projects;
const listen = (app) => new Promise((resolve, reject) => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  listener.once('error', reject);
});
const close = (listener) => new Promise((resolve) => listener.close(resolve));
const endpoint = (project = projects[0], storyId) => `/projects/${project._id}/stories${storyId ? `/${storyId}` : ''}`;
const storyValues = (overrides = {}) => ({
  title: 'View campus event details',
  description: 'As a student, I want to view campus event details, so that I can decide whether to attend.',
  priority: 'High', assigned_user_id: null, ...overrides,
});
const editValues = (story, overrides = {}) => ({
  title: story.title, description: story.description, priority: story.priority,
  status: story.status, assigned_user_id: story.assigned_user_id, ...overrides,
});

async function request(route, { method = 'GET', body, url = base } = {}) {
  const response = await fetch(`${url}${route}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function makeStory(overrides, project = projects[0]) {
  const result = await request(endpoint(project), { method: 'POST', body: storyValues(overrides) });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(typeof result.data.message, 'string');
  return result.data.story;
}
const snapshot = () => collections.stories.find({}).sort({ _id: 1 }).toArray();
async function expectRejected(route, options, expectedStatus) {
  const original = await snapshot();
  const result = await request(route, options);
  assert.equal(result.status, expectedStatus, `${options.method} ${route}: ${JSON.stringify(result.data)}`);
  assert.equal(typeof result.data.message, 'string');
  assert.ok(result.data.message.trim());
  assert.deepEqual(await snapshot(), original, 'A rejected request must not change stored stories.');
}

before(async () => {
  // A fresh temporary instance is independent of the saved demo and UI databases.
  mongo = await MongoMemoryServer.create({
    binary: { version: '7.0.14', downloadDir: path.resolve(__dirname, '../.cache/mongodb-binaries') },
  });
  client = await new MongoClient(mongo.getUri()).connect();
  db = client.db('pa4_stories_test');
  collections = await initializeCollections(db);
  server = await listen(createApp(collections.users, { ...collections, client }));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
  people = [
    { _id: new ObjectId(), f_name: 'Alex', l_name: 'Chen', username: 'alex', password: 'stored-private-hash' },
    { _id: new ObjectId(), f_name: 'Sam', l_name: 'Rivera', username: 'sam', password: 'stored-private-hash' },
    { _id: new ObjectId(), f_name: 'Maya', l_name: 'Patel', username: 'maya', password: 'stored-private-hash' },
  ];
  projects = [
    { _id: new ObjectId(), name: 'Campus Planner', description: 'Plan campus events.', status: 'Planning', project_lead_id: people[0]._id },
    { _id: new ObjectId(), name: 'Study Together', description: 'Organize study groups.', status: 'Active', project_lead_id: people[2]._id },
  ];
  await collections.users.insertMany(people);
  await collections.projects.insertMany(projects);
  await collections.memberships.insertMany([
    { project_id: projects[0]._id, user_id: people[0]._id },
    { project_id: projects[0]._id, user_id: people[1]._id },
    { project_id: projects[1]._id, user_id: people[2]._id },
  ]);
});
after(async () => {
  if (server) await close(server);
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

test('UserStories initialization is repeatable and retains records and query indexes', async () => {
  const story = await makeStory();
  const initializedAgain = await initializeCollections(db);
  assert.equal(initializedAgain.stories.collectionName, 'UserStories');
  assert.ok(await initializedAgain.stories.findOne({ _id: new ObjectId(story._id) }));
  const indexes = await initializedAgain.stories.indexes();
  assert.ok(indexes.some(({ key }) => key.project_id === 1 && Object.keys(key).length === 1));
  assert.ok(indexes.some(({ key }) => key.project_id === 1 && key.assigned_user_id === 1));
});

test('creation stores exactly the required fields and ObjectId relationships with readable public users', async () => {
  for (const member of [people[0], people[1]]) {
    const story = await makeStory({ title: '  View event details  ', description: `  ${storyValues().description}  `, assigned_user_id: member._id.toString() });
    const saved = await collections.stories.findOne({ _id: new ObjectId(story._id) });
    assert.deepEqual(Object.keys(saved).sort(), ['_id', 'assigned_user_id', 'description', 'priority', 'project_id', 'status', 'title']);
    assert.ok(saved._id instanceof ObjectId);
    assert.ok(saved.project_id instanceof ObjectId && saved.project_id.equals(projects[0]._id));
    assert.ok(saved.assigned_user_id instanceof ObjectId && saved.assigned_user_id.equals(member._id));
    assert.equal(saved.title, 'View event details');
    assert.equal(saved.description, storyValues().description);
    assert.equal(saved.priority, 'High');
    assert.equal(saved.status, 'To Do');
    assert.equal(story.project_id, projects[0]._id.toString());
    assert.equal(story.assigned_user_id, member._id.toString());
    assert.deepEqual(story.assigned_user, { _id: member._id.toString(), f_name: member.f_name, l_name: member.l_name, username: member.username });
    assert.equal(JSON.stringify(story).includes('password'), false);
    assert.equal(JSON.stringify(story).includes('stored-private-hash'), false);
  }
});

test('explicit null and omitted assignment both persist as Unassigned', async () => {
  const omitted = storyValues();
  delete omitted.assigned_user_id;
  for (const body of [storyValues(), omitted]) {
    const result = await request(endpoint(), { method: 'POST', body });
    assert.equal(result.status, 201);
    assert.equal(result.data.story.assigned_user_id, null);
    assert.equal(result.data.story.assigned_user, null);
    const saved = await collections.stories.findOne({ _id: new ObjectId(result.data.story._id) });
    assert.equal(saved.assigned_user_id, null);
    assert.equal(saved.status, 'To Do');
  }
});

test('the backend initializes To Do even when a caller supplies another valid status', async () => {
  for (const status of ['To Do', 'In Progress', 'Done']) {
    const story = await makeStory({ status });
    assert.equal(story.status, 'To Do');
    assert.equal((await collections.stories.findOne({ _id: new ObjectId(story._id) })).status, 'To Do');
  }
});

test('backlogs include every priority and status, readable assignment, and only the selected project', async () => {
  assert.deepEqual((await request(endpoint())).data, { stories: [] });
  const ids = [];
  for (const [priority, status, assigned_user_id] of [
    ['High', 'To Do', people[0]._id.toString()],
    ['Medium', 'In Progress', people[1]._id.toString()],
    ['Low', 'Done', null],
  ]) {
    const story = await makeStory({ priority, assigned_user_id });
    ids.push(story._id);
    assert.equal((await request(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { status }) })).status, 200);
  }
  const other = await makeStory({ title: 'A different project story', assigned_user_id: people[2]._id.toString() }, projects[1]);
  const result = await request(endpoint());
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.stories.map(({ _id }) => _id), [...ids].reverse());
  assert.deepEqual(result.data.stories.map(({ status }) => status).sort(), ['Done', 'In Progress', 'To Do']);
  assert.deepEqual(result.data.stories.map(({ priority }) => priority).sort(), ['High', 'Low', 'Medium']);
  for (const story of result.data.stories) {
    assert.equal(story.description, storyValues().description);
    assert.equal(story.project_id, projects[0]._id.toString());
    if (story.assigned_user_id) assert.equal(typeof story.assigned_user.username, 'string');
    else assert.equal(story.assigned_user, null);
  }
  assert.equal(JSON.stringify(result.data).includes('password'), false);
  assert.deepEqual((await request(endpoint(projects[1]))).data.stories.map(({ _id }) => _id), [other._id]);
});

test('editing all five fields updates one existing document and can reassign or unassign it', async () => {
  const story = await makeStory({ assigned_user_id: people[0]._id.toString() });
  const untouched = await makeStory({ title: 'Another story' });
  const untouchedRecord = await collections.stories.findOne({ _id: new ObjectId(untouched._id) });
  const values = editValues(story, {
    title: '  Updated story  ', description: '  As a student, I want event reminders, so that I arrive on time.  ',
    priority: 'Low', status: 'In Progress', assigned_user_id: people[1]._id.toString(),
  });
  const result = await request(endpoint(projects[0], story._id), { method: 'PUT', body: values });
  assert.equal(result.status, 200);
  assert.equal(typeof result.data.message, 'string');
  assert.equal(result.data.story._id, story._id);
  assert.equal(result.data.story.project_id, story.project_id);
  assert.equal(result.data.story.assigned_user.username, 'sam');
  const saved = await collections.stories.findOne({ _id: new ObjectId(story._id) });
  assert.equal(saved.title, values.title.trim());
  assert.equal(saved.description, values.description.trim());
  assert.equal(saved.priority, 'Low');
  assert.equal(saved.status, 'In Progress');
  assert.ok(saved.project_id.equals(projects[0]._id));
  assert.ok(saved.assigned_user_id.equals(people[1]._id));
  assert.equal(await collections.stories.countDocuments(), 2);
  assert.deepEqual(await collections.stories.findOne({ _id: new ObjectId(untouched._id) }), untouchedRecord);
  const unassigned = await request(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(result.data.story, { assigned_user_id: null }) });
  assert.equal(unassigned.status, 200);
  assert.equal(unassigned.data.story.assigned_user_id, null);
  assert.equal(unassigned.data.story.assigned_user, null);
  assert.equal((await collections.stories.findOne({ _id: new ObjectId(story._id) })).assigned_user_id, null);
});

test('all six status changes are allowed, including reopening Done, and unchanged updates succeed', async () => {
  let story = await makeStory();
  for (const status of ['In Progress', 'Done', 'To Do', 'Done', 'In Progress', 'To Do']) {
    const result = await request(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { status }) });
    assert.equal(result.status, 200);
    assert.equal(result.data.story.status, status);
    assert.equal(result.data.story._id, story._id);
    story = result.data.story;
    assert.equal((await collections.stories.findOne({ _id: new ObjectId(story._id) })).status, status);
  }
  const original = await snapshot();
  const unchanged = await request(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story) });
  assert.equal(unchanged.status, 200);
  assert.deepEqual(await snapshot(), original);
  assert.equal(await collections.stories.countDocuments(), 1);
});

test('fresh app reads preserve created and updated data, and deleted stories remain absent', async () => {
  const story = await makeStory();
  const secondServer = await listen(createApp(collections.users, { ...collections, client }));
  const url = `http://127.0.0.1:${secondServer.address().port}`;
  try {
    assert.equal((await request(endpoint(), { url })).data.stories[0]._id, story._id);
    const result = await request(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { title: 'Saved change', status: 'Done' }) });
    assert.equal(result.status, 200);
    const reread = (await request(endpoint(), { url })).data.stories[0];
    assert.equal(reread.title, 'Saved change');
    assert.equal(reread.status, 'Done');
    const deleted = await request(endpoint(projects[0], story._id), { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal(typeof deleted.data.message, 'string');
    assert.deepEqual((await request(endpoint(), { url })).data, { stories: [] });
    assert.equal(await collections.stories.findOne({ _id: new ObjectId(story._id) }), null);
    await expectRejected(endpoint(projects[0], story._id), { method: 'DELETE' }, 404);
  } finally { await close(secondServer); }
});

test('creation and editing reject blank or non-string required text and unsupported priorities', async () => {
  const story = await makeStory();
  for (const field of ['title', 'description', 'priority']) {
    const missingCreate = storyValues();
    delete missingCreate[field];
    await expectRejected(endpoint(), { method: 'POST', body: missingCreate }, 400);
    for (const value of ['', '   ', null, 12, [], { $ne: null }]) {
      await expectRejected(endpoint(), { method: 'POST', body: storyValues({ [field]: value }) }, 400);
      await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { [field]: value }) }, 400);
    }
  }
  for (const priority of ['high', 'Urgent', 'Medium ']) {
    await expectRejected(endpoint(), { method: 'POST', body: storyValues({ priority }) }, 400);
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { priority }) }, 400);
  }
  for (const body of [null, {}, []]) {
    await expectRejected(endpoint(), { method: 'POST', body }, 400);
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body }, 400);
  }
});

test('editing requires all five fields and both writes reject unsupported status values', async () => {
  const story = await makeStory();
  for (const field of ['title', 'description', 'priority', 'status', 'assigned_user_id']) {
    const incomplete = editValues(story);
    delete incomplete[field];
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: incomplete }, 400);
  }
  for (const status of ['', ' ', 'Planning', 'Active', 'Completed', 'done', null, 7, [], { $ne: null }]) {
    await expectRejected(endpoint(), { method: 'POST', body: storyValues({ status }) }, 400);
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { status }) }, 400);
  }
});

test('invalid assignment identifiers are rejected rather than stored as null or query objects', async () => {
  const story = await makeStory();
  for (const assigned_user_id of ['', 'null', 'not-an-id', 'a'.repeat(23), 'a'.repeat(25), 'g'.repeat(24), 7, [], { $ne: null }]) {
    await expectRejected(endpoint(), { method: 'POST', body: storyValues({ assigned_user_id }) }, 400);
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { assigned_user_id }) }, 400);
  }
});

test('assignment requires an existing user and membership in this project on both create and edit', async () => {
  const story = await makeStory();
  const missingUser = new ObjectId();
  const missingUserWithMembership = new ObjectId();
  await collections.memberships.insertOne({ project_id: projects[0]._id, user_id: missingUserWithMembership });
  for (const [userId, expected] of [[people[2]._id, 400], [missingUser, 404], [missingUserWithMembership, 404]]) {
    const assigned_user_id = userId.toString();
    await expectRejected(endpoint(), { method: 'POST', body: storyValues({ assigned_user_id }) }, expected);
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, { assigned_user_id }) }, expected);
  }
  // Sam is valid in A, but being registered and a member elsewhere is not enough for B.
  const otherStory = await makeStory({}, projects[1]);
  await expectRejected(endpoint(projects[1]), { method: 'POST', body: storyValues({ assigned_user_id: people[1]._id.toString() }) }, 400);
  await expectRejected(endpoint(projects[1], otherStory._id), { method: 'PUT', body: editValues(otherStory, { assigned_user_id: people[1]._id.toString() }) }, 400);
});

test('invalid and absent project IDs are rejected consistently on every story route', async () => {
  const story = await makeStory();
  for (const [projectId, expected] of [['invalid', 400], ['g'.repeat(24), 400], [new ObjectId().toString(), 404]]) {
    const route = `/projects/${projectId}/stories`;
    for (const [target, options] of [
      [route, { method: 'GET' }], [route, { method: 'POST', body: storyValues() }],
      [`${route}/${story._id}`, { method: 'PUT', body: editValues(story) }],
      [`${route}/${story._id}`, { method: 'DELETE' }],
    ]) await expectRejected(target, options, expected);
  }
});

test('invalid and absent story IDs cannot update or delete existing stories', async () => {
  const story = await makeStory();
  for (const [id, expected] of [['invalid', 400], ['g'.repeat(24), 400], [new ObjectId().toString(), 404]]) {
    await expectRejected(endpoint(projects[0], id), { method: 'PUT', body: editValues(story) }, expected);
    await expectRejected(endpoint(projects[0], id), { method: 'DELETE' }, expected);
  }
});

test('using another project URL cannot update or delete a story', async () => {
  const story = await makeStory();
  await makeStory({ title: 'Other project must also stay unchanged' }, projects[1]);
  await expectRejected(endpoint(projects[1], story._id), { method: 'PUT', body: editValues(story, { title: 'Wrong project update' }) }, 404);
  await expectRejected(endpoint(projects[1], story._id), { method: 'DELETE' }, 404);
});

test('callers cannot set or replace story and project IDs, even with their current values', async () => {
  const story = await makeStory();
  for (const identifiers of [
    { _id: story._id }, { _id: new ObjectId().toString() }, { _id: null },
    { project_id: projects[0]._id.toString() }, { project_id: projects[1]._id.toString() }, { project_id: null },
  ]) {
    await expectRejected(endpoint(), { method: 'POST', body: storyValues(identifiers) }, 400);
    await expectRejected(endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story, identifiers) }, 400);
  }
});

test('extra fields are not stored, and update operators cannot change protected data', async () => {
  const story = await makeStory({ note: 'client metadata', assigned_user: { username: 'spoofed' } });
  const result = await request(endpoint(projects[0], story._id), {
    method: 'PUT', body: editValues(story, { title: 'Allowed update', extra: true, $set: { project_id: projects[1]._id.toString() } }),
  });
  assert.equal(result.status, 200);
  const saved = await collections.stories.findOne({ _id: new ObjectId(story._id) });
  assert.deepEqual(Object.keys(saved).sort(), ['_id', 'assigned_user_id', 'description', 'priority', 'project_id', 'status', 'title']);
  assert.equal(saved.title, 'Allowed update');
  assert.ok(saved.project_id.equals(projects[0]._id));
  assert.equal(result.data.story.assigned_user, null);
});

test('database failures on all story routes return safe JSON errors without altering data', async () => {
  const story = await makeStory();
  const original = await snapshot();
  const disconnected = await new MongoClient(mongo.getUri()).connect();
  const disconnectedDb = disconnected.db(db.databaseName);
  const broken = {
    users: disconnectedDb.collection('Users'), projects: disconnectedDb.collection('Projects'),
    memberships: disconnectedDb.collection('ProjectMemberships'), stories: disconnectedDb.collection('UserStories'),
  };
  await disconnected.close();
  const logs = [];
  const failingServer = await listen(createApp(broken.users, { ...broken, client: disconnected, logger: { error: (...args) => logs.push(args) } }));
  const url = `http://127.0.0.1:${failingServer.address().port}`;
  try {
    for (const [route, options] of [
      [endpoint(), { method: 'GET' }], [endpoint(), { method: 'POST', body: storyValues() }],
      [endpoint(projects[0], story._id), { method: 'PUT', body: editValues(story) }],
      [endpoint(projects[0], story._id), { method: 'DELETE' }],
    ]) {
      const result = await request(route, { ...options, url });
      assert.equal(result.status, 500);
      assert.match(result.data.message, /server or database error/i);
      assert.equal(JSON.stringify(result.data).includes('mongodb://'), false);
      assert.equal(JSON.stringify(result.data).includes('stored-private-hash'), false);
      assert.equal(Object.hasOwn(result.data, 'stack'), false);
    }
    assert.equal(logs.length, 4);
    assert.deepEqual(await snapshot(), original);
  } finally { await close(failingServer); }
});
