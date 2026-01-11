import { useEffect, useRef } from 'react';
import { AlertTriangle, Info, ShieldCheck } from 'lucide-react';

export interface LogEntry {
    type: 'message' | 'info' | 'error' | 'status' | 'ui_control';
    content: string;
    username?: string;
}

interface LogDisplayProps {
    logs: LogEntry[];
}

// Helper to generate a consistent color from a string (username)
const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
};

// Helper to get initials
const getInitials = (name: string) => name.substring(0, 2).toUpperCase();

function LogDisplay({ logs }: LogDisplayProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Smooth scroll to bottom on new log
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="chat-container">
            {logs.map((log, i) => {
                const prevLog = logs[i - 1];

                // Check if this message continues the previous one (same user, message type)
                const isContinuation =
                    prevLog &&
                    prevLog.type === 'message' &&
                    log.type === 'message' &&
                    prevLog.username === log.username;

                // 1. SYSTEM MESSAGES (Info, Error, Status)
                if (log.type !== 'message') {
                    return (
                        <div key={i} className={`system-message ${log.type}`}>
                            <div className="system-icon">
                                {log.type === 'error' && <AlertTriangle size={14} />}
                                {log.type === 'info' && <Info size={14} />}
                                {log.type === 'status' && <ShieldCheck size={14} />}
                            </div>
                            <span className="system-content">{log.content}</span>
                        </div>
                    );
                }

                // 2. CHAT MESSAGES
                return (
                    <div
                        key={i}
                        className={`chat-message ${isContinuation ? 'continuation' : 'full'}`}
                    >
                        {/* Avatar Column */}
                        <div className="msg-avatar-col">
                            {!isContinuation && (
                                <div
                                    className="user-avatar"
                                    style={{ backgroundColor: stringToColor(log.username || "Anon") }}
                                >
                                    {getInitials(log.username || "?")}
                                </div>
                            )}
                        </div>

                        {/* Content Column */}
                        <div className="msg-content-col">
                            {!isContinuation && (
                                <div className="msg-header">
                                    <span className="msg-username">{log.username || "Unknown"}</span>
                                </div>
                            )}
                            <div className="msg-text">
                                {log.content}
                            </div>
                        </div>
                    </div>
                );
            })}
            <div ref={bottomRef} />
        </div>
    );
}

export default LogDisplay;
