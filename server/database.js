async function initializeCollections(db, { usersCollection = 'Users' } = {}) {
  // Create namespaces before the first transaction, even for an empty database.
  const names = [usersCollection, 'Projects', 'ProjectMemberships', 'UserStories'];
  for (const name of names) {
    try {
      await db.createCollection(name);
    } catch (error) {
      if (error.code !== 48) throw error; // NamespaceExists is safe on later starts.
    }
  }
  const users = db.collection(usersCollection);
  const projects = db.collection('Projects');
  const memberships = db.collection('ProjectMemberships');
  const stories = db.collection('UserStories');
  await users.createIndex({ username: 1 }, { unique: true });
  await memberships.createIndex({ project_id: 1, user_id: 1 }, { unique: true });
  await stories.createIndex({ project_id: 1 });
  await stories.createIndex({ project_id: 1, assigned_user_id: 1 });
  return { users, projects, memberships, stories };
}

module.exports = { initializeCollections };
