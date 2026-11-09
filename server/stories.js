const express = require('express');
const { ObjectId } = require('mongodb');

const priorities = new Set(['High', 'Medium', 'Low']);
const statuses = new Set(['To Do', 'In Progress', 'Done']);
const userProjection = { _id: 1, f_name: 1, l_name: 1, username: 1 };

function objectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? new ObjectId(value) : null;
}

function publicStory(story, assignee) {
  return {
    _id: story._id.toString(),
    project_id: story.project_id.toString(),
    title: story.title,
    description: story.description,
    priority: story.priority,
    status: story.status,
    assigned_user_id: story.assigned_user_id?.toString() ?? null,
    assigned_user: assignee ? {
      _id: assignee._id.toString(),
      f_name: assignee.f_name,
      l_name: assignee.l_name,
      username: assignee.username,
    } : null,
  };
}

function validateFields(body, editing = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Please provide the story fields as a JSON object.' };
  }
  if (Object.hasOwn(body, '_id') || Object.hasOwn(body, 'project_id')) {
    return { error: 'Story and project IDs cannot be supplied or changed. Select the project in the URL.' };
  }
  if (typeof body.title !== 'string' || !body.title.trim()
    || typeof body.description !== 'string' || !body.description.trim()) {
    return { error: 'Please provide a nonblank title and description.' };
  }
  if (!priorities.has(body.priority)) {
    return { error: 'Priority must be High, Medium, or Low.' };
  }
  if ((editing || Object.hasOwn(body, 'status')) && !statuses.has(body.status)) {
    return { error: 'Status must be To Do, In Progress, or Done.' };
  }
  if (editing && !Object.hasOwn(body, 'assigned_user_id')) {
    return { error: 'Provide assigned_user_id when editing, or null for Unassigned.' };
  }
  const rawAssignee = Object.hasOwn(body, 'assigned_user_id') ? body.assigned_user_id : null;
  const assignedUserId = rawAssignee === null ? null : objectId(rawAssignee);
  if (rawAssignee !== null && !assignedUserId) {
    return { error: 'Assigned member must be a valid user ID or null for Unassigned.' };
  }
  return {
    fields: {
      title: body.title.trim(),
      description: body.description.trim(),
      priority: body.priority,
      // A supplied creation status never overrides the server's initial state.
      status: editing ? body.status : 'To Do',
      assigned_user_id: assignedUserId,
    },
  };
}

function createStoryRouter({ users, projects, memberships, stories }) {
  const router = express.Router();

  async function validateAssignment(userId, projectId) {
    if (userId === null) return { user: null };
    const user = await users.findOne({ _id: userId }, { projection: userProjection });
    if (!user) return { status: 404, message: 'The assigned user does not exist.' };
    const membership = await memberships.findOne({ project_id: projectId, user_id: userId });
    if (!membership) return { status: 400, message: 'The assigned user must be a current member of this project.' };
    return { user };
  }

  router.use('/projects/:projectId/stories', async (req, res, next) => {
    const projectId = objectId(req.params.projectId);
    if (!projectId) return res.status(400).json({ message: 'The project ID is invalid.' });
    const project = await projects.findOne({ _id: projectId }, { projection: { _id: 1 } });
    if (!project) return res.status(404).json({ message: 'The selected project does not exist.' });
    res.locals.storyProjectId = project._id;
    next();
  });

  router.get('/projects/:projectId/stories', async (_req, res) => {
    const documents = await stories.aggregate([
      { $match: { project_id: res.locals.storyProjectId } },
      { $sort: { _id: -1 } },
      { $lookup: {
        from: users.collectionName,
        localField: 'assigned_user_id',
        foreignField: '_id',
        pipeline: [{ $project: userProjection }],
        as: 'assignee',
      } },
    ]).toArray();
    res.json({ stories: documents.map((story) => publicStory(story, story.assignee[0])) });
  });

  router.post('/projects/:projectId/stories', async (req, res) => {
    const { fields, error } = validateFields(req.body);
    if (error) return res.status(400).json({ message: error });
    const projectId = res.locals.storyProjectId;
    const assignment = await validateAssignment(fields.assigned_user_id, projectId);
    if (assignment.status) return res.status(assignment.status).json({ message: assignment.message });
    const story = { project_id: projectId, ...fields };
    const result = await stories.insertOne(story);
    story._id = result.insertedId;
    return res.status(201).json({ message: 'User story created successfully.', story: publicStory(story, assignment.user) });
  });

  router.use('/projects/:projectId/stories/:storyId', (req, res, next) => {
    const storyId = objectId(req.params.storyId);
    if (!storyId) return res.status(400).json({ message: 'The story ID is invalid.' });
    // Both identifiers constrain every update and deletion, even for direct API requests.
    res.locals.storyQuery = { _id: storyId, project_id: res.locals.storyProjectId };
    next();
  });

  router.put('/projects/:projectId/stories/:storyId', async (req, res) => {
    const { fields, error } = validateFields(req.body, true);
    if (error) return res.status(400).json({ message: error });
    const assignment = await validateAssignment(fields.assigned_user_id, res.locals.storyProjectId);
    if (assignment.status) return res.status(assignment.status).json({ message: assignment.message });
    // Only editable fields reach $set; the original _id and project_id remain intact.
    const result = await stories.updateOne(res.locals.storyQuery, { $set: fields });
    if (!result.matchedCount) return res.status(404).json({ message: 'The story does not exist in this project.' });
    const story = { ...res.locals.storyQuery, ...fields };
    return res.json({ message: 'User story updated successfully.', story: publicStory(story, assignment.user) });
  });

  router.delete('/projects/:projectId/stories/:storyId', async (_req, res) => {
    const result = await stories.deleteOne(res.locals.storyQuery);
    if (!result.deletedCount) return res.status(404).json({ message: 'The story does not exist in this project.' });
    return res.json({ message: 'User story deleted successfully.' });
  });

  return router;
}

module.exports = { createStoryRouter };
