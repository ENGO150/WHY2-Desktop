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
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./index.css";

//THE LOBBY HAS NO NAME - EVERY CHANNEL-KEYED MAP USES THE EMPTY STRING FOR IT
const LOBBY = "";

//WHAT REPLACING A PINNED KEY HAS TO BE TYPED OUT AS, SO IT CANNOT HAPPEN BY LEANING ON ENTER
const CHALLENGE = "yes";

//THE PROJECT LOGO, PAINTED IN THE MIDDLE OF THE MESSAGE PANE AS A WATERMARK
const LOGO = `                ▄█
  ▄▄▄▄        ▄███  ▄▄██
  ████▀███▀▀▀▀▀███▄██▀██
  ███▄▄   ▀██▄  ▀██▀ ▄█▀
  ▀▀█████▄       ▀▀ ▄██
    ▀▀ ▀███▄      ▀███
     ▄▄██▀██       ▀█▄
  ▄████▄▄██▀        ██
  ▀███████▄▄▄       ▀██
        ▀███         ██
        ███▀      ▄▄███
        ███▄▄▄▄▄████▀▀
        ██████▀▀▀▀`;

type UIState = "server_select" | "username_prompt" | "password_prompt" | "connected";

type MessageKind = "user" | "private" | "system" | "notice" | "ok" | "error";

interface ChatMessage
{
    kind: MessageKind;
    prefix: string | null;
    username: string;
    text: string;
    id: number | null;
    username_color: number | null;
    message_color: number | null;
}

interface BlockRow
{
    depth: number;
    id: number | null;
    text: string;
    note: string | null;
    accent: boolean;
    download: [number, number] | null;
}

//ONE THING IN THE PANE. THE TUI PRINTS ITS LISTS INTO THE SAME SCROLLBACK THE MESSAGES LIVE IN, SO A
///files IS AN ENTRY IN THE HISTORY RATHER THAN A WINDOW THAT COVERS IT
type PaneEntry =
    | { entry: "message"; message: ChatMessage }
    | { entry: "block"; title: string; rows: BlockRow[] };

