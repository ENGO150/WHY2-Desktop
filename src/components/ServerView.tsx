import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Rss, XCircle } from 'lucide-react';
import LogDisplay, { LogEntry } from './LogDisplay';
import ModalPrompt from './ModalPrompt';

interface ServerPayload {
    event_type: string;
    content: string;
    username?: string;
    extra?: string;
    state_bool?: boolean;
}

interface ServerViewProps {
    serverAddress: string;
    onDisconnect: () => void;
}

function ServerView({ serverAddress, onDisconnect }: ServerViewProps) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [status, setStatus] = useState("Connected");

    // UI STATE: Only for Modal Configuration
    const [modalConfig, setModalConfig] = useState<{label: string, type: 'text'|'password'} | null>(null);

    useEffect(() => {
        const unlisten = listen<ServerPayload>('server-payload', (event) => {
            const p = event.payload;

            // 1. HANDLE UI CONTROLS (Prompt for Username)
            if (p.event_type === 'ui_control') {
                if (p.state_bool === true) {
                    setModalConfig({
                        label: p.content, // e.g., "Enter username:"
                        type: (p.extra as 'text' | 'password') || 'text'
                    });
                } else {
                    setModalConfig(null);
                }
                return;
            }

            // 2. HANDLE STATUS UPDATES (Header)
            if (p.event_type === 'status' && p.extra) {
                setStatus(p.extra);
                return;
            }

            // 3. HANDLE DISCONNECT
            if (p.event_type === 'error' && p.content.includes("Disconnected")) {
                onDisconnect();
                return;
            }

            // 4. HANDLE LOGS
            if (['info', 'message', 'error'].includes(p.event_type)) {
                 setLogs(prev => [...prev, {
                    type: p.event_type as any,
                    content: p.content,
                    username: p.username
                }]);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [onDisconnect]);

    const handleSendInput = async (value: string) => {
        try {
            // Send input to Rust backend
            await invoke('send_input', { text: value });
            // Close modal immediately after sending
            setModalConfig(null);
        } catch (err) {
            console.error("Failed to send:", err);
            setLogs(prev => [...prev, { type: 'error', content: `Error sending: ${err}` }]);
        }
    };

    return (
        <div className="server-view">
            {/* Modal for Username Input */}
            {modalConfig && (
                <ModalPrompt
                    label={modalConfig.label}
                    inputType={modalConfig.type}
                    onSubmit={handleSendInput}
                />
            )}

            {/* Header */}
            <header className="server-header">
                <div className="status-badge">
                    <Rss size={16} />
                    <span>{serverAddress}</span>
                </div>
                <div className="channel-indicator">{status}</div>
                <button onClick={onDisconnect} className="disconnect-btn">
                    <XCircle size={18} />
                </button>
            </header>

            {/* Console Area */}
            <main className="console-area">
                <LogDisplay logs={logs} />
            </main>

            {/* Footer / Input Area - Placeholder only for now */}
            <footer className="input-area">
                <div className="input-placeholder">
                    {modalConfig ? "Waiting for input..." : "Connected"}
                </div>
            </footer>
        </div>
    );
}

export default ServerView;
