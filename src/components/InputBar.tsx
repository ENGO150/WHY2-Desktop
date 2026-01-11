import React, { useState } from 'react';

interface InputBarProps {
    placeholder?: string;
    onSend: (text: string) => void;
}

function InputBar({ placeholder = "Enter message...", onSend }: InputBarProps) {
    const [value, setValue] = useState('');

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && value.trim()) {
            e.preventDefault();
            onSend(value);
            setValue(''); // Clear input after sending
        }
    };

    return (
        <div className="input-bar-container">
            <span className="input-prompt">{">>>"}</span>
            <input
                type="text"
                className="cmd-input"
                placeholder={placeholder}
                spellCheck={false}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
            />
        </div>
    );
}

export default InputBar;
