import { useEffect, useId, useRef, useState } from 'react';
import { Feedback } from './FormFields.jsx';

const priorities = ['High', 'Medium', 'Low'];
const statuses = ['To Do', 'In Progress', 'Done'];
const fullName = (user) => [user?.f_name, user?.l_name].filter(Boolean).join(' ') || user?.username || 'Unknown member';

export default function StoryForm({ story, members, membersLoading, membersError, membersReady, pending, onSave, onCancel, onRetryMembers }) {
  const editing = Boolean(story);
  const prefix = useId();
  const firstInput = useRef(null);
  const [form, setForm] = useState(() => ({
    title: story?.title || '',
    description: story?.description || '',
    priority: story?.priority || 'Medium',
    status: story?.status || 'To Do',
    assigned_user_id: story?.assigned_user_id || '',
  }));
  const [feedback, setFeedback] = useState(null);

  useEffect(() => { firstInput.current?.focus(); }, []);

  useEffect(() => {
    if (membersReady && form.assigned_user_id && !members.some((member) => member._id === form.assigned_user_id)) {
      setForm((previous) => ({ ...previous, assigned_user_id: '' }));
      setFeedback({ type: 'error', message: 'The selected member is no longer in this project. This draft is now Unassigned; save to apply this change. Your other edits have been kept.' });
    }
  }, [members, membersReady, form.assigned_user_id]);

  function update(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
    setFeedback(null);
  }

  function submit(event) {
    event.preventDefault();
    if (pending || !membersReady) return;
    if (!form.title.trim() || !form.description.trim()) {
      setFeedback({ type: 'error', message: 'Please enter a nonblank story title and description.' });
      return;
    }
    if (!priorities.includes(form.priority) || (editing && !statuses.includes(form.status))) {
      setFeedback({ type: 'error', message: 'Please choose a valid priority and story status.' });
      return;
    }
    if (form.assigned_user_id && !members.some((member) => member._id === form.assigned_user_id)) {
      setFeedback({ type: 'error', message: 'Choose a current project member or Unassigned.' });
      return;
    }
    setFeedback(null);
    const values = {
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      assigned_user_id: form.assigned_user_id || null,
    };
    if (editing) values.status = form.status;
    onSave(values);
  }

  return <div className="story-form-panel">
    <h3>{editing ? 'Edit user story' : 'New user story'}</h3>
    <form aria-label={editing ? 'Edit user story' : 'Create user story'} onSubmit={submit} noValidate aria-busy={pending || membersLoading}>
      <fieldset disabled={pending}>
        <div className="story-form-grid">
          <div className="field story-title-field"><label htmlFor={`${prefix}-title`}>Story title</label><input ref={firstInput} id={`${prefix}-title`} name="title" value={form.title} onChange={update} placeholder="e.g. View campus event details" required /></div>
          <div className="field story-description-field"><label htmlFor={`${prefix}-description`}>Story description</label><textarea id={`${prefix}-description`} name="description" value={form.description} onChange={update} rows={3} placeholder="As a [type of user], I want [goal], so that [benefit]." aria-describedby={`${prefix}-description-hint`} required /><p id={`${prefix}-description-hint`} className="select-hint">As a [type of user], I want [goal], so that [benefit].</p></div>
          <div className="field"><label htmlFor={`${prefix}-priority`}>Priority</label><select id={`${prefix}-priority`} name="priority" value={form.priority} onChange={update} required>{priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></div>
          {editing && <div className="field"><label htmlFor={`${prefix}-status`}>Story status</label><select id={`${prefix}-status`} name="status" value={form.status} onChange={update} required>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div>}
          <div className="field"><label htmlFor={`${prefix}-assignee`}>Assigned member</label><select id={`${prefix}-assignee`} name="assigned_user_id" value={form.assigned_user_id} onChange={update} disabled={!membersReady}><option value="">Unassigned</option>{members.map((member) => <option key={member._id} value={member._id}>{fullName(member)}{member.username ? ` (@${member.username})` : ''}{member.is_lead ? ' · Project Lead' : ''}</option>)}</select></div>
        </div>
        {!editing && <p className="select-hint">New stories start as To Do. You can change their status after creating them.</p>}
        {membersLoading && <p className="loading-state" role="status">Loading current project members…</p>}
        {membersError && <div className="load-error"><Feedback feedback={{ type: 'error', message: membersError }} /><button className="secondary-button" type="button" onClick={onRetryMembers}>Retry members</button></div>}
        <Feedback feedback={feedback} />
        <div className="story-form-actions"><button className="primary-button compact-button" type="submit" disabled={!membersReady}>{pending ? 'Saving story…' : editing ? 'Save story' : 'Create story'}</button><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button></div>
      </fieldset>
    </form>
  </div>;
}
