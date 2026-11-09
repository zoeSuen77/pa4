const { test, expect } = require('@playwright/test');
const { MongoClient } = require('mongodb');
const username = `ui_test_${Date.now()}`;
const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:9001';
const MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27019';
const DB_NAME = process.env.TEST_DB_NAME || 'pa3_ui_test';
const testUsernames = [username];
const testProjectIds = [];

test.afterAll(async () => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const { ObjectId } = require('mongodb');
    const projects = testProjectIds.map((id) => new ObjectId(id));
    await db.collection('ProjectMemberships').deleteMany({ project_id: { $in: projects } });
    await db.collection('Projects').deleteMany({ _id: { $in: projects } });
    await db.collection('Users').deleteMany({ username: { $in: testUsernames } });
  }
  finally { await client.close(); }
});

test('signup, database storage, duplicates, invalid login, and successful login', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please fill in');
  async function fillSignup() {
    await page.getByLabel('First name', { exact: true }).fill('Alex');
    await page.getByLabel('Last name', { exact: true }).fill('Chen');
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill('DemoPass123!');
  }
  await fillSignup();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account created successfully');
  const client = await new MongoClient(MONGO_URI).connect();
  try {
    const saved = await client.db(DB_NAME).collection('Users').findOne({ username });
    expect(saved.f_name).toBe('Alex');
    expect(saved.password).toMatch(/^scrypt\$/);
  } finally { await client.close(); }
  await fillSignup();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('already taken');
  await page.getByRole('navigation').getByRole('button', { name: 'Log in', exact: true }).click();
  const submitLogin = page.getByRole('form', { name: 'Login' }).getByRole('button', { name: 'Log in', exact: true });
  await submitLogin.click();
  await expect(page.getByRole('alert')).toContainText('Please enter');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await submitLogin.click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  await page.getByLabel('Password', { exact: true }).fill('DemoPass123!');
  await submitLogin.click();
  await expect(page.getByRole('status')).toContainText('Login successful. Welcome back, Alex!');
  await page.getByRole('button', { name: 'Continue to projects' }).click();
  await expect(page.getByRole('heading', { name: 'Good things start with a team.' })).toBeVisible();
  expect(errors).toEqual([]);
});

async function registerPeople(request, prefix) {
  const people = [];
  for (const name of ['Ada', 'Blair', 'Casey']) {
    const user = { f_name: name, l_name: 'Campus', username: `${prefix}_${name.toLowerCase()}`, password: 'DemoPass123!' };
    testUsernames.push(user.username);
    const response = await request.post(`${API_URL}/signup`, { data: user });
    expect(response.status()).toBe(201);
    people.push((await response.json()).user);
  }
  return people;
}

test('projects persist, leads are members, and one person can join two projects', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const stamp = Date.now();
  const people = await registerPeople(request, `ui_projects_${stamp}`);
  const [ada, blair, casey] = people;
  const garden = `Campus garden ${stamp}`;
  const library = `Library exchange ${stamp}`;
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please enter a project name');

  async function createProject(name, lead, status) {
    await page.getByLabel('Project name', { exact: true }).fill(name);
    await page.getByLabel('Description', { exact: true }).fill(`A shared place for ${name}.`);
    await page.getByLabel('Status', { exact: true }).selectOption(status);
    await page.getByLabel('Project lead', { exact: true }).selectOption(lead._id);
    const responsePromise = page.waitForResponse((response) => response.url() === `${API_URL}/projects` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    testProjectIds.push((await response.json()).project._id);
    await expect(page.getByRole('heading', { name, exact: true }).last()).toBeVisible();
  }

  await createProject(garden, ada, 'Active');
  const gardenPanel = page.getByRole('region', { name: garden, exact: true });
  await expect(gardenPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + ada.username);
  await expect(gardenPanel.getByText('Lead · protected')).toBeVisible();
  await expect(gardenPanel.getByRole('button', { name: 'Remove Ada Campus' })).toHaveCount(0);
  await expect(gardenPanel.getByText('Active', { exact: true })).toBeVisible();
  await gardenPanel.getByLabel('Add a registered user').selectOption(casey._id);
  await gardenPanel.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(gardenPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + casey.username);

  await gardenPanel.getByLabel('Add a registered user').selectOption(casey._id);
  await gardenPanel.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(gardenPanel.getByRole('alert')).toContainText(/already|duplicate/i);
  await expect(gardenPanel.getByRole('list', { name: 'Project members' }).getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await createProject(library, blair, 'Planning');
  const libraryPanel = page.getByRole('region', { name: library, exact: true });
  await libraryPanel.getByLabel('Add a registered user').selectOption(casey._id);
  await libraryPanel.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(libraryPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + casey.username);
  await expect(libraryPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + blair.username);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Good things start with a team.' })).toBeVisible();
  await page.getByRole('button', { name: `View project ${garden}`, exact: true }).click();
  await expect(gardenPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + casey.username);
  await gardenPanel.getByRole('button', { name: 'Remove Casey Campus', exact: true }).click();
  await expect(gardenPanel.getByRole('list', { name: 'Project members' })).not.toContainText('@' + casey.username);
  await expect(gardenPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + ada.username);
  await page.getByRole('button', { name: `View project ${library}`, exact: true }).click();
  await expect(libraryPanel.getByRole('list', { name: 'Project members' })).toContainText('@' + casey.username);

  // Check actual storage, including ObjectId references and independent relationships.
  const client = await new MongoClient(MONGO_URI).connect();
  try {
    const { ObjectId } = require('mongodb');
    const db = client.db(DB_NAME);
    const project = await db.collection('Projects').findOne({ name: garden });
    expect(project.project_lead_id).toBeInstanceOf(ObjectId);
    const remaining = await db.collection('ProjectMemberships').find({ user_id: new ObjectId(casey._id) }).toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].project_id).toBeInstanceOf(ObjectId);
    const remainingProject = await db.collection('Projects').findOne({ _id: remaining[0].project_id });
    expect(remainingProject.name).toBe(library);
  } finally { await client.close(); }
  expect(errors).toEqual([]);
});

