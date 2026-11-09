import { useState } from 'react';

export function TextField({ label, id, ...props }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <input id={id} name={id} required {...props} />
  </div>;
}

export function PasswordField({ value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return <div className="field">
    <label htmlFor="password">Password</label>
    <div className="password-input">
      <input id="password" name="password" type={visible ? 'text' : 'password'}
        value={value} onChange={onChange} autoComplete={autoComplete}
        placeholder="Enter your password" maxLength={1024} required />
      <button className="reveal-button" type="button" aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button>
    </div>
  </div>;
}

export function Feedback({ feedback }) {
  if (!feedback) return null;
  return <div className={`feedback ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
    <span className="feedback-symbol" aria-hidden="true">{feedback.type === 'error' ? '!' : '✓'}</span>
    <p>{feedback.message}</p>
  </div>;
}
