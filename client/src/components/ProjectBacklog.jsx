import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { Feedback } from './FormFields.jsx';
import StoryForm from './StoryForm.jsx';

const fullName = (user) => [user?.f_name, user?.l_name].filter(Boolean).join(' ') || user?.username || 'Unknown member';
const statusClass = (status) => status.toLowerCase().replaceAll(' ', '-');

export default function ProjectBacklog({ project, membershipVersion = 0 }) {
  const projectId = project?._id;
  const headingId = useId();
  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(Boolean(projectId));
  const [storiesError, setStoriesError] = useState('');
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(Boolean(projectId));
  const [membersError, setMembersError] = useState('');
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [formTarget, setFormTarget] = useState(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const writing = useRef(false);
  const storyVersion = useRef(0);
  const memberVersion = useRef(0);
  const storyController = useRef(null);
  const memberController = useRef(null);
  const newStoryButton = useRef(null);

  const loadStories = useCallback(async () => {
    if (!projectId || writing.current) return;
    storyController.current?.abort();
    const controller = new AbortController();
    storyController.current = controller;
    const version = ++storyVersion.current;
    setStoriesLoading(true);
    setStoriesError('');
    try {
      const data = await apiRequest(`projects/${projectId}/stories`, { signal: controller.signal });
      if (mounted.current && version === storyVersion.current) setStories(data.stories);
    } catch (error) {
      if (mounted.current && version === storyVersion.current && error.name !== 'AbortError') setStoriesError(error.message);
    } finally {
      if (mounted.current && version === storyVersion.current) setStoriesLoading(false);
    }
  }, [projectId]);

  const loadMembers = useCallback(async () => {
    if (!projectId) return;
    memberController.current?.abort();
    const controller = new AbortController();
    memberController.current = controller;
    const version = ++memberVersion.current;
    setMembersLoading(true);
    setMembersError('');
    try {
      const data = await apiRequest(`projects/${projectId}/members`, { signal: controller.signal });
      if (mounted.current && version === memberVersion.current) {
        setMembers(data.members);
        setMembersLoaded(true);
      }
    } catch (error) {
      if (mounted.current && version === memberVersion.current && error.name !== 'AbortError') setMembersError(error.message);
    } finally {
      if (mounted.current && version === memberVersion.current) setMembersLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    mounted.current = true;
    loadStories();
    return () => {
      mounted.current = false;
      lifetime.current += 1;
      storyVersion.current += 1;
      memberVersion.current += 1;
      storyController.current?.abort();
      memberController.current?.abort();
    };
  }, [loadStories]);

  useEffect(() => { loadMembers(); }, [loadMembers, membershipVersion]);

  function openForm(story = null) {
    if (writing.current) return;
    setFeedback(null);
    loadMembers();
    setFormTarget(story ? { story } : { story: null });
  }

  function closeForm() {
    if (writing.current) return;
    setFormTarget(null);
    setFeedback(null);
    newStoryButton.current?.focus();
  }

  function beginWrite() {
    writing.current = true;
    setPending(true);
    setFeedback(null);
    // A GET started before this mutation must never overwrite its newer result.
    storyVersion.current += 1;
    storyController.current?.abort();
    setStoriesLoading(false);
    return lifetime.current;
  }

  const isCurrent = (version) => mounted.current && version === lifetime.current;

  async function saveStory(values) {
    if (writing.current || !formTarget) return;
    const editing = formTarget.story;
    const version = beginWrite();
    try {
      const data = await apiRequest(`projects/${projectId}/stories${editing ? `/${editing._id}` : ''}`, {
        method: editing ? 'PUT' : 'POST', values,
      });
      if (!isCurrent(version)) return;
      setStories((previous) => editing ? previous.map((story) => story._id === editing._id ? data.story : story) : [data.story, ...previous]);
      setFormTarget(null);
      setFeedback({ type: 'success', message: data.message });
    } catch (error) {
      if (isCurrent(version)) setFeedback({ type: 'error', message: error.message });
    } finally {
      if (isCurrent(version)) {
        writing.current = false;
        setPending(false);
      }
    }
  }

  async function deleteStory(story) {
    if (writing.current || !window.confirm(`Delete "${story.title}"? This cannot be undone.`)) return;
    const version = beginWrite();
    try {
      const data = await apiRequest(`projects/${projectId}/stories/${story._id}`, { method: 'DELETE' });
      if (!isCurrent(version)) return;
      setStories((previous) => previous.filter((item) => item._id !== story._id));
      setFormTarget((current) => current?.story?._id === story._id ? null : current);
      setFeedback({ type: 'success', message: data.message });
    } catch (error) {
      if (isCurrent(version)) setFeedback({ type: 'error', message: error.message });
    } finally {
      if (isCurrent(version)) {
        writing.current = false;
        setPending(false);
      }
    }
  }

  return <section className="backlog-panel" aria-labelledby={headingId} aria-busy={pending || storiesLoading}>
    <div className="backlog-heading"><div><p className="eyebrow">USER STORIES</p><h2 id={headingId}>Project backlog <span className="count-pill" aria-hidden="true">{storiesLoading ? '…' : stories.length}</span></h2>{project && <p className="backlog-project-name">{project.name}</p>}</div><div className="backlog-toolbar"><button className="secondary-button" onClick={loadStories} disabled={!projectId || pending || storiesLoading} aria-label="Refresh backlog">Refresh backlog</button><button ref={newStoryButton} className="primary-button compact-button" onClick={() => openForm()} disabled={!projectId || pending || storiesLoading || Boolean(storiesError)}>New story<span aria-hidden="true">+</span></button></div></div>
    {!project ? <p className="backlog-empty">Select a project to view its user stories.</p> : <>
      <Feedback feedback={feedback} />
      {formTarget && <StoryForm key={formTarget.story?._id || 'new'} story={formTarget.story} members={members} membersLoading={membersLoading} membersError={membersError} membersReady={membersLoaded && !membersLoading && !membersError} pending={pending} onSave={saveStory} onCancel={closeForm} onRetryMembers={loadMembers} />}
      {storiesLoading && <p className="loading-state" role="status">Loading user stories…</p>}
      {storiesError && <div className="load-error"><Feedback feedback={{ type: 'error', message: storiesError }} /><button className="secondary-button" onClick={loadStories} disabled={pending || storiesLoading}>Retry backlog</button></div>}
      {!storiesLoading && !storiesError && stories.length === 0 && <p className="backlog-empty">This project has no user stories yet. Create a story to start its backlog.</p>}
      {stories.length > 0 && <ul className="story-list" aria-label="User stories">{stories.map((story) => <li key={story._id}><article className="story-card" aria-label={story.title}>
        <div className="story-card-heading"><h3>{story.title}</h3><div className="story-actions"><button className="text-button" onClick={() => openForm(story)} disabled={pending} aria-label={`Edit ${story.title}`}>Edit</button><button className="remove-button" onClick={() => deleteStory(story)} disabled={pending} aria-label={`Delete ${story.title}`}>Delete</button></div></div>
        <p className="story-description">{story.description}</p>
        <dl className="story-meta"><div><dt className="story-meta-label">Priority</dt><dd><span className={`story-priority story-priority-${story.priority.toLowerCase()}`}>{story.priority}</span></dd></div><div><dt className="story-meta-label">Status</dt><dd><span className={`story-status story-status-${statusClass(story.status)}`}>{story.status}</span></dd></div><div><dt className="story-meta-label">Assigned member</dt><dd>{story.assigned_user_id ? <>{fullName(story.assigned_user)}{story.assigned_user?.username && <span className="story-username"> @{story.assigned_user.username}</span>}</> : 'Unassigned'}</dd></div></dl>
      </article></li>)}</ul>}
    </>}
  </section>;
}