test('workspace creation and member controls fit a narrow mobile screen', async ({ page, request }) => {
  const stamp = Date.now();
  const [lead, member] = await registerPeople(request, `ui_mobile_${stamp}`);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = `Mobile team ${stamp}`;
  await page.getByLabel('Project name').fill(name);
  await page.getByLabel('Description', { exact: true }).fill('A small team with a very long description '.repeat(20));
  await page.getByLabel('Project lead', { exact: true }).selectOption(lead._id);
  await page.getByLabel('Status', { exact: true }).selectOption('Completed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const responsePromise = page.waitForResponse((response) => response.url() === `${API_URL}/projects` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  testProjectIds.push((await (await responsePromise).json()).project._id);
  const panel = page.getByRole('region', { name, exact: true });
  await panel.getByLabel('Add a registered user').selectOption(member._id);
  await panel.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Project members' })).toContainText('@' + member.username);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('workspace network errors provide a working retry', async ({ page }) => {
  await page.route('**/projects', (route) => route.abort());
  await page.goto('/#projects');
  await expect(page.getByRole('alert')).toContainText('Could not connect to the server');
  await page.unroute('**/projects');
  await page.getByRole('button', { name: 'Retry workspace' }).click();
  await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('switching projects cannot replace the selected team with a stale response', async ({ page }) => {
  const ada = { _id: '000000000000000000000001', f_name: 'Ada', l_name: 'One', username: 'ada' };
  const blair = { _id: '000000000000000000000002', f_name: 'Blair', l_name: 'Two', username: 'blair' };
  const projects = [ada, blair].map((user, index) => ({ _id: `00000000000000000000001${index}`, name: `Project ${index + 1}`, description: 'Race test', status: 'Planning', project_lead_id: user._id, project_lead: user, member_count: 1 }));
  await page.route('**/users', (route) => route.fulfill({ json: { users: [ada, blair] } }));
  await page.route('**/projects', (route) => route.fulfill({ json: { projects } }));
  await page.route(`**/projects/${projects[0]._id}/members`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({ json: { members: [{ ...ada, is_lead: true }] } });
  });
  await page.route(`**/projects/${projects[1]._id}/members`, (route) => route.fulfill({ json: { members: [{ ...blair, is_lead: true }] } }));
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'View project Project 2', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Project members' })).toContainText('@blair');
  // Waiting on the slow response makes this a check of the race, not just the first render.
  await page.waitForTimeout(500);
  await expect(page.getByRole('list', { name: 'Project members' })).not.toContainText('@ada');
  await expect(page.getByRole('list', { name: 'Project members' })).toContainText('@blair');
});

test('a failed network request shows feedback and enables retry', async ({ page }) => {
  await page.route('**/login', (route) => route.abort());
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('offline');
  await page.getByLabel('Password', { exact: true }).fill('demo');
  const submit = page.getByRole('form').getByRole('button', { name: 'Log in', exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Could not connect to the server');
  await expect(submit).toBeEnabled();
});

test('server errors appear in the form', async ({ page }) => {
  await page.route('**/login', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'A server or database error occurred. Please try again shortly.' }) }));
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('demo');
  await page.getByLabel('Password', { exact: true }).fill('demo');
  await page.getByRole('form').getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('server or database error');
});

test('password visibility can be toggled without submitting', async ({ page }) => {
  await page.goto('/');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('private');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('both forms fit a mobile viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create an account.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
