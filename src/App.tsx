import { useState, useEffect } from "react";
import { Server, ArrowRight, User, Lock, CheckCircle2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./index.css";

type UIState = "server_select" | "username_prompt" | "password_prompt" | "connected";

function App() {
  const [uiState, setUiState] = useState<UIState>("server_select");
  const [inputValue, setInputValue] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [serverName, setServerName] = useState("");

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
        setErrorMsg("Disconnected from server. (Invalid password or connection dropped)");
        setInputValue("");
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
        // Don't clear input here, let the event loop clear it if needed
      }
    } catch (err: any) {
      setErrorMsg(err.toString());
      setConnecting(false);
    }
  };

  const renderIcon = () => {
    switch (uiState) {
      case "server_select": return <Server size={32} />;
      case "username_prompt": return <User size={32} />;
      case "password_prompt": return <Lock size={32} />;
      case "connected": return <CheckCircle2 size={32} />;
    }
  };

  const renderTitle = () => {
    switch (uiState) {
      case "server_select": return "Connect to Server";
      case "username_prompt": return "Enter Username";
      case "password_prompt": return "Enter Password";
      case "connected": return `Connected to ${serverName}`;
    }
  };

  const renderDescription = () => {
    switch (uiState) {
      case "server_select": return "Enter the IP address of the WHY2 server";
      case "username_prompt": return "Choose a username to join the server";
      case "password_prompt": return "Authenticate to secure your session";
      case "connected": return "You are now connected securely.";
    }
  };

  const inputType = uiState === "password_prompt" ? "password" : "text";

  return (
    <main className="dark flex h-screen w-screen items-center justify-center bg-background text-foreground noise-overlay">
      <div className="animate-fade-in-up relative z-10 w-full max-w-md rounded-xl border border-border bg-card/50 p-8 shadow-2xl backdrop-blur-sm">
        <div className="mb-8 flex flex-col items-center justify-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary transition-all duration-300">
            {renderIcon()}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {renderTitle()}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {renderDescription()}
          </p>
        </div>

        {uiState !== "connected" ? (
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
                className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                autoFocus
                disabled={connecting}
              />
              {errorMsg && <p className="text-sm text-destructive mt-1">{errorMsg}</p>}
            </div>

            <button
              type="submit"
              disabled={!inputValue || connecting}
              className="group flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? "Processing..." : "Continue"}
              {!connecting && (
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              )}
            </button>
          </form>
        ) : (
          <div className="flex justify-center text-primary mt-4">
            <p>Ready to chat.</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
