const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { demoUsers, demoProjects, demoStories, demoPassword } = require('./demo-data.cjs');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

async function seedDemo(base = process.env.DEMO_API_URL || 'http://127.0.0.1:9000', options = {}) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) API address without credentials, a query, or a fragment.');
  }
  const api = url.href.replace(/\/+$/, '');
  const apiHash = createHash('sha256').update(api).digest('hex');
  const manifestPath = path.resolve(options.manifestPath || process.env.DEMO_MANIFEST_PATH
    || path.join(__dirname, '../.local-data/seed-manifests', `pa4-${apiHash.slice(0, 16)}.json`));
  const logger = options.logger || console;
  const report = {
    status: 'success', ready: false, warnings: [],
    created: { users: [], projects: [], memberships: [], stories: [] },
    ids: { users: {}, projects: {}, stories: {} }, manifestPath,
  };
  function warn(code, message, repair) {
    report.warnings.push({ code, message, repair });
    logger.warn(`[${code}] ${message}\n  Repair: ${repair}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read the demo manifest. Restore its valid JSON from a backup or choose a separate DEMO_MANIFEST_PATH; the file was not replaced.');
    manifest = { version: 1, apiHash, projects: {}, stories: {} };
  }
  const validManifest = isObject(manifest) && manifest.version === 1 && manifest.apiHash === apiHash
    && isObject(manifest.projects) && isObject(manifest.stories)
    && Object.entries(manifest.projects).every(([key, value]) => demoProjects.some(project => project.key === key)
      && isObject(value) && isId(value.id) && typeof value.membersInitialized === 'boolean')
    && Object.entries(manifest.stories).every(([key, value]) => demoStories.some(story => story.key === key)
      && isObject(value) && isId(value.id) && isId(value.projectId));
  if (!validManifest) throw new Error('The demo manifest is invalid or belongs to another API address. Restore the correct manifest or choose a separate DEMO_MANIFEST_PATH; no records were changed.');
  async function saveManifest() {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const temporary = `${manifestPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, manifestPath);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  // Check tracking-file access before making any database changes.
  await saveManifest();
  async function request(endpoint, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${api}${endpoint}`, {
      method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${method} ${endpoint}: ${data.message || `HTTP ${response.status}`}`);
    return data;
  }

  const { users } = await request('/users');
  for (const sample of demoUsers) {
    let user = users.find(person => person.username === sample.username);
    if (!user) {
      user = (await request('/signup', { ...sample, password: demoPassword })).user;
      users.push(user);
      report.created.users.push(user._id);
    }
    report.ids.users[sample.username] = user._id;
    if (user.f_name !== sample.f_name || user.l_name !== sample.l_name) {
      warn('USER_NAME_DIFFERS', `Account @${sample.username} (${user._id}) has a different display name; the account and password were preserved.`,
        `Use this account with its current name, or deliberately restore the display name in MongoDB Compass after checking its _id. Expected: ${sample.f_name} ${sample.l_name}.`);
    }
  }

  const { projects } = await request('/projects');
  for (const sample of demoProjects) {
    const leadId = report.ids.users[sample.lead];
    const tracked = manifest.projects[sample.key];
    const named = projects.filter(project => project.name === sample.name);
    let project = tracked && projects.find(candidate => candidate._id === tracked.id);
    if (named.length > 1 || (project && named.some(candidate => candidate._id !== project._id))) {
      warn('PROJECT_NAME_CONFLICT', `${sample.name} has conflicting project IDs: ${[...new Set([...named.map(candidate => candidate._id), ...(project ? [project._id] : [])])].join(', ')}. Its samples were skipped.`,
        'In MongoDB Compass, identify the intended project by _id and deliberately rename conflicting projects while retaining their records. Then rerun the seed command.');
      continue;
    }
    project ||= named[0];
    if (project && project.project_lead_id !== leadId) {
      warn('PROJECT_LEAD_CONFLICT', `${sample.name} (${project._id}) has lead ${project.project_lead_id}, not @${sample.lead}. Its samples were skipped.`,
        tracked?.id === project._id
          ? `This project is tracked by _id even if renamed. To restore the planned setup, verify its _id in MongoDB Compass and deliberately restore project_lead_id to ObjectId("${leadId}"). Then select this project in the app, ensure @${sample.lead} is present (use Add member if missing), and rerun.`
          : `In MongoDB Compass, verify this _id and rename the unrelated project while retaining its records. Then rerun to create ${sample.name} with @${sample.lead}. Do not change its lead ID without also maintaining its lead membership.`);
      continue;
    }
    if (!project) {
      project = (await request('/projects', { name: sample.name, description: sample.description, status: sample.status, project_lead_id: leadId })).project;
      projects.push(project);
      report.created.projects.push(project._id);
    }
    report.ids.projects[sample.key] = project._id;
    if (!tracked || tracked.id !== project._id) manifest.projects[sample.key] = { id: project._id, membersInitialized: false };
    await saveManifest();
    const projectDifferences = ['name', 'description', 'status'].filter(field => project[field] !== sample[field]);
    if (projectDifferences.length) {
      warn('PROJECT_EDITED', `${sample.name} (${project._id}) differs in ${projectDifferences.join(', ')}; existing values were preserved.`,
        'To restore the recording state, check the project _id in MongoDB Compass and deliberately restore these fields from scripts/demo-data.cjs.');
    }
    const { members } = await request(`/projects/${project._id}/members`);
    const memberState = manifest.projects[sample.key];
    for (const username of sample.members) {
      const userId = report.ids.users[username];
      if (members.some(member => member._id === userId)) continue;
      if (memberState.membersInitialized || userId === leadId) {
        warn('MEMBER_MISSING', `${sample.name} (${project._id}) is missing @${username}; the membership was not restored automatically.`,
          `Select this project, choose @${username} under Add a registered user, click Add member, and rerun.`);
      } else {
        await request(`/projects/${project._id}/members`, { user_id: userId });
        members.push(users.find(user => user._id === userId));
        report.created.memberships.push({ project_id: project._id, user_id: userId });
      }
    }
    const expectedIds = new Set(sample.members.map(username => report.ids.users[username]));
    for (const member of members.filter(person => !expectedIds.has(person._id))) {
      warn('EXTRA_MEMBER', `${sample.name} (${project._id}) also contains @${member.username} (${member._id}); this membership was preserved.`,
        'Keep intentional members. To restore the planned layout, first reassign/unassign their stories in this project, then use Remove in the members panel.');
    }
    if (sample.members.every(username => members.some(member => member._id === report.ids.users[username]))) {
      memberState.membersInitialized = true;
      await saveManifest();
    }

    const { stories } = await request(`/projects/${project._id}/stories`);
    for (const sampleStory of demoStories.filter(story => story.project === sample.key)) {
      const remembered = manifest.stories[sampleStory.key];
      const namedStories = stories.filter(story => story.title === sampleStory.title);
      let story = remembered?.projectId === project._id && stories.find(candidate => candidate._id === remembered.id);
      if (namedStories.length > 1 || (story && namedStories.some(candidate => candidate._id !== story._id))) {
        warn('STORY_TITLE_CONFLICT', `${sampleStory.key} in ${sample.name} has conflicting story IDs: ${[...new Set([...namedStories.map(candidate => candidate._id), ...(story ? [story._id] : [])])].join(', ')}. The sample was skipped.`,
          `Check these _ids in MongoDB Compass to identify the intended story, then use Edit in this project's backlog to rename unrelated same-title stories. Rerun afterward.`);
        continue;
      }
      story ||= namedStories[0];
      const values = {
        title: sampleStory.title, description: sampleStory.description, priority: sampleStory.priority,
        assigned_user_id: sampleStory.assignee ? report.ids.users[sampleStory.assignee] : null,
      };
      if (!story) {
        if (values.assigned_user_id && !members.some(member => member._id === values.assigned_user_id)) {
          warn('STORY_MEMBER_MISSING', `${sampleStory.key} (${sampleStory.title}) cannot be created because @${sampleStory.assignee} is not a member of ${sample.name}.`,
            `Add @${sampleStory.assignee} to this project with Add member, then rerun to create the missing story.`);
          continue;
        }
        story = (await request(`/projects/${project._id}/stories`, values)).story;
        report.created.stories.push(story._id);
        // Record POST before PUT so an interrupted setup cannot duplicate this story.
        manifest.stories[sampleStory.key] = { id: story._id, projectId: project._id };
        await saveManifest();
        if (sampleStory.status !== 'To Do') story = (await request(`/projects/${project._id}/stories/${story._id}`, { ...values, status: sampleStory.status }, 'PUT')).story;
        stories.push(story);
      }
      report.ids.stories[sampleStory.key] = story._id;
      manifest.stories[sampleStory.key] = { id: story._id, projectId: project._id };
      await saveManifest();
      const expected = { ...values, status: sampleStory.status };
      const differences = Object.keys(expected).filter(field => story[field] !== expected[field]);
      if (differences.length) {
        warn('STORY_EDITED', `${sampleStory.key} (${story._id}) in ${sample.name} differs in ${differences.join(', ')}; no fields were overwritten.`,
          `Select this project and Edit "${story.title}". To restore the recording state, use ${sampleStory.key} in scripts/demo-data.cjs (priority ${sampleStory.priority}, status ${sampleStory.status}, assignee ${sampleStory.assignee || 'Unassigned'}), Save story, and rerun.`);
      }
    }
    const sampleIds = new Set(demoStories.filter(story => story.project === sample.key).map(story => report.ids.stories[story.key]).filter(Boolean));
    for (const story of stories.filter(candidate => !sampleIds.has(candidate._id))) {
      warn('EXTRA_STORY', `${sample.name} also contains "${story.title}" (${story._id}); the story was preserved.`,
        'Keep intentional additions. Before recording the exact sample scenario, review any extra assignment to Sam or Maya because it can affect the member-removal demonstration.');
    }
  }
  report.ready = report.warnings.length === 0;
  report.status = report.ready ? 'success' : 'warnings';
  logger.log(report.ready ? 'PA4 demo data ready: three users, two PA4 projects, and six stories match the planned layout.'
    : `PA4 demo setup needs review: ${report.warnings.length} warning(s). Existing edits were preserved; follow the repair notes above.`);
  logger.log(`Created this run: ${report.created.users.length} users, ${report.created.projects.length} projects, ${report.created.memberships.length} additional memberships, ${report.created.stories.length} stories.`);
  if (report.created.users.length) logger.log(`Password for accounts created by this run: ${demoPassword}. Existing account passwords are unchanged.`);
  logger.log(`Sample tracking file: ${manifestPath}`);
  return report;
}

module.exports = { seedDemo };
if (require.main === module) seedDemo().then(report => { if (!report.ready) process.exitCode = 2; }).catch(error => {
  console.error('Could not prepare demo data:', error.message);
  console.error('Make sure the application is running. Correct the reported issue and rerun; existing records are preserved.');
  process.exitCode = 1;
});
