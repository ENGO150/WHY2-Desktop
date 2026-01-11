import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Rss, XCircle } from 'lucide-react';
import LogDisplay, { LogEntry } from './LogDisplay';
import InputBar from './InputBar';
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

    // UI STATES
    const [modalConfig, setModalConfig] = useState<{label: string, type: 'text'|'password'} | null>(null);
    const [isChatActive, setIsChatActive] = useState(false);

    useEffect(() => {
        const unlisten = listen<ServerPayload>('server-payload', (event) => {
            const p = event.payload;

            // 1. HANDLE UI CONTROLS
            if (p.event_type === 'ui_control') {
                // Check if this is a command to enable chat
                if (p.content === 'chat_input' && p.state_bool === true) {
                    setIsChatActive(true);
                    setModalConfig(null); // Ensure modal is closed
                    return;
                }

                // Otherwise, it's a modal request (Username/Password)
                if (p.state_bool === true) {
                    setModalConfig({
                        label: p.content,
                        type: (p.extra as 'text' | 'password') || 'text'
                    });
                } else {
                    setModalConfig(null);
                }
                return;
            }

            // 2. HANDLE STATUS UPDATES
            if (p.event_type === 'status' && p.extra) {
                setStatus(p.extra);
                return;
            }

            // 3. HANDLE DISCONNECT
            if (p.event_type === 'error' && p.content.includes("Disconnected")) {
                onDisconnect();
                return;
            }

            // 4. HANDLE LOGS & MESSAGES
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
            await invoke('send_input', { text: value });
            // If we are still in modal mode (auth), close it optimistically
            if (modalConfig) setModalConfig(null);
        } catch (err) {
            console.error("Failed to send:", err);
            setLogs(prev => [...prev, { type: 'error', content: `Error sending: ${err}` }]);
        }
    };

    return (
        <div className="server-view">
            {/* Modal for Auth */}
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

            {/* Footer / Input Area */}
            <footer className="input-area">
                {isChatActive ? (
                    <InputBar onSend={handleSendInput} />
                ) : (
                    <div className="input-placeholder">
                        {modalConfig ? "Waiting for input..." : "Authenticating..."}
                    </div>
                )}
            </footer>
        </div>
    );
}

export default ServerView;
