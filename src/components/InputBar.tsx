interface InputBarProps {
    placeholder?: string;
}

function InputBar({ placeholder = "Enter message..." }: InputBarProps) {
    return (
        <div className="input-bar-container">
            <span className="input-prompt">{">>>"}</span>
            <input
                type="text"
                className="cmd-input"
                placeholder={placeholder}
                spellCheck={false}
                autoFocus
            />
        </div>
    );
}

export default InputBar;
