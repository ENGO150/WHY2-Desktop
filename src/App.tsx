import { useState, useEffect, useRef } from "react";
import { Server, ArrowRight, User, Lock, Send } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./index.css";

type UIState = "server_select" | "username_prompt" | "password_prompt" | "connected";

interface ChatMessage {
  username: string;
  text: string;
  id: number;
  username_color?: number;
  message_color?: number;
}

function getAnsiColor(code?: number) {
  if (code === undefined || code === null) return undefined;
  switch (code) {
    case 0: return "#000000"; // Black
    case 1: return "#800000"; // DarkRed
    case 2: return "#008000"; // DarkGreen
    case 3: return "#808000"; // DarkYellow
    case 4: return "#000080"; // DarkBlue
    case 5: return "#800080"; // DarkMagenta
    case 6: return "#008080"; // DarkCyan
    case 7: return "#c0c0c0"; // Grey
    case 8: return "#808080"; // DarkGrey
    case 9: return "#ff0000"; // Red
    case 10: return "#00ff00"; // Green
    case 11: return "#ffff00"; // Yellow
    case 12: return "#0000ff"; // Blue
    case 13: return "#ff00ff"; // Magenta
    case 14: return "#00ffff"; // Cyan
    case 15: return "#ffffff"; // White
    default: return undefined;
  }
}

function App() {
  const [uiState, setUiState] = useState<UIState>("server_select");
  const [inputValue, setInputValue] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [serverName, setServerName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showSpamWarning, setShowSpamWarning] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const unlisten = listen<string>("why2-event", (event) => {
      const payload = event.payload;
      setConnecting(false);

      if (payload.startsWith("RequestUsername:")) {
        const disabledRegistration = payload.split(":")[1] === "true";
        setUiState("username_prompt");
        setInputValue("");
        if (disabledRegistration) {
          setErrorMsg((prev) => prev ? prev : "Registration is disabled on this server. Login only.");
        }
      } else if (payload === "Register" || payload === "Login") {
        setUiState("password_prompt");
        setInputValue("");
      } else if (payload.startsWith("Connected:")) {
        setServerName(payload.split(":")[1] || "Unknown");
      } else if (payload === "UsernameRejected") {
        setUiState("username_prompt");
        setErrorMsg("Username rejected by server.");
      } else if (payload.startsWith("PasswordRejected:")) {
        setUiState("password_prompt");
        setErrorMsg(`Password rejected! Min length: ${payload.split(":")[1]}`);
      } else if (payload === "Authenticated") {
        setUiState("connected");
      } else if (payload === "Quit") {
        setUiState("server_select");
        setErrorMsg("Disconnected from server.");
        setInputValue("");
      } else if (payload === "SpamWarning") {
        setShowSpamWarning(true);
        setTimeout(() => setShowSpamWarning(false), 3000);
      } else if (payload.startsWith("Message:")) {
        try {
          const jsonStr = payload.substring("Message:".length);
          const msg = JSON.parse(jsonStr) as ChatMessage;
          setMessages((prev) => [...prev, msg]);
        } catch (e) {
          console.error("Failed to parse message", e);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue) return;

    setErrorMsg("");
    setConnecting(true);

    try {
      if (uiState === "server_select") {
        await invoke("connect_to_server", { ip: inputValue });
      } else {
        await invoke("send_input", { input: inputValue });
      }
    } catch (err: any) {
      setErrorMsg(err.toString());
      setConnecting(false);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    try {
      await invoke("send_input", { input: chatInput });
      setChatInput("");
    } catch (err: any) {
      console.error(err);
    }
  };

  const renderIcon = () => {
    switch (uiState) {
      case "server_select": return <Server size={32} />;
      case "username_prompt": return <User size={32} />;
      case "password_prompt": return <Lock size={32} />;
      default: return null;
    }
  };

  const renderTitle = () => {
    switch (uiState) {
      case "server_select": return "Connect to Server";
      case "username_prompt": return "Enter Username";
      case "password_prompt": return "Enter Password";
      default: return "";
    }
  };

  const renderDescription = () => {
    switch (uiState) {
      case "server_select": return "Enter the IP address of the WHY2 server";
      case "username_prompt": return "Choose a username to join the server";
      case "password_prompt": return "Authenticate to secure your session";
      default: return "";
    }
  };

  const inputType = uiState === "password_prompt" ? "password" : "text";

  if (uiState === "connected") {
    return (
      <main className="dark flex h-screen w-screen flex-col bg-background text-foreground noise-overlay">
        <header className="flex flex-col items-end justify-center border-b border-border bg-card/50 px-6 py-3 backdrop-blur-md z-10">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">Connected to</span>
          <h1 className="text-sm font-medium text-foreground/90">{serverName}</h1>
        </header>

        {showSpamWarning && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-card border border-border text-muted-foreground px-6 py-2 rounded-md shadow-lg backdrop-blur-md animate-fade-in z-50 text-sm">
            Please slow down. You are sending messages too fast.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-2 z-10 custom-scrollbar">
          {messages.map((msg, idx) => {
            const isSystem = !msg.username;
            const uColor = getAnsiColor(msg.username_color) || "var(--primary)";
            const mColor = getAnsiColor(msg.message_color) || "inherit";

            return (
              <div key={idx} className={`flex w-full ${isSystem ? "justify-center my-4" : "items-start space-x-4 my-1 hover:bg-white/5 p-2 rounded-md transition-colors"}`}>
                {isSystem ? (
                  <span className="text-sm text-muted-foreground italic" style={{ color: mColor }}>
                    {msg.text}
                  </span>
                ) : (
                  <>
                    <div 
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-background uppercase shadow-sm"
                      style={{ backgroundColor: uColor }}
                    >
                      {msg.username.charAt(0)}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 pt-0.5">
                      <span className="text-sm font-semibold mb-0.5" style={{ color: uColor }}>
                        {msg.username}
                      </span>
                      <span className="text-sm leading-relaxed whitespace-pre-wrap break-words" style={{ color: mColor }}>
                        {msg.text}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        <div className="border-t border-border bg-background/80 p-4 backdrop-blur-md z-10">
          <form onSubmit={handleChatSubmit} className="flex w-full max-w-6xl mx-auto relative items-center">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="w-full rounded-md border border-input bg-card/50 pl-4 pr-12 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all shadow-sm"
              placeholder="Type your message..."
              autoFocus
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-primary hover:bg-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="dark flex h-screen w-screen items-center justify-center bg-background text-foreground noise-overlay">
      <div className="animate-fade-in-up relative z-10 w-full max-w-md rounded-md border border-border bg-card/50 p-8 shadow-2xl backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 text-primary transition-all duration-300">
            {renderIcon()}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {renderTitle()}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {renderDescription()}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="inputField" className="text-sm font-medium text-foreground capitalize">
              {uiState === "server_select" ? "Server IP" : uiState.split("_")[0]}
            </label>
            <input
              id="inputField"
              type={inputType}
              value={inputValue}
              onChange={(e) => setInputValue(e.currentTarget.value)}
              placeholder={uiState === "server_select" ? "e.g., 192.168.1.100" : ""}
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors shadow-sm"
              autoFocus
              disabled={connecting}
            />
            {errorMsg && <p className="text-sm text-destructive mt-1">{errorMsg}</p>}
          </div>

          <button
            type="submit"
            disabled={!inputValue || connecting}
            className="group flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 shadow-md"
          >
            {connecting ? "Processing..." : "Continue"}
            {!connecting && (
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            )}
          </button>
        </form>
      </div>
    </main>
  );
}

export default App;
