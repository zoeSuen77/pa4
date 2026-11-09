const { test: base, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:9001';
const MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27019';
const DB_NAME = process.env.TEST_DB_NAME || 'pa3_ui_test';
const description = 'As a student, I want to view event details, so that I can decide whether to attend.';

async function json(response, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

const test = base.extend({
  workspace: async ({ request }, use) => {
    const prefix = `stories_ui_${randomUUID().slice(0, 8)}`;
    const people = [], projects = [], usernames = [];
    try {
      for (const name of ['Lead', 'Member', 'Other']) {
        const username = `${prefix}_${name.toLowerCase()}`;
        usernames.push(username);
        people.push((await json(await request.post(`${API_URL}/signup`, {
          data: { f_name: name, l_name: 'Story', username, password: 'DemoPass123!' },
        }), 201)).user);
      }
      for (const [index, lead] of [[0, people[0]], [1, people[2]]]) {
        projects.push((await json(await request.post(`${API_URL}/projects`, {
          data: { name: `${prefix} ${index ? 'Beta' : 'Alpha'}`, description: 'An isolated browser test project.', status: 'Planning', project_lead_id: lead._id },
        }), 201)).project);
      }
      await json(await request.post(`${API_URL}/projects/${projects[0]._id}/members`, { data: { user_id: people[1]._id } }), 201);
      await use({ people, a: projects[0], b: projects[1] });
    } finally {
      // Only this test's records are removed; preserve other test runs and saved user data.
      const client = await new MongoClient(MONGO_URI).connect();
      try {
        const db = client.db(DB_NAME), ids = projects.map(({ _id }) => new ObjectId(_id));
        await db.collection('UserStories').deleteMany({ project_id: { $in: ids } });
        await db.collection('ProjectMemberships').deleteMany({ project_id: { $in: ids } });
        await db.collection('Projects').deleteMany({ _id: { $in: ids } });
        await db.collection('Users').deleteMany({ username: { $in: usernames } });
      } finally { await client.close(); }
    }
  },
});

const editValues = (story, overrides = {}) => ({
  title: story.title, description: story.description, priority: story.priority,
  status: story.status, assigned_user_id: story.assigned_user_id, ...overrides,
});
async function seedStory(request, project, overrides = {}) {
  const { status = 'To Do', ...values } = overrides;
  let story = (await json(await request.post(`${API_URL}/projects/${project._id}/stories`, {
    data: { title: 'View campus events', description, priority: 'High', assigned_user_id: null, ...values },
  }), 201)).story;
  if (status !== 'To Do') story = (await json(await request.put(`${API_URL}/projects/${project._id}/stories/${story._id}`, { data: editValues(story, { status }) }))).story;
  return story;
}
async function listStories(request, project) {
  return (await json(await request.get(`${API_URL}/projects/${project._id}/stories`))).stories;
}
async function selectProject(page, project) {
  await page.getByRole('button', { name: `View project ${project.name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true }).last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Project backlog', exact: true })).toBeVisible();
}
async function visitProject(page, project) {
  await page.goto('/#projects');
  await selectProject(page, project);
}
const card = (page, title) => page.getByRole('article', { name: title, exact: true });
const createForm = (page) => page.getByRole('form', { name: 'Create user story', exact: true });
const editForm = (page) => page.getByRole('form', { name: 'Edit user story', exact: true });
async function openCreate(page) {
  await page.getByRole('button', { name: 'New story', exact: true }).click();
  await expect(createForm(page)).toBeVisible();
  return createForm(page);
}
async function fillCreate(form, { title, priority = 'High', assignedUserId, text = description }) {
  await form.getByLabel('Story title', { exact: true }).fill(title);
  await form.getByLabel('Story description', { exact: true }).fill(text);
  await form.getByLabel('Priority', { exact: true }).selectOption(priority);
  await form.getByLabel('Assigned member', { exact: true }).selectOption(assignedUserId || { label: 'Unassigned' });
}
async function submitStory(page, project, form, method, id) {
  const endpoint = `${API_URL}/projects/${project._id}/stories${id ? `/${id}` : ''}`;
  const response = page.waitForResponse((response) => response.url() === endpoint && response.request().method() === method);
  await form.getByRole('button', { name: method === 'POST' ? 'Create story' : 'Save story', exact: true }).click();
  const data = await json(await response, method === 'POST' ? 201 : 200);
  await expect(form).toHaveCount(0);
  return data.story;
}

test('real story creation and five-field editing persist after refresh, including null assignment', async ({ page, request, workspace }) => {
  const { a, people } = workspace;
  await visitProject(page, a);
  const form = await openCreate(page);
  await expect(form.getByLabel('Story status', { exact: true })).toHaveCount(0);
  await fillCreate(form, { title: 'Create through the browser', assignedUserId: people[1]._id });
  const story = await submitStory(page, a, form, 'POST');
  await expect(card(page, story.title)).toContainText('To Do');
  await expect(card(page, story.title)).toContainText('Member Story');
  expect(story.status).toBe('To Do');
  await page.getByRole('button', { name: `Edit ${story.title}`, exact: true }).click();
  const edit = editForm(page);
  await edit.getByLabel('Story title', { exact: true }).fill('Edited in the browser');
  await edit.getByLabel('Story description', { exact: true }).fill('As a student, I want reminders, so that I arrive on time.');
  await edit.getByLabel('Priority', { exact: true }).selectOption('Low');
  await edit.getByLabel('Story status', { exact: true }).selectOption('Done');
  await edit.getByLabel('Assigned member', { exact: true }).selectOption({ label: 'Unassigned' });
  const updated = await submitStory(page, a, edit, 'PUT', story._id);
  expect(updated._id).toBe(story._id);
  expect(updated.project_id).toBe(a._id);
  await page.reload();
  await selectProject(page, a);
  await expect(card(page, updated.title)).toContainText('Done');
  await expect(card(page, updated.title)).toContainText('Low');
  await expect(card(page, updated.title)).toContainText('Unassigned');
  await expect(card(page, updated.title)).toContainText(updated.description);
  const unassigned = await openCreate(page);
  await fillCreate(unassigned, { title: 'Initially unassigned' });
  const second = await submitStory(page, a, unassigned, 'POST');
  const client = await new MongoClient(MONGO_URI).connect();
  try {
    const saved = await client.db(DB_NAME).collection('UserStories').find({ project_id: new ObjectId(a._id) }).toArray();
    expect(saved).toHaveLength(2);
    for (const record of saved) {
      expect(record._id).toBeInstanceOf(ObjectId);
      expect(record.project_id).toBeInstanceOf(ObjectId);
      expect(record.assigned_user_id).toBeNull();
    }
    expect(saved.find(({ _id }) => _id.toString() === second._id).status).toBe('To Do');
  } finally { await client.close(); }
  expect((await listStories(request, a)).find(({ _id }) => _id === story._id).title).toBe(updated.title);
});

test('each backlog displays all priorities and statuses with descriptions and readable members', async ({ page, request, workspace }) => {
  const { a, b, people } = workspace;
  const stories = [];
  for (const [title, priority, status, assigned_user_id] of [
    ['High planned work', 'High', 'To Do', people[0]._id],
    ['Medium active work', 'Medium', 'In Progress', people[1]._id],
    ['Low completed work', 'Low', 'Done', null],
  ]) stories.push(await seedStory(request, a, { title, priority, status, assigned_user_id }));
  const other = await seedStory(request, b, { title: 'Only project Beta', assigned_user_id: people[2]._id });
  await visitProject(page, a);
  await expect(page.getByRole('list', { name: 'User stories' }).getByRole('article')).toHaveCount(3);
  for (const story of stories) {
    await expect(card(page, story.title)).toContainText(story.priority);
    await expect(card(page, story.title)).toContainText(story.status);
    await expect(card(page, story.title)).toContainText(story.description);
    await expect(card(page, story.title)).toContainText(story.assigned_user ? `${story.assigned_user.f_name} Story` : 'Unassigned');
  }
  await selectProject(page, b);
  await expect(card(page, other.title)).toBeVisible();
  await expect(card(page, stories[0].title)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'User stories' }).getByRole('article')).toHaveCount(1);
});

test('editing prefills all fields and Cancel discards changes without sending PUT', async ({ page, request, workspace }) => {
  const { a, people } = workspace;
  const story = await seedStory(request, a, { priority: 'Medium', status: 'Done', assigned_user_id: people[1]._id });
  await visitProject(page, a);
  let updates = 0;
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().endsWith(`/stories/${story._id}`)) updates += 1; });
  await page.getByRole('button', { name: `Edit ${story.title}`, exact: true }).click();
  const form = editForm(page);
  for (const [label, value] of [['Story title', story.title], ['Story description', story.description], ['Priority', story.priority], ['Story status', story.status], ['Assigned member', story.assigned_user_id]]) {
    await expect(form.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  await form.getByLabel('Story title', { exact: true }).fill('Unsaved draft');
  await form.getByLabel('Story status', { exact: true }).selectOption('To Do');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(updates).toBe(0);
  expect(await listStories(request, a)).toEqual([story]);
  await page.reload();
  await selectProject(page, a);
  await expect(card(page, story.title)).toContainText('Done');
  await expect(card(page, 'Unsaved draft')).toHaveCount(0);
});

test('delete cancellation sends no request, while confirmation deletes and closes the open editor', async ({ page, request, workspace }) => {
  const { a } = workspace;
  const story = await seedStory(request, a);
  await visitProject(page, a);
  let deletes = 0;
  page.on('request', (request) => { if (request.method() === 'DELETE' && request.url().endsWith(`/stories/${story._id}`)) deletes += 1; });
  await page.getByRole('button', { name: `Edit ${story.title}`, exact: true }).click();
  await expect(editForm(page)).toBeVisible();
  page.once('dialog', async (dialog) => { expect(dialog.message()).toContain(story.title); await dialog.dismiss(); });
  await page.getByRole('button', { name: `Delete ${story.title}`, exact: true }).click();
  await expect(card(page, story.title)).toBeVisible();
  await expect(editForm(page)).toBeVisible();
  expect(deletes).toBe(0);
  expect(await listStories(request, a)).toHaveLength(1);
  page.once('dialog', async (dialog) => { expect(dialog.message()).toContain(story.title); await dialog.accept(); });
  const response = page.waitForResponse((response) => response.url().endsWith(`/stories/${story._id}`) && response.request().method() === 'DELETE');
  await page.getByRole('button', { name: `Delete ${story.title}`, exact: true }).click();
  await json(await response);
  await expect(editForm(page)).toHaveCount(0);
  await expect(card(page, story.title)).toHaveCount(0);
  await page.reload();
  await selectProject(page, a);
  expect(await listStories(request, a)).toHaveLength(0);
  expect(deletes).toBe(1);
});

test('assignment choices contain only current project members and refresh after member changes', async ({ page, request, workspace }) => {
  const { a, b, people: [lead, member, other] } = workspace;
  await visitProject(page, a);
  const form = await openCreate(page), assigned = form.getByLabel('Assigned member', { exact: true });
  await expect(assigned.locator('option', { hasText: 'Unassigned' })).toHaveCount(1);
  await expect(assigned.locator(`option[value="${lead._id}"]`)).toHaveCount(1);
  await expect(assigned.locator(`option[value="${member._id}"]`)).toHaveCount(1);
  await expect(assigned.locator(`option[value="${other._id}"]`)).toHaveCount(0);
  const members = page.getByRole('region', { name: a.name, exact: true });
  await members.getByLabel('Add a registered user', { exact: true }).selectOption(other._id);
  await members.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(assigned.locator(`option[value="${other._id}"]`)).toHaveCount(1);
  await members.getByRole('button', { name: 'Remove Other Story', exact: true }).click();
  await expect(assigned.locator(`option[value="${other._id}"]`)).toHaveCount(0);
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  // A change outside this browser must be picked up when the next form opens.
  await json(await request.post(`${API_URL}/projects/${a._id}/members`, { data: { user_id: other._id } }), 201);
  const refreshed = await openCreate(page);
  await expect(refreshed.getByLabel('Assigned member', { exact: true }).locator(`option[value="${other._id}"]`)).toHaveCount(1);
  await selectProject(page, b);
  const otherForm = await openCreate(page), otherChoices = otherForm.getByLabel('Assigned member', { exact: true });
  await expect(otherChoices.locator(`option[value="${other._id}"]`)).toHaveCount(1);
  await expect(otherChoices.locator(`option[value="${member._id}"]`)).toHaveCount(0);
  await expect(otherChoices.locator(`option[value="${lead._id}"]`)).toHaveCount(0);
});

test('Done assignments block member removal and reopening plus unassigning allows removal', async ({ page, request, workspace }) => {
  const { a, people } = workspace;
  const story = await seedStory(request, a, { status: 'Done', assigned_user_id: people[1]._id });
  await visitProject(page, a);
  const members = page.getByRole('region', { name: a.name, exact: true });
  await members.getByRole('button', { name: 'Remove Member Story', exact: true }).click();
  await expect(members.getByRole('alert')).toContainText(/reassign.*unassign.*delete/i);
  await expect(members.getByRole('alert')).toContainText('Done');
  await expect(members.getByRole('list', { name: 'Project members' })).toContainText(people[1].username);
  await page.getByRole('button', { name: `Edit ${story.title}`, exact: true }).click();
  const form = editForm(page);
  await form.getByLabel('Story status', { exact: true }).selectOption('To Do');
  await form.getByLabel('Assigned member', { exact: true }).selectOption({ label: 'Unassigned' });
  await submitStory(page, a, form, 'PUT', story._id);
  await expect(card(page, story.title)).toContainText('To Do');
  await members.getByRole('button', { name: 'Remove Member Story', exact: true }).click();
  await expect(members.getByRole('list', { name: 'Project members' })).not.toContainText(people[1].username);
  expect((await listStories(request, a))[0].assigned_user_id).toBeNull();
});

test('switching A to B and back clears editing drafts and feedback for the same original project ID', async ({ page, request, workspace }) => {
  const { a, b } = workspace;
  const first = await seedStory(request, a, { title: 'Alpha story' });
  const second = await seedStory(request, b, { title: 'Beta story' });
  await visitProject(page, a);
  await page.getByRole('button', { name: `Edit ${first.title}`, exact: true }).click();
  await editForm(page).getByLabel('Story title', { exact: true }).fill('Discard on switch');
  await selectProject(page, b);
  await expect(editForm(page)).toHaveCount(0);
  await expect(card(page, second.title)).toBeVisible();
  await expect(card(page, first.title)).toHaveCount(0);
  await selectProject(page, a);
  await expect(editForm(page)).toHaveCount(0);
  await expect(card(page, first.title)).toBeVisible();
  const form = await openCreate(page);
  await form.getByRole('button', { name: 'Create story', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await selectProject(page, b);
  await expect(createForm(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await selectProject(page, a);
  await expect(createForm(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await listStories(request, a))[0].title).toBe(first.title);
});

test('a delayed backlog response from the previous project cannot replace the selected project', async ({ page, request, workspace }) => {
  const { a, b } = workspace;
  const first = await seedStory(request, a, { title: 'Delayed Alpha story' });
  const second = await seedStory(request, b, { title: 'Current Beta story' });
  await visitProject(page, b);
  let release, started, completed;
  const gate = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  const finished = new Promise((resolve) => { completed = resolve; });
  await page.route(`${API_URL}/projects/${a._id}/stories`, async (route) => {
    started();
    await gate;
    try { await route.fulfill({ json: { stories: [first] } }); }
    finally { completed(); }
  });
  try {
    await selectProject(page, a);
    await requested;
    await selectProject(page, b);
    await expect(card(page, second.title)).toBeVisible();
    release();
    await finished;
    // Await a browser turn after the late response has been delivered.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(card(page, second.title)).toBeVisible();
    await expect(card(page, first.title)).toHaveCount(0);
  } finally { release(); }
});

test('backlog loading and network errors have a working refresh retry', async ({ page, request, workspace }) => {
  const { a, b } = workspace;
  const story = await seedStory(request, a);
  await visitProject(page, b);
  let release, started, failInitialLoad = true;
  const gate = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  await page.route(`${API_URL}/projects/${a._id}/stories`, async (route) => {
    // StrictMode may restart the initial effect; hold every initial GET until retry.
    if (failInitialLoad) { started(); await gate; await route.abort(); }
    else await route.continue();
  });
  try {
    await selectProject(page, a);
    await requested;
    await expect(page.getByRole('region', { name: 'Project backlog', exact: true })
      .getByText('Loading user stories…', { exact: true })).toBeVisible();
    release();
    await expect(page.getByRole('alert')).toContainText('Could not connect to the server');
    failInitialLoad = false;
    await page.getByRole('button', { name: 'Refresh backlog', exact: true }).click();
    await expect(card(page, story.title)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
});

test('validation avoids writes and a failed save preserves form inputs for a successful retry', async ({ page, request, workspace }) => {
  const { a, people } = workspace;
  await visitProject(page, a);
  const form = await openCreate(page);
  let posts = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.url() === `${API_URL}/projects/${a._id}/stories`) posts += 1; });
  await form.getByRole('button', { name: 'Create story', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  expect(posts).toBe(0);
  await fillCreate(form, { title: 'Preserved draft', priority: 'Medium', assignedUserId: people[1]._id });
  let failures = 0;
  await page.route(`${API_URL}/projects/${a._id}/stories`, (route) => route.request().method() === 'POST' && failures++ === 0
    ? route.fulfill({ status: 500, json: { message: 'A server or database error occurred. Please try again shortly.' } })
    : route.continue());
  await form.getByRole('button', { name: 'Create story', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project backlog', exact: true }).getByRole('alert')).toContainText('server or database error');
  await expect(form.getByLabel('Story title', { exact: true })).toHaveValue('Preserved draft');
  await expect(form.getByLabel('Story description', { exact: true })).toHaveValue(description);
  await expect(form.getByLabel('Priority', { exact: true })).toHaveValue('Medium');
  await expect(form.getByLabel('Assigned member', { exact: true })).toHaveValue(people[1]._id);
  await expect(form.getByRole('button', { name: 'Create story', exact: true })).toBeEnabled();
  expect(await listStories(request, a)).toHaveLength(0);
  const story = await submitStory(page, a, form, 'POST');
  await expect(card(page, story.title)).toBeVisible();
  expect(posts).toBe(2);
});

test('a project-details refresh failure and retry preserve the open story draft', async ({ page, request, workspace }) => {
  const { a, people } = workspace;
  await visitProject(page, a);
  const form = await openCreate(page);
  await fillCreate(form, { title: 'Keep this unsaved draft', priority: 'Low', assignedUserId: people[1]._id });
  await page.route(`${API_URL}/projects`, (route) => route.request().method() === 'GET' ? route.abort() : route.continue());
  await page.getByRole('region', { name: a.name, exact: true }).getByRole('button', { name: 'Refresh members', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not refresh project details');
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Story title', { exact: true })).toHaveValue('Keep this unsaved draft');
  await expect(form.getByLabel('Story description', { exact: true })).toHaveValue(description);
  await expect(form.getByLabel('Priority', { exact: true })).toHaveValue('Low');
  await expect(form.getByLabel('Assigned member', { exact: true })).toHaveValue(people[1]._id);
  await page.unroute(`${API_URL}/projects`);
  await page.getByRole('button', { name: 'Retry project details', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Story title', { exact: true })).toHaveValue('Keep this unsaved draft');
  await expect(form.getByLabel('Story description', { exact: true })).toHaveValue(description);
  await expect(form.getByLabel('Priority', { exact: true })).toHaveValue('Low');
  await expect(form.getByLabel('Assigned member', { exact: true })).toHaveValue(people[1]._id);
  expect(await listStories(request, a)).toHaveLength(0);
});

test('an empty backlog and a workspace without projects show useful guidance without an active story form', async ({ page, workspace }) => {
  await visitProject(page, workspace.a);
  await expect(page.getByText(/no (user )?stories|backlog is empty|first (user )?story/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'New story', exact: true })).toBeEnabled();
  await page.route(`${API_URL}/projects`, (route) => route.fulfill({ json: { projects: [] } }));
  await page.reload();
  await expect(page.getByText(/select.*project|create.*project|first project/i).first()).toBeVisible();
  await expect(createForm(page)).toHaveCount(0);
  const newStory = page.getByRole('button', { name: 'New story', exact: true });
  if (await newStory.count()) await expect(newStory).toBeDisabled();
});

test('long story text, details, and forms fit a 375 pixel viewport without horizontal overflow', async ({ page, request, workspace }) => {
  const { a, people } = workspace;
  const title = `Long story ${'X'.repeat(180)}`;
  const story = await seedStory(request, a, { title, description: `${description} ${'unbroken'.repeat(90)}`, assigned_user_id: people[1]._id, status: 'In Progress' });
  await page.setViewportSize({ width: 375, height: 812 });
  await visitProject(page, a);
  await expect(card(page, title)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await expect(editForm(page).getByLabel('Story description', { exact: true })).toHaveValue(story.description);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await editForm(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  const form = await openCreate(page);
  await fillCreate(form, { title, text: story.description });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
