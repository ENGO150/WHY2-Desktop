import { useEffect, useRef } from 'react';

export interface LogEntry {
    type: 'message' | 'info' | 'error' | 'status';
    content: string;
    username?: string;
}

interface LogDisplayProps {
    logs: LogEntry[];
}

function LogDisplay({ logs }: LogDisplayProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    return (
        <div className="log-container">
            {logs.map((log, i) => (
                <div key={i} className={`log-entry ${log.type}`}>
                    {log.username && (
                        <span className="log-username">[{log.username}]: </span>
                    )}
                    <span className="log-content">{log.content}</span>
                </div>
            ))}
            <div ref={bottomRef} />
        </div>
    );
}

export default LogDisplay;