interface OnlineUser
{
    username: string;
    id: number;
    channel: string | null;
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

interface ClientConfig
{
    show_id: boolean;
    disable_colors: boolean;
    disable_logo: boolean;
}

interface TofuPrompt
{
    host: string;
    hash: string;
    pinned: string | null;
    mismatch: boolean;
}

//ONE ROW OF THE COMMAND PALETTE. A COMMAND THAT IS NOTHING BUT A DOORWAY TO ITS ACTIONS IS LISTED AS
//ITS ACTIONS, THE WAY THE TUI LISTS THEM - "/server" ALONE RUNS NOTHING
interface PaletteEntry
{
    name: string;
    description: string;
    args: CommandArgInfo[];
}

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
    | { event: "users"; data: { users: OnlineUser[] } }
    | { event: "user_left"; data: { id: number } }
    | { event: "block"; data: { title: string; rows: BlockRow[] } }
    | { event: "channel_changed"; data: { channel: string | null } }
    | { event: "channel_created"; data: { name: string } }
    | { event: "channel_destroyed"; data: { name: string } }
    | { event: "disconnected"; data: { reason: string | null } };

//THE SIXTEEN COLORS THE PROTOCOL CARRIES, AS THE TERMINAL WOULD HAVE PAINTED THEM
const ANSI: Record<number, string> =
{
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
};

//THE FINGERPRINT IS 64 HEX CHARS - GROUPED IN EIGHTS AND BROKEN INTO ROWS SO IT CAN ACTUALLY BE
//COMPARED AGAINST WHAT THE OPERATOR PUBLISHED
function fingerprint(hash: string): string[]
{
    const groups = hash.match(/.{1,8}/g) ?? [];
    const rows: string[] = [];

    for (let index = 0; index < groups.length; index += 4)
    {
        rows.push(groups.slice(index, index + 4).join(" "));
    }

    return rows;
}

//EVERY LIST BLOCK IS A TREE: ONE BRANCH PER ROW, THEN A RIGHT-ALIGNED ID COLUMN, THEN THE NAME.
//THE TRUNK KEEPS RUNNING PAST A NESTED ROW UNLESS ITS OWNER WAS THE LAST ONE
function branches(rows: BlockRow[]): string[]
{
    const last = rows.map((row, index) =>
    {
        for (let next = index + 1; next < rows.length; next++)
        {
            if (rows[next].depth < row.depth) break;
            if (rows[next].depth === row.depth) return false;
        }

        return true;
    });

    return rows.map((row, index) =>
    {
        const branch = last[index] ? "╰─ " : "├─ ";

        if (row.depth === 0) return branch;

        let owner = index;
        while (owner >= 0 && rows[owner].depth !== 0) owner--;

        return `${owner < 0 || last[owner] ? "   " : "│  "}${branch}`;
    });
}

//A BORDERED BOX WITH ITS NAME SITTING IN THE TOP BORDER, AND ITS STATUS IN THE BOTTOM ONE
function Panel(
{
    title,
    active,
    danger,
    left,
    right,
    className,
    children,
}: {
    title?: string;
    active?: boolean;
    danger?: boolean;
    left?: React.ReactNode;
    right?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
})
{
    const border = danger ? "border-error" : active ? "border-border-active" : "border-border";
    const titleColor = danger ? "text-error" : "text-title";

    return (
        <div className={`relative min-h-0 rounded-md border ${border} ${className ?? ""}`}>
            {title && (
                <span className={`absolute -top-[0.65em] left-3 bg-background px-1 font-bold ${titleColor}`}>
                    {title}
                </span>
            )}
            {children}
            {left && <span className="absolute -bottom-[0.65em] left-3 bg-background px-1 text-muted-foreground">{left}</span>}
            {right && <span className="absolute -bottom-[0.65em] right-3 bg-background px-1 text-muted-foreground">{right}</span>}
        </div>
    );
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
    const [address, setAddress] = useState("");
    const [serverName, setServerName] = useState("");
    const [username, setUsername] = useState("");
    const [role, setRole] = useState("user");
    const [paneByChannel, setPaneByChannel] = useState<Record<string, PaneEntry[]>>({});
    const [popupMessage, setPopupMessage] = useState("");
    const [commands, setCommands] = useState<CommandInfo[]>([]);
    const [config, setConfig] = useState<ClientConfig>({ show_id: false, disable_colors: false, disable_logo: false });
    const [tofu, setTofu] = useState<TofuPrompt | null>(null);
    const [tofuTyped, setTofuTyped] = useState("");
    const [users, setUsers] = useState<OnlineUser[]>([]);
    const [activeChannels, setActiveChannels] = useState<string[]>([]);
    const [currentChannel, setCurrentChannel] = useState(LOBBY);
    const [selected, setSelected] = useState(0);
    const [unread, setUnread] = useState(0);

    const paneRef = useRef<HTMLDivElement>(null);
    const addressRef = useRef("");
    const loginInputRef = useRef<HTMLInputElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);

    //THE EVENT LISTENER IS REGISTERED ONCE, SO IT READS THE CHANNEL THROUGH A REF - A CAPTURED ONE
    //WOULD BE WHATEVER IT WAS WHEN THE SESSION STARTED
    const currentChannelRef = useRef(currentChannel);

    //THE PANE FOLLOWS THE BOTTOM ONLY WHILE IT IS ALREADY THERE; SCROLLING UP PARKS IT AND COUNTS
    //WHAT ARRIVES, WHICH IS WHAT THE "↓ n new" IN THE BOTTOM BORDER IS
    const pinnedRef = useRef(true);

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

    const pane = paneByChannel[currentChannel] ?? [];

