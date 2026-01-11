import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Rss, XCircle } from 'lucide-react';
import LogDisplay, { LogEntry } from './LogDisplay';
import InputBar from './InputBar';

interface ServerPayload {
    event_type: string;
    content: string;
    username?: string;
    extra?: string;
    clear_count?: number;
}

interface ServerViewProps {
    serverAddress: string;
    onDisconnect: () => void;
}

function ServerView({ serverAddress, onDisconnect }: ServerViewProps) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [status, setStatus] = useState("Connected");

    useEffect(() => {
        const unlisten = listen<ServerPayload>('server-payload', (event) => {
            const p = event.payload;

            if (p.event_type === 'clear' || (p.clear_count && p.clear_count > 0)) {
                const count = p.clear_count || 0;
                setLogs(prev => prev.slice(0, Math.max(0, prev.length - count)));
                if (p.event_type === 'clear') return;
            }

            if (p.event_type === 'error' && p.content.includes("Disconnected")) {
                onDisconnect();
                return;
            }

            if (p.event_type === 'status' && p.extra) {
                setStatus(p.extra);
                return;
            }

            setLogs(prev => [...prev, {
                type: p.event_type as any,
                content: p.content,
                username: p.username
            }]);
        });

        return () => {
            unlisten.then(f => f());
        };
    }, [onDisconnect]);

    return (
        <div className="server-view">
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

            <main className="console-area">
                <LogDisplay logs={logs} />
            </main>

            <footer className="input-area">
                <InputBar />
            </footer>
        </div>
    );
}

export default ServerView;
