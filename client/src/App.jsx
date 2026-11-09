import { useEffect, useState } from 'react';
import Login from './components/Login.jsx';
import Signup from './components/Signup.jsx';
import ProjectsWorkspace from './components/ProjectsWorkspace.jsx';

export default function App() {
  const [view, setView] = useState(window.location.hash === '#projects' ? 'projects' : 'login');
  const [initialUsername, setInitialUsername] = useState('');

  function showLogin(username = '') {
    setInitialUsername(username);
    changeView('login');
  }

  function changeView(nextView) {
    setView(nextView);
    window.location.hash = nextView;
  }

  useEffect(() => {
    const followHash = () => setView(['projects', 'signup'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'login');
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  if (view === 'projects') return <ProjectsWorkspace onLogin={showLogin} onSignup={() => changeView('signup')} />;

  return <main className="app-shell">
    <aside className="intro-panel" aria-label="Welcome to Campus">
      <a className="brand" href="/" aria-label="Campus home"><span className="brand-mark" aria-hidden="true">c</span>campus<span className="brand-dot">.</span></a>
      <div className="intro-copy"><span className="small-tag">A SPACE TO BEGIN</span><h2>Make yourself<br />at home.</h2><p>Your account is the first step.<br />Let’s get you settled in.</p></div>
      <div className="arch-art" aria-hidden="true"><div className="arch arch-back" /><div className="arch arch-front" /><div className="art-orbit" /><span className="art-star">✳</span></div>
      <p className="intro-footer"><span className="footer-dot" /> A little connection goes a long way.</p>
    </aside>
    <section className="account-panel" aria-label="Account access">
      <nav className="view-switch" aria-label="Choose account form">
        <button aria-current={view === 'login' ? 'page' : undefined} onClick={() => showLogin()}>Log in</button>
        <button aria-current={view === 'signup' ? 'page' : undefined} onClick={() => changeView('signup')}>Sign up</button>
        <button onClick={() => changeView('projects')}>Projects</button>
      </nav>
      <div className="form-container">
        {view === 'login' ? <Login initialUsername={initialUsername} onSignup={() => changeView('signup')} onProjects={() => changeView('projects')} /> : <Signup onLogin={showLogin} />}
      </div>
      <footer className="account-footer"><span>ICSI 418Y</span><span>PA4 · Projects & Stories</span></footer>
    </section>
  </main>;
}
