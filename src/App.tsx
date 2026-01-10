import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './App.css';
import { Server, ArrowRight, Shield, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

function App() {
  const [serverAddress, setServerAddress] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // UI stavy
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState('Connecting');
  const [isConnected, setIsConnected] = useState(false);

  // Animace teček
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingText(prev => prev.length >= 13 ? 'Connecting' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      // Volání Rust backendu
      await invoke('try_connect', { address: serverAddress });

      // Úspěch
      setIsConnected(true);
      console.log("Connection established, background listener running.");

    } catch (err) {
      // Chyba
      console.error("Failed:", err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  // Obrazovka po úspěšném připojení
  if (isConnected) {
    return (
      <div className="container">
        <div className="bg-grid" />
        <main className="login-card center-content">
          <div className="icon-badge success">
            <CheckCircle2 size={32} color="#22c55e" />
          </div>
          <div>
            <h1 className="title">Connected</h1>
            <p className="subtitle">Secure link established to <span style={{ fontFamily: 'JetBrains Mono', color: 'white' }}>{serverAddress}</span></p>
          </div>
          <div style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            width: '100%',
            fontFamily: 'JetBrains Mono',
            fontSize: '0.8rem',
            color: 'var(--text-secondary)'
          }}>
            <span style={{ color: '#22c55e', marginRight: '8px' }}>●</span>
            Listening for incoming transmissions...
          </div>
        </main>
      </div>
    );
  }

  // Obrazovka přihlášení
  return (
    <div className="container">
      <div className="bg-grid" />

      <main className="login-card">
        {/* Header */}
        <div className="header">
          <div className="icon-badge">
            <Shield size={24} className="icon-primary" />
          </div>
          <div>
            <h1 className="title">Connect to Server</h1>
            <p className="subtitle">Enter the host address to continue.</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleConnect} className="form">
          <div className={`input-container ${isFocused ? 'focused' : ''} ${error ? 'input-error' : ''}`}>
            <div className="input-icon-wrapper">
              <Server size={18} className="text-secondary" />
            </div>

            <input
              type="text"
              placeholder="e.g. 127.0.0.1:8080"
              value={serverAddress}
              onChange={(e) => {
                setServerAddress(e.target.value);
                if (error) setError(null);
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className="input-field"
              autoFocus
              disabled={isLoading}
              spellCheck={false}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="error-message">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={!serverAddress || isLoading}>
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span className="fixed-width-text">{loadingText}</span>
              </>
            ) : (
              <>
                <span>Connect</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;
