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
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import "./index.css";

import { LOBBY } from "./types";
import type
{
    UIState,
    StoredServer,
    DirectPeer,
    DirectChat,
    ScreenState,
    ScreenUser,
    FileOwner,
    PaneEntry,
    OnlineUser,
    ArgValues,
    AudioDevices,
    CommandInfo,
    ClientSetting,
    SettingsItem,
    SettingsBox,
    Picker,
    VoiceState,
    VocabularyValue,
    ClientConfig,
    TofuPrompt,
    PaletteEntry,
    PaletteShape,
    PaletteState,
    BridgeEvent,
} from "./types";

import { ANSI_TRUE } from "./theme";
import { Icon, IconButton } from "./icons";
import { isKeyFrame, h264Config } from "./video";
import { PALETTE_ROWS, analyze, entryTyped, formatArg } from "./palette";
import type { History } from "./history";
import { historyUp, historyDown, pushHistory } from "./history";
import { useNarrow, SWIPE, SWIPE_SLOPE, SWIPE_SLOP, DRAWER_MS } from "./narrow";
import { TofuDialog, CHALLENGE } from "./tofu";
import { ScreensBox } from "./screens";
import { FilesBox } from "./files";
import { LoginScreen } from "./login";
import type { ServerForm } from "./servers";
import { ServerRail, AddServerDialog } from "./servers";
import { SettingsDialog } from "./settings-dialog";
import { Sidebar } from "./sidebar";
import { MemberColumn } from "./members";
import { renderNotice, renderChat, renderBlock } from "./messages";
import
{
    RESTART_LABEL,
    NO_DEVICES,
    deviceEntries,
    clientRows,
    serverRows,
    stepRow,
    landRow,
    unsavedRows,
} from "./settings";

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

    //THE SERVERS THIS WINDOW REMEMBERS, WHICHEVER OF THEM IS IN FRONT, AND THE FORM THAT ADDS ONE. THE
    //TERMINAL CLIENT IS RUN AT A SERVER AND ASKS FOR EVERYTHING EVERY TIME; A WINDOW IS LEFT OPEN, SO
    //THE ADDRESS AND THE IDENTITY ARE ASKED ONCE AND KEPT (servers.rs, IN A FILE ONLY THE USER CAN READ)
    const [servers, setServers] = useState<StoredServer[]>([]);
    const [dialing, setDialing] = useState<StoredServer | null>(null);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState<ServerForm>({ address: "", username: "", password: "" });
    const [serverName, setServerName] = useState("");
    const [username, setUsername] = useState("");
    const [role, setRole] = useState("user");
    const [paneByChannel, setPaneByChannel] = useState<Record<string, PaneEntry[]>>({});
    const [popupMessage, setPopupMessage] = useState("");
    const [commands, setCommands] = useState<CommandInfo[]>([]);
    const [config, setConfig] = useState<ClientConfig>({ show_id: false, disable_colors: false });
    const [tofu, setTofu] = useState<TofuPrompt | null>(null);
    const [tofuTyped, setTofuTyped] = useState("");
    const [users, setUsers] = useState<OnlineUser[]>([]);
    const [activeChannels, setActiveChannels] = useState<string[]>([]);
    const [currentChannel, setCurrentChannel] = useState(LOBBY);

    //THE CONVERSATIONS, KEYED BY THE OTHER PERSON'S ID, AND WHICH OF THEM THE MIDDLE COLUMN IS SHOWING.
    //A CONVERSATION IS OPEN BECAUSE SOMEBODY OPENED IT OR BECAUSE SOMETHING ARRIVED IN IT - THE SERVER
    //KNOWS NOTHING ABOUT ANY OF THIS, WHICH IS ALSO WHY IT LASTS EXACTLY AS LONG AS THE SESSION DOES
    const [dms, setDms] = useState<Record<number, DirectChat>>({});
    const [openDm, setOpenDm] = useState<number | null>(null);
    const [selected, setSelected] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [settings, setSettings] = useState<SettingsBox | null>(null);
    const [vocabulary, setVocabulary] = useState<{ kind: ArgValues; values: VocabularyValue[] }>({ kind: "free", values: [] });
    const [unread, setUnread] = useState(0);
    const [voice, setVoice] = useState<VoiceState>({ enabled: false, mic: false, users: [] });
    const [screen, setScreen] = useState<ScreenState>({ sharing: false, monitor: null });

    //THE SCREEN WINDOW: WHICH OF OURS TO SHARE, AND WHOSE TO WATCH. THE MONITORS ARE ENUMERATED WHEN IT
    //OPENS AND NOT KEPT - ONE PLUGGED IN MID-SESSION IS SUPPOSED TO SHOW UP WITHOUT A RECONNECT - AND THE
    //SHARERS ARE WHATEVER THE SERVER LAST ANSWERED, SINCE IT NEVER SAYS ON ITS OWN THAT SOMEBODY STARTED
    const [screensOpen, setScreensOpen] = useState(false);
    const [monitors, setMonitors] = useState<string[]>([]);
    const [sharers, setSharers] = useState<ScreenUser[]>([]);

    //WHOSE SCREEN THE PANE IS DRAWING, AND WHAT STOPPED IT FROM DRAWING ONE
    const [watching, setWatching] = useState<string | null>(null);
    const [viewerError, setViewerError] = useState("");

    //WHICH OF THE TWO THE MIDDLE COLUMN IS SHOWING WHILE A SCREEN IS BEING WATCHED, AND WHO IS DECODING IT
    const [view, setView] = useState<"chat" | "screen">("chat");
    const [decoding, setDecoding] = useState<"webview" | "bridge" | "">("");

    //THE MEMBER COLUMN IS A VIEW PREFERENCE AND NOT A SESSION FACT, SO IT SURVIVES A RECONNECT
    const [members, setMembers] = useState(true);

    //WHAT IS UP FOR DOWNLOAD, WHILE THE WINDOW SHOWING IT IS OPEN, AND WHAT IS BEING LOOKED FOR IN IT
    const [files, setFiles] = useState<FileOwner[] | null>(null);
    const [filter, setFilter] = useState("");

    //THE NAME OF THE CHANNEL BEING MADE, WHILE ONE IS BEING MADE. THERE IS NO COMMAND FOR CREATING ONE -
    //A CHANNEL IS WHEREVER SOMEBODY IS STANDING, SO THIS IS /channel WITH A NAME NOBODY IS IN YET
    const [creating, setCreating] = useState<string | null>(null);

    //THE PHONE LAYOUT, AND WHICHEVER SIDEBAR IS SLID OVER THE CONVERSATION RIGHT NOW. NEITHER OF THEM
    //MEANS ANYTHING ON A WIDE WINDOW, WHERE BOTH COLUMNS SIMPLY STAND WHERE THEY ARE
    const narrow = useNarrow();
    const [drawer, setDrawer] = useState<"left" | "right" | null>(null);

    //THE LINES ALREADY SENT. IT IS A REF AND NOT STATE BECAUSE NOTHING IS DRAWN FROM IT - IT IS READ AND
    //WRITTEN BY ONE KEYPRESS AT A TIME, AND A RE-RENDER PER ARROW WOULD BE ONE PER RECALLED LINE ANYWAY
    const historyRef = useRef<History>({ entries: [], pos: 0, stash: null, prefix: null });

    const paneRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef<HTMLDivElement>(null);
    const filesRef = useRef<HTMLDivElement>(null);
    const addRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const settingsRowRef = useRef<HTMLDivElement>(null);
    const pickerRowRef = useRef<HTMLDivElement>(null);
    const addressRef = useRef("");

    //THE ENTRY THIS DIAL BELONGS TO, AND WHAT IS LEFT OF ITS STORED IDENTITY TO ANSWER THE SERVER WITH.
    //A CREDENTIAL IS CONSUMED AS IT IS SENT, SO ONE THE SERVER REFUSED IS ASKED FOR RATHER THAN RESENT
    const entryRef = useRef<StoredServer | null>(null);
    const credsRef = useRef({ username: "", password: "" });

    //AND WHAT ACTUALLY GOT US IN, WHICHEVER OF THE TWO IT CAME FROM - THAT IS WHAT IS WORTH REMEMBERING
    const typedRef = useRef({ username: "", password: "" });

    //WHAT THE SERVER CALLS ITSELF, WHERE TO GO ONCE THIS SOCKET IS GONE, AND WHETHER ANYTHING HAS BEEN
    //DIALLED AT ALL - THE LIST IS READ ONCE AT STARTUP, AND StrictMode READS IT TWICE
    const serverNameRef = useRef("");
    const switchRef = useRef<StoredServer | null>(null);
    const loginInputRef = useRef<HTMLInputElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);

    //THE EVENT LISTENER IS REGISTERED ONCE, SO IT READS THE CHANNEL THROUGH A REF - A CAPTURED ONE
    //WOULD BE WHATEVER IT WAS WHEN THE SESSION STARTED
    const currentChannelRef = useRef(currentChannel);

    //AND SO IS THE CONVERSATION IN FRONT: A LINE THAT LANDS IN THE ONE BEING READ IS NOT UNREAD
    const openDmRef = useRef(openDm);

    //THE PANE FOLLOWS THE BOTTOM ONLY WHILE IT IS ALREADY THERE; SCROLLING UP PARKS IT AND COUNTS
    //WHAT ARRIVES, WHICH IS WHAT THE "↓ n new" IN THE BOTTOM BORDER IS
    const pinnedRef = useRef(true);

    useEffect(() =>
    {
        currentChannelRef.current = currentChannel;
    }, [currentChannel]);

    //A DRAWER IS A NARROW WINDOW'S IDEA ONLY. DRAGGING THE WINDOW WIDE PUTS THE COLUMNS BACK WHERE THEY
    //BELONG, AND A DRAWER LEFT OPEN BEHIND THEM WOULD BE A PANEL FLOATING OVER ITS OWN TWIN
    useEffect(() => { if (!narrow) setDrawer(null); }, [narrow]);

    useEffect(() =>
    {
        openDmRef.current = openDm;
    }, [openDm]);

    useEffect(() =>
    {
        if (!popupMessage) return;

        const timer = setTimeout(() => setPopupMessage(""), 3500);
        return () => clearTimeout(timer);
    }, [popupMessage]);

    useEffect(() =>
    {
        //A SOFT KEYBOARD IS HALF THE SCREEN, AND ON THE CONNECT SCREEN THE OTHER HALF IS THE LIST OF
        //SERVERS TO PICK FROM - SO ON A PHONE IT OPENS WHEN THE FIELD IS TAPPED, LIKE THE COMPOSER
        if (connecting || narrow || uiState === "connected") return;

        //THE FIELD IS REPLACED BETWEEN THE IDENTITY STEPS, SO THE FOCUS HAS TO FOLLOW IT
        const timer = setTimeout(() => loginInputRef.current?.focus(), 10);
        return () => clearTimeout(timer);
    }, [uiState, connecting, narrow]);

    const connected = uiState === "connected";

    //THE PICTURE GETS THE WHOLE WINDOW. A SCREEN IS SOMEBODY'S WHOLE MONITOR, AND EVERY COLUMN LEFT
    //STANDING BESIDE IT IS TAKEN OFF THE ONLY THING ANYBODY IS LOOKING AT
    const theater = connected && watching !== null && view === "screen";

    //THE SERVER'S OWN CONFIG IS BEHIND A ROLE, AND THE COMMAND LIST IS ALREADY FILTERED BY THE ONE THE
    //SERVER GRANTED US - SO THE DOOR IS DRAWN EXACTLY WHERE THERE IS SOMETHING BEHIND IT
    const canServerSettings = commands.some((command) => command.name === "server"
        && command.subcommands.some((sub) => sub.triggers.includes("settings")));

    //AND THE CALL AND THE SCREEN SHARE ARE ASKED THE SAME WAY. THE ANDROID BUILD IS COMPILED WITHOUT
    //client_voice/client_screen, SO THE COMMANDS THEY WOULD BE DRIVEN THROUGH ARE NOT IN THE LIST AT ALL -
    //WHICH MAKES THE COMMAND LIST THE ONE HONEST ANSWER TO "CAN THIS BUILD DO IT", ON EITHER PLATFORM
    const hasVoice = commands.some((command) => command.name === "voice");
    const hasScreens = commands.some((command) => command.name === "screens");

    //AND NO DRAWER SURVIVES THE PICTURE TAKING THE WHOLE SCREEN
    useEffect(() => { if (theater) setDrawer(null); }, [theater]);

    //WHOEVER THE MIDDLE COLUMN IS TALKING TO, WHILE IT IS A PERSON AND NOT A CHANNEL
    const dm = openDm === null ? null : dms[openDm] ?? null;

    const pane = dm ? dm.pane : paneByChannel[currentChannel] ?? [];

    useEffect(() =>
    {
        if (!pinnedRef.current) return;

        const node = paneRef.current;
        if (node) node.scrollTop = node.scrollHeight;
    }, [paneByChannel, currentChannel, dms, openDm]);

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

        //THE COUNT IN THE BOTTOM BORDER IS ABOUT THE PANE BEING LOOKED AT, AND A CONVERSATION IN FRONT
        //MEANS THIS IS NOT IT
        if (!pinnedRef.current && openDmRef.current === null) setUnread((previous) => previous + entries.length);
    };

    //A PRIVATE MESSAGE GOES TO THE CONVERSATION IT BELONGS TO, WHICH IS STARTED HERE IF THERE WAS NONE -
    //SOMEBODY WRITING TO US IS EXACTLY AS MUCH A REASON FOR ONE TO EXIST AS US WRITING TO THEM
    const pushDirect = (peer: DirectPeer, entry: PaneEntry) =>
    {
        const reading = openDmRef.current === peer.id;

        setDms((previous) =>
        {
            const chat = previous[peer.id] ?? { id: peer.id, username: peer.username, pane: [], unread: 0 };

            return { ...previous, [peer.id]: {
                ...chat,
                username: peer.username,
                pane: [...chat.pane, entry],
                unread: chat.unread + (reading ? 0 : 1),
            } };
        });

        if (reading && !pinnedRef.current) setUnread((previous) => previous + 1);
    };

    //THE COLUMN TURNS TO ONE PERSON, OR BACK TO THE CHANNEL. EITHER WAY IT IS ANOTHER PANE WITH ANOTHER
    //BOTTOM, SO WHAT WAS COUNTED AGAINST THE LAST ONE IS NOT WHAT IS UNREAD IN THIS ONE
    const showDirect = (peer: { id: number; username: string } | null) =>
    {
        if (peer) setDms((previous) =>
        {
            const chat = previous[peer.id] ?? { id: peer.id, username: peer.username, pane: [], unread: 0 };

            return { ...previous, [peer.id]: { ...chat, username: peer.username, unread: 0 } };
        });

        setOpenDm(peer ? peer.id : null);
        setView("chat");

        pinnedRef.current = true;
        setUnread(0);

        //ON A PHONE THE COMPOSER'S FOCUS IS HALF THE SCREEN'S WORTH OF KEYBOARD, WHICH IS NOT SOMETHING
        //TO OPEN BECAUSE A CONVERSATION WAS PICKED - IT OPENS WHEN THE LINE ITSELF IS TAPPED
        if (!narrow) chatInputRef.current?.focus();
    };

    //CLOSING ONE IS CLOSING IT FOR GOOD: NOTHING BUT THIS WINDOW EVER HELD THE CONVERSATION, AND THE
    //SERVER HAS NO HISTORY OF IT TO ASK FOR AGAIN
    const closeDirect = (id: number) =>
    {
        setDms((previous) =>
        {
            const next = { ...previous };
            delete next[id];

            return next;
        });

        setOpenDm((previous) => (previous === id ? null : previous));
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
        setDms({});
        setOpenDm(null);
        setCommands([]);
        setTofu(null);
        setTofuTyped("");
        setSettings(null);
        setServerName("");
        setUsername("");
        setRole("user");
        setUnread(0);
        setVoice({ enabled: false, mic: false, users: [] });
        setScreen({ sharing: false, monitor: null });
        setScreensOpen(false);
        setMonitors([]);
        setSharers([]);
        setWatching(null);
        setViewerError("");
        setView("chat");
        setDecoding("");
        setCreating(null);
        setFiles(null);

        pinnedRef.current = true;
        historyRef.current = { entries: [], pos: 0, stash: null, prefix: null };
    };

    //AN ID NOBODY BUT THIS WINDOW EVER READS - IT IS ONLY EVER COMPARED WITH ITSELF, SO THE SAME ADDRESS
    //TWICE IS TWO ACCOUNTS ON ONE SERVER RATHER THAN ONE ROW FIGHTING OVER ITSELF
    const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

    //DIAL ONE ENTRY OF THE LIST. WHATEVER IT HAS STORED IS PUT WHERE THE IDENTITY STEPS WILL FIND IT,
    //AND WHAT IT HAS NOT IS SIMPLY ASKED FOR THE WAY IT ALWAYS WAS
    const dial = (server: StoredServer) =>
    {
        entryRef.current = server;
        credsRef.current = { username: server.username, password: server.password ?? "" };
        typedRef.current = { username: "", password: "" };
        serverNameRef.current = "";

        setDialing(server);
        setAddress(server.address);
        addressRef.current = server.address;
        setUsername(server.username);
        setServerName(server.name ?? "");
        setUiState("server_select");
        setInputValue("");
        setErrorMsg("");
        setHint("");
        setConnecting(true);

        invoke("connect_to_server", { address: server.address }).catch((error: unknown) =>
        {
            setErrorMsg(String(error));
            setConnecting(false);
        });
    };

    //THE SESSION GOT THROUGH, SO WHAT GOT IT THROUGH IS WORTH KEEPING: THE ADDRESS, WHOEVER WE TURNED
    //OUT TO BE, THE PASSWORD IF ONE WAS GIVEN AT ALL, AND WHAT THE SERVER CALLS ITSELF. A SERVER TYPED
    //IN AND CONNECTED TO IS IN THE LIST FROM HERE ON - NOTHING ELSE HAS TO BE PRESSED
    const rememberServer = () =>
    {
        const entry = entryRef.current;

        if (!entry) return;

        const saved: StoredServer =
        {
            ...entry,
            username: typedRef.current.username || entry.username,
            password: typedRef.current.password || entry.password,
            name: serverNameRef.current || entry.name,
            last_used: Date.now(),
        };

        entryRef.current = saved;

        setDialing(saved);
        invoke<StoredServer[]>("save_server", { server: saved }).then(setServers).catch(console.error);
    };

    //AN ANSWER WE ALREADY HAVE GOES BACK DOWN THE PATH THE TYPED ONE WOULD HAVE, AND IS CONSUMED ON THE
    //WAY: A STORED PASSWORD THE SERVER REFUSES IS ASKED FOR NEXT TIME ROUND RATHER THAN SENT AGAIN
    const answerStored = (stored: string) =>
    {
        setConnecting(true);
        setInputValue("");

        invoke("send_input", { input: stored }).catch((error: unknown) =>
        {
            setErrorMsg(String(error));
            setConnecting(false);
        });
    };

    useEffect(() =>
    {
        invoke<ClientConfig>("get_client_config").then(setConfig).catch(console.error);

        //THE LIST IS THE FIRST THING THE WINDOW ASKS FOR, AND IT IS WHAT THE PROGRAM OPENS ON: WHICH
        //SERVER THIS IS GOING TO BE IS THE ONE QUESTION A LIST CANNOT ANSWER BY ITSELF, AND A SESSION
        //THAT STARTED WITHOUT BEING ASKED FOR IS ONE TO BE LEFT AGAIN. AN EMPTY LIST HAS NOTHING TO PICK
        //FROM, SO IT OPENS ON THE FORM THAT ADDS THE FIRST ONE
        invoke<StoredServer[]>("get_servers").then((list) =>
        {
            setServers(list);

            if (!list.length) setAdding(true);
        }).catch(console.error);

        const unlisten = listen<BridgeEvent>("why2-event", ({ payload }) =>
        {
            switch (payload.event)
            {
                case "connected":
                {
                    serverNameRef.current = payload.data.server;

                    setServerName(payload.data.server);
                    break;
                }

                //AN ANSWER WE ALREADY HAVE IS NOT A QUESTION: THE SCREEN STAYS ON `Connecting…` AND THE
                //STORED ONE GOES STRAIGHT BACK, RATHER THAN THE PROMPT BEING DRAWN AND ANSWERED A FRAME
                //LATER - WHICH LOOKED LIKE A PASSWORD BOX FLASHING PAST ON EVERY CONNECT
                case "request_username":
                {
                    const { registration, min, max } = payload.data;
                    const stored = credsRef.current.username;

                    setInputValue("");

                    if (stored)
                    {
                        credsRef.current.username = "";
                        typedRef.current.username = stored;

                        setUsername(stored);
                        answerStored(stored);
                        break;
                    }

                    setUiState("username_prompt");
                    setConnecting(false);
                    setHint(registration ? `a-Z, 0-9; ${min}-${max} characters` : "Registration is disabled.");
                    break;
                }

                case "request_password":
                {
                    const stored = credsRef.current.password;

                    setInputValue("");
                    setRegistering(payload.data.register);

                    if (stored)
                    {
                        credsRef.current.password = "";
                        typedRef.current.password = stored;

                        answerStored(stored);
                        break;
                    }

                    setUiState("password_prompt");
                    setConnecting(false);
                    setHint("");
                    break;
                }

                //A REJECTION ALWAYS ARRIVES JUST BEFORE THE RE-PROMPT, WHICH LEAVES THE ERROR ON SCREEN
                case "username_rejected":
                {
                    typedRef.current.username = "";

                    setErrorMsg("Username rejected!");
                    setConnecting(false);
                    break;
                }

                case "password_rejected":
                {
                    typedRef.current.password = "";

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
                    rememberServer();

                    //THE FORM STAYS UP BEHIND A DIAL IT STARTED, SO A SERVER THAT TURNED OUT TO BE
                    //UNREACHABLE COMES BACK WITH WHAT WAS TYPED INTO IT STILL THERE. THIS IS IT WORKING
                    setAdding(false);
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
                    const message = payload.data.message;

                    //A PM IS NOT A LINE OF THE CHANNEL THAT HAPPENED TO BE OPEN WHEN IT LANDED
                    if (message.direct) pushDirect(message.direct, { entry: "message", message });
                    else push({ entry: "message", message });

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

                //WHAT IS ON THE SERVER IS NOT SOMETHING THAT WAS SAID - IT IS A DRAWER, AND IT OPENS AS ONE
                case "files":
                {
                    setFiles(payload.data.owners);
                    setFilter("");
                    break;
                }

                //THE DEVICES COME ALONG WITH THE ROWS, ENUMERATED ONCE THE WAY THE TUI ENUMERATES THEM WHEN
                ///settings IS TYPED - THE PICKER AND THE DEVICE ROWS BOTH READ THAT ONE LIST
                case "open_settings":
                {
                    //TWO WINDOWS OVER THE SAME CHAT IS ONE TOO MANY - THE ONE BEING OPENED WINS
                    setFiles(null);

                    Promise.all([
                        invoke<ClientSetting[]>("get_client_settings"),
                        invoke<AudioDevices>("get_audio_devices"),
                    ]).then(([list, devices]) =>
                    {
                        const rows = clientRows(list);

                        setSettings({
                            rows,
                            selected: landRow(rows, 0, 1),
                            server: false,
                            edit: null,
                            saving: false,
                            confirm: false,
                            devices,
                            picker: null,
                        });
                    }).catch((error: unknown) => setPopupMessage(String(error)));

                    break;
                }

                //client.toml MOVED UNDER THE BOX - THE VOICE CLIENT POINTED A DEVICE KEY BACK AT WHAT IS
                //ACTUALLY PLAYING. THE SELECTION STAYS WHERE THE USER LEFT IT
                case "client_settings":
                {
                    const rows = clientRows(payload.data.settings);

                    setSettings((previous) => (previous && !previous.server
                        ? { ...previous, rows, selected: landRow(rows, previous.selected, 1), edit: null, picker: null }
                        : previous));

                    break;
                }

                case "screen":
                {
                    setScreen(payload.data.screen);
                    break;
                }

                //THE ANSWER OPENS THE WINDOW IT BELONGS IN, THE WAY /files OPENS ITS OWN. NOBODY ASKS
                //THIS QUESTION BUT THE WINDOW AND THE USER, SO THERE IS NO OTHER PLACE FOR IT TO LAND
                case "screens":
                {
                    setSharers(payload.data.users);
                    setScreensOpen(true);

                    break;
                }

                //A SCREEN ARRIVING IS WORTH LOOKING AT, SO THE COLUMN TURNS TO IT - AND GOES BACK TO WHAT
                //WAS BEING SAID WHEN THERE IS NOTHING LEFT TO WATCH
                case "watching":
                {
                    setWatching(payload.data.username);
                    setViewerError("");
                    setView(payload.data.username ? "screen" : "chat");
                    break;
                }

                case "voice":
                {
                    setVoice(payload.data.voice);
                    break;
                }

                //EITHER THE COPY THE BOX ASKED FOR, OR THE ONE THE SERVER JUST STORED. THE ANSWER TO A SAVE
                //IS THE CONFIG AS IT ACTUALLY STANDS, SO A ROW IT REFUSED SNAPS BACK INSTEAD OF SITTING
                //THERE LOOKING APPLIED - AND THE SELECTION STAYS WHERE THE USER LEFT IT
                case "server_settings":
                {
                    const rows = serverRows(payload.data.settings);

                    if (payload.data.saved)
                    {
                        setSettings((previous) => (previous && previous.server
                            ? { ...previous, rows, selected: landRow(rows, previous.selected, 1), edit: null, saving: false, confirm: false }
                            : previous));

                        break;
                    }

                    setSettings({
                        rows,
                        selected: landRow(rows, 0, 1),
                        server: true,
                        edit: null,
                        saving: false,
                        confirm: false,

                        //THE SERVER'S ROWS HAVE NO AUDIO IN THEM - server.toml IS NOT WHERE OUR DEVICES LIVE
                        devices: NO_DEVICES,
                        picker: null,
                    });
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

                    //WALKING INTO A CHANNEL IS WALKING OUT OF WHATEVER CONVERSATION WAS IN FRONT OF IT
                    setOpenDm(null);

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

                    //A SERVER PICKED WHILE ANOTHER ONE WAS STILL UP IS DIALLED HERE RATHER THAN THERE:
                    //THE OLD SESSION IS ASKED TO LEAVE FIRST (/exit), AND THIS IS IT GONE
                    const next = switchRef.current;
                    switchRef.current = null;

                    if (next) dial(next);
                    break;
                }
            }
        });

        return () => { unlisten.then((stop) => stop()); };
    }, []);

    //THE TWO COLUMNS AND THE SHEET UNDER THEM, WHICH ARE THE THREE THINGS A DRAG MOVES. THEY ARE WRITTEN
    //TO DIRECTLY AND NOT DRAWN FROM STATE: A FINGER PUTS OUT SIXTY POSITIONS A SECOND, AND RE-RENDERING
    //THE WHOLE WINDOW FOR EACH OF THEM WOULD MAKE THE ONE THING THAT HAS TO FEEL SMOOTH THE ONE THAT DOES
    //NOT. REACT OWNS WHERE A DRAWER *IS* (THE CLASSES), AND THE DRAG BORROWS IT FOR THE LENGTH OF ITSELF
    const leftPanel = useRef<HTMLElement | null>(null);
    const rightPanel = useRef<HTMLElement | null>(null);
    const scrimEl = useRef<HTMLDivElement | null>(null);

    //WHERE A DRAG STARTED AND WHAT IT TURNED OUT TO BE ABOUT, WHILE ONE IS RUNNING. THE DRAWERS FOLLOW THE
    //FINGER THE WAY EVERY PHONE CHAT PROGRAM MOVES THEM - AND A DRAG THAT IS MOSTLY VERTICAL IS SOMEBODY
    //READING THE PANE, WHICH IS WHY IT TAKES BOTH A DISTANCE AND A DIRECTION BEFORE IT MEANS ANYTHING
    const swipeRef = useRef<
    {
        x: number;
        y: number;
        side: "left" | "right" | null;
        from: number;
        width: number;
    } | null>(null);

    //THE INLINE POSITION IS GIVEN BACK TO THE CLASSES ONCE THE LAST STRETCH HAS PLAYED OUT, AND A DRAG
    //THAT STARTS BEFORE THEN TAKES THE HAND-BACK WITH IT
    const settleRef = useRef<number | null>(null);

    const panelOf = (side: "left" | "right") => (side === "left" ? leftPanel.current : rightPanel.current);

    //open IS 0 SHUT AND 1 OPEN, AND EVERYTHING BETWEEN IS WHERE THE FINGER IS. THE SHUT DRAWER HAS TO BE
    //MADE VISIBLE BY HAND, SINCE .drawer-shut TAKES IT OUT OF REACH OF A TAP AND OF THE TAB KEY
    const dragTo = (side: "left" | "right", open: number) =>
    {
        const panel = panelOf(side);

        if (panel)
        {
            panel.style.transition = "none";
            panel.style.visibility = "visible";
            panel.style.transform = `translateX(${side === "left" ? (open - 1) * 100 : (1 - open) * 100}%)`;
        }

        if (scrimEl.current)
        {
            scrimEl.current.style.transition = "none";
            scrimEl.current.style.opacity = String(open);
        }
    };

    //THE FINGER IS OFF: THE REST OF THE WAY IS ANIMATED RATHER THAN DRAGGED, AND THE INLINE POSITION IS
    //DROPPED ONLY ONCE IT HAS ARRIVED - CLEARING IT WHILE THE DRAWER IS STILL MOVING IS A JUMP
    const settle = (side: "left" | "right", open: boolean) =>
    {
        const panel = panelOf(side);

        if (panel)
        {
            panel.style.transition = "";
            panel.style.transform = open ? "translateX(0%)" : `translateX(${side === "left" ? "-100%" : "100%"})`;
        }

        if (scrimEl.current)
        {
            scrimEl.current.style.transition = "";
            scrimEl.current.style.opacity = open ? "1" : "0";
        }

        if (settleRef.current !== null) window.clearTimeout(settleRef.current);

        settleRef.current = window.setTimeout(() =>
        {
            settleRef.current = null;

            if (panel)
            {
                panel.style.transform = "";
                panel.style.visibility = "";
                panel.style.transition = "";
            }

            if (scrimEl.current)
            {
                scrimEl.current.style.opacity = "";
                scrimEl.current.style.transition = "";
            }
        }, DRAWER_MS + 20);

        setDrawer(open ? side : null);
    };

    const onSwipeStart = (event: React.TouchEvent) =>
    {
        const touch = event.touches[0];

        //A WINDOW IN FRONT OF THE CONVERSATION IS WHAT THE DRAG BELONGS TO, NOT THE COLUMNS BEHIND IT
        swipeRef.current = narrow && event.touches.length === 1 && touch && connected
            && !theater && !settingsOpen && !filesOpen && !screensOpen && !addOpen && !tofu
            ? { x: touch.clientX, y: touch.clientY, side: null, from: 0, width: 1 }
            : null;
    };

    const onSwipeMove = (event: React.TouchEvent) =>
    {
        const start = swipeRef.current;

        if (!start) return;

        const touch = event.touches[0];

        if (!touch) return;

        const across = touch.clientX - start.x;
        const along = touch.clientY - start.y;

        //WHAT THE DRAG IS ABOUT IS DECIDED ONCE AND THEN KEPT: A FINGER THAT HAS BARELY MOVED IS NEITHER
        //DIRECTION YET, AND ONE THAT WENT MOSTLY DOWN IS THE PANE'S RATHER THAN THE DRAWER'S
        if (!start.side)
        {
            if (Math.abs(across) < SWIPE_SLOP && Math.abs(along) < SWIPE_SLOP) return;

            if (Math.abs(across) < Math.abs(along) * SWIPE_SLOPE)
            {
                swipeRef.current = null;

                return;
            }

            //A DRAWER THAT IS ALREADY OPEN IS THE ONE BEING MOVED, WHICHEVER WAY THE FINGER WENT -
            //OTHERWISE THE DIRECTION PICKS ONE: RIGHT PULLS THE LEFT COLUMN IN, LEFT THE RIGHT ONE
            start.side = drawer ?? (across > 0 ? "left" : "right");
            start.from = drawer === start.side ? 1 : 0;

            //HOW FAR THE COLUMN HAS TO TRAVEL IS THE COLUMN'S OWN WIDTH, AND IT IS A PROPORTION OF THE
            //SCREEN - SO IT IS MEASURED RATHER THAN WRITTEN DOWN HERE A SECOND TIME
            start.width = panelOf(start.side)?.offsetWidth || window.innerWidth;

            //A HAND-BACK STILL PENDING FROM THE LAST DRAG WOULD WIPE THIS ONE HALFWAY THROUGH
            if (settleRef.current !== null)
            {
                window.clearTimeout(settleRef.current);
                settleRef.current = null;
            }
        }

        const travel = start.side === "left" ? across : -across;

        dragTo(start.side, Math.min(1, Math.max(0, start.from + travel / start.width)));
    };

    const onSwipeEnd = (event: React.TouchEvent) =>
    {
        const start = swipeRef.current;
        swipeRef.current = null;

        if (!start || !start.side) return;

        const touch = event.changedTouches[0];
        const across = touch ? touch.clientX - start.x : 0;
        const travel = start.side === "left" ? across : -across;

        //A DRAG THAT WENT FAR ENOUGH MEANS THE DIRECTION IT WENT IN; ONE THAT DID NOT GOES BACK WHERE IT
        //CAME FROM, WHICH IS ALSO WHAT A CANCELLED TOUCH IS
        settle(start.side, Math.abs(travel) >= SWIPE ? travel > 0 : start.from === 1);
    };

    const onSwipeCancel = () =>
    {
        const start = swipeRef.current;
        swipeRef.current = null;

        if (start?.side) settle(start.side, start.from === 1);
    };

    const send = (input: string) =>
    {
        invoke("send_input", { input }).catch((error: unknown) => setPopupMessage(String(error)));
    };

    //GOING TO A SERVER IS THE SAME THING WHEREVER IT WAS ASKED FOR - A TILE, A ROW OF THE LIST, OR A
    //SERVER JUST TYPED IN. WHILE ONE IS UP IT IS A SWITCH AND NOT A SECOND SESSION: THAT ONE IS LEFT
    //PROPERLY FIRST, AND THE DISCONNECT THAT COMES BACK DIALS THIS ONE
    const goTo = (server: StoredServer) =>
    {
        setDrawer(null);

        if (connected)
        {
            switchRef.current = server;
            send("/exit");

            return;
        }

        dial(server);
    };

    //WHICH OF THE THREE THINGS THE CONNECT SCREEN IS ASKING: THE SERVER'S OWN QUESTION WHILE ONE IS
    //PENDING, OTHERWISE THE FORM THAT ADDS A SERVER (WHICH AN EMPTY LIST HAS NOTHING BUT), OTHERWISE
    //THE LIST ITSELF, WAITING TO BE PICKED FROM
    const mode = uiState === "username_prompt" || uiState === "password_prompt"
        ? "prompt"
        : (adding || servers.length === 0 ? "add" : "idle");

    const handleSubmit = async (event: React.FormEvent) =>
    {
        event.preventDefault();

        //A SERVER IS NOT WRITTEN DOWN UNTIL IT WORKS: A TYPO IS A FAILED CONNECT RATHER THAN A ROW IN
        //THE LIST TO BE FORGOTTEN AGAIN, AND rememberServer PUTS IT IN WHEN THE SERVER LETS US IN
        if (mode === "add")
        {
            const typed = form.address.trim();

            if (!typed) return;

            const wanted = form.username.trim();

            //THE SAME SERVER TYPED IN AGAIN IS THE ROW THAT IS ALREADY THERE RATHER THAN A SECOND ONE
            //BESIDE IT - THE ADDRESS LEFT IN THE FIELD BY A DISCONNECT IS EXACTLY THAT CASE. TWO ROWS
            //FOR ONE ADDRESS ARE TWO ACCOUNTS, WHICH IS WHY THE NAME COUNTS WHEN ONE WAS GIVEN
            const existing = servers.find((server) => server.address === typed
                && (!wanted || server.username === wanted));

            goTo(existing
                ? {
                    ...existing,
                    username: wanted || existing.username,
                    password: form.password || existing.password,
                }
                : {
                    id: newId(),
                    address: typed,
                    username: wanted,
                    password: form.password || null,
                    name: null,
                    last_used: Date.now(),
                });

            return;
        }

        if (!inputValue) return;

        setErrorMsg("");
        setConnecting(true);

        //WHAT IS TYPED AT AN IDENTITY STEP IS WHAT GETS REMEMBERED, IF IT TURNS OUT TO WORK
        if (uiState === "username_prompt")
        {
            typedRef.current.username = inputValue;
            setUsername(inputValue);
        }

        if (uiState === "password_prompt") typedRef.current.password = inputValue;

        try
        {
            await invoke("send_input", { input: inputValue });
        }
        catch (error: unknown)
        {
            setErrorMsg(String(error));
            setConnecting(false);
        }
    };

    //THE RAIL, THE LIST AND THE TILE MENU ALL COME BACK HERE. A SERVER PICKED WHILE ANOTHER ONE IS UP IS
    //A SWITCH AND NOT A SECOND SESSION: THE ONE IN FRONT IS LEFT PROPERLY FIRST, AND THE DISCONNECT THAT
    //COMES BACK IS WHAT DIALS THE NEXT
    const pickServer = (server: StoredServer) =>
    {
        if (server.id === dialing?.id && (connected || connecting)) return;

        setAdding(false);
        goTo(server);
    };

    //THE FORM IS THE CONNECT SCREEN ITSELF WHILE THERE IS NO SESSION AND A WINDOW OVER THE CHAT WHILE
    //THERE IS ONE. ON A PHONE THE + WAS PRESSED INSIDE THE DRAWER, WHICH HAS DONE ITS JOB
    const openAdd = () =>
    {
        setForm({ address: "", username: "", password: "" });
        setErrorMsg("");
        setAdding(true);
        setDrawer(null);
    };

    const closeAdd = () =>
    {
        setAdding(false);

        if (!narrow) chatInputRef.current?.focus();
    };

    //FORGETTING IS FOR GOOD, AND FORGETTING THE ONE WE ARE STANDING IN IS ALSO LEAVING IT - THERE WOULD
    //BE NOTHING LEFT IN THE RAIL SAYING WHERE THIS SESSION IS
    const forgetServer = (id: string) =>
    {
        invoke<StoredServer[]>("remove_server", { id }).then((list) =>
        {
            setServers(list);

            if (!list.length && !connected) setAdding(true);
        }).catch((error: unknown) => setPopupMessage(String(error)));

        if (id !== dialing?.id) return;

        if (connected) send("/exit");

        entryRef.current = null;
        setDialing(null);
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

    //WHAT THE PALETTE WOULD SHOW IF ITS VOCABULARY WERE ALREADY IN HAND
    const shape = useMemo<PaletteShape>(
        () => (dismissed ? { mode: "hidden" } : analyze(chatInput, commands)),
        [chatInput, commands, dismissed],
    );

    const wanted = shape.mode === "pending" ? shape.arg.values : null;

    //ASKED FOR EVERY TIME THE CARET LANDS ON SUCH A PARAMETER, AND DROPPED THE MOMENT IT LEAVES - THE
    //MONITORS ARE THE REASON: ONE PLUGGED IN MID-SESSION IS STILL SUPPOSED TO SHOW UP HERE
    useEffect(() =>
    {
        if (wanted === null)
        {
            setVocabulary({ kind: "free", values: [] });
            return;
        }

        let live = true;

        invoke<VocabularyValue[]>("get_vocabulary", { values: wanted })
            .then((values) => { if (live) setVocabulary({ kind: wanted, values }); })
            .catch(() => {});

        return () => { live = false; };
    }, [wanted]);

    const palette = useMemo<PaletteState>(() =>
    {
        if (shape.mode !== "pending") return shape;

        //STILL WAITING ON THE ANSWERS - THE SIGNATURE HINT SAYS WHAT THE PARAMETER IS IN THE MEANTIME
        if (vocabulary.kind !== shape.arg.values) return { mode: "signature", entry: shape.entry, active: shape.active };

        const matches = vocabulary.values.filter((value) => value.value.toLowerCase().startsWith(shape.typed));

        //A TYPO IS NOT A REASON TO GO BLANK
        if (matches.length === 0) return { mode: "signature", entry: shape.entry, active: shape.active };

        return { mode: "values", arg: shape.arg, matches, start: shape.start };
    }, [shape, vocabulary]);

    //A MENU IS OPEN: NAVIGABLE, AND COMPLETABLE. A SIGNATURE HINT IS NEITHER - IT IS ONLY THERE TO BE READ
    const active = palette.mode === "menu" || palette.mode === "values";

    const count = palette.mode === "menu" ? palette.entries.length : palette.mode === "values" ? palette.matches.length : 0;

    //A FULLY TYPED WORD WINS THE SELECTION, OTHERWISE IT STAYS WHERE IT WAS. WITHOUT THIS, "/screens"
    //HIGHLIGHTS "/screen" AND ENTER RUNS THE WRONG COMMAND
    const exact = useMemo(() =>
    {
        if (palette.mode === "menu") return palette.entries.findIndex((entry) => entryTyped(entry, chatInput));

        if (palette.mode === "values")
        {
            const typed = chatInput.slice(palette.start).trim().toLowerCase();

            return palette.matches.findIndex((value) => value.value.toLowerCase() === typed);
        }

        return -1;
    }, [palette, chatInput]);

    useEffect(() =>
    {
        if (exact >= 0) setSelected(exact);
        else setSelected((previous) => Math.min(previous, Math.max(count - 1, 0)));
    }, [exact, count]);

    //KEEP THE SELECTION IN VIEW, THE WAY THE TUI SCROLLS ITS OWN POPUP RATHER THAN PINNING THE ROW
    useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest" }); }, [selected, palette]);

    //THE BOX OWNS THE KEYBOARD WHILE IT IS UP, WHICH IN A WINDOW MEANS TAKING THE FOCUS OFF THE INPUT LINE.
    //THE DEPENDENCY IS WHETHER IT IS OPEN AND NOT THE BOX ITSELF - EVERY ROW EDITED IS A NEW OBJECT, AND
    //FOCUSING ON EACH OF THEM WOULD TAKE IT BACK OFF THE ROW BEING TYPED INTO
    const settingsOpen = settings !== null;

    useEffect(() => { if (settingsOpen) settingsRef.current?.focus(); }, [settingsOpen]);

    //THE FILE WINDOW TAKES THE KEYBOARD TOO, SO ESC REACHES IT AND NOTHING TYPED AT IT LANDS IN THE LINE
    //BEHIND IT. THE DEPENDENCY IS WHETHER IT IS OPEN AND NOT THE LIST ITSELF, WHICH IS A NEW ARRAY EVERY
    //TIME THE SERVER ANSWERS
    const filesOpen = files !== null;

    useEffect(() => { if (filesOpen) filesRef.current?.focus(); }, [filesOpen]);

    //WHO IS SHARING. NOT send(): THE SERVER COUNTS PACKETS, AND THIS ONE HAS TO WAIT OUT WHATEVER THE
    //USER JUST DID - A /screens ON THE HEELS OF AN /attach IS WHAT THE SERVER CALLS SPAM
    const askScreens = () => { invoke("refresh_screens").catch(() => {}); };

    //ONE DOOR FOR BOTH HALVES OF THE SUBJECT: WHICH OF OUR SCREENS TO SHARE, AND WHOSE TO WATCH. THE
    //MONITORS ARE ASKED OF THE SAME VOCABULARY THE PALETTE USES, AND THE SHARERS OF THE SERVER, BECAUSE
    //IT ONLY EVER ANSWERS THAT QUESTION AND NEVER VOLUNTEERS IT
    const openScreens = () =>
    {
        setScreensOpen(true);

        invoke<VocabularyValue[]>("get_vocabulary", { values: "monitors" })
            .then((values) => setMonitors(values.map((value) => value.value)))
            .catch(() => setMonitors([]));

        askScreens();
    };

    //SOMEBODY ELSE'S SCREEN, DRAWN HERE RATHER THAN IN A WINDOW OF THE CRATE'S OWN. THE FRAMES ARRIVE ON A
    //BINARY CHANNEL, AND WHAT IS ON IT DEPENDS ON WHAT THIS WEBVIEW CAN DO: H.264 WHERE IT HAS A DECODER
    //OF ITS OWN, AND OTHERWISE JPEG, DECODED FOR US ON THE OTHER SIDE OF THE BRIDGE
    useEffect(() =>
    {
        if (!watching) return;

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");

        if (!canvas || !context) return;

        let live = true;
        let decoder: VideoDecoder | null = null;
        let started = false;  //A DECODER CANNOT START ANYWHERE BUT A KEYFRAME
        let drawing = false;  //ONE PICTURE AT A TIME - THE NEXT FRAME IS NEWER THAN THE ONE BEING DECODED
        let stamp = 0;

        //THE CANVAS'S OWN BOX, IN DEVICE PIXELS. A SHARE IS SOMEBODY'S WHOLE MONITOR AND THE PANE IS SMALLER
        //THAN THAT, SO THIS IS WHAT THE PICTURE IS ACTUALLY BEING LOOKED AT - MEASURED AND NOT ASSUMED,
        //SINCE A WINDOW IS RESIZED WHILE THE SHARE RUNS AND A HIDDEN PANE HAS NO BOX AT ALL
        let box = { width: 0, height: 0 };

        const measure = () =>
        {
            const ratio = window.devicePixelRatio || 1;

            box = { width: canvas.clientWidth * ratio, height: canvas.clientHeight * ratio };
        };

        measure();

        const observer = new ResizeObserver((entries) =>
        {
            //THE DEVICE BOX WHERE THE BROWSER REPORTS IT, SINCE THAT IS THE ONE WITHOUT A ROUNDING ERROR
            const device = entries[0]?.devicePixelContentBoxSize?.[0];

            if (device) box = { width: device.inlineSize, height: device.blockSize };
            else measure();
        });

        observer.observe(canvas);

        //RESIZING A CANVAS RESETS EVERYTHING ABOUT ITS CONTEXT, SO THE SCALING QUALITY IS ASKED FOR AGAIN
        const resize = (surface: HTMLCanvasElement, target: CanvasRenderingContext2D, width: number, height: number) =>
        {
            if (surface.width === width && surface.height === height) return;

            surface.width = width;
            surface.height = height;

            target.imageSmoothingEnabled = true;
            target.imageSmoothingQuality = "high";
        };

        //THE STEPS OF THE WAY DOWN. TWO, BECAUSE EACH HALVING READS THE ONE BEFORE IT
        const scratch = [0, 1].map(() =>
        {
            const surface = document.createElement("canvas");

            return { surface, context: surface.getContext("2d") };
        });

        const paint = (frame: CanvasImageSource, width: number, height: number) =>
        {
            //THE CANVAS IS THE SIZE THE PICTURE IS LOOKED AT, NOT THE SIZE IT WAS SENT: A BACKING STORE
            //BIGGER THAN ITS BOX IS SCALED DOWN BY THE COMPOSITOR IN ONE BILINEAR TAP, AND FOUR TAPS OF A
            //1080p SCREEN DRAWN AT 1000 WIDE IS EXACTLY THE ALIASING THAT TURNS TEXT INTO PIXELS. THE ASPECT
            //IS KEPT, SO THE object-contain ON THE ELEMENT HAS NOTHING LEFT TO DO. IT IS NEVER SCALED *UP*
            //HERE - A PANE BIGGER THAN THE SHARE IS THE ONE CASE THE COMPOSITOR HANDLES PERFECTLY WELL
            const fit = Math.min((box.width || width) / width, (box.height || height) / height, 1);

            const drawnWidth = Math.max(1, Math.round(width * fit));
            const drawnHeight = Math.max(1, Math.round(height * fit));

            resize(canvas, context, drawnWidth, drawnHeight);

            //AND THE WAY DOWN IS HALVED RATHER THAN TAKEN AT ONCE. A BILINEAR TAP AVERAGES A 2x2 BLOCK
            //EXACTLY, WHICH IS THE BOX FILTER THE TUI GETS OUT OF ITS SAMPLER FOR NOTHING; ASKED FOR MORE
            //THAN THAT IT READS FOUR PIXELS OUT OF SIXTEEN AND DROPS THE REST
            let source = frame;
            let sourceWidth = width;
            let sourceHeight = height;
            let step = 0;

            while (sourceWidth >= drawnWidth * 2 && sourceHeight >= drawnHeight * 2)
            {
                const { surface, context: half } = scratch[step % scratch.length];

                if (!half) break;

                const halfWidth = Math.max(drawnWidth, Math.round(sourceWidth / 2));
                const halfHeight = Math.max(drawnHeight, Math.round(sourceHeight / 2));

                resize(surface, half, halfWidth, halfHeight);
                half.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, halfWidth, halfHeight);

                source = surface;
                sourceWidth = halfWidth;
                sourceHeight = halfHeight;

                step += 1;
            }

            //THE SOURCE RECTANGLE IS NAMED AND NOT ASSUMED. H.264 ENCODES IN WHOLE MACROBLOCKS, SO A 900-ROW
            //SCREEN TRAVELS AS 912 ROWS WITH THE LAST TWELVE PADDED OUT, AND A DECODER THAT HANDS OVER THE
            //CODED FRAME RATHER THAN THE VISIBLE ONE PUTS THAT PADDING ALONG THE BOTTOM EDGE. NAMING THE
            //RECTANGLE CROPS IT WHERE THAT HAPPENS AND CHANGES NOTHING WHERE IT DOES NOT
            context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, drawnWidth, drawnHeight);
        };

        const channel = new Channel<ArrayBuffer>();

        //NOTHING IS DRAWN UNTIL IT IS KNOWN WHAT IS COMING - THE FIRST FRAMES ARE DROPPED, AND THE SHARE
        //FORCES A KEYFRAME EVERY COUPLE OF SECONDS ANYWAY
        channel.onmessage = () => {};

        void (async () =>
        {
            const config = await h264Config();

            if (!live) return;

            setDecoding(config ? "webview" : "bridge");

            if (config)
            {
                decoder = new VideoDecoder(
                {
                    output: (frame) =>
                    {
                        //THE VISIBLE RECTANGLE FIRST, AND THE DISPLAY SIZE ONLY WHERE THERE IS NONE: THE
                        //CODED FRAME IS PADDED OUT TO WHOLE MACROBLOCKS, AND THE PADDING IS NOT PICTURE
                        const rect = frame.visibleRect;

                        paint(frame, rect?.width ?? frame.displayWidth, rect?.height ?? frame.displayHeight);
                        frame.close();
                    },

                    error: (error) => { if (live) setViewerError(String(error)); },
                });

                decoder.configure(config);

                channel.onmessage = (data) =>
                {
                    if (!live || !decoder || decoder.state !== "configured") return;

                    const bytes = new Uint8Array(data);
                    const key = isKeyFrame(bytes);

                    //A DELTA FRAME BEFORE THE FIRST KEY ONE IS PREDICTED FROM A PICTURE NOBODY HAS
                    if (!started && !key) return;

                    started = true;

                    decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: stamp, data: bytes }));

                    stamp += 33333;
                };
            }
            else
            {
                channel.onmessage = (data) =>
                {
                    if (!live || drawing) return;

                    drawing = true;

                    createImageBitmap(new Blob([data], { type: "image/jpeg" }))
                        .then((bitmap) =>
                        {
                            if (live) paint(bitmap, bitmap.width, bitmap.height);

                            bitmap.close();
                        })
                        .catch(() => {})
                        .finally(() => { drawing = false; });
                };
            }

            await invoke("watch_frames", { channel, decode: config === null })
                .catch((error: unknown) => setViewerError(String(error)));
        })();

        return () =>
        {
            live = false;

            observer.disconnect();

            setDecoding("");
            invoke("drop_frames").catch(() => {});

            if (decoder && decoder.state !== "closed") decoder.close();
        };
    }, [watching]);

    //THE PICTURE HAS THE WHOLE WINDOW, SO THE WAY BACK HAS TO BE A KEY AS WELL AS A BUTTON - AND THERE IS
    //NO COMPOSER UNDER IT TO TAKE THE KEYSTROKE FIRST
    useEffect(() =>
    {
        if (!theater) return;

        const onKey = (event: KeyboardEvent) =>
        {
            if (event.key !== "Escape") return;

            event.preventDefault();
            setView("chat");
        };

        window.addEventListener("keydown", onKey);

        return () => window.removeEventListener("keydown", onKey);
    }, [theater]);

    //A PANE THAT WAS display:none WHILE THE SCREEN WAS IN FRONT COMES BACK WITH ITS SCROLL WHERE THE BROWSER
    //LEFT IT, WHICH IS NOT NECESSARILY THE BOTTOM IT WAS PINNED TO
    useEffect(() =>
    {
        if (view !== "chat" || !pinnedRef.current) return;

        const node = paneRef.current;

        if (node) node.scrollTop = node.scrollHeight;
    }, [view]);

    const closeFiles = () =>
    {
        setFiles(null);
        setFilter("");

        if (!narrow) chatInputRef.current?.focus();
    };

    //THE COMPOSER IS WHERE TYPING GOES, WHEREVER THE CLICK BEFORE IT LANDED. THE TERMINAL HAD NOWHERE ELSE
    //FOR A KEYPRESS TO GO; A WINDOW DOES, AND A CHARACTER TYPED AT A MEMBER LIST WOULD OTHERWISE BE LOST.
    //A SHORTCUT, A DIALOG, OR A FIELD THAT ALREADY HAS THE KEYBOARD IS NOT OURS TO TAKE IT FROM
    useEffect(() =>
    {
        if (!connected || settingsOpen || filesOpen || screensOpen || tofu) return;

        const onKey = (event: KeyboardEvent) =>
        {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key.length !== 1 && event.key !== "Backspace") return;

            const focused = document.activeElement;
            if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;

            chatInputRef.current?.focus();
        };

        window.addEventListener("keydown", onKey);

        return () => window.removeEventListener("keydown", onKey);
    }, [connected, settingsOpen, filesOpen, screensOpen, tofu]);

    useEffect(() => { settingsRowRef.current?.scrollIntoView({ block: "nearest" }); }, [settings?.selected]);

    useEffect(() => { pickerRowRef.current?.scrollIntoView({ block: "nearest" }); }, [settings?.picker?.selected]);

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

    //THE CONVERSATIONS, IN AN ORDER THAT DOES NOT MOVE UNDER THE POINTER - A LIST SORTED BY WHAT ARRIVED
    //LAST WOULD PUT THE ROW BEING CLICKED SOMEWHERE ELSE THE MOMENT SOMEBODY TYPED
    const directs = useMemo(
        () => Object.values(dms).sort((a, b) => a.username.localeCompare(b.username)),
        [dms],
    );

    //EVERY EDIT OF THE BOX GOES THROUGH HERE, BECAUSE EVERY ONE OF THEM IS "THE SAME BOX, ONE ROW LATER"
    const editSettings = (change: (box: SettingsBox) => SettingsBox | null) =>
        setSettings((previous) => (previous ? change(previous) : previous));

    const closeSettings = () =>
    {
        setSettings(null);

        if (!narrow) chatInputRef.current?.focus();
    };

    //THE PHONE ALREADY HAS ONE NAVIGATION CONTROL, AND EVERYBODY EXPECTS IT TO CLOSE WHATEVER IS IN FRONT
    //RATHER THAN THE PROGRAM. EACH THING THAT COVERS THE CONVERSATION PARKS ONE ENTRY IN THE HISTORY, AND
    //THE BACK GESTURE SPENDS IT - WITH NOTHING IN FRONT, BACK STILL MEANS WHAT IT ALWAYS DID
    const addOpen = connected && adding;
    const covering = drawer !== null || settingsOpen || filesOpen || screensOpen || addOpen || theater;

    useEffect(() =>
    {
        if (!covering) return;

        window.history.pushState({ why2: true }, "");

        const onPop = () =>
        {
            //WHATEVER IS ON TOP, IN THE ORDER THEY STACK
            if (theater) setView("chat");
            else if (addOpen) closeAdd();
            else if (screensOpen) setScreensOpen(false);
            else if (filesOpen) closeFiles();
            else if (settingsOpen) closeSettings();
            else setDrawer(null);
        };

        window.addEventListener("popstate", onPop);

        return () =>
        {
            window.removeEventListener("popstate", onPop);

            //CLOSED BY A BUTTON RATHER THAN BY THE GESTURE, SO THE ENTRY IS STILL OURS TO SPEND
            if (window.history.state?.why2) window.history.back();
        };
    }, [covering]);

    //WRITE ONE ROW BACK INTO THE BOX
    const withRow = (box: SettingsBox, index: number, change: (item: SettingsItem) => SettingsItem): SettingsBox =>
    ({
        ...box,
        rows: box.rows.map((row, position) => (position === index && row.row === "item"
            ? { row: "item", item: change(row.item) }
            : row)),
    });

    //FLIP ONE TOGGLE. A CLIENT ROW IS WRITTEN THROUGH IMMEDIATELY - A SERVER ROW IS NOT OURS TO WRITE,
    //SO IT IS HELD UNTIL Save AND SENT IN ONE GO. THE WRITE IS DONE HERE AND NOT INSIDE THE UPDATER:
    //AN UPDATER MAY RUN TWICE, AND client.toml WOULD BE WRITTEN TWICE WITH IT
    const setToggle = (index: number, on: boolean) =>
    {
        const box = settings;
        if (!box) return;

        const row = box.rows[index];
        if (row.row !== "item" || row.item.value.kind !== "toggle") return;

        //THE THREE INTERFACE KEYS ARE WHAT THE PANE DRAWS ITSELF FROM, SO THE WINDOW FOLLOWS AT ONCE
        if (!box.server)
        {
            invoke<ClientConfig>("set_client_setting", { key: row.item.key, on })
                .then(setConfig)
                .catch((error: unknown) => setPopupMessage(String(error)));
        }

        editSettings((current) => withRow({ ...current, selected: index, confirm: false }, index,
            (item) => ({ ...item, value: { kind: "toggle", value: on }, changed: item.changed || current.server })));
    };

    //SLIDE ONE VOLUME. THE BRIDGE KEEPS THE CEILING, SO WHAT IT STORED IS WHAT THE ROW ENDS UP DRAWING -
    //THE BAR MOVES AT ONCE ALL THE SAME, BECAUSE A SLIDER THAT WAITS FOR A ROUND TRIP PER ARROW IS NOT ONE
    const setVolume = (index: number, percent: number, max: number) =>
    {
        const box = settings;
        if (!box) return;

        const row = box.rows[index];
        if (row.row !== "item" || row.item.value.kind !== "volume") return;

        const wanted = Math.min(Math.max(percent, 0), max);
        if (wanted === row.item.value.value.percent) return;

        const write = (stored: number) => editSettings((current) => withRow({ ...current, selected: index, confirm: false }, index,
            (item) => (item.value.kind === "volume"
                ? { ...item, value: { kind: "volume", value: { ...item.value.value, percent: stored } } }
                : item)));

        write(wanted);

        invoke<number>("set_client_volume", { key: row.item.key, percent: wanted })
            .then((stored) => { if (stored !== wanted) write(stored); })
            .catch((error: unknown) => setPopupMessage(String(error)));
    };

    //POINT ONE OF THE TWO DEVICE KEYS SOMEWHERE ELSE. A RUNNING CALL REBUILDS ITS STREAMS ON THIS WITHOUT
    //BEING DROPPED, WHICH IS WHY THE ROW MAY BE TOUCHED MID-SESSION AT ALL
    const setDevice = (index: number, id: string) =>
    {
        const box = settings;
        if (!box) return;

        const row = box.rows[index];
        if (row.row !== "item" || row.item.value.kind !== "device" || row.item.value.value.id === id) return;

        const input = row.item.value.value.input;

        invoke("set_client_device", { key: row.item.key, id }).catch((error: unknown) => setPopupMessage(String(error)));

        editSettings((current) => withRow({ ...current, selected: index, confirm: false }, index,
            (item) => ({ ...item, value: { kind: "device", value: { id, input } } })));
    };

    //LEFT/RIGHT: FLIP A TOGGLE, SLIDE A VOLUME, STEP A NUMBER, OR CYCLE A DEVICE WITHOUT OPENING THE PICKER
    const adjustRow = (direction: number) =>
    {
        const box = settings;
        if (!box) return;

        const row = box.rows[box.selected];
        if (row.row !== "item") return;

        //A TOGGLE ONLY HAS TWO STATES, SO EITHER DIRECTION MEANS THE OTHER ONE
        if (row.item.value.kind === "toggle")
        {
            if ((direction > 0) !== row.item.value.value) setToggle(box.selected, direction > 0);
            return;
        }

        if (row.item.value.kind === "volume")
        {
            const { percent, max, step } = row.item.value.value;

            setVolume(box.selected, percent + direction * step, max);
            return;
        }

        if (row.item.value.kind === "device")
        {
            const { id, input } = row.item.value.value;
            const entries = deviceEntries(box.devices, id, input);

            const current = Math.max(entries.findIndex((entry) => entry.id === id), 0);
            const next = (current + direction + entries.length) % entries.length;

            setDevice(box.selected, entries[next].id);
            return;
        }

        if (row.item.value.kind !== "number") return;

        const next = row.item.value.value + direction;

        editSettings((current) => withRow(current, current.selected,
            (item) => ({ ...item, value: { kind: "number", value: next }, changed: true })));
    };

    //HAND THE EDITED ROWS TO THE BRIDGE, WHICH IS WHERE THE SOCKET IS. THEY STAY MARKED UNTIL THE SERVER
    //SAYS WHAT IT STORED - ITS ANSWER REBUILDS THEM
    const saveSettings = () =>
    {
        const box = settings;
        if (!box || !box.server || box.saving) return;

        const changed = box.rows.flatMap((row) => (row.row === "item" && row.item.changed
            ? [{ key: row.item.key, value: row.item.value, section: "", description: "", restart: row.item.restart }]
            : []));

        if (changed.length === 0) return;

        invoke("save_server_settings", { settings: changed }).catch((error: unknown) =>
        {
            setPopupMessage(String(error));

            //NOTHING WENT OUT, SO NOTHING IS COMING BACK - THE ROWS STAY EDITABLE INSTEAD OF WAITING FOREVER
            editSettings((current) => ({ ...current, saving: false }));
        });

        editSettings((current) => ({ ...current, saving: true, confirm: false }));
    };

    //THE ONE BUTTON THAT ENDS THE SESSION FOR EVERYBODY ON THE SERVER, SO IT IS ASKED TWICE - AND NEVER
    //WHILE THERE ARE EDITED ROWS IN THE BOX, WHICH THE RESTART WOULD THROW AWAY UNREAD
    const restartServer = () =>
    {
        const box = settings;
        if (!box || !box.server || box.saving || unsavedRows(box.rows)) return;

        //THE FIRST PRESS ONLY ARMS IT - THE BUTTON SAYS SO UNTIL SOMETHING CLEARS IT
        if (!box.confirm)
        {
            editSettings((current) => ({ ...current, confirm: true }));
            return;
        }

        invoke("restart_server").catch((error: unknown) => setPopupMessage(String(error)));

        //THE SERVER GOES DOWN WITH THIS, SO THERE IS NOTHING LEFT FOR THE BOX TO SHOW OR TO SAVE
        closeSettings();
    };

    //ENTER/SPACE, OR A CLICK: FLIP A TOGGLE, START TYPING INTO A VALUE, OR PRESS THE BUTTON
    const activateRow = (index: number) =>
    {
        const box = settings;
        if (!box) return;

        const row = box.rows[index];

        if (row.row === "action")
        {
            editSettings((current) => ({ ...current, selected: index }));

            if (row.label === RESTART_LABEL) restartServer();
            else saveSettings();

            return;
        }

        if (row.row !== "item") return;

        if (row.item.value.kind === "toggle")
        {
            setToggle(index, !row.item.value.value);
            return;
        }

        //A VOLUME HAS NOWHERE ELSE TO GO ON ⏎ THAN ONE STEP UP, THE WAY THE TUI'S DOES
        if (row.item.value.kind === "volume")
        {
            const { percent, max, step } = row.item.value.value;

            setVolume(index, percent + step, max);
            return;
        }

        //A DEVICE HAS A WHOLE LIST BEHIND IT, SO ⏎ OPENS IT RATHER THAN GUESSING WHICH ONE WAS MEANT
        if (row.item.value.kind === "device")
        {
            const { id, input } = row.item.value.value;
            const entries = deviceEntries(box.devices, id, input);

            editSettings((current) => ({
                ...current,
                selected: index,
                confirm: false,
                picker: { title: input ? " Input device " : " Output device ", entries, selected: Math.max(entries.findIndex((entry) => entry.id === id), 0), row: index },
            }));

            return;
        }

        //A NUMBER OR A STRING IS TYPED INTO THE ROW ITSELF
        editSettings((current) => ({ ...current, selected: index, confirm: false, edit: String(row.item.value.value) }));
    };

    //KEEP WHAT WAS TYPED, IF THE ROW CAN HOLD IT - AN UNPARSEABLE NUMBER IS NOT A CHANGE
    const commitEdit = () => editSettings((box) =>
    {
        if (box.edit === null) return box;

        const row = box.rows[box.selected];
        if (row.row !== "item") return { ...box, edit: null };

        const typed = box.edit;

        if (row.item.value.kind === "number")
        {
            const number = Number(typed.trim());

            if (typed.trim() === "" || !Number.isInteger(number) || number === row.item.value.value) return { ...box, edit: null };

            return { ...withRow(box, box.selected, (item) => ({ ...item, value: { kind: "number", value: number }, changed: true })), edit: null };
        }

        if (row.item.value.kind !== "text" || typed === row.item.value.value) return { ...box, edit: null };

        return { ...withRow(box, box.selected, (item) => ({ ...item, value: { kind: "text", value: typed }, changed: true })), edit: null };
    });

    //ONE KEYPRESS WHILE THE BOX IS UP - IT OWNS THE KEYBOARD, THE WAY THE TUI'S OVERLAY DOES
    //ONE KEYPRESS WHILE THE DEVICE LIST IS UP. IT SITS ON TOP OF THE ROWS AND TAKES THE KEYBOARD OFF THEM
    //FOR AS LONG AS IT IS OPEN - THERE IS NOTHING TO DO IN THE BOX BEHIND IT UNTIL A DEVICE IS PICKED
    const handlePickerKey = (event: React.KeyboardEvent<HTMLDivElement>, picker: Picker) =>
    {
        const move = (delta: number) => editSettings((current) => (current.picker
            ? { ...current, picker: { ...current.picker, selected: Math.min(Math.max(current.picker.selected + delta, 0), current.picker.entries.length - 1) } }
            : current));

        switch (event.key)
        {
            case "Escape": editSettings((current) => ({ ...current, picker: null })); break;

            case "ArrowUp": move(-1); break;
            case "ArrowDown": move(1); break;

            case "Home": editSettings((current) => (current.picker ? { ...current, picker: { ...current.picker, selected: 0 } } : current)); break;
            case "End": editSettings((current) => (current.picker ? { ...current, picker: { ...current.picker, selected: current.picker.entries.length - 1 } } : current)); break;

            case "Enter":
            case " ":
            {
                const chosen = picker.entries[picker.selected];

                if (chosen) setDevice(picker.row, chosen.id);

                editSettings((current) => ({ ...current, picker: null }));
                break;
            }

            default: return;
        }

        event.preventDefault();
    };

    const handleSettingsKey = (event: React.KeyboardEvent<HTMLDivElement>) =>
    {
        const box = settings;
        if (!box || box.edit !== null) return;

        if (box.picker) { handlePickerKey(event, box.picker); return; }

        //Ctrl+S SAVES FROM WHEREVER THE SELECTION IS - THE BUTTON IS AT THE BOTTOM OF A LONG LIST
        if (box.server && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")
        {
            event.preventDefault();
            saveSettings();
            return;
        }

        //AN ARMED RESTART SURVIVES ONLY THE KEY THAT CONFIRMS IT - ANYTHING ELSE PUTS THE BUTTON BACK
        if (event.key !== "Enter" && event.key !== " ") editSettings((current) => ({ ...current, confirm: false }));

        switch (event.key)
        {
            case "Escape": closeSettings(); break;

            case "ArrowUp": editSettings((current) => ({ ...current, selected: stepRow(current.rows, current.selected, -1) })); break;
            case "ArrowDown": editSettings((current) => ({ ...current, selected: stepRow(current.rows, current.selected, 1) })); break;

            case "Home": editSettings((current) => ({ ...current, selected: landRow(current.rows, 0, 1) })); break;
            case "End": editSettings((current) => ({ ...current, selected: landRow(current.rows, current.rows.length - 1, -1) })); break;

            case "ArrowLeft": adjustRow(-1); break;
            case "ArrowRight": adjustRow(1); break;

            case "Enter":
            case " ": activateRow(box.selected); break;

            default: return;
        }

        event.preventDefault();
    };

    //ESCAPE PUTS THE PALETTE AWAY, AND ANYTHING TYPED AFTERWARDS BRINGS IT BACK
    const writeInput = (value: string) =>
    {
        setChatInput(value);
        setDismissed(false);
    };

    //WRITE THE HIGHLIGHTED ROW ONTO THE LINE, WHETHER IT IS A COMMAND OR ONE ANSWER OF A PARAMETER.
    //force IS TAB, WHICH COMPLETES WHATEVER IS HIGHLIGHTED; ENTER ONLY COMPLETES WHAT IS NOT SPELLED OUT
    //ALREADY, SO A FINISHED LINE IS SENT INSTEAD OF BEING REWRITTEN. RETURNS WHETHER THE LINE WAS TOUCHED
    const complete = (force: boolean): boolean =>
    {
        if (exact >= 0 && !force) return false;

        if (palette.mode === "values")
        {
            const value = palette.matches[selected];
            if (!value) return false;

            //EVERYTHING UP TO THE HALF-TYPED VALUE STAYS - THE PARAMETERS BEFORE IT WERE ANSWERED ALREADY
            writeInput(`${chatInput.slice(0, palette.start)}${value.value}`);

            return true;
        }

        if (palette.mode !== "menu") return false;

        const entry = palette.entries[selected];
        if (!entry) return false;

        //LEAVE ROOM FOR PARAMETERS RIGHT AWAY - AN ACTION WORD COUNTS AS ONE, SO /server OPENS ITS OWN MENU
        writeInput(`/${entry.name}${entry.args.length > 0 ? " " : ""}`);

        return true;
    };

    const handleChatKey = (event: React.KeyboardEvent<HTMLInputElement>) =>
    {
        if (event.key === "Escape")
        {
            setDismissed(true);
            return;
        }

        if (event.key === "Enter")
        {
            //A HIGHLIGHTED PALETTE ROW THE USER HASN'T FULLY TYPED COMPLETES FIRST
            if (active && complete(false)) event.preventDefault();

            return;
        }

        //WITH NO MENU OPEN THE ARROWS BELONG TO WHAT WAS TYPED BEFORE, THE WAY THEY DO IN THE TERMINAL -
        //AND A HALF-WRITTEN MESSAGE LOCKS THE SEARCH TO ITSELF INSTEAD OF BEING WALKED OVER
        if (!active)
        {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

            event.preventDefault();

            const line = event.key === "ArrowUp"
                ? historyUp(historyRef.current, chatInput)
                : historyDown(historyRef.current);

            if (line !== null) writeInput(line);

            return;
        }

        if (event.key === "ArrowDown")
        {
            event.preventDefault();
            setSelected((previous) => (previous + 1) % count);
        }
        else if (event.key === "ArrowUp")
        {
            event.preventDefault();
            setSelected((previous) => (previous - 1 + count) % count);
        }
        else if (event.key === "Tab")
        {
            event.preventDefault();
            complete(true);
        }
    };

    const handleChatSubmit = (event: React.FormEvent) =>
    {
        event.preventDefault();
        if (!chatInput.trim()) return;

        //IN A CONVERSATION A PLAIN LINE IS A PRIVATE MESSAGE, AND IT GOES DOWN THE SAME COMMAND PATH
        //TYPING IT OUT WOULD - A LINE THAT ALREADY STARTS WITH / IS A COMMAND WHEREVER IT WAS TYPED,
        //AND THE HISTORY KEEPS WHAT WAS TYPED RATHER THAN WHAT IT TURNED INTO
        send(dm && !chatInput.startsWith("/") ? `/pm ${dm.id} ${chatInput}` : chatInput);
        pushHistory(historyRef.current, chatInput);

        setChatInput("");
    };

    const onPaneScroll = () =>
    {
        const node = paneRef.current;
        if (!node) return;

        pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8;

        if (pinnedRef.current) setUnread(0);
    };


    const channelLabel = currentChannel || "lobby";

    //THE TWO SHAPES OF EVERY WINDOW THAT COVERS THE CONVERSATION. ON A DESKTOP IT IS A CARD FLOATING IN
    //A DARKENED ROOM; ON A PHONE THERE IS NO ROOM TO FLOAT IN, SO IT IS THE SCREEN
    //THE NARROW ONE PAYS THE INSETS AGAIN, EVEN THOUGH <main> ALREADY DID: AN absolute inset-0 CHILD IS
    //LAID OUT AGAINST ITS ANCESTOR'S *PADDING BOX*, SO IT COVERS THE NOTCH THAT PADDING WAS KEEPING CLEAR
    //- AND A HEADER UNDER THE STATUS BAR IS AN X THAT PULLS DOWN THE NOTIFICATIONS INSTEAD OF CLOSING.
    //THE WRAP PAYS AND NOT THE CARD, SO THE OVERLAY STILL REACHES THE GLASS BEHIND THE BAR
    const dialogWrap = narrow
        ? "safe-top safe-bottom absolute inset-0 z-40 flex bg-overlay"
        : "absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4";

    const dialogCard = (wide: string) => narrow
        ? "flex h-full w-full flex-col overflow-hidden bg-overlay outline-none"
        : wide;

    //WHAT THE MIDDLE COLUMN IS: A CHANNEL, OR ONE PERSON. THE HEADING, THE TAB, THE WAY BACK OUT OF A
    //SCREEN AND THE COMPOSER'S OWN PLACEHOLDER ARE ALL THE SAME QUESTION ASKED IN FOUR PLACES
    const columnLabel = dm ? dm.username : channelLabel;
    const columnIcon = dm ? "at" : "hash";

    //WHAT THE PALETTE IS OFFERING: THE COMMANDS, THE PARAMETER'S OWN VOCABULARY, OR THE PARAMETERS
    const paletteTitle = palette.mode === "values"
        ? `${palette.arg.name.charAt(0).toUpperCase()}${palette.arg.name.slice(1).toLowerCase()}`
        : palette.mode === "menu" ? "Commands" : "Parameters";

    //ONE ROW PER COMMAND, OR THE SINGLE PARAMETER HINT. THE ACTIVE PARAMETER'S OWN DESCRIPTION TAKES OVER
    //THE COLUMN WHILE IT IS BEING TYPED - index IS null FOR THE HINT, WHICH IS THERE TO BE READ, NOT PICKED
    const entryRow = (entry: PaletteEntry, index: number | null, activeArgument: number | null) =>
    {
        const chosen = index !== null && index === selected;
        const described = activeArgument !== null ? entry.args[activeArgument] : undefined;

        return (
            <div
                key={entry.name}
                ref={chosen ? selectedRef : undefined}
                onMouseEnter={index === null ? undefined : () => setSelected(index)}
                onClick={index === null ? undefined : () => { complete(true); chatInputRef.current?.focus(); }}
                className={`flex items-baseline gap-2 border-l-2 px-3 py-1.5 ${index === null ? "border-transparent" : "cursor-pointer"} ${chosen ? "border-accent bg-selected" : "border-transparent"}`}
            >
                <span className="font-mono text-[13px] font-semibold text-text">/{entry.name}</span>
                {entry.args.map((arg, position) => (
                    <span
                        key={arg.name}
                        className={`font-mono text-[13px] ${position === activeArgument ? "text-accent" : arg.required ? "text-arg-required" : "text-arg-optional"}`}
                    >
                        {formatArg(arg)}
                    </span>
                ))}
                <span className="ml-auto truncate pl-6 text-xs text-muted">{described?.description ?? entry.description}</span>
            </div>
        );
    };

    //ONE ROW PER ANSWER THE PARAMETER ACCEPTS, EACH SHOWING ITS OWN COLOR - A NAME ALONE WOULD STILL BE A GUESS
    const valueRow = (value: VocabularyValue, index: number) =>
    {
        const chosen = index === selected;

        return (
            <div
                key={value.value}
                ref={chosen ? selectedRef : undefined}
                onMouseEnter={() => setSelected(index)}
                onClick={() => { complete(true); chatInputRef.current?.focus(); }}
                className={`flex cursor-pointer items-center gap-3 border-l-2 px-3 py-1.5 ${chosen ? "border-accent bg-selected" : "border-transparent"}`}
            >
                {/* THE SWATCH IS THE ACTUAL ANSI COLOR - EVEN black AND dark_grey ARE SOMETHING TO LOOK AT */}
                {value.color !== null && (
                    <span
                        className="h-4 w-4 shrink-0 rounded border border-white/15"
                        style={{ backgroundColor: ANSI_TRUE[value.color] }}
                    />
                )}
                <span className="text-sm">{value.value}</span>
            </div>
        );
    };

    //THE WHOLE PANE. THE GROUPING IS DECIDED HERE AND NOT PER MESSAGE, BECAUSE IT IS ABOUT WHAT CAME
    //BEFORE - AND ANYTHING THAT IS NOT SOMEBODY TALKING BREAKS THE RUN
    const paneNodes = (() =>
    {
        let previous: string | null = null;

        return pane.map((entry, index) =>
        {
            if (entry.entry === "block")
            {
                previous = null;

                return renderBlock(entry.title, entry.rows, index);
            }

            const message = entry.message;

            if (message.kind !== "user" && message.kind !== "private")
            {
                previous = null;

                return renderNotice(message, index);
            }

            const author = `${message.kind} ${message.username} ${message.id ?? ""}`;
            const grouped = author === previous;

            previous = author;

            return renderChat(message, index, grouped, config, username, dm !== null);
        });
    })();

    //THE SETTINGS DIALOG. IT OWNS THE KEYBOARD WHILE IT IS UP, THE WAY THE TUI'S OVERLAY DOES - THE FOCUS
    //MOVES INTO IT, SO NOTHING TYPED HERE REACHES THE COMPOSER BEHIND IT
    const settingsBox = settings && (
        <SettingsDialog
            settings={settings}
            settingsRef={settingsRef}
            settingsRowRef={settingsRowRef}
            pickerRowRef={pickerRowRef}
            dialogWrap={dialogWrap}
            dialogCard={dialogCard}
            onKeyDown={handleSettingsKey}
            setToggle={setToggle}
            setVolume={setVolume}
            setDevice={setDevice}
            activateRow={activateRow}
            commitEdit={commitEdit}
            editSettings={editSettings}
            close={closeSettings}
        />
    );
    //WHAT IS ON THE SERVER, IN A WINDOW OF ITS OWN. NOBODY SAID IT, SO IT DOES NOT BELONG IN THE
    //SCROLLBACK - IT IS A DRAWER THAT IS OPENED, LOOKED THROUGH AND CLOSED, AND IT CLOSES THE WAY EVERY
    //OTHER MENU HERE DOES: ESC, THE X, OR A PRESS THAT LANDED OUTSIDE IT
    const filesBox = files && (
        <FilesBox
            files={files}
            filter={filter}
            setFilter={setFilter}
            config={config}
            filesRef={filesRef}
            dialogWrap={dialogWrap}
            dialogCard={dialogCard}
            send={send}
            refresh={() => send("/files")}
            close={closeFiles}
        />
    );

    //SCREENS, BOTH WAYS ROUND: WHICH OF OURS TO SHARE AND WHOSE TO WATCH. THE PICK NEVER LEAVES THIS
    //MACHINE - THE SERVER ONLY EVER KNOWS *THAT* WE ARE SHARING - AND NAMING ANOTHER MONITOR WHILE THE
    //SHARE IS UP SWAPS THE CAPTURE OVER WITHOUT STOPPING IT
    const screensBox = screensOpen && (
        <ScreensBox
            sharers={sharers}
            monitors={monitors}
            watching={watching}
            username={username}
            screen={screen}
            dialogWrap={dialogWrap}
            dialogCard={dialogCard}
            send={send}
            askScreens={askScreens}
            close={() => setScreensOpen(false)}
        />
    );

    //THE CONNECT SCREEN ASKS FOR EVERYTHING UNTIL WE ARE IN: THE ADDRESS, THEN WHOEVER THE SERVER WANTS US
    //TO BE. IT IS THE WHOLE WINDOW RATHER THAN A BOX OVER THE CHAT, BECAUSE THERE IS NO CHAT BEHIND IT YET
    //THE RAIL'S + WHILE THERE IS A SESSION BEHIND IT: THE CONNECT SCREEN IS THE FORM'S OTHER HOME, AND
    //THAT ONE IS ONLY UP WHILE THERE IS NONE
    const addBox = addOpen && (
        <AddServerDialog
            form={form}
            setForm={setForm}
            connecting={connecting}
            errorMsg={errorMsg}
            cardRef={addRef}
            dialogWrap={dialogWrap}
            dialogCard={dialogCard}
            narrow={narrow}
            onSubmit={handleSubmit}
            close={closeAdd}
        />
    );

    //THE FAR-LEFT COLUMN, WHICH STANDS INSIDE THE SESSION - THE SELECTION SCREEN IS THE SAME LIST DRAWN
    //LARGE, AND DRAWING BOTH AT ONCE WOULD BE ASKING THE SAME QUESTION TWICE ON ONE SCREEN - IT IS THE WAY INTO ONE AND
    //THE WAY BETWEEN TWO. IT IS DRAWN INSIDE THE LEFT COLUMN WHILE THERE IS ONE, AND INSIDE THE CONNECT
    //SCREEN WHILE THERE IS NOT; ON A PHONE THAT MAKES IT PART OF THE SAME DRAWER RATHER THAN A SECOND ONE
    const rail = (
        <ServerRail
            servers={servers}
            active={dialing?.id ?? null}
            connecting={connecting}
            onPick={pickServer}
            onAdd={openAdd}
            onForget={forgetServer}
        />
    );

    const loginScreen = !connected && !tofu && (
        <LoginScreen
            uiState={uiState}
            mode={mode}
            servers={servers}
            target={dialing}
            form={form}
            setForm={setForm}
            value={inputValue}
            setValue={setInputValue}
            connecting={connecting}
            errorMsg={errorMsg}
            hint={hint}
            registering={registering}
            inputRef={loginInputRef}
            narrow={narrow}
            onSubmit={handleSubmit}
            onPick={pickServer}
            onAdd={openAdd}
            onForget={forgetServer}
            onCancel={() => setAdding(false)}
        />
    );

    //THE IDENTITY CHECK. IT COVERS EVEN THE CONNECT SCREEN, BECAUSE IT IS THE ONLY THING THE USER MAY
    //ANSWER WHILE IT IS UP - AND IT CAN APPEAR MID-SESSION TOO, SINCE THE PERIODIC REKEY RUNS THE SAME CHECK
    const tofuBox = tofu && (
        <TofuDialog tofu={tofu} typed={tofuTyped} setTyped={setTofuTyped} answer={answerTofu} />
    );
    return (
        <main
            //A CLICK ANYWHERE THAT IS NOT THE COMPOSER PUTS THE PALETTE AWAY - IT IS A MENU LIKE ANY OTHER,
            //AND THE NEXT KEYSTROKE IN THE LINE BRINGS IT STRAIGHT BACK
            onMouseDown={() => setDismissed(true)}
            onTouchStart={onSwipeStart}
            onTouchMove={onSwipeMove}
            onTouchEnd={onSwipeEnd}
            onTouchCancel={onSwipeCancel}

            //h-dvh AND NOT h-screen: A PHONE'S VIEWPORT IS THE ONE THING THAT CHANGES HEIGHT WHILE THE
            //PAGE IS UP, AND WITH interactive-widget=resizes-content THE SOFT KEYBOARD IS EXACTLY THAT.
            //THE INSETS ARE PAID BACK HERE ONCE, SO EVERY COLUMN INSIDE IS ALREADY CLEAR OF THE NOTCH
            className="noise-overlay safe-top safe-bottom relative flex h-dvh w-screen overflow-hidden bg-chat text-[15px] text-text"
        >
            {connected && (
                <>
                    {/* THE SHEET UNDER AN OPEN DRAWER, WHICH IS ALSO THE WAY OUT OF ONE. IT IS THERE
                        WHENEVER A DRAWER COULD BE, ONLY FADED OUT AND OUT OF REACH WHILE THERE IS NONE:
                        A DRAG DARKENS IT BY THE INCH, AND A SHEET MOUNTED AT THE END OF THE DRAG WOULD
                        HAVE NOTHING TO DARKEN FROM */}
                    {narrow && !theater && (
                        <div
                            ref={scrimEl}
                            onMouseDown={() => setDrawer(null)}
                            //fixed AND NOT absolute, LIKE THE DRAWERS IT SITS UNDER: BOTH ARE AGAINST THE
                            //VIEWPORT, SO THE DARKNESS REACHES THE SAME EDGES OF THE GLASS THEY DO
                            className={`scrim fixed inset-0 z-30 bg-black/50 ${drawer === null ? "pointer-events-none opacity-0" : "opacity-100"}`}
                        />
                    )}

                    {/* THE LEFT COLUMN: WHERE WE ARE, WHERE WE COULD BE, AND WHO WE ARE WHILE WE ARE THERE.
                        ON A PHONE IT IS THE SAME COLUMN SLID IN OVER THE CONVERSATION - AND IT IS ALWAYS
                        RENDERED, TRANSLATED OUT OF SIGHT, BECAUSE A PANEL THAT IS MOUNTED WHEN IT OPENS
                        HAS NOWHERE TO SLIDE FROM */}
                    <Sidebar
                        serverName={serverName}
                        address={address}
                        role={role}
                        username={username}
                        users={users}
                        channels={channels}
                        currentChannel={currentChannel}
                        directs={directs}
                        openDm={openDm}
                        voice={voice}
                        screen={screen}
                        creating={creating}
                        setCreating={setCreating}
                        canServerSettings={canServerSettings}
                        hasVoice={hasVoice}
                        narrow={narrow}
                        drawer={drawer}
                        theater={theater}
                        setDrawer={setDrawer}
                        send={send}
                        showDirect={showDirect}
                        closeDirect={closeDirect}
                        openScreens={openScreens}
                        rail={rail}
                        panelRef={leftPanel}
                    />

                    {/* THE MIDDLE: THE CHANNEL, WHAT WAS SAID IN IT, AND THE LINE THAT SAYS THE NEXT THING */}
                    <section className="flex min-w-0 flex-1 flex-col bg-chat">
                        <header className={`h-14 shrink-0 items-center gap-2 border-b border-border ${narrow ? "px-2" : "px-4"} ${theater ? "hidden" : "flex"}`}>
                            {narrow && (
                                <IconButton icon="menu" label="Channels" onClick={() => setDrawer("left")} />
                            )}

                            {/* WHILE THERE IS A SCREEN TO LOOK AT, THE HEAD OF THE COLUMN IS THE CHOICE OF
                                WHICH TO LOOK AT - THE PICTURE TAKES THE WHOLE COLUMN OR NONE OF IT, BECAUSE
                                HALF A CHAT ABOVE HALF A SCREEN IS TWO THINGS TOO SMALL TO READ */}
                            {watching ? (
                                <div className="flex min-w-0 items-center gap-1 rounded-app bg-deep p-1">
                                    {([["chat", columnIcon, columnLabel], ["screen", "monitor", watching]] as const).map(([which, icon, label]) => (
                                        <button
                                            key={which}
                                            type="button"
                                            onClick={() => setView(which)}
                                            className={`flex min-w-0 items-center gap-1.5 rounded-app px-2.5 py-1.5 text-sm transition-colors ${view === which
                                                ? "bg-active font-semibold text-text"
                                                : "text-muted hover:bg-hover hover:text-text"}`}
                                        >
                                            <Icon name={icon} className={`h-4 w-4 shrink-0 ${which === "screen" && view !== which ? "text-online" : ""}`} />
                                            <span className="max-w-[14ch] truncate">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <>
                                    <Icon name={columnIcon} className="h-5 w-5 shrink-0 text-faint" />
                                    <span className="truncate font-semibold">{columnLabel}</span>

                                    <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
                                    <span className="hidden min-w-0 truncate text-xs text-faint sm:block">
                                        {dm
                                            ? users.some((user) => user.id === dm.id) ? "online" : "no longer on the server"
                                            : `${users.length} online`}
                                    </span>
                                </>
                            )}

                            <div className="ml-auto flex items-center gap-1">
                                <IconButton
                                    icon="folder"
                                    label="Files on the server"
                                    active={filesOpen}
                                    onClick={() => (filesOpen ? closeFiles() : send("/files"))}
                                />
                                {hasScreens && (
                                    <IconButton
                                        icon="monitor"
                                        label="Screens"
                                        tone={screen.sharing ? "ok" : "default"}
                                        active={screen.sharing || screensOpen}
                                        onClick={openScreens}
                                    />
                                )}
                                {hasVoice && (
                                    <IconButton
                                        icon="headset"
                                        label={voice.enabled ? "Leave the call" : "Join the call"}
                                        tone={voice.enabled ? "ok" : "default"}
                                        onClick={() => send("/voice")}
                                    />
                                )}

                                {/* THE SAME BUTTON EITHER WAY ROUND: A COLUMN TO STAND BESIDE THE
                                    CONVERSATION, OR A DRAWER TO SLIDE OVER IT */}
                                <IconButton
                                    icon="users"
                                    label="Members"
                                    active={narrow ? drawer === "right" : members}
                                    onClick={() => (narrow
                                        ? setDrawer((previous) => (previous === "right" ? null : "right"))
                                        : setMembers((previous) => !previous))}
                                />
                            </div>
                        </header>

                        {/* SOMEBODY ELSE'S SCREEN. IT IS ONLY HIDDEN AND NEVER UNMOUNTED WHILE IT IS BEING
                            WATCHED - A CANVAS THAT LEFT THE PAGE WOULD TAKE THE DECODER'S TARGET WITH IT,
                            AND THE PICTURE WOULD COME BACK BLACK */}
                        <div className={`min-h-0 flex-1 flex-col bg-deep ${watching && view === "screen" ? "flex" : "hidden"}`}>
                            <div className="relative min-h-0 flex-1">
                                <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />

                                {viewerError && (
                                    <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-error">
                                        {viewerError}
                                    </div>
                                )}
                            </div>

                            {/* WHOSE PICTURE IT IS, WHO IS DECODING IT, AND THE TWO WAYS OUT OF IT: BACK TO
                                WHAT IS BEING SAID, OR OUT OF THE SHARE ALTOGETHER */}
                            <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3">
                                <button
                                    type="button"
                                    title="Back to the chat (esc)"
                                    onClick={() => setView("chat")}
                                    className="flex shrink-0 items-center gap-1.5 rounded-app px-2 py-1 text-sm text-muted transition-colors hover:bg-hover hover:text-text"
                                >
                                    <Icon name={columnIcon} className="h-4 w-4" />
                                    <span className="max-w-[14ch] truncate">{columnLabel}</span>
                                </button>

                                <span className="h-4 w-px shrink-0 bg-border" />

                                <Icon name="monitor" className="h-4 w-4 shrink-0 text-online" />

                                <span className="min-w-0 truncate text-sm">
                                    <span className="font-semibold">{watching}</span>
                                    <span className="text-muted">&apos;s screen</span>
                                </span>

                                {decoding && (
                                    <span
                                        title={decoding === "webview"
                                            ? "The window is decoding the H.264 stream itself"
                                            : "This webview has no H.264 decoder, so the frames are decoded for it and sent on as pictures"}
                                        className="shrink-0 rounded bg-hover px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-faint"
                                    >
                                        {decoding === "webview" ? "h.264" : "jpeg"}
                                    </span>
                                )}

                                <button
                                    type="button"
                                    onClick={() => send("/deattach")}
                                    className="ml-auto shrink-0 rounded-app border border-border px-3 py-1 text-xs font-semibold text-muted transition hover:border-error hover:text-error"
                                >
                                    Stop watching
                                </button>
                            </div>
                        </div>

                        <div className={`relative min-h-0 flex-1 flex-col ${watching && view === "screen" ? "hidden" : "flex"}`}>
                            <div ref={paneRef} onScroll={onPaneScroll} className="scroller relative min-h-0 flex-1 pb-4">
                                {/* THE HEAD OF EVERY CHANNEL SAYS WHAT IT IS - AND WITH NOTHING SAID IN IT YET,
                                    IT IS THE WHOLE OF WHAT THERE IS TO LOOK AT */}
                                <div className="px-4 pb-2 pt-8">
                                    <h1 className="text-2xl font-bold">{dm ? dm.username : `Welcome to #${channelLabel}`}</h1>
                                    <p className="mt-1 text-sm text-muted">
                                        {dm
                                            ? `This is the beginning of your conversation with ${dm.username}. Nobody else can read it, and nothing keeps it past this session.`
                                            : currentChannel
                                                ? `This is the start of #${currentChannel}. It exists as long as somebody is in it.`
                                                : `This is the beginning of ${serverName || "the server"}.`}
                                    </p>
                                </div>

                                {paneNodes}
                            </div>

                            {/* THE PANE FOLLOWS THE BOTTOM ONLY WHILE IT IS ALREADY THERE - SCROLLING UP PARKS
                                IT AND COUNTS WHAT ARRIVES, AND THIS IS THE WAY BACK DOWN */}
                            {unread > 0 && (
                                <button
                                    type="button"
                                    onClick={() =>
                                    {
                                        const node = paneRef.current;
                                        if (node) node.scrollTop = node.scrollHeight;

                                        pinnedRef.current = true;
                                        setUnread(0);
                                    }}
                                    className="absolute inset-x-4 bottom-1 flex items-center gap-2 rounded-app bg-accent px-3 py-1.5 text-xs font-semibold text-black/85 shadow-lg"
                                >
                                    <Icon name="arrow_down" className="h-3.5 w-3.5" />
                                    {unread} new {unread === 1 ? "message" : "messages"}
                                </button>
                            )}
                        </div>

                        <div
                            className={`relative shrink-0 pt-1 ${narrow ? "px-2 pb-2" : "px-4 pb-5"} ${theater ? "hidden" : ""}`}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            {/* THE PALETTE SITS ON THE COMPOSER, WHICH IS WHERE THE LINE IT IS TALKING ABOUT IS */}
                            {palette.mode !== "hidden" && (
                                <div className={`rise absolute bottom-full z-20 mb-2 overflow-hidden rounded-app border border-border bg-overlay shadow-2xl ${narrow ? "inset-x-2" : "inset-x-4"}`}>
                                    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{paletteTitle}</span>
                                        {active && <span className="text-[11px] text-faint">↑↓ select · tab complete · esc dismiss</span>}
                                    </div>

                                    <div className="scroller" style={{ maxHeight: `${PALETTE_ROWS * 2.1}rem` }}>
                                        {palette.mode === "menu" && palette.entries.map((entry, index) => entryRow(entry, index, null))}
                                        {palette.mode === "signature" && entryRow(palette.entry, null, palette.active)}
                                        {palette.mode === "values" && palette.matches.map(valueRow)}
                                    </div>
                                </div>
                            )}

                            <form onSubmit={handleChatSubmit} className={`flex items-center gap-1 bg-raised px-2 ${narrow ? "rounded-full py-1" : "rounded-app py-1.5"}`}>
                                <IconButton icon="plus" label="Upload a file" onClick={uploadFile} />

                                <input
                                    ref={chatInputRef}
                                    id="chat-input"
                                    type="text"
                                    value={chatInput}
                                    onChange={(event) => writeInput(event.currentTarget.value)}
                                    onKeyDown={handleChatKey}
                                    placeholder={dm ? `Message @${dm.username}` : `Message #${channelLabel}`}
                                    className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[15px] outline-none placeholder:text-faint"

                                    //THE SOFT KEYBOARD OPENS WHEN THE LINE IS TAPPED AND NOT WHEN THE
                                    //WINDOW APPEARS, AND ITS RETURN KEY SAYS WHAT IT ACTUALLY DOES
                                    autoFocus={!narrow}
                                    enterKeyHint="send"
                                    autoCapitalize="sentences"
                                    autoCorrect="off"
                                    spellCheck={false}
                                />

                                <button
                                    type="submit"
                                    title="Send"
                                    aria-label="Send"
                                    disabled={!chatInput.trim()}
                                    className="flex h-8 w-8 items-center justify-center rounded-app text-muted transition-colors hover:bg-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                                >
                                    <Icon name="send" className="h-[18px] w-[18px]" />
                                </button>
                            </form>
                        </div>
                    </section>

                    {/* THE RIGHT COLUMN: EVERYBODY ON THE SERVER, AND WHICH CHANNEL THEY ARE SITTING IN */}
                    {(narrow ? !theater : members && !theater) && (
                        <MemberColumn
                            users={users}
                            username={username}
                            config={config}
                            narrow={narrow}
                            drawer={drawer}
                            setDrawer={setDrawer}
                            showDirect={showDirect}
                            panelRef={rightPanel}
                        />
                    )}
                </>
            )}

            {/* WHAT THE SERVER SAID IN PASSING - IT IS NOT A MESSAGE, AND IT DOES NOT BELONG IN THE PANE */}
            {popupMessage && (
                <div className="rise absolute bottom-6 left-1/2 z-50 max-w-[80vw] -translate-x-1/2 rounded-app border border-border bg-overlay px-4 py-2 text-sm text-muted shadow-2xl">
                    {popupMessage}
                </div>
            )}

            {settingsBox}
            {filesBox}
            {screensBox}
            {addBox}
            {loginScreen}
            {tofuBox}
        </main>
    );
}

export default App;
