import { useState, useEffect, useRef } from "react";
import { Server, ArrowRight, ArrowLeft, Info, User, Lock, Send, Paperclip, Download, Folder, LogOut, Hash, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./index.css";

type UIState = "server_select" | "username_prompt" | "password_prompt" | "connected";

interface ChatMessage {
  username: string;
  text: string;
  id: number;
  username_color?: number;
  message_color?: number;
}

interface CommandArgInfo {
  name: string;
  required: boolean;
}

interface CommandInfo {
  name: string;
  description: string;
  args: CommandArgInfo[];
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
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, ChatMessage[]>>({});
  const [popupMessage, setPopupMessage] = useState("");

  useEffect(() => {
    if (popupMessage) {
      const timer = setTimeout(() => {
        setPopupMessage("");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [popupMessage]);
  const [slashCommands, setSlashCommands] = useState<CommandInfo[]>([]);
  const [modal, setModal] = useState<{type: string, data: any} | null>(null);
  const [tofuPrompt, setTofuPrompt] = useState<{hash: string, ip: string} | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [currentChannel, setCurrentChannel] = useState("");
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentChannelRef = useRef(currentChannel);

  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messagesByChannel, currentChannel]);

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
        invoke<CommandInfo[]>("get_commands").then(setSlashCommands).catch(console.error);
      } else if (payload === "Quit") {
        setUiState("server_select");
        setErrorMsg((prev) => prev.startsWith("SECURITY WARNING") ? prev : "Disconnected from server.");
        setInputValue("");
        setMessagesByChannel({});
        setUsers([]);
        setCurrentChannel("");
      } else if (payload === "TofuMismatch") {
        setUiState("server_select");
        setErrorMsg("SECURITY WARNING: Identity key mismatch! Connection aborted.");
        setConnecting(false);
      } else if (payload.startsWith("TofuUnknown:")) {
        const parts = payload.split(":");
        const hash = parts[1];
        const ip = parts.slice(2).join(":");
        setTofuPrompt({ hash, ip });
        setConnecting(false);
      } else if (payload.startsWith("Popup:")) {
        const text = payload.substring("Popup:".length);
        setPopupMessage(text);
        setTimeout(() => {
          setPopupMessage(prev => prev === text ? "" : prev);
        }, 3500);
      } else if (payload.startsWith("Modal:")) {
        const parts = payload.split(":");
        const type = parts[1];
        const jsonStr = parts.slice(2).join(":");
        try {
          const data = JSON.parse(jsonStr);
          setModal({ type, data });
        } catch (e) {
          console.error("Failed to parse modal JSON");
        }
      } else if (payload.startsWith("UserList:")) {
        try {
          const data = JSON.parse(payload.substring("UserList:".length));
          setUsers(data);
          
          const activeChannels = new Set(data.map((u: any) => u.channel));
          activeChannels.add(""); // lobby
          setMessagesByChannel(prev => {
            const next = { ...prev };
            let changed = false;
            for (const ch in next) {
              if (!activeChannels.has(ch)) {
                delete next[ch];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        } catch (e) {
          console.error("Failed to parse UserList JSON");
        }
      } else if (payload.startsWith("ChannelChanged:")) {
        setCurrentChannel(payload.substring("ChannelChanged:".length));
      } else if (payload.startsWith("Message:")) {
        try {
          const jsonStr = payload.substring("Message:".length);
          const msg = JSON.parse(jsonStr) as ChatMessage;
          const ch = currentChannelRef.current;
          setMessagesByChannel((prev) => ({
            ...prev,
            [ch]: [...(prev[ch] || []), msg]
          }));
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

  const parsedCommand = chatInput.startsWith("/") ? chatInput.substring(1).split(" ")[0].toLowerCase() : "";
  const filteredCommands = chatInput.startsWith("/") 
    ? slashCommands.filter(c => c.name.startsWith(parsedCommand))
    : [];

  const channels = Array.from(new Set(users.map(u => u.channel || "")));
  if (!channels.includes(currentChannel)) {
    channels.push(currentChannel);
  }
  if (!channels.includes("")) {
    channels.unshift("");
  }

  if (uiState === "connected") {
    return (
      <main className="dark flex h-screen w-screen flex-col bg-background text-foreground noise-overlay">
        <header className="flex items-center justify-between border-b border-border bg-card/50 px-6 py-3 backdrop-blur-md z-10">
          <div></div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-0.5">Connected to</span>
              <h1 className="text-sm font-medium text-foreground/90">{serverName}</h1>
            </div>
            <div className="h-8 w-px bg-border mx-1"></div>
            <button 
              onClick={() => invoke("send_input", { input: "/exit" }).catch((e: any) => setPopupMessage(e.toString()))}
              className="p-2 rounded-md bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors flex items-center justify-center"
              title="Disconnect"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {popupMessage && (
          <div className="absolute top-16 right-6 bg-card border border-border text-muted-foreground px-6 py-2 rounded-md shadow-lg backdrop-blur-md animate-fade-in z-50 text-sm whitespace-nowrap">
            {popupMessage}
          </div>
        )}

        {modal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm animate-fade-in px-4">
             <div className="bg-card border border-border rounded-md shadow-2xl p-6 min-w-[300px] max-w-md w-full">
                <h2 className="text-lg font-bold mb-4">{modal.type === "List" ? "Users Online" : "Available Files"}</h2>
                <div className="max-h-64 overflow-y-auto space-y-2 mb-6 custom-scrollbar pr-2">
                   {modal.type === "List" ? (
                      modal.data.length > 0 ? modal.data.map((u: any, i: number) => (
                         <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-border/50 last:border-0">
                            <span className="font-semibold">{u.username}</span>
                            <span className="text-muted-foreground text-xs">ID: {u.id}</span>
                         </div>
                      )) : <div className="text-muted-foreground text-sm">No users online.</div>
                   ) : (
                      modal.data.length > 0 ? modal.data.map((u: any, i: number) => (
                         <div key={i} className="mb-4 last:mb-0">
                            <div className="font-semibold text-sm mb-2">{u.username} (ID: {u.id})</div>
                            <div className="space-y-2 pl-3 border-l-2 border-primary/20">
                               {u.uploads.map((f: any, j: number) => (
                                   <div key={j} className="flex justify-between text-xs items-center py-0.5">
                                      <span className="text-foreground/90 font-medium">{f[0]}</span>
                                      <div className="flex items-center gap-3">
                                        <span className="text-muted-foreground">ID: {f[1]}</span>
                                        <button 
                                          className="text-primary hover:text-primary/80 transition-colors p-1 rounded-sm hover:bg-primary/10"
                                          onClick={() => {
                                            invoke("send_input", { input: `/download ${u.id} ${f[1]}` })
                                              .catch((e: any) => setPopupMessage(e.toString()));
                                            setModal(null);
                                          }}
                                          title="Download File"
                                        >
                                          <Download size={14} />
                                        </button>
                                      </div>
                                   </div>
                               ))}
                            </div>
                         </div>
                      )) : <div className="text-muted-foreground text-sm">No files available.</div>
                   )}
                </div>
                <button onClick={() => setModal(null)} className="w-full py-2.5 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none">Close</button>
             </div>
          </div>
        )}

        {showCreateChannel && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm animate-fade-in px-4">
             <div className="bg-card border border-border rounded-md shadow-2xl p-6 min-w-[300px] max-w-sm w-full">
                <h2 className="text-lg font-bold mb-4">Create Channel</h2>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newChannelName.trim()) {
                      invoke("send_input", { input: `/channel ${newChannelName.trim()}` }).catch((e: any) => setPopupMessage(e.toString()));
                      setShowCreateChannel(false);
                      setNewChannelName("");
                    }
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary mb-6"
                  placeholder="Channel name..."
                  autoFocus
                />
                <div className="flex space-x-3">
                  <button 
                     onClick={() => {
                       if (newChannelName.trim()) {
                         invoke("send_input", { input: `/channel ${newChannelName.trim()}` }).catch((e: any) => setPopupMessage(e.toString()));
                       }
                       setShowCreateChannel(false);
                       setNewChannelName("");
                     }} 
                     className="flex-1 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none"
                  >
                     Create
                  </button>
                  <button 
                     onClick={() => { setShowCreateChannel(false); setNewChannelName(""); }}
                     className="flex-1 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/90 transition-colors shadow-sm focus:outline-none"
                  >
                     Cancel
                  </button>
                </div>
             </div>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 relative">
            <div className="flex-1 overflow-y-auto p-6 z-10 custom-scrollbar">
          {(messagesByChannel[currentChannel] || []).map((msg, idx) => {
            const isSystem = !msg.username;
            const uColor = getAnsiColor(msg.username_color) || "var(--primary)";
            const mColor = getAnsiColor(msg.message_color) || "inherit";

            const prevMsg = idx > 0 ? messagesByChannel[currentChannel][idx - 1] : null;
            const isConsecutive = !isSystem && prevMsg && !(!prevMsg.username) && prevMsg.username === msg.username;

            return (
              <div key={idx} className={`flex w-full ${isSystem ? "items-center justify-center px-2 my-2" : `items-start space-x-4 hover:bg-white/5 rounded-md transition-colors px-2 ${isConsecutive ? "py-0 mt-0 mb-0" : "pt-2 pb-0 mt-4 mb-0"}`}`}>
                {isSystem ? (
                  <>
                    <div className="h-[1px] bg-border/60 flex-1"></div>
                    <span className="text-sm text-muted-foreground italic px-4 whitespace-nowrap" style={{ color: mColor }}>
                      {msg.text}
                    </span>
                    <div className="h-[1px] bg-border/60 flex-1"></div>
                  </>
                ) : (
                  <>
                    <div className={`shrink-0 ${isConsecutive ? "w-10" : "flex h-10 w-10 items-center justify-center"}`}>
                      {!isConsecutive && (
                        <div 
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-background uppercase shadow-sm"
                          style={{ backgroundColor: uColor }}
                        >
                          {msg.username.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div className={`flex flex-col flex-1 min-w-0 ${isConsecutive ? "pt-0" : "pt-0.5"}`}>
                      {!isConsecutive && (
                        <span className="text-sm font-semibold mb-0.5" style={{ color: uColor }}>
                          {msg.username}
                        </span>
                      )}
                      <span className="text-sm leading-snug whitespace-pre-wrap break-words" style={{ color: mColor }}>
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

        <div className="border-t border-border bg-background/80 p-4 backdrop-blur-md z-10 relative">
          {chatInput.startsWith("/") && (
            <div className="absolute bottom-full left-0 right-0 w-full max-w-6xl mx-auto pb-4 z-50">
              <div className="bg-card border border-border rounded-md shadow-2xl backdrop-blur-md overflow-hidden max-h-64 overflow-y-auto custom-scrollbar animate-fade-in-up">
                {filteredCommands.length > 0 ? (
                  <ul className="py-2">
                    {filteredCommands.map((cmd) => (
                      <li 
                        key={cmd.name} 
                        className="px-6 py-2 hover:bg-white/5 cursor-pointer transition-colors"
                        onClick={() => {
                          setChatInput("/" + cmd.name + " ");
                          document.getElementById("chat-input")?.focus();
                        }}
                      >
                        <div className="flex items-baseline space-x-2">
                          <span className="font-bold text-primary">/{cmd.name}</span>
                          {cmd.args.map((arg, i) => (
                            <span key={i} className={`text-xs font-semibold ${arg.required ? 'text-foreground/80' : 'text-muted-foreground'}`}>
                              {arg.required ? `<${arg.name}>` : `[${arg.name}]`}
                            </span>
                          ))}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{cmd.description}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-6 py-4 text-sm text-muted-foreground">No matching commands found.</div>
                )}
              </div>
            </div>
          )}

          <form onSubmit={handleChatSubmit} className="flex w-full max-w-6xl mx-auto relative items-center">
            <div className="absolute left-2 flex items-center gap-1 z-10">
              <button
                type="button"
                onClick={async () => {
                  const selected = await open({ multiple: false });
                  if (selected) {
                    const path = typeof selected === 'string' ? selected : (selected as any).path || (Array.isArray(selected) ? selected[0] : null);
                    if (path) {
                      const fileName = path.split(/[\\/]/).pop() || path;
                      setPopupMessage(`Uploading ${fileName}...`);
                      invoke("upload_file_from_path", { path }).catch((e: any) => setPopupMessage(e.toString()));
                    }
                  }
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                title="Upload File"
              >
                <Paperclip size={18} />
              </button>
              <button
                type="button"
                onClick={() => {
                  invoke("send_input", { input: "/files" }).catch((e: any) => setPopupMessage(e.toString()));
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                title="View Files"
              >
                <Folder size={18} />
              </button>
            </div>
            <input
              id="chat-input"
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className="w-full rounded-md border border-input bg-card/50 pl-20 pr-12 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all shadow-sm"
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
        </div>

        <div className="w-64 border-l border-border bg-card/30 flex flex-col z-10">
          <div className="p-4 border-b border-border flex justify-between items-center">
            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Channels</h2>
            <button 
              onClick={() => setShowCreateChannel(true)}
              className="text-primary hover:text-primary/80 transition-colors p-1 rounded-sm hover:bg-primary/10"
              title="Create Channel"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-1">
            {channels.map(c => {
              const isCurrent = c === currentChannel;
              const display = c === "" ? "chat lobby" : c;
              return (
                <button
                  key={display}
                  onClick={() => invoke("send_input", { input: c === "" ? "/channel" : `/channel ${c}` }).catch((e: any) => setPopupMessage(e.toString()))}
                  className={`w-full text-left px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors ${
                    isCurrent 
                      ? "bg-primary/20 text-primary font-medium" 
                      : "text-foreground/70 hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  <Hash size={14} className={isCurrent ? "text-primary" : "text-muted-foreground"} />
                  <span className="truncate">{display}</span>
                  {isCurrent && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      </main>
    );
  }

  return (
    <main className="dark flex h-screen w-screen items-center justify-center bg-background text-foreground noise-overlay">
      {tofuPrompt && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm animate-fade-in px-4">
           <div className="bg-card border border-border rounded-md shadow-2xl p-6 min-w-[300px] max-w-md w-full">
              <h2 className="text-lg font-bold mb-4 text-destructive">Unknown Server Identity</h2>
              <p className="text-sm text-muted-foreground mb-4">
                The server's identity key is not stored in local configuration.
              </p>
              <div className="bg-background border border-border rounded-md p-3 mb-6 break-all font-mono text-xs text-foreground/80">
                {tofuPrompt.hash}
              </div>
              <p className="text-sm font-medium mb-6">Do you trust this server?</p>
              <div className="flex space-x-3">
                <button 
                   onClick={async () => {
                      await invoke("accept_tofu", { ip: tofuPrompt.ip, hash: tofuPrompt.hash });
                      const ipToConnect = tofuPrompt.ip;
                      setTofuPrompt(null);
                      setConnecting(true);
                      setErrorMsg("");
                      invoke("connect_to_server", { ip: ipToConnect }).catch((err: any) => { setErrorMsg(err.toString()); setConnecting(false); });
                   }} 
                   className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors shadow-sm focus:outline-none"
                >
                   Yes, Connect
                </button>
                <button 
                   onClick={() => { setTofuPrompt(null); setErrorMsg("Connection aborted."); }}
                   className="flex-1 py-2.5 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/90 transition-colors shadow-sm focus:outline-none"
                >
                   No, Abort
                </button>
              </div>
           </div>
        </div>
      )}
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
