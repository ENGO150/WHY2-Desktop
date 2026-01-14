import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface InputBarProps {
    placeholder?: string;
    onSend: (text: string) => void;
}

// Interfaces matching the Rust DTOs
interface CommandArg {
    name: string;
    required: boolean;
}

interface CommandInfo {
    name: string;
    triggers: string[];
    args: CommandArg[];
    description: string;
}

function InputBar({ placeholder = "Enter message...", onSend }: InputBarProps) {
    const [value, setValue] = useState('');
    const [commandPrefix, setCommandPrefix] = useState('/');
    const [availableCommands, setAvailableCommands] = useState<CommandInfo[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [filteredCommands, setFilteredCommands] = useState<CommandInfo[]>([]);

    // Load commands from backend on component mount
    useEffect(() => {
        invoke<[string, CommandInfo[]]>('get_commands')
            .then(([prefix, commands]) => {
                setCommandPrefix(prefix);
                setAvailableCommands(commands);
            })
            .catch(console.error);
    }, []);

    // Handle input changes and command filtering
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setValue(newValue);

        // Check if input starts with the command prefix
        if (newValue.startsWith(commandPrefix)) {
            const searchText = newValue.slice(commandPrefix.length).toUpperCase();

            // Filter commands based on triggers
            const filtered = availableCommands.filter(cmd =>
                cmd.triggers.some(trigger => trigger.startsWith(searchText))
            );

            setFilteredCommands(filtered);
            setShowSuggestions(filtered.length > 0);
        } else {
            setShowSuggestions(false);
        }
    };

    // Handle key presses (Send on Enter, Close suggestions on Escape)
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (value.trim()) {
                e.preventDefault();
                onSend(value);
                setValue(''); // Clear input after sending
                setShowSuggestions(false);
            }
        }

        if (e.key === 'Escape') {
            setShowSuggestions(false);
        }
    };

    // Helper to insert command when clicked in the popup
    const selectCommand = (cmdName: string) => {
        setValue(`${commandPrefix}${cmdName.toLowerCase()} `);

        // Refocus the input
        const input = document.querySelector('.cmd-input') as HTMLInputElement;
        input?.focus();

        setShowSuggestions(false);
    };

    return (
        <div className="input-bar-container" style={{ position: 'relative' }}>
            {/* Suggestions Popup */}
            {showSuggestions && (
                <div className="suggestions-popup">
                    <table className="commands-table">
                        <thead>
                            <tr>
                                <th>Command</th>
                                <th>Arguments</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredCommands.map((cmd) => (
                                <tr
                                    key={cmd.name}
                                    onClick={() => selectCommand(cmd.name)}
                                    className="command-row"
                                >
                                    <td className="cmd-name">
                                        {commandPrefix}{cmd.name.toLowerCase()}
                                    </td>
                                    <td className="cmd-args">
                                        {cmd.args.map((arg, i) => (
                                            <span key={i} className={arg.required ? 'arg-req' : 'arg-opt'}>
                                                {arg.required ? `<${arg.name}>` : `[${arg.name}]`}
                                            </span>
                                        ))}
                                    </td>
                                    <td className="cmd-desc">{cmd.description}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <span className="input-prompt">{">>>"}</span>
            <input
                type="text"
                className="cmd-input"
                placeholder={placeholder}
                spellCheck={false}
                autoFocus
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
            />
        </div>
    );
}

export default InputBar;
