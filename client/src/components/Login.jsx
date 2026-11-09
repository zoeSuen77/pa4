import { useState } from 'react';
import { postForm } from '../api.js';
import { Feedback, PasswordField, TextField } from './FormFields.jsx';

export default function Login({ initialUsername, onSignup, onProjects }) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    if (!username.trim() || !password.trim()) {
      setFeedback({ type: 'error', message: 'Please enter your username and password.' });
      return;
    }
    setPending(true);
    setFeedback(null);
    try {
      const data = await postForm('login', { username, password });
      setFeedback({ type: 'success', message: data.message });
      setPassword('');
    } catch (error) {
      setFeedback({ type: 'error', message: error.message });
    } finally {
      setPending(false);
    }
  }

  return <>
    <header className="form-header"><p className="eyebrow">YOUR CAMPUS ACCOUNT</p><h1>Welcome back.</h1><p>Enter your details to log in to your account.</p></header>
    <form noValidate onSubmit={handleSubmit} aria-label="Login" aria-busy={pending}>
      <fieldset disabled={pending}>
        <TextField label="Username" id="username" value={username} onChange={(event) => { setUsername(event.target.value); setFeedback(null); }} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter your username" maxLength={64} />
        <PasswordField value={password} onChange={(event) => { setPassword(event.target.value); setFeedback(null); }} autoComplete="current-password" />
        <Feedback feedback={feedback} />
        <button className="primary-button" type="submit">{pending ? 'Logging in…' : 'Log in'}<span aria-hidden="true">↗</span></button>
      </fieldset>
    </form>
    {feedback?.type === 'success' && <button className="success-link" onClick={onProjects}>Continue to projects <span aria-hidden="true">→</span></button>}
    <p className="form-switch">New here? <button onClick={onSignup}>Create an account</button></p>
  </>;
}
