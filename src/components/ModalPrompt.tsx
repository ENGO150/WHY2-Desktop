import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';

interface ModalPromptProps {
    label: string;
    inputType: 'text' | 'password';
    onSubmit: (value: string) => void;
}

function ModalPrompt({ label, inputType, onSubmit }: ModalPromptProps) {
    const [value, setValue] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (value) onSubmit(value);
    };

    return (
        <div className="modal-overlay">
            <div className="modal-card">
                <h3 className="modal-title">{label}</h3>
                <form onSubmit={handleSubmit} className="modal-form">
                    <div className="input-container focused">
                        <input
                            type={inputType}
                            className="input-field"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            autoFocus
                            placeholder="Type here..."
                            spellCheck={false}
                        />
                    </div>
                    <button type="submit" className="submit-btn small-btn">
                        <ArrowRight size={18} />
                    </button>
                </form>
            </div>
        </div>
    );
}

export default ModalPrompt;
