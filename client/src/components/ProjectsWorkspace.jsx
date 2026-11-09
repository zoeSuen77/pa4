import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, postForm } from '../api.js';
import { Feedback } from './FormFields.jsx';
import ProjectBacklog from './ProjectBacklog.jsx';

const emptyProject = { name: '', description: '', status: 'Planning', project_lead_id: '' };
const fullName = (user) => [user?.f_name, user?.l_name].filter(Boolean).join(' ') || user?.username || 'Unknown user';
const userLabel = (user) => `${fullName(user)} (@${user.username})`;

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><span aria-hidden="true" />{status}</span>;
}

function CreateProject({ users, onCreated, onCancel, onSignup }) {
  const [form, setForm] = useState(emptyProject);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const firstInput = useRef(null);

  useEffect(() => { firstInput.current?.focus(); }, []);

  function update(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setFeedback(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    if (!form.name.trim() || !form.description.trim() || !form.project_lead_id) {
      setFeedback({ type: 'error', message: 'Please enter a project name and description, and choose a project lead.' });
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      const data = await postForm('projects', form);
      onCreated(data.project, data.message);
    } catch (error) {
      setFeedback({ type: 'error', message: error.message });
      setPending(false);
    }
  }

  return <section className="create-panel" aria-labelledby="create-heading">
    <div className="section-heading"><div><p className="eyebrow">START SOMETHING TOGETHER</p><h2 id="create-heading">Create a project</h2></div><button className="text-button" onClick={onCancel} disabled={pending}>Cancel</button></div>
    {users.length === 0 ? <div className="empty-state"><p>Register a user first, then choose them as your project lead.</p><button className="secondary-button" onClick={onSignup}>Register a user</button></div> : <form aria-label="Create project" onSubmit={submit} noValidate aria-busy={pending}>
      <fieldset disabled={pending}>
        <div className="create-grid">
          <div className="field project-name-field"><label htmlFor="project-name">Project name</label><input ref={firstInput} id="project-name" name="name" value={form.name} onChange={update} maxLength={120} placeholder="e.g. Campus garden" required /></div>
          <div className="field"><label htmlFor="project-status">Status</label><select id="project-status" name="status" value={form.status} onChange={update}><option>Planning</option><option>Active</option><option>Completed</option></select></div>
          <div className="field project-description-field"><label htmlFor="project-description">Description</label><textarea id="project-description" name="description" value={form.description} onChange={update} maxLength={3000} rows={3} placeholder="What will your team work on?" required /></div>
          <div className="field project-lead-field"><label htmlFor="project-lead">Project lead</label><select id="project-lead" name="project_lead_id" value={form.project_lead_id} onChange={update} required aria-describedby="lead-hint"><option value="">Choose a registered user</option>{users.map((user) => <option key={user._id} value={user._id}>{userLabel(user)}</option>)}</select><p id="lead-hint" className="select-hint">The project lead automatically joins the team and stays a member.</p></div>
        </div>
        <Feedback feedback={feedback} />
        <div className="create-actions"><button className="primary-button compact-button" type="submit">{pending ? 'Creating project…' : 'Create project'}<span aria-hidden="true">↗</span></button></div>
      </fieldset>
    </form>}
  </section>;
}

function MembersPanel({ project, users, onChanged, onSignup }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [userId, setUserId] = useState('');
  const [pending, setPending] = useState(false);
  const version = useRef(0);
  const mounted = useRef(true);

  const loadMembers = useCallback(async (signal) => {
    const requestVersion = ++version.current;
    setLoading(true);
    setLoadError('');
    try {
      const data = await apiRequest(`projects/${project._id}/members`, { signal });
      if (mounted.current && requestVersion === version.current) setMembers(data.members);
    } catch (error) {
      if (mounted.current && requestVersion === version.current && error.name !== 'AbortError') setLoadError(error.message);
    } finally {
      if (mounted.current && requestVersion === version.current) setLoading(false);
    }
  }, [project._id]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    loadMembers(controller.signal);
    return () => { mounted.current = false; version.current += 1; controller.abort(); };
  }, [loadMembers]);

  async function changeMember(method, memberId) {
    if (pending) return;
    if (!memberId) {
      setFeedback({ type: 'error', message: 'Please choose a registered user to add.' });
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      const data = await apiRequest(`projects/${project._id}/members${method === 'DELETE' ? `/${memberId}` : ''}`, {
        method, values: method === 'POST' ? { user_id: memberId } : undefined,
      });
      if (!mounted.current) { onChanged(); return; }
      setFeedback({ type: 'success', message: data.message });
      if (method === 'POST') setUserId('');
      await loadMembers();
      onChanged();
    } catch (error) {
      if (mounted.current) setFeedback({ type: 'error', message: error.message });
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return <section className="member-panel" aria-labelledby="selected-project-title" aria-busy={pending}>
    <div className="project-detail">
      <div className="detail-topline"><span className="eyebrow">PROJECT DETAILS</span><StatusBadge status={project.status} /></div>
      <h2 id="selected-project-title">{project.name}</h2>
      <p className="project-description">{project.description}</p>
      <div className="lead-summary"><span className="person-avatar" aria-hidden="true">{fullName(project.project_lead).slice(0, 1)}</span><div><span>Project lead</span><strong>{fullName(project.project_lead)}</strong></div></div>
    </div>
    <div className="members-content">
      <div className="section-heading"><div><h3>People on this project <span className="count-pill">{loading ? '…' : members.length}</span></h3><p>Make room for great ideas.</p></div><button className="text-button" disabled={loading || pending} onClick={() => { loadMembers(); onChanged(); }} aria-label="Refresh members">Refresh</button></div>
      {loading ? <p className="loading-state" role="status">Loading members…</p> : loadError ? <div className="load-error"><Feedback feedback={{ type: 'error', message: loadError }} /><button className="secondary-button" onClick={() => loadMembers()}>Retry members</button></div> : <ul className="member-list" aria-label="Project members">{members.map((member) => <li key={member._id}>
        <span className="person-avatar" aria-hidden="true">{fullName(member).slice(0, 1)}</span><div className="member-identity"><strong>{fullName(member)}</strong><span>@{member.username}</span></div>
        {member.is_lead ? <span className="lead-badge" title="The project lead cannot be removed">Lead · protected</span> : <button className="remove-button" onClick={() => changeMember('DELETE', member._id)} disabled={pending} aria-label={`Remove ${fullName(member)}`}>Remove</button>}
      </li>)}</ul>}
      <div className="add-member-area">
        <form onSubmit={(event) => { event.preventDefault(); changeMember('POST', userId); }} aria-label="Add project member" noValidate>
          <label htmlFor="add-user">Add a registered user</label>
          <div className="add-member-controls"><select id="add-user" value={userId} onChange={(event) => { setUserId(event.target.value); setFeedback(null); }} disabled={pending || !users.length} required><option value="">Choose a person</option>{users.map((user) => <option key={user._id} value={user._id}>{userLabel(user)}</option>)}</select><button className="primary-button compact-button" type="submit" disabled={pending || !users.length}>{pending ? 'Saving…' : 'Add member'}<span aria-hidden="true">+</span></button></div>
          <p className="select-hint">People can join several projects. Each person can join this project once.</p>
        </form>
        <Feedback feedback={feedback} />
        {!users.length && <button className="success-link" onClick={onSignup}>Register a user</button>}
      </div>
    </div>
  </section>;
}

export default function ProjectsWorkspace({ onLogin, onSignup }) {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [membershipVersion, setMembershipVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const version = useRef(0);
  const newProjectButton = useRef(null);

  const refresh = useCallback(async (signal, quiet = false) => {
    const requestVersion = ++version.current;
    if (!quiet) setLoading(true);
    setError('');
    setRefreshError('');
    try {
      const [userData, projectData] = await Promise.all([apiRequest('users', { signal }), apiRequest('projects', { signal })]);
      if (requestVersion !== version.current) return;
      setUsers(userData.users);
      setProjects(projectData.projects);
      setSelectedId((current) => projectData.projects.some((project) => project._id === current) ? current : projectData.projects[0]?._id || '');
    } catch (failure) {
      if (requestVersion === version.current && failure.name !== 'AbortError') {
        if (quiet) setRefreshError(failure.message);
        else setError(failure.message);
      }
    } finally {
      if (requestVersion === version.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => { version.current += 1; controller.abort(); };
  }, [refresh]);

  function closeCreate() {
    setCreating(false);
    newProjectButton.current?.focus();
  }

  function created(project, message) {
    setProjects((previous) => [project, ...previous]);
    setSelectedId(project._id);
    setFeedback({ type: 'success', message });
    closeCreate();
    refresh(undefined, true);
  }

  function membershipsChanged() {
    setMembershipVersion((current) => current + 1);
    refresh(undefined, true);
  }

  const selected = projects.find((project) => project._id === selectedId);

  return <main className="workspace-shell">
    <header className="workspace-header"><a className="brand" href="#login" aria-label="Campus home"><span className="brand-mark" aria-hidden="true">c</span>campus<span className="brand-dot">.</span></a><nav className="view-switch" aria-label="Campus navigation"><button onClick={() => onLogin()}>Log in</button><button onClick={onSignup}>Sign up</button><button aria-current="page">Projects</button></nav></header>
    <section className="workspace-hero" aria-labelledby="workspace-title"><div><p className="small-tag">YOUR SHARED WORKSPACE</p><h1 id="workspace-title">Good things start<br />with a team.</h1><p>A home for your projects and the people who make them happen.</p></div><div className="hero-aside"><span className="hero-spark" aria-hidden="true">✳</span><span className="project-total">{loading ? '—' : String(projects.length).padStart(2, '0')}</span><span>projects, endless possibilities</span></div></section>
    <div className="workspace-body">
      <div className="workspace-toolbar"><div><p className="eyebrow">BUILD SOMETHING GOOD</p><h2>Projects <span className="count-pill">{projects.length}</span></h2></div><div className="toolbar-actions"><button className="secondary-button" onClick={() => refresh()} disabled={loading} aria-label="Refresh projects">Refresh</button><button ref={newProjectButton} className="primary-button compact-button" disabled={loading || creating || !!error} onClick={() => { setCreating(true); setFeedback(null); }}>New project<span aria-hidden="true">+</span></button></div></div>
      <Feedback feedback={feedback} />
      {error && <div className="load-error workspace-error"><Feedback feedback={{ type: 'error', message: error }} /><button className="secondary-button" onClick={() => refresh()}>Retry workspace</button></div>}
      {refreshError && <div className="load-error workspace-error"><Feedback feedback={{ type: 'error', message: `Could not refresh project details: ${refreshError}` }} /><button className="secondary-button" onClick={() => refresh(undefined, true)}>Retry project details</button></div>}
      {creating && <CreateProject users={users} onCreated={created} onCancel={closeCreate} onSignup={onSignup} />}
      {loading ? <div className="workspace-loading" role="status">Gathering your projects and people…</div> : !error && projects.length === 0 ? <>
        <section className="empty-projects"><span className="empty-symbol" aria-hidden="true">✳</span><h2>Your next idea belongs here.</h2><p>Create your first project, choose a lead, and bring your team together.</p>{!creating && <button className="secondary-button" onClick={() => setCreating(true)}>Create your first project <span aria-hidden="true">↗</span></button>}</section>
        <ProjectBacklog project={null} />
      </> : !error && <div className="project-columns">
        <section className="project-list-panel" aria-label="All projects">
          <div className="list-heading"><span>ALL PROJECTS</span><span>{projects.length}</span></div>
          <ul className="project-list">{projects.map((project) => <li key={project._id}>
            <button className={`project-card ${project._id === selectedId ? 'is-selected' : ''}`} onClick={() => { setSelectedId(project._id); setFeedback(null); }} aria-pressed={project._id === selectedId} aria-label={`View project ${project.name}`}>
              <div className="project-card-top"><StatusBadge status={project.status} /><span className="project-arrow" aria-hidden="true">↗</span></div>
              <h3>{project.name}</h3><p>{project.description}</p>
              <div className="project-card-footer"><span>Led by <strong>{fullName(project.project_lead)}</strong></span><span>{project.member_count ?? 1} {(project.member_count ?? 1) === 1 ? 'person' : 'people'}</span></div>
            </button>
          </li>)}</ul>
        </section>
        {selected && <div className="selected-project-content">
          <ProjectBacklog key={`backlog-${selected._id}`} project={selected} membershipVersion={membershipVersion} />
          <MembersPanel key={`members-${selected._id}`} project={selected} users={users} onChanged={membershipsChanged} onSignup={onSignup} />
        </div>}
      </div>}
    </div>
    <footer className="workspace-footer"><span>ICSI 418Y · PA4</span><span>A little connection goes a long way.</span></footer>
  </main>;
}
