// Reference values for restoring the planned recording state.
const demoUsers = [
  { f_name: 'Alex', l_name: 'Chen', username: 'alex_chen' },
  { f_name: 'Maya', l_name: 'Patel', username: 'maya_patel' },
  { f_name: 'Sam', l_name: 'Rivera', username: 'sam_rivera' },
];
const demoProjects = [
  { key: 'A', name: 'PA4 Campus Planner', description: 'Plan campus events, coordinate organizers, and help students find activities.', status: 'Planning', lead: 'alex_chen', members: ['alex_chen', 'maya_patel', 'sam_rivera'] },
  { key: 'B', name: 'PA4 Study Together', description: 'Connect classmates through study groups and shared learning opportunities.', status: 'Active', lead: 'maya_patel', members: ['maya_patel'] },
];
const demoStories = [
  { key: 'S1', project: 'A', title: 'View campus event details', description: 'As a student, I want to view campus event details, so that I can decide whether to attend.', priority: 'High', status: 'To Do', assignee: 'alex_chen' },
  { key: 'S2', project: 'A', title: 'Publish event schedule', description: 'As an organizer, I want to publish the event schedule, so that students can plan their visits.', priority: 'Medium', status: 'Done', assignee: 'sam_rivera' },
  { key: 'S3', project: 'A', title: 'Filter campus events', description: 'As a student, I want to filter campus events by category, so that I can find activities that interest me.', priority: 'Low', status: 'In Progress', assignee: null },
  { key: 'S4', project: 'B', title: 'Create study groups', description: 'As a student, I want to create study groups, so that I can learn with classmates.', priority: 'High', status: 'In Progress', assignee: 'maya_patel' },
  { key: 'S5', project: 'B', title: 'View study group details', description: 'As a student, I want to view study group details, so that I can choose a suitable group.', priority: 'Low', status: 'Done', assignee: null },
  { key: 'S6', project: 'A', title: 'Remove outdated event notice', description: 'As an organizer, I want to remove outdated event notices, so that students see current information.', priority: 'Low', status: 'To Do', assignee: null },
];
module.exports = { demoUsers, demoProjects, demoStories, demoPassword: 'CampusDemo123!' };
