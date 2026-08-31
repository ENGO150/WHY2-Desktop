/*
This is part of WHY2
Copyright (C) 2026 Václav Šmejkal

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Server, ArrowRight, User, Lock, Send, Paperclip, Download, Folder, LogOut, Hash, Plus, ShieldAlert } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./index.css";

//THE LOBBY HAS NO NAME - EVERY CHANNEL-KEYED MAP USES THE EMPTY STRING FOR IT
const LOBBY = "";

//WHAT REPLACING A PINNED KEY HAS TO BE TYPED OUT AS, SO IT CANNOT HAPPEN BY LEANING ON ENTER
const CHALLENGE = "yes";

type UIState = "server_select" | "username_prompt" | "password_prompt" | "connected";

type MessageKind = "user" | "private" | "system" | "notice" | "error";

interface ChatMessage
{
    kind: MessageKind;
    username: string;
    text: string;
    id: number | null;
    username_color: number | null;
    message_color: number | null;
}

interface OnlineUser
{
    username: string;
    id: number;
    channel: string | null;
}

interface FileEntry
{
    filename: string;
    id: number;
}

interface UserFile
{
    username: string;
    id: number;
    uploads: FileEntry[];
}

interface BanEntry
{
    id: number;
    subject: string;
}

interface ServerSetting
{
    key: string;
    value: string;
    section: string;
    description: string;
    restart: boolean;
}

interface CommandArgInfo
{
    name: string;
    description: string;
    required: boolean;
}

interface SubcommandInfo
{
    name: string;
    description: string;
    args: CommandArgInfo[];
}

interface CommandInfo
{
    name: string;
    description: string;
    args: CommandArgInfo[];
    subcommands: SubcommandInfo[];
}

interface TofuPrompt
{
    host: string;
    hash: string;
    pinned: string | null;
    mismatch: boolean;
}

//ONE ROW OF THE SLASH PALETTE. A COMMAND THAT IS NOTHING BUT A DOORWAY TO ITS ACTIONS IS LISTED AS ITS
//ACTIONS, THE WAY THE TUI LISTS THEM - "/server" ALONE RUNS NOTHING
interface PaletteEntry
{
    name: string;
    description: string;
    args: CommandArgInfo[];
}

type Modal =
    | { type: "users"; users: OnlineUser[] }
    | { type: "files"; users: UserFile[] }
    | { type: "bans"; users: BanEntry[]; ips: BanEntry[] }
    | { type: "settings"; settings: ServerSetting[] };

//EVERYTHING THE BRIDGE SENDS, TAGGED THE WAY SERDE TAGS IT ON THE OTHER SIDE
type BridgeEvent =
    | { event: "connected"; data: { server: string } }
    | { event: "request_username"; data: { registration: boolean; min: number; max: number } }
    | { event: "request_password"; data: { register: boolean } }
    | { event: "username_rejected"; data?: null }
    | { event: "password_rejected"; data: { min: number } }
    | { event: "authenticated"; data: { role: string } }
    | { event: "role"; data: { role: string; username: string | null } }
    | { event: "message"; data: { message: ChatMessage } }
    | { event: "history"; data: { messages: ChatMessage[] } }
    | { event: "popup"; data: { text: string } }
    | { event: "tofu_prompt"; data: TofuPrompt }
    | { event: "users"; data: { users: OnlineUser[]; requested: boolean } }
    | { event: "user_left"; data: { id: number } }
    | { event: "files"; data: { users: UserFile[] } }
    | { event: "bans"; data: { users: BanEntry[]; ips: BanEntry[] } }
    | { event: "server_settings"; data: { settings: ServerSetting[]; saved: boolean } }
    | { event: "channel_changed"; data: { channel: string | null } }
    | { event: "channel_created"; data: { name: string } }
    | { event: "channel_destroyed"; data: { name: string } }
    | { event: "disconnected"; data: { reason: string | null } };

//THE SIXTEEN COLORS THE PROTOCOL CARRIES, AS THE TERMINAL WOULD HAVE PAINTED THEM
function getAnsiColor(code: number | null | undefined): string | undefined
{
    if (code === undefined || code === null) return undefined;

    switch (code)
    {
        case 0: return "#000000";  //BLACK
        case 1: return "#800000";  //DARK RED
        case 2: return "#008000";  //DARK GREEN
        case 3: return "#808000";  //DARK YELLOW
        case 4: return "#000080";  //DARK BLUE
        case 5: return "#800080";  //DARK MAGENTA
        case 6: return "#008080";  //DARK CYAN
        case 7: return "#c0c0c0";  //GREY
        case 8: return "#808080";  //DARK GREY
        case 9: return "#ff0000";  //RED
        case 10: return "#00ff00"; //GREEN
        case 11: return "#ffff00"; //YELLOW
        case 12: return "#0000ff"; //BLUE
        case 13: return "#ff00ff"; //MAGENTA
        case 14: return "#00ffff"; //CYAN
        case 15: return "#ffffff"; //WHITE
        default: return undefined;
    }
}

//THE FINGERPRINT IS 64 HEX CHARS - GROUPED IN EIGHTS AND BROKEN INTO ROWS SO IT CAN ACTUALLY BE
//COMPARED AGAINST WHAT THE OPERATOR PUBLISHED
function fingerprint(hash: string): string[]
{
    const groups = hash.match(/.{1,8}/g) ?? [];
    const rows: string[] = [];

    for (let i = 0; i < groups.length; i += 4)
    {
        rows.push(groups.slice(i, i + 4).join(" "));
    }

    return rows;
}

function App()
{
    const [uiState, setUiState] = useState<UIState>("server_select");
    const [inputValue, setInputValue] = useState("");
    const [chatInput, setChatInput] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const [hint, setHint] = useState("");
    const [registering, setRegistering] = useState(false);
    const [serverName, setServerName] = useState("");
    const [role, setRole] = useState("user");
    const [messagesByChannel, setMessagesByChannel] = useState<Record<string, ChatMessage[]>>({});
    const [popupMessage, setPopupMessage] = useState("");
    const [commands, setCommands] = useState<CommandInfo[]>([]);
    const [modal, setModal] = useState<Modal | null>(null);
    const [tofu, setTofu] = useState<TofuPrompt | null>(null);
    const [tofuTyped, setTofuTyped] = useState("");
    const [users, setUsers] = useState<OnlineUser[]>([]);
    const [activeChannels, setActiveChannels] = useState<string[]>([]);
    const [currentChannel, setCurrentChannel] = useState(LOBBY);
    const [showCreateChannel, setShowCreateChannel] = useState(false);
    const [newChannelName, setNewChannelName] = useState("");

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const loginInputRef = useRef<HTMLInputElement>(null);

    //THE EVENT LISTENER IS REGISTERED ONCE, SO IT READS THE CHANNEL THROUGH A REF - A CAPTURED ONE
    //WOULD BE WHATEVER IT WAS WHEN THE SESSION STARTED
    const currentChannelRef = useRef(currentChannel);

    useEffect(() =>
    {
        currentChannelRef.current = currentChannel;
    }, [currentChannel]);

    useEffect(() =>
    {
        if (!popupMessage) return;

        const timer = setTimeout(() => setPopupMessage(""), 3500);
        return () => clearTimeout(timer);
    }, [popupMessage]);

    useEffect(() =>
    {
        if (connecting || uiState === "connected") return;

        //THE FIELD IS REPLACED BETWEEN THE IDENTITY STEPS, SO THE FOCUS HAS TO FOLLOW IT
        const timer = setTimeout(() => loginInputRef.current?.focus(), 10);
        return () => clearTimeout(timer);
    }, [uiState, connecting]);

    useEffect(() =>
    {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messagesByChannel, currentChannel]);

    //PUSH ONE LINE INTO WHICHEVER CHANNEL IS OPEN WHEN IT ARRIVES
    const pushMessage = (message: ChatMessage) =>
    {
        const channel = currentChannelRef.current;

        setMessagesByChannel((previous) => ({ ...previous, [channel]: [...(previous[channel] ?? []), message] }));
    };

    //A CHANNEL EXISTS EXACTLY AS LONG AS SOMEBODY SITS IN IT, SO THE ROSTER IS THE WHOLE TRUTH ABOUT
    //WHICH ONES THERE ARE - AND HISTORY OF ONE NOBODY IS IN ANY MORE IS NOT WORTH KEEPING
    const syncChannels = (roster: OnlineUser[]) =>
    {
        const channels = new Set(roster.map((user) => user.channel ?? LOBBY));
        channels.add(LOBBY);

        setActiveChannels(Array.from(channels));

        setMessagesByChannel((previous) =>
        {
            const next = { ...previous };
            let changed = false;

            for (const channel in next)
            {
                if (channel !== currentChannelRef.current && !channels.has(channel))
                {
                    delete next[channel];
                    changed = true;
                }
            }

            return changed ? next : previous;
        });
    };

    const refreshCommands = () =>
    {
        invoke<CommandInfo[]>("get_commands").then(setCommands).catch(console.error);
    };

    //EVERYTHING THE SESSION BUILT UP GOES AWAY WITH IT
    const resetSession = (reason: string) =>
    {
        setUiState("server_select");
        setConnecting(false);
        setErrorMsg(reason);
        setHint("");
        setInputValue("");
        setMessagesByChannel({});
        setUsers([]);
        setActiveChannels([]);
        setCurrentChannel(LOBBY);
        setCommands([]);
        setModal(null);
        setTofu(null);
        setTofuTyped("");
        setServerName("");
        setRole("user");
    };

    useEffect(() =>
    {
        const unlisten = listen<BridgeEvent>("why2-event", ({ payload }) =>
        {
            switch (payload.event)
            {
                case "connected":
                {
                    setServerName(payload.data.server);
                    break;
                }

                case "request_username":
                {
                    const { registration, min, max } = payload.data;

                    setUiState("username_prompt");
                    setConnecting(false);
                    setInputValue("");
                    setHint(registration ? `a-Z, 0-9; ${min}-${max} characters` : "Registration is disabled on this server.");
                    break;
                }

                case "request_password":
                {
                    setUiState("password_prompt");
                    setConnecting(false);
                    setInputValue("");
                    setRegistering(payload.data.register);
                    setHint("");
                    break;
                }

                //A REJECTION ALWAYS ARRIVES JUST BEFORE THE RE-PROMPT, WHICH LEAVES THE ERROR ON SCREEN
                case "username_rejected":
                {
                    setErrorMsg("Username rejected!");
                    setConnecting(false);
                    break;
                }

                case "password_rejected":
                {
                    setErrorMsg(`Password rejected! Enter at least ${payload.data.min} characters.`);
                    setConnecting(false);
                    break;
                }

                case "authenticated":
                {
                    setUiState("connected");
                    setConnecting(false);
                    setErrorMsg("");
                    setRole(payload.data.role);
                    refreshCommands();
                    break;
                }

                //THE SERVER NAMES THE USER WHEN IT IS SOMEBODY ELSE, SO THE ONE WITHOUT A NAME IS OURS -
                //AND THAT ONE DECIDES WHICH COMMANDS THE PALETTE IS ALLOWED TO OFFER
                case "role":
                {
                    const { role, username } = payload.data;

                    if (username === null)
                    {
                        setRole(role);
                        refreshCommands();
                    }

                    setPopupMessage(username === null ? `You are now ${role}.` : `${username} is now ${role}.`);
                    break;
                }

                case "message":
                {
                    pushMessage(payload.data.message);
                    break;
                }

                case "history":
                {
                    const { messages } = payload.data;
                    const channel = currentChannelRef.current;

                    setMessagesByChannel((previous) => ({ ...previous, [channel]: [...messages, ...(previous[channel] ?? [])] }));
                    break;
                }

                case "popup":
                {
                    setPopupMessage(payload.data.text);
                    break;
                }

                case "tofu_prompt":
                {
                    setTofu(payload.data);
                    setTofuTyped("");
                    setConnecting(false);
                    break;
                }

                case "users":
                {
                    const { users, requested } = payload.data;

                    setUsers(users);
                    syncChannels(users);

                    if (requested) setModal({ type: "users", users });
                    break;
                }

                case "user_left":
                {
                    setUsers((previous) =>
                    {
                        const next = previous.filter((user) => user.id !== payload.data.id);
                        syncChannels(next);

                        return next;
                    });
                    break;
                }

                case "files":
                {
                    setModal({ type: "files", users: payload.data.users });
                    break;
                }

                case "bans":
                {
                    setModal({ type: "bans", users: payload.data.users, ips: payload.data.ips });
                    break;
                }

                case "server_settings":
                {
                    const { settings, saved } = payload.data;

                    if (saved) setPopupMessage("Server settings saved.");
                    else setModal({ type: "settings", settings });
                    break;
                }

                case "channel_changed":
                {
                    setCurrentChannel(payload.data.channel ?? LOBBY);
                    break;
                }

                case "channel_created":
                {
                    const { name } = payload.data;
                    setActiveChannels((previous) => (previous.includes(name) ? previous : [...previous, name]));
                    break;
                }

                case "channel_destroyed":
                {
                    const { name } = payload.data;

                    setActiveChannels((previous) => previous.filter((channel) => channel !== name));

                    setMessagesByChannel((previous) =>
                    {
                        if (!(name in previous) || name === currentChannelRef.current) return previous;

                        const next = { ...previous };
                        delete next[name];

                        return next;
                    });
                    break;
                }

                //THE SOCKET IS GONE, BUT THE APP IS NOT: THE CONNECT BOX COMES BACK SO ANOTHER SERVER
                //(OR THE SAME ONE AGAIN) IS ONE ENTER AWAY
                case "disconnected":
                {
                    resetSession(payload.data.reason ?? "Disconnected from the server.");
                    break;
                }
            }
        });

        return () => { unlisten.then((stop) => stop()); };
    }, []);

    const send = (input: string) =>
    {
        invoke("send_input", { input }).catch((error: unknown) => setPopupMessage(String(error)));
    };

    const handleSubmit = async (event: React.FormEvent) =>
    {
        event.preventDefault();
        if (!inputValue) return;

        setErrorMsg("");
        setConnecting(true);

        try
        {
            if (uiState === "server_select") await invoke("connect_to_server", { address: inputValue });
            else await invoke("send_input", { input: inputValue });
        }
        catch (error: unknown)
        {
            setErrorMsg(String(error));
            setConnecting(false);
        }
    };

    const handleChatSubmit = (event: React.FormEvent) =>
    {
        event.preventDefault();
        if (!chatInput.trim()) return;

        send(chatInput);
        setChatInput("");
    };

    //THE PROMPT IS ANSWERED IN-BAND: THE LISTENING TASK IS PARKED ON IT, AND ON A YES IT PINS THE KEY
    //AND DIALS AGAIN ITSELF - NOTHING HERE HAS TO RECONNECT
    const answerTofu = (accept: boolean) =>
    {
        setTofu(null);
        setTofuTyped("");

        invoke("answer_tofu", { accept }).catch((error: unknown) => setErrorMsg(String(error)));

        if (accept)
        {
            setConnecting(true);
            setErrorMsg("");
        }
        else setErrorMsg("Connection aborted.");
    };

    const uploadFile = async () =>
    {
        const selected = await open({ multiple: false });
        if (typeof selected !== "string") return;

        invoke("upload_file_from_path", { path: selected }).catch((error: unknown) => setPopupMessage(String(error)));
    };

    //A COMMAND THAT IS NOTHING BUT A DOORWAY TO ITS ACTIONS IS OFFERED AS ITS ACTIONS
    const palette = useMemo<PaletteEntry[]>(() => commands.flatMap((command) =>
    {
        if (command.subcommands.length === 0) return [command];

        return command.subcommands.map((sub) => ({
            name: `${command.name} ${sub.name}`,
            description: sub.description,
            args: sub.args,
        }));
    }), [commands]);

    const typed = chatInput.startsWith("/") ? chatInput.slice(1).toLowerCase() : null;

    const suggestions = useMemo(() =>
    {
        if (typed === null) return [];

        //THE ENTRY STAYS UP WHILE ITS PARAMETERS ARE BEING TYPED, SO THE SIGNATURE IS STILL READABLE
        return palette.filter((entry) => entry.name.startsWith(typed) || typed.startsWith(`${entry.name} `));
    }, [palette, typed]);

    const channels = useMemo(() =>
    {
        const set = new Set(activeChannels);
        set.add(currentChannel);
        set.add(LOBBY);

        return Array.from(set).sort((a, b) =>
        {
            if (a === LOBBY) return -1;
            if (b === LOBBY) return 1;

            return a.localeCompare(b);
        });
    }, [activeChannels, currentChannel]);

    const messages = messagesByChannel[currentChannel] ?? [];

    const renderIcon = () =>
    {
        switch (uiState)
        {
            case "server_select": return <Server size={32} />;
            case "username_prompt": return <User size={32} />;
            case "password_prompt": return <Lock size={32} />;
            default: return null;
        }
    };

    const renderTitle = () =>
    {
        switch (uiState)
        {
            case "server_select": return "Connect to Server";
            case "username_prompt": return "Enter Username";
            case "password_prompt": return registering ? "Register" : "Log In";
            default: return "";
        }
    };

    const renderDescription = () =>
    {
        switch (uiState)
        {
            case "server_select": return "Enter the address of the WHY2 server";
            case "username_prompt": return "Choose a username to join the server";
            case "password_prompt": return registering ? "Pick a password for your new account" : "Authenticate to secure your session";
            default: return "";
        }
    };

    //THE IDENTITY PROMPT IS A MODAL OVERLAY ON BOTH SCREENS - WHILE IT IS UP THE SESSION IS PARKED ON
    //ITS ANSWER, SO NOTHING TYPED ANYWHERE ELSE CAN REACH AN UNTRUSTED SERVER
    const tofuOverlay = tofu && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 px-4 backdrop-blur-sm animate-fade-in">
            <div className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-2xl">
                <div className="mb-4 flex items-center gap-3">
                    <ShieldAlert size={20} className="text-destructive" />
                    <h2 className="text-lg font-bold text-destructive">
                        {tofu.mismatch ? "Server identity changed" : "Unknown server identity"}
                    </h2>
                </div>

                <p className="mb-4 text-sm text-muted-foreground">
                    {tofu.mismatch
                        ? `The key pinned for ${tofu.host} does not match the one it just offered. This is what a
                           machine-in-the-middle looks like - unless the operator has told you they replaced it.`
                        : `${tofu.host} has not been seen before. Compare the fingerprint against the one its
                           operator published before trusting it.`}
                </p>

                <div className="mb-4 rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground/80">
                    {fingerprint(tofu.hash).map((row) => <div key={row}>{row}</div>)}
                </div>

                {tofu.pinned && (
                    <>
                        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Pinned</p>
                        <div className="mb-4 rounded-md border border-border bg-background p-3 font-mono text-xs text-muted-foreground">
                            {fingerprint(tofu.pinned).map((row) => <div key={row}>{row}</div>)}
                        </div>
                    </>
                )}

                {/* REPLACING A PINNED KEY HAS TO BE TYPED OUT - THE FIRST CONTACT IS THE ONLY ONE ANSWERED BY A BUTTON */}
                {tofu.mismatch && (
                    <div className="mb-6">
                        <label htmlFor="tofu-challenge" className="text-sm text-muted-foreground">
                            Type <span className="font-mono font-bold text-foreground">{CHALLENGE}</span> to replace the pinned key.
                        </label>
                        <input
                            id="tofu-challenge"
                            type="text"
                            value={tofuTyped}
                            onChange={(event) => setTofuTyped(event.currentTarget.value.toLowerCase())}
                            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus
                        />
                    </div>
                )}

                <div className="flex space-x-3">
                    <button
                        onClick={() => answerTofu(false)}
                        className="flex-1 rounded-md bg-primary py-2.5 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none"
                    >
                        Reject
                    </button>
                    <button
                        onClick={() => answerTofu(true)}
                        disabled={tofu.mismatch && tofuTyped !== CHALLENGE}
                        className="flex-1 rounded-md bg-destructive/10 py-2.5 font-medium text-destructive shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-destructive/10 disabled:hover:text-destructive"
                    >
                        Trust
                    </button>
                </div>
            </div>
        </div>
    );

    if (uiState === "connected")
    {
        return (
            <main className="dark flex h-screen w-screen flex-col bg-background text-foreground noise-overlay">
                <header className="z-10 flex items-center justify-between border-b border-border bg-card/50 px-6 py-3 backdrop-blur-md">
                    <div></div>
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                            <span className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Connected to</span>
                            <h1 className="text-sm font-medium text-foreground/90">{serverName}</h1>
                        </div>
                        <div className="mx-1 h-8 w-px bg-border"></div>
                        <span className="rounded-sm bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                            {role}
                        </span>
                        <button
                            onClick={() => send("/exit")}
                            className="flex items-center justify-center rounded-md bg-destructive/10 p-2 text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
                            title="Disconnect"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </header>

                {tofuOverlay}

                {popupMessage && (
                    <div className="absolute right-6 top-16 z-50 whitespace-nowrap rounded-md border border-border bg-card px-6 py-2 text-sm text-muted-foreground shadow-lg backdrop-blur-md animate-fade-in">
                        {popupMessage}
                    </div>
                )}

                {modal && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 px-4 backdrop-blur-sm animate-fade-in">
                        <div className="w-full min-w-[300px] max-w-md rounded-md border border-border bg-card p-6 shadow-2xl">
                            <h2 className="mb-4 text-lg font-bold">
                                {modal.type === "users" && "Users Online"}
                                {modal.type === "files" && "Available Files"}
                                {modal.type === "bans" && "Bans"}
                                {modal.type === "settings" && "Server Settings"}
                            </h2>

                            <div className="custom-scrollbar mb-6 max-h-64 space-y-2 overflow-y-auto pr-2">
                                {modal.type === "users" && (modal.users.length > 0 ? modal.users.map((user) => (
                                    <div key={user.id} className="flex items-center justify-between border-b border-border/50 py-1 text-sm last:border-0">
                                        <span className="font-semibold">{user.username}</span>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                            {user.channel && <span className="text-primary">#{user.channel}</span>}
                                            <span>ID: {user.id}</span>
                                        </div>
                                    </div>
                                )) : <div className="text-sm text-muted-foreground">No users online.</div>)}

                                {modal.type === "files" && (modal.users.length > 0 ? modal.users.map((user) => (
                                    <div key={user.id} className="mb-4 last:mb-0">
                                        <div className="mb-2 text-sm font-semibold">{user.username} (ID: {user.id})</div>
                                        <div className="space-y-2 border-l-2 border-primary/20 pl-3">
                                            {user.uploads.map((file) => (
                                                <div key={file.id} className="flex items-center justify-between py-0.5 text-xs">
                                                    <span className="font-medium text-foreground/90">{file.filename}</span>
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-muted-foreground">ID: {file.id}</span>
                                                        <button
                                                            className="rounded-sm p-1 text-primary transition-colors hover:bg-primary/10 hover:text-primary/80"
                                                            onClick={() =>
                                                            {
                                                                send(`/download ${user.id} ${file.id}`);
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
                                )) : <div className="text-sm text-muted-foreground">No files available.</div>)}

                                {/* THE IDS RENUMBER WHENEVER ONE IS LIFTED, SO EACH SECTION COUNTS FROM ITS OWN ZERO */}
                                {modal.type === "bans" && (modal.users.length + modal.ips.length > 0
                                    ? ([["users", modal.users], ["addresses", modal.ips]] as const).map(([name, bans]) => bans.length > 0 && (
                                        <div key={name} className="mb-4 last:mb-0">
                                            <div className="mb-2 text-sm font-semibold capitalize">{name}</div>
                                            <div className="space-y-1 border-l-2 border-primary/20 pl-3">
                                                {bans.map((ban) => (
                                                    <div key={ban.id} className="flex items-center justify-between py-0.5 text-xs">
                                                        <span className="font-medium text-foreground/90">{ban.subject}</span>
                                                        <span className="text-muted-foreground">ID: {ban.id}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))
                                    : <div className="text-sm text-muted-foreground">No bans.</div>)}

                                {modal.type === "settings" && (
                                    <>
                                        <p className="mb-3 text-xs text-muted-foreground">
                                            Read-only here - edit them with the terminal client.
                                        </p>
                                        {modal.settings.map((setting) => (
                                            <div key={`${setting.section}.${setting.key}`} className="border-b border-border/50 py-1 last:border-0">
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="font-mono font-medium">{setting.key}</span>
                                                    <span className="font-mono text-xs text-muted-foreground">{setting.value}</span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">{setting.description}</div>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>

                            <button
                                onClick={() => setModal(null)}
                                className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}

                {showCreateChannel && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 px-4 backdrop-blur-sm animate-fade-in">
                        <div className="w-full min-w-[300px] max-w-sm rounded-md border border-border bg-card p-6 shadow-2xl">
                            <h2 className="mb-4 text-lg font-bold">Create Channel</h2>
                            <input
                                type="text"
                                value={newChannelName}
                                onChange={(event) => setNewChannelName(event.currentTarget.value)}
                                onKeyDown={(event) =>
                                {
                                    if (event.key === "Enter" && newChannelName.trim())
                                    {
                                        send(`/channel ${newChannelName.trim()}`);
                                        setShowCreateChannel(false);
                                        setNewChannelName("");
                                    }
                                }}
                                className="mb-6 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                placeholder="Channel name..."
                                autoFocus
                            />
                            <div className="flex space-x-3">
                                <button
                                    onClick={() =>
                                    {
                                        if (newChannelName.trim()) send(`/channel ${newChannelName.trim()}`);

                                        setShowCreateChannel(false);
                                        setNewChannelName("");
                                    }}
                                    className="flex-1 rounded-md bg-primary py-2 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none"
                                >
                                    Create
                                </button>
                                <button
                                    onClick={() => { setShowCreateChannel(false); setNewChannelName(""); }}
                                    className="flex-1 rounded-md bg-secondary py-2 font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/90 focus:outline-none"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex flex-1 overflow-hidden">
                    <div className="relative flex min-w-0 flex-1 flex-col">
                        <div className="custom-scrollbar z-10 flex-1 overflow-y-auto p-6">
                            {messages.map((message, index) =>
                            {
                                const spoken = message.kind === "user" || message.kind === "private";

                                const usernameColor = getAnsiColor(message.username_color) ?? "var(--primary)";
                                const messageColor = getAnsiColor(message.message_color)
                                    ?? (message.kind === "error" ? "var(--destructive)" : "inherit");

                                //CONSECUTIVE LINES BY THE SAME PERSON HANG UNDER THE FIRST ONE'S NAME
                                const previous = index > 0 ? messages[index - 1] : null;
                                const consecutive = spoken && previous?.kind === message.kind && previous.username === message.username;

                                if (!spoken)
                                {
                                    return (
                                        <div key={index} className="my-2 flex w-full items-center justify-center px-2">
                                            <div className="h-px flex-1 bg-border/60"></div>
                                            <span
                                                className={`whitespace-pre-wrap px-4 text-sm italic ${message.kind === "system" ? "text-muted-foreground" : "font-medium"}`}
                                                style={{ color: messageColor }}
                                            >
                                                {message.text}
                                            </span>
                                            <div className="h-px flex-1 bg-border/60"></div>
                                        </div>
                                    );
                                }

                                return (
                                    <div
                                        key={index}
                                        className={`flex w-full items-start space-x-4 rounded-md px-2 transition-colors hover:bg-white/5 ${consecutive ? "my-0 py-0" : "mb-0 mt-4 pb-0 pt-2"}`}
                                    >
                                        <div className={`shrink-0 ${consecutive ? "w-10" : "flex h-10 w-10 items-center justify-center"}`}>
                                            {!consecutive && (
                                                <div
                                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold uppercase text-background shadow-sm"
                                                    style={{ backgroundColor: usernameColor }}
                                                >
                                                    {message.username.charAt(0)}
                                                </div>
                                            )}
                                        </div>
                                        <div className={`flex min-w-0 flex-1 flex-col ${consecutive ? "pt-0" : "pt-0.5"}`}>
                                            {!consecutive && (
                                                <span className="mb-0.5 text-sm font-semibold" style={{ color: usernameColor }}>
                                                    {message.username}
                                                </span>
                                            )}
                                            <span className="whitespace-pre-wrap break-words text-sm leading-snug" style={{ color: messageColor }}>
                                                {message.text}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} className="h-4" />
                        </div>

                        <div className="relative z-10 border-t border-border bg-background/80 p-4 backdrop-blur-md">
                            {typed !== null && (
                                <div className="absolute bottom-full left-0 right-0 z-50 mx-auto w-full max-w-6xl pb-4">
                                    <div className="custom-scrollbar max-h-64 overflow-hidden overflow-y-auto rounded-md border border-border bg-card shadow-2xl backdrop-blur-md animate-fade-in-up">
                                        {suggestions.length > 0 ? (
                                            <ul className="py-2">
                                                {suggestions.map((entry) => (
                                                    <li
                                                        key={entry.name}
                                                        className="cursor-pointer px-6 py-2 transition-colors hover:bg-white/5"
                                                        onClick={() =>
                                                        {
                                                            setChatInput(`/${entry.name} `);
                                                            document.getElementById("chat-input")?.focus();
                                                        }}
                                                    >
                                                        <div className="flex items-baseline space-x-2">
                                                            <span className="font-bold text-primary">/{entry.name}</span>
                                                            {entry.args.map((arg) => (
                                                                <span
                                                                    key={arg.name}
                                                                    className={`text-xs font-semibold ${arg.required ? "text-foreground/80" : "text-muted-foreground"}`}
                                                                    title={arg.description}
                                                                >
                                                                    {arg.required ? `<${arg.name}>` : `[${arg.name}]`}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="mt-0.5 text-xs text-muted-foreground">{entry.description}</div>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="px-6 py-4 text-sm text-muted-foreground">No matching commands found.</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <form onSubmit={handleChatSubmit} className="relative mx-auto flex w-full max-w-6xl items-center">
                                <div className="absolute left-2 z-10 flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={uploadFile}
                                        className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary"
                                        title="Upload File"
                                    >
                                        <Paperclip size={18} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => send("/files")}
                                        className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary"
                                        title="View Files"
                                    >
                                        <Folder size={18} />
                                    </button>
                                </div>
                                <input
                                    id="chat-input"
                                    type="text"
                                    value={chatInput}
                                    onChange={(event) => setChatInput(event.currentTarget.value)}
                                    className="w-full rounded-md border border-input bg-card/50 py-3 pl-20 pr-12 text-sm text-foreground shadow-sm transition-all placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    placeholder="Type your message..."
                                    autoFocus
                                />
                                <button
                                    type="submit"
                                    disabled={!chatInput.trim()}
                                    className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-primary transition-all hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Send size={18} />
                                </button>
                            </form>
                        </div>
                    </div>

                    <div className="z-10 flex w-64 flex-col border-l border-border bg-card/30">
                        <div className="flex items-center justify-between border-b border-border p-4">
                            <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Channels</h2>
                            <button
                                onClick={() => setShowCreateChannel(true)}
                                className="rounded-sm p-1 text-primary transition-colors hover:bg-primary/10 hover:text-primary/80"
                                title="Create Channel"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                        <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
                            {channels.map((channel) =>
                            {
                                const current = channel === currentChannel;
                                const display = channel === LOBBY ? "chat lobby" : channel;
                                const here = users.filter((user) => (user.channel ?? LOBBY) === channel).length;

                                return (
                                    <React.Fragment key={display}>
                                        <button
                                            onClick={() => send(channel === LOBBY ? "/channel" : `/channel ${channel}`)}
                                            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                                current
                                                    ? "bg-primary/20 font-medium text-primary"
                                                    : "text-foreground/70 hover:bg-white/5 hover:text-foreground"
                                            }`}
                                        >
                                            <Hash size={14} className={current ? "text-primary" : "text-muted-foreground"} />
                                            <span className="truncate">{display}</span>
                                            <span className="ml-auto flex items-center gap-2">
                                                {here > 0 && <span className="text-xs text-muted-foreground">{here}</span>}
                                                {current && <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />}
                                            </span>
                                        </button>
                                        {channel === LOBBY && channels.length > 1 && <div className="mx-2 my-2 border-b border-border/50" />}
                                    </React.Fragment>
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
            {tofuOverlay}

            <div className="relative z-10 w-full max-w-md rounded-md border border-border bg-card/50 p-8 shadow-2xl backdrop-blur-sm animate-fade-in-up">
                <div className="mb-8 flex flex-col items-center justify-center text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 text-primary transition-all duration-300">
                        {renderIcon()}
                    </div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">{renderTitle()}</h1>
                    <p className="mt-2 text-sm text-muted-foreground">{renderDescription()}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label htmlFor="inputField" className="text-sm font-medium capitalize text-foreground">
                            {uiState === "server_select" ? "Server address" : uiState.split("_")[0]}
                        </label>
                        <input
                            id="inputField"
                            ref={loginInputRef}
                            type={uiState === "password_prompt" ? "password" : "text"}
                            value={inputValue}
                            onChange={(event) => setInputValue(event.currentTarget.value)}
                            placeholder={uiState === "server_select" ? "e.g., 192.168.1.100" : ""}
                            className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            autoFocus
                            disabled={connecting}
                        />
                        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
                        {errorMsg && <p className="mt-1 text-sm text-destructive">{errorMsg}</p>}
                    </div>

                    <button
                        type="submit"
                        disabled={!inputValue || connecting}
                        className="group flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-md transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {connecting ? "Processing..." : "Continue"}
                        {!connecting && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />}
                    </button>
                </form>
            </div>
        </main>
    );
}

export default App;
