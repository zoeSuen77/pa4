const express = require('express');
const cors = require('cors');
const { hashPassword, verifyPassword } = require('./passwords');
const { createProjectRouter } = require('./projects');
const { createStoryRouter } = require('./stories');

const limits = { f_name: 100, l_name: 100, username: 64, password: 1024 };

function validFields(body, fields) {
  return body && fields.every((field) => typeof body[field] === 'string'
    && body[field].trim().length > 0 && body[field].length <= limits[field]);
}

function publicUser(user) {
  return { _id: user._id.toString(), f_name: user.f_name, l_name: user.l_name, username: user.username };
}

function createApp(users, { projects, memberships, stories, client, origins = ['http://localhost:5173', 'http://127.0.0.1:5173'], logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '16kb' }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/', (_req, res) => res.json({ message: 'Server is running' }));

  app.post('/signup', async (req, res, next) => {
    if (!validFields(req.body, ['f_name', 'l_name', 'username', 'password'])) {
      return res.status(400).json({ message: 'Please provide a first name, last name, username, and password within the field limits.' });
    }
    const username = req.body.username.trim().toLowerCase();
    try {
      const existing = await users.findOne({ username });
      if (existing) return res.status(409).json({ message: 'That username is already taken. Please choose another.' });
      const user = {
        f_name: req.body.f_name.trim(),
        l_name: req.body.l_name.trim(),
        username,
        password: await hashPassword(req.body.password),
      };
      const result = await users.insertOne(user);
      user._id = result.insertedId;
      return res.status(201).json({ message: 'Account created successfully. You can now log in.', user: publicUser(user) });
    } catch (error) {
      // The unique index also prevents simultaneous signup requests from creating duplicates.
      if (error.code === 11000) return res.status(409).json({ message: 'That username is already taken. Please choose another.' });
      next(error);
    }
  });

  app.post('/login', async (req, res, next) => {
    if (!validFields(req.body, ['username', 'password'])) {
      return res.status(400).json({ message: 'Please provide a username and password within the field limits.' });
    }
    try {
      const user = await users.findOne({ username: req.body.username.trim().toLowerCase() });
      if (!user || !(await verifyPassword(req.body.password, user.password))) {
        return res.status(401).json({ message: 'Incorrect username or password. Please try again.' });
      }
      return res.json({ message: `Login successful. Welcome back, ${user.f_name}!`, user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  if (projects && memberships && client) app.use(createProjectRouter({ users, projects, memberships, stories, client }));
  if (projects && memberships && stories) app.use(createStoryRouter({ users, projects, memberships, stories }));

  app.use((_req, res) => res.status(404).json({ message: 'This endpoint was not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Please send valid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ message: 'The request is too large.' });
    logger.error('Request failed:', error.name || 'Error');
    return res.status(500).json({ message: 'A server or database error occurred. Please try again shortly.' });
  });
  return app;
}

module.exports = { createApp };
