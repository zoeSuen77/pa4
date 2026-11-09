import { useState } from 'react';
import { postForm } from '../api.js';
import { Feedback, PasswordField, TextField } from './FormFields.jsx';

const emptyForm = { f_name: '', l_name: '', username: '', password: '' };

export default function Signup({ onLogin }) {
  const [form, setForm] = useState(emptyForm);
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(false);
  const [createdUsername, setCreatedUsername] = useState('');

  function update(field) {
    return (event) => {
      setForm((previous) => ({ ...previous, [field]: event.target.value }));
      setFeedback(null);
      setCreatedUsername('');
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    if (Object.values(form).some((value) => !value.trim())) {
      setFeedback({ type: 'error', message: 'Please fill in your first name, last name, username, and password.' });
      return;
    }
    setPending(true);
    setFeedback(null);
    setCreatedUsername('');
    try {
      const data = await postForm('signup', form);
      setFeedback({ type: 'success', message: data.message });
      setCreatedUsername(data.user.username);
      setForm(emptyForm);
    } catch (error) {
      setFeedback({ type: 'error', message: error.message });
    } finally {
      setPending(false);
    }
  }

  return <>
    <header className="form-header"><p className="eyebrow">GET STARTED</p><h1>Create an account.</h1><p>A few details, and you’re ready to go.</p></header>
    <form noValidate onSubmit={handleSubmit} aria-label="Signup" aria-busy={pending}>
      <fieldset disabled={pending}>
        <div className="name-fields">
          <TextField label="First name" id="f_name" value={form.f_name} onChange={update('f_name')} autoComplete="given-name" placeholder="First name" maxLength={100} />
          <TextField label="Last name" id="l_name" value={form.l_name} onChange={update('l_name')} autoComplete="family-name" placeholder="Last name" maxLength={100} />
        </div>
        <TextField label="Username" id="username" value={form.username} onChange={update('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Choose a username" maxLength={64} aria-describedby="username-hint" />
        <p id="username-hint" className="field-hint">Usernames are unique and aren’t case-sensitive.</p>
        <PasswordField value={form.password} onChange={update('password')} autoComplete="new-password" />
        <Feedback feedback={feedback} />
        <button className="primary-button" type="submit">{pending ? 'Creating account…' : 'Create account'}<span aria-hidden="true">↗</span></button>
      </fieldset>
    </form>
    {createdUsername && <button className="success-link" onClick={() => onLogin(createdUsername)}>Continue to login <span aria-hidden="true">→</span></button>}
    <p className="form-switch">Already have an account? <button onClick={() => onLogin('')}>Log in</button></p>
  </>;
}