    useEffect(() =>
    {
        if (!pinnedRef.current) return;

        const node = paneRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [paneByChannel, currentChannel]);

    //A CHANNEL EXISTS EXACTLY AS LONG AS SOMEBODY SITS IN IT, SO THE ROSTER IS THE WHOLE TRUTH ABOUT
    //WHICH ONES THERE ARE - AND THE SCROLLBACK OF ONE NOBODY IS IN ANY MORE IS NOT WORTH KEEPING
    useEffect(() =>
    {
        const channels = new Set(users.map((user) => user.channel ?? LOBBY));
        channels.add(LOBBY);

        setActiveChannels(Array.from(channels));

        setPaneByChannel((previous) =>
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
    }, [users]);

    const push = (...entries: PaneEntry[]) =>
    {
        const channel = currentChannelRef.current;

        setPaneByChannel((previous) => ({ ...previous, [channel]: [...(previous[channel] ?? []), ...entries] }));

        if (!pinnedRef.current) setUnread((previous) => previous + entries.length);
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

        //THE BOX COMES BACK AT THE ADDRESS STEP WITH THE ADDRESS STILL IN IT, SO THE NEXT TRY (HERE OR
        //ELSEWHERE) IS ONE KEYSTROKE AWAY
        setInputValue(addressRef.current);
        setChatInput("");
        setPaneByChannel({});
        setUsers([]);
        setActiveChannels([]);
        setCurrentChannel(LOBBY);
        setCommands([]);
        setTofu(null);
        setTofuTyped("");
        setServerName("");
        setUsername("");
        setRole("user");
        setUnread(0);

        pinnedRef.current = true;
    };

    useEffect(() =>
    {
        invoke<ClientConfig>("get_client_config").then(setConfig).catch(console.error);

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
                    setHint(registration ? `a-Z, 0-9; ${min}-${max} characters` : "Registration is disabled.");
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
                    push({ entry: "message", message: payload.data.message });
                    break;
                }

                case "history":
                {
                    push(...payload.data.messages.map((message): PaneEntry => ({ entry: "message", message })));
                    break;
                }

                case "block":
                {
                    push({ entry: "block", title: payload.data.title, rows: payload.data.rows });
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
                    setUsers(payload.data.users);
                    break;
                }

                case "user_left":
                {
                    setUsers((previous) => previous.filter((user) => user.id !== payload.data.id));
                    break;
                }

                case "channel_changed":
                {
                    setCurrentChannel(payload.data.channel ?? LOBBY);

                    pinnedRef.current = true;
                    setUnread(0);
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

                    setPaneByChannel((previous) =>
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
                    resetSession(payload.data.reason ?? "");
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
            if (uiState === "server_select")
            {
                setAddress(inputValue);
                addressRef.current = inputValue;

                await invoke("connect_to_server", { address: inputValue });
            }
            else
            {
                if (uiState === "username_prompt") setUsername(inputValue);

                await invoke("send_input", { input: inputValue });
            }
        }
        catch (error: unknown)
        {
            setErrorMsg(String(error));
            setConnecting(false);
        }
    };

    //THE PROMPT IS ANSWERED IN-BAND: THE LISTENING TASK IS PARKED ON IT, AND ON A YES IT PINS THE KEY
    //AND DIALS AGAIN ITSELF - NOTHING HERE HAS TO RECONNECT
    const answerTofu = (accept: boolean) =>
    {
        if (accept && tofu?.mismatch && tofuTyped !== CHALLENGE) return;

        setTofu(null);
        setTofuTyped("");

        invoke("answer_tofu", { accept }).catch((error: unknown) => setErrorMsg(String(error)));

        //REJECTING ENDS THE SESSION, AND THE DISCONNECT THAT FOLLOWS CARRIES THE REASON ITSELF
        if (accept)
        {
            setConnecting(true);
            setErrorMsg("");
        }
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

    useEffect(() => { setSelected(0); }, [typed]);

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

    const complete = () =>
    {
        const entry = suggestions[selected];
        if (!entry) return;

        setChatInput(`/${entry.name} `);
        chatInputRef.current?.focus();
    };

    const handleChatKey = (event: React.KeyboardEvent<HTMLInputElement>) =>
    {
        if (suggestions.length === 0) return;

        if (event.key === "ArrowDown")
        {
            event.preventDefault();
            setSelected((previous) => (previous + 1) % suggestions.length);
        }
        else if (event.key === "ArrowUp")
        {
            event.preventDefault();
            setSelected((previous) => (previous - 1 + suggestions.length) % suggestions.length);
        }
        else if (event.key === "Tab")
        {
            event.preventDefault();
            complete();
        }
        else if (event.key === "Enter")
        {
            const entry = suggestions[selected];

            //ENTER FINISHES THE COMMAND WORD WHILE THE PALETTE IS STILL OFFERING ONE. ONCE IT IS
            //FINISHED - OR A PARAMETER HAS BEEN STARTED - IT SENDS THE LINE LIKE ANY OTHER
            if (entry && entry.name !== typed && !typed?.startsWith(`${entry.name} `))
            {
                event.preventDefault();
                complete();
            }
        }
    };

    const handleChatSubmit = (event: React.FormEvent) =>
    {
        event.preventDefault();
        if (!chatInput.trim()) return;

        send(chatInput);
        setChatInput("");
    };

    const onPaneScroll = () =>
    {
        const node = paneRef.current;
        if (!node) return;

        pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;

        if (pinnedRef.current) setUnread(0);
    };

    const color = (code: number | null): string | undefined =>
        (code === null || config.disable_colors ? undefined : ANSI[code]);

    //THE PANE'S TITLE IS THE WHOLE OF WHAT WE ARE CONNECTED TO: WHY2 ── <SERVER> ── <ADDRESS AS TYPED>
    const paneTitle = ` ${["WHY2", serverName, address].filter(Boolean).join(" ── ")} `;

    const status = [currentChannel && `#${currentChannel}`, username].filter(Boolean).join(" │ ");

    //ID FIRST, RIGHT-ALIGNED, SO THE USERNAMES LINE UP IN ONE COLUMN
    const idWidth = useMemo(() => Math.max(...users.map((user) => String(user.id).length), 1), [users]);

    const renderMessage = (message: ChatMessage, key: number) =>
    {
        const spoken = message.kind === "user" || message.kind === "private";

        const tone =
        {
            user: "",
            private: "text-accent",
            system: "text-muted-foreground",
            notice: "text-notice",
            ok: "text-ok",
            error: "text-error",
        }[message.kind];

        return (
            <div key={key} className="whitespace-pre-wrap break-words">
                {message.prefix && <span className="text-muted-foreground">{message.prefix} </span>}
                {spoken && (
                    <>
                        <span style={{ color: color(message.username_color) }}>{message.username}</span>
                        {config.show_id && message.id !== null && (
                            <span className="text-muted-foreground"> ({message.id})</span>
                        )}
                        <span>: </span>
                    </>
                )}
                <span className={tone} style={{ color: spoken ? color(message.message_color) : undefined }}>
                    {message.text}
                </span>
            </div>
        );
    };

    const renderBlock = (title: string, rows: BlockRow[], key: number) =>
    {
        const glyphs = branches(rows);

        //THE ID COLUMN IS AS WIDE AS THE WIDEST ID ON ITS OWN LEVEL, SO THE NAMES LINE UP UNDER EACH OTHER
        const widths = rows.reduce<Record<number, number>>((widths, row) =>
        {
            const width = row.id === null ? 1 : String(row.id).length;
            widths[row.depth] = Math.max(widths[row.depth] ?? 1, width);

            return widths;
        }, {});

        return (
            <div key={key}>
                <div className="font-bold text-title">{title}:</div>
                {rows.map((row, index) =>
                {
                    //THE TWO IDS A FILE ROW CARRIES ARE THE TWO ARGUMENTS TO /download, SO CLICKING ONE
                    //SENDS EXACTLY WHAT TYPING IT OUT WOULD HAVE
                    const download = row.download;

                    return (
                    <div
                        key={index}
                        className={`whitespace-pre ${download ? "cursor-pointer hover:bg-selected" : ""}`}
                        onClick={download ? () => send(`/download ${download[0]} ${download[1]}`) : undefined}
                        title={download ? "Download" : undefined}
                    >
                        <span className="text-border">{glyphs[index]}</span>
                        {row.id !== null && (
                            <span className="text-muted-foreground">{String(row.id).padStart(widths[row.depth])}  </span>
                        )}
                        <span className={row.accent ? "text-accent" : ""}>{row.text}</span>
                        {row.note && <span className="text-muted-foreground">  {row.note}</span>}
                    </div>
                    );
                })}
            </div>
        );
    };

    const connected = uiState === "connected";

    //THE CONNECT BOX ASKS FOR EVERYTHING UNTIL WE ARE IN, AND THE SERVER-KEY PROMPT COVERS EVEN THAT,
    //BECAUSE IT IS THE ONLY THING THE USER MAY ANSWER WHILE IT IS UP
    const loginBox = !connected && !tofu && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 px-4">
            <Panel
                active
                title={` ${
                    {
                        server_select: "Connect",
                        username_prompt: "Identify",
                        password_prompt: registering ? "Register" : "Log in",
                        connected: "",
                    }[uiState]
                } `}
                left={connecting ? undefined : uiState === "server_select" ? " ⏎ connect " : " ⏎ continue "}
                className="w-full max-w-[52ch] bg-background p-3"
            >
                <form onSubmit={handleSubmit}>
                    <div className="text-muted-foreground">
                        {uiState === "server_select" ? "Server address" : uiState === "username_prompt" ? "Username" : "Password"}
                    </div>
                    <div className="flex items-baseline">
                        <span className="text-accent">&gt;&nbsp;</span>
                        <input
                            ref={loginInputRef}
                            type={uiState === "password_prompt" ? "password" : "text"}
                            value={inputValue}
                            onChange={(event) => setInputValue(event.currentTarget.value)}
                            className="w-full bg-transparent text-foreground caret-accent outline-none"
                            disabled={connecting}
                            autoFocus
                            spellCheck={false}
                        />
                    </div>

                    {/* THE STATUS ROW, ALWAYS IN THE SAME PLACE: WHAT IS HAPPENING, WHAT WENT WRONG,
                        OR THE SERVER'S RULES */}
                    <div className="mt-2 min-h-[1.5em]">
                        {connecting
                            ? <span className="text-accent">{uiState === "server_select" ? "Connecting…" : "Waiting for the server…"}</span>
                            : errorMsg
                                ? <span className="text-error">{errorMsg}</span>
                                : <span className="text-muted-foreground">{hint}</span>}
                    </div>
                </form>
            </Panel>
        </div>
    );

    const tofuBox = tofu && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 px-4">
            <Panel
                danger
                title={` ${tofu.mismatch ? "Server identity changed" : "Unknown server identity"} `}
                left={tofu.mismatch ? " type the word │ ⏎ confirm " : " ⏎ confirm "}
                className="w-full max-w-[64ch] bg-background p-3"
            >
                <p className="whitespace-pre-wrap text-notice">
                    {tofu.mismatch
                        ? "The server is presenting a different identity key than the one pinned for this address. Either the operator replaced the server's keys, or somebody is sitting between you and it."
                        : "This address has no pinned identity key yet. Accept it only if the fingerprint below matches the one the server's operator published."}
                </p>

                <div className="mt-3 whitespace-pre">
                    <div>
                        <span className="text-muted-foreground">Server   </span>
                        {tofu.host}
                    </div>
                    {fingerprint(tofu.pinned ?? "").map((row, index) => (
                        <div key={row} className="text-muted-foreground">
                            <span>{index === 0 ? "Pinned   " : "         "}</span>
                            {row}
                        </div>
                    ))}
                    {fingerprint(tofu.hash).map((row, index) => (
                        <div key={row}>
                            <span className="text-muted-foreground">
                                {index === 0 ? (tofu.mismatch ? "New key  " : "Key      ") : "         "}
                            </span>
                            <span className="text-accent">{row}</span>
                        </div>
                    ))}
                </div>

                {/* REPLACING A PINNED KEY HAS TO BE TYPED OUT - A FIRST CONTACT IS THE ONLY ONE A BUTTON ANSWERS */}
                {tofu.mismatch && (
                    <div className="mt-3">
                        <div>Type '{CHALLENGE}' to replace the pinned key with this one:</div>
                        <div className="flex items-baseline justify-center">
                            <input
                                type="text"
                                value={tofuTyped}
                                onChange={(event) => setTofuTyped(event.currentTarget.value.toLowerCase())}
                                onKeyDown={(event) => { if (event.key === "Enter") answerTofu(true); }}
                                className="w-[8ch] bg-transparent text-center text-accent caret-accent outline-none"
                                autoFocus
                                spellCheck={false}
                            />
                        </div>
                    </div>
                )}

                <div className="mt-3 flex justify-center gap-4">
                    <button onClick={() => answerTofu(false)} className="px-2 text-error hover:bg-selected">
                        &nbsp;Reject&nbsp;
                    </button>
                    <button
                        onClick={() => answerTofu(true)}
                        disabled={tofu.mismatch && tofuTyped !== CHALLENGE}
                        className="px-2 text-ok hover:bg-selected disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        &nbsp;{tofu.mismatch ? "Replace pinned key" : "Trust & save"}&nbsp;
                    </button>
                </div>
            </Panel>
        </div>
    );

    return (
        <main className="noise-overlay relative flex h-screen w-screen flex-col bg-background font-mono text-sm text-foreground">
            {popupMessage && (
                <div className="absolute right-6 top-4 z-50 whitespace-nowrap rounded-md border border-border bg-background px-3 py-1 text-muted-foreground">
                    {popupMessage}
                </div>
            )}

            <div className="flex min-h-0 flex-1 gap-2 p-2">
                <Panel
                    title={paneTitle}
                    right={unread > 0 ? <span className="text-notice">{` ↓ ${unread} new `}</span> : undefined}
                    className="flex flex-1 flex-col"
                >
                    {!config.disable_logo && (
                        <div className="pointer-events-none absolute inset-0 z-0 flex select-none items-center justify-center">
                            <pre className="whitespace-pre text-logo">{LOGO}</pre>
                        </div>
                    )}

                    <div ref={paneRef} onScroll={onPaneScroll} className="custom-scrollbar relative z-10 min-h-0 flex-1 overflow-auto px-3 py-1">
                        {pane.map((entry, index) => entry.entry === "message"
                            ? renderMessage(entry.message, index)
                            : renderBlock(entry.title, entry.rows, index))}
                    </div>

                    {/* THE PALETTE SITS ON THE BOTTOM EDGE OF THE MESSAGE PANE, DIRECTLY ABOVE THE INPUT */}
                    {connected && typed !== null && (
                        <div className="absolute inset-x-0 bottom-0 z-20 px-1 pb-1">
                            <Panel
                                active
                                title=" Commands "
                                left={suggestions.length > 0 ? " ↑↓ select │ ⇥ complete " : undefined}
                                className="bg-background"
                            >
                                <div className="custom-scrollbar max-h-60 overflow-auto py-1">
                                    {suggestions.length > 0 ? suggestions.map((entry, index) => (
                                        <div
                                            key={entry.name}
                                            onMouseEnter={() => setSelected(index)}
                                            onClick={complete}
                                            className={`flex cursor-pointer items-baseline gap-2 whitespace-pre px-2 ${index === selected ? "bg-selected" : ""}`}
                                        >
                                            <span className="text-accent">{index === selected ? "▌" : " "}</span>
                                            <span className="font-bold text-title">/{entry.name}</span>
                                            {entry.args.map((arg) => (
                                                <span key={arg.name} className={arg.required ? "text-arg-required" : "text-arg-optional"}>
                                                    {arg.required ? `<${arg.name}>` : `[${arg.name}]`}
                                                </span>
                                            ))}
                                            <span className="ml-auto pl-4 text-muted-foreground">{entry.description}</span>
                                        </div>
                                    )) : (
                                        <div className="px-3 text-muted-foreground">No matching commands.</div>
                                    )}
                                </div>
                            </Panel>
                        </div>
                    )}
                </Panel>

                {/* THE SIDEBAR HAS NOBODY TO LIST UNTIL WE ARE AUTHENTICATED - DO NOT SPEND THE WIDTH ON IT */}
                {connected && (
                    <div className="flex w-[26ch] shrink-0 flex-col gap-2">
                        <Panel title={` Online (${users.length}) `} className="flex flex-1 flex-col">
                            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto px-3 py-1">
                                {users.map((user) => (
                                    <div key={user.id} className="whitespace-pre">
                                        <span className="text-muted-foreground">
                                            {String(user.id).padStart(idWidth)}
                                            &nbsp;&nbsp;
                                        </span>
                                        <span className={user.username === username ? "text-accent" : ""}>{user.username}</span>
                                    </div>
                                ))}
                            </div>
                        </Panel>

                        {/* A CHANNEL LIVES EXACTLY AS LONG AS SOMEBODY SITS IN IT, SO WITH NOBODY OUT
                            THERE THE PANEL HAS NOTHING TO SAY - THE LOBBY IS WHERE WE ALREADY ARE */}
                        {channels.length > 1 && (
                        <Panel title={` Channels (${channels.length}) `} className="flex max-h-[40%] flex-col">
                            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto px-3 py-1">
                                {channels.map((channel) =>
                                {
                                    const here = channel === currentChannel;

                                    return (
                                        <div
                                            key={channel || "lobby"}
                                            onClick={() => send(channel === LOBBY ? "/channel" : `/channel ${channel}`)}
                                            className="cursor-pointer whitespace-pre hover:bg-selected"
                                        >
                                            <span className="text-accent">{here ? "▸ " : "  "}</span>
                                            <span className="text-muted-foreground">#</span>
                                            <span className={here ? "text-accent" : ""}>{channel === LOBBY ? "lobby" : channel}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </Panel>
                        )}
                    </div>
                )}
            </div>

            {/* THE INPUT HAS NOTHING TO SAY UNTIL WE ARE IN, THE SAME WAY THE SIDEBAR HAS NOBODY TO LIST */}
            {connected && (
                <div className="px-2 pb-2">
                    <Panel
                        active
                        left={status && ` ${status} `}
                        right={
                            <span className="whitespace-pre">
                                {" "}
                                <button onClick={uploadFile} className="hover:text-accent">upload</button>
                                {" │ "}
                                <button onClick={() => send("/files")} className="hover:text-accent">files</button>
                                {" │ "}
                                <span className="text-accent">{role}</span>
                                {" │ "}
                                <button onClick={() => send("/exit")} className="hover:text-error">exit</button>
                                {" "}
                            </span>
                        }
                        className="p-2"
                    >
                        <form onSubmit={handleChatSubmit} className="flex items-baseline">
                            <span className="text-accent">&gt;&nbsp;</span>
                            <input
                                ref={chatInputRef}
                                id="chat-input"
                                type="text"
                                value={chatInput}
                                onChange={(event) => setChatInput(event.currentTarget.value)}
                                onKeyDown={handleChatKey}
                                className="w-full bg-transparent text-foreground caret-accent outline-none"
                                autoFocus
                                spellCheck={false}
                            />
                        </form>
                    </Panel>
                </div>
            )}

            {loginBox}
            {tofuBox}
        </main>
    );
}

export default App;
