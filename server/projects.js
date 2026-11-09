const express = require('express');
const { ObjectId } = require('mongodb');

const statuses = new Set(['Planning', 'Active', 'Completed']);
const userProjection = { _id: 1, f_name: 1, l_name: 1, username: 1 };

function objectId(value) {
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? new ObjectId(value) : null;
}

function publicUser(user) {
  return { _id: user._id.toString(), f_name: user.f_name, l_name: user.l_name, username: user.username };
}

function publicProject(project, lead, memberCount) {
  return {
    _id: project._id.toString(),
    name: project.name,
    description: project.description,
    status: project.status,
    project_lead_id: project.project_lead_id.toString(),
    project_lead: lead ? publicUser(lead) : null,
    member_count: memberCount,
  };
}

function createProjectRouter({ users, projects, memberships, stories, client }) {
  const router = express.Router();

  router.get('/users', async (_req, res) => {
    const people = await users.find({}, { projection: userProjection }).sort({ username: 1 }).toArray();
    res.json({ users: people.map(publicUser) });
  });

  router.post('/projects', async (req, res) => {
    const { name, description, status, project_lead_id: leadId } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 120
      || typeof description !== 'string' || !description.trim() || description.length > 3000
      || !statuses.has(status)) {
      return res.status(400).json({ message: 'Provide a project name (up to 120 characters), description (up to 3000 characters), and status: Planning, Active, or Completed.' });
    }
    const projectLeadId = objectId(leadId);
    if (!projectLeadId) return res.status(400).json({ message: 'Please select a valid registered project lead.' });
    const lead = await users.findOne({ _id: projectLeadId }, { projection: userProjection });
    if (!lead) return res.status(404).json({ message: 'The selected project lead does not exist.' });

    const project = { _id: new ObjectId(), name: name.trim(), description: description.trim(), status, project_lead_id: projectLeadId };
    const session = client.startSession();
    try {
      // Both writes commit together: a project can never be saved without its lead membership.
      await session.withTransaction(async () => {
        await projects.insertOne(project, { session });
        await memberships.insertOne({ project_id: project._id, user_id: projectLeadId }, { session });
      });
    } finally {
      await session.endSession();
    }
    return res.status(201).json({ message: 'Project created. The project lead was added as a member.', project: publicProject(project, lead, 1) });
  });

  router.get('/projects', async (_req, res) => {
    const documents = await projects.aggregate([
      { $sort: { _id: -1 } },
      { $lookup: { from: users.collectionName, localField: 'project_lead_id', foreignField: '_id', pipeline: [{ $project: userProjection }], as: 'lead' } },
      { $lookup: { from: memberships.collectionName, localField: '_id', foreignField: 'project_id', pipeline: [{ $count: 'total' }], as: 'membershipCount' } },
    ]).toArray();
    res.json({ projects: documents.map((project) => publicProject(project, project.lead[0], project.membershipCount[0]?.total || 0)) });
  });

  // Validate the project once for every membership operation, including malformed IDs.
  router.use('/projects/:id/members', async (req, res, next) => {
    const id = objectId(req.params.id);
    if (!id) return res.status(400).json({ message: 'The project ID is invalid.' });
    const project = await projects.findOne({ _id: id });
    if (!project) return res.status(404).json({ message: 'The selected project does not exist.' });
    res.locals.project = project;
    next();
  });

  router.get('/projects/:id/members', async (_req, res) => {
    const project = res.locals.project;
    const entries = await memberships.find({ project_id: project._id }).toArray();
    const people = await users.find({ _id: { $in: entries.map((entry) => entry.user_id) } }, { projection: userProjection }).sort({ username: 1 }).toArray();
    res.json({ members: people.map((user) => ({ ...publicUser(user), is_lead: user._id.equals(project.project_lead_id) })) });
  });

  router.post('/projects/:id/members', async (req, res, next) => {
    const userId = objectId(req.body?.user_id);
    if (!userId) return res.status(400).json({ message: 'Please select a valid registered user.' });
    const user = await users.findOne({ _id: userId }, { projection: { _id: 1 } });
    if (!user) return res.status(404).json({ message: 'The selected user does not exist.' });
    try {
      await memberships.insertOne({ project_id: res.locals.project._id, user_id: userId });
      return res.status(201).json({ message: 'Member added successfully.' });
    } catch (error) {
      // The database's compound unique index also handles concurrent additions.
      if (error.code === 11000) return res.status(409).json({ message: 'This user is already a member of the project.' });
      next(error);
    }
  });

  router.delete('/projects/:id/members/:userId', async (req, res) => {
    const userId = objectId(req.params.userId);
    if (!userId) return res.status(400).json({ message: 'The user ID is invalid.' });
    const project = res.locals.project;
    if (userId.equals(project.project_lead_id)) {
      return res.status(403).json({ message: 'The project lead must remain a member and cannot be removed.' });
    }
    const user = await users.findOne({ _id: userId }, { projection: { _id: 1 } });
    if (!user) return res.status(404).json({ message: 'The selected user does not exist.' });
    const membershipQuery = { project_id: project._id, user_id: userId };
    const membership = await memberships.findOne(membershipQuery, { projection: { _id: 1 } });
    if (!membership) return res.status(404).json({ message: 'This user is not a member of the project.' });
    // Done stories still count; assignments in other projects must not block removal here.
    const assignedStory = await stories.findOne({ project_id: project._id, assigned_user_id: userId }, { projection: { _id: 1 } });
    if (assignedStory) {
      return res.status(409).json({
        message: "Reassign, unassign, or delete this member's stories in this project before removing them. Done stories count too.",
      });
    }
    const result = await memberships.deleteOne(membershipQuery);
    if (!result.deletedCount) return res.status(404).json({ message: 'This user is not a member of the project.' });
    return res.json({ message: 'Member removed successfully.' });
  });

  return router;
}

module.exports = { createProjectRouter };
