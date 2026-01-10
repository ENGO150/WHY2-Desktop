import { useState } from 'react';
import './App.css';
import { Server, ArrowRight, Shield } from 'lucide-react';

function App() {
  const [serverAddress, setServerAddress] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverAddress) return;
    console.log(`CONNECTING TO: ${serverAddress}`);
  };

  return (
    <div className="container">
      <div className="bg-grid" />

      <main className="login-card">
        {/* HEADER */}
        <div className="header">
          <div className="icon-badge">
            <Shield size={24} className="icon-primary" />
          </div>
          <div>
            <h1 className="title">Connect to Server</h1>
            <p className="subtitle">Enter the host address to continue.</p>
          </div>
        </div>

        {/* FORM */}
        <form onSubmit={handleConnect} className="form">
          <div className={`input-container ${isFocused ? 'focused' : ''}`}>
            <div className="input-icon-wrapper">
              <Server size={18} className="text-secondary" />
            </div>

            <input
              type="text"
              placeholder="e.g. 192.168.1.50:8080"
              value={serverAddress}
              onChange={(e) => setServerAddress(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className="input-field"
              autoFocus
              spellCheck={false}
            />
          </div>

          <button type="submit" className="submit-btn" disabled={!serverAddress}>
            <span>Connect</span>
            <ArrowRight size={16} />
          </button>
        </form>
      </main>

      {/* STYLES */}
      <style>{`
        .container {
          height: 100vh;
          width: 100vw;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .login-card {
          width: 100%;
          max-width: 400px;
          background: var(--card-bg);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 2rem;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        }

        .header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 2rem;
        }

        .icon-badge {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(217, 70, 239, 0.1); /* Low opacity primary */
          border-radius: 12px;
          border: 1px solid rgba(217, 70, 239, 0.15);
        }

        .icon-primary {
          color: var(--primary);
        }

        .title {
          font-size: 1.125rem;
          font-weight: 600;
          margin: 0;
          color: var(--text-primary);
        }

        .subtitle {
          font-size: 0.875rem;
          color: var(--text-secondary);
          margin: 4px 0 0 0;
        }

        .form {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }

        .input-container {
          position: relative;
          display: flex;
          align-items: center;
          background: var(--input-bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .input-container.focused {
          border-color: var(--primary);
          box-shadow: 0 0 0 1px var(--primary);
        }

        .input-icon-wrapper {
          padding-left: 12px;
          display: flex;
          align-items: center;
          pointer-events: none;
        }

        .text-secondary {
          color: var(--text-secondary);
        }

        .input-field {
          width: 100%;
          background: transparent;
          border: none;
          padding: 12px;
          color: var(--text-primary);
          font-family: 'JetBrains Mono', monospace; /* Monospace for IPs/URLs is standard */
          font-size: 0.9rem;
          outline: none;
        }

        .input-field::placeholder {
          color: #52525b;
        }

        .submit-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: var(--primary);
          color: white;
          border: none;
          padding: 10px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 0.9rem;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .submit-btn:hover:not(:disabled) {
          background: var(--primary-hover);
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}

export default App;
