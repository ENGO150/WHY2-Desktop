import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Server, ArrowRight, Shield, AlertCircle, Loader2 } from 'lucide-react';

interface ConnectFormProps {
    onConnect: (address: string) => void;
}

function ConnectForm({ onConnect }: ConnectFormProps) {
  const [addressInput, setAddressInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState('Connecting');

  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setLoadingText(prev => prev.length >= 13 ? 'Connecting' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressInput) return;

    setIsLoading(true);
    setError(null);

    try {
      await invoke('try_connect', { address: addressInput });
      onConnect(addressInput);
    } catch (err) {
      console.error("Failed:", err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
      <main className="login-card">
        <div className="header">
          <div className="icon-badge">
            <Shield size={24} className="icon-primary" />
          </div>
          <div>
            <h1 className="title">Connect to Server</h1>
            <p className="subtitle">Enter the host address to continue.</p>
          </div>
        </div>

        <form onSubmit={handleConnect} className="form">
          <div className={`input-container ${isFocused ? 'focused' : ''} ${error ? 'input-error' : ''}`}>
            <div className="input-icon-wrapper">
              <Server size={18} className="text-secondary" />
            </div>

            <input
              type="text"
              placeholder="e.g. 127.0.0.1:8080"
              value={addressInput}
              onChange={(e) => {
                setAddressInput(e.target.value);
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

          {error && (
            <div className="error-message">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={!addressInput || isLoading}>
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
  );
}

export default ConnectForm;
