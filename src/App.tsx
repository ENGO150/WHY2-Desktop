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

//THE NAME OF THE SET A PARAMETER ACCEPTS - "free" IS EVERYTHING ELSE, AND HAS NOTHING TO OFFER
type ArgValues = "free" | "colors" | "monitors" | "roles";

interface CommandArgInfo
{
    name: string;
    description: string;
    required: boolean;
    values: ArgValues;
}

interface SubcommandInfo
{
    name: string;
    triggers: string[];
    description: string;
    args: CommandArgInfo[];
}

interface CommandInfo
{
    name: string;
    triggers: string[];
    description: string;
    args: CommandArgInfo[];
    subcommands: SubcommandInfo[];
}

//ONE ROW OF client.toml THE SETTINGS BOX OFFERS. EVERY ONE OF THEM IS A TOGGLE, AND EVERY ONE IS WRITTEN
//THROUGH THE MOMENT IT IS FLIPPED - THIS CONFIG IS OURS, UNLIKE THE SERVER'S
interface ClientSetting
{
    label: string;
    key: string;
    section: string;
    on: boolean;
}

//THE THREE DATATYPES server.toml UNDERSTANDS
type SettingValueInfo =
    | { kind: "toggle"; value: boolean }
    | { kind: "number"; value: number }
    | { kind: "text"; value: string };

//ONE ROW OF server.toml, BOTH WAYS - WHAT THE SERVER SENT, AND WHAT A SAVE SENDS BACK
interface SettingRow
{
    key: string;
    value: SettingValueInfo;
    section: string;
    description: string;
    restart: boolean;
}

//ONE ROW OF THE SETTINGS BOX, WHICHEVER CONFIG IT IS SHOWING
interface SettingsItem
{
    label: string;
    key: string;
    value: SettingValueInfo;
    hint: string;      //THE COMMENT THE SERVER SENT ALONG (EMPTY ON A CLIENT ROW)
    changed: boolean;  //EDITED AND NOT SAVED YET - ONLY A SERVER ROW IS EVER LEFT UNSAVED
    restart: boolean;  //SAVING IT STORES IT, BUT THE RUNNING SERVER KEEPS USING WHAT IT READ AT STARTUP
}

type SettingsRow =
    | { row: "header"; label: string }
    | { row: "item"; item: SettingsItem }
    | { row: "action"; label: string }; //A BUTTON - THE SERVER ROWS ARE THE ONLY THING THAT NEEDS ONE

//THE BOX ITSELF, IN EITHER OF ITS TWO MODES
interface SettingsBox
{
    rows: SettingsRow[];
    selected: number;
    server: boolean;          //THE ROWS BELONG TO server.toml, WHICH IS NOT OURS TO WRITE
    edit: string | null;      //WHAT IS BEING TYPED INTO THE SELECTED ROW
    saving: boolean;          //A SAVE IS ON THE WIRE, WAITING FOR THE SERVER TO ANSWER WITH WHAT IT STORED
    confirm: boolean;         //THE RESTART BUTTON IS ARMED BY ONE PRESS AND FIRED BY THE NEXT
}

//ONE ANSWER A PARAMETER ACCEPTS, AS THE BRIDGE HANDS IT OVER
interface VocabularyValue
{
    value: string;
    color: number | null;
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

//ONE ROW OF THE COMMAND PALETTE: A COMMAND, OR ONE ACTION OF A COMMAND THAT TAKES ONE (/server mute).
//AN ACTION SPEAKS FOR ITSELF FROM HERE ON - ITS OWN PARAMETERS, ITS OWN DESCRIPTION
interface PaletteEntry
{
    name: string;              //WHAT THE USER TYPES TO GET HERE, WITHOUT THE PARAMETERS (server mute)
    word: string[];            //EVERY SPELLING OF THE LAST WORD OF IT - THE ONE BEING TYPED
    parent: string[] | null;   //EVERY SPELLING OF THE COMMAND WORD IN FRONT OF IT, WHERE THERE IS ONE
    description: string;
    args: CommandArgInfo[];
}

//WHAT THE PALETTE IS SHOWING. THE TUI'S PaletteMode, MINUS NOTHING: A MENU OF COMMANDS OR ACTIONS, THE
//ANSWERS ONE PARAMETER ACCEPTS WHERE THERE IS A KNOWN LIST OF THEM, OR THE PLAIN SIGNATURE HINT
type PaletteState =
    | { mode: "hidden" }
    | { mode: "menu"; entries: PaletteEntry[] }
    | { mode: "values"; arg: CommandArgInfo; matches: VocabularyValue[]; start: number }
    | { mode: "signature"; entry: PaletteEntry; active: number | null };

//THE SHAPE OF THE PALETTE BEFORE ITS VOCABULARY IS IN HAND - EVERYTHING BUT THE VALUES MODE IS ALREADY
//FINAL, AND THAT ONE STILL HAS TO BE ASKED FOR
type PaletteShape =
    | PaletteState
    | { mode: "pending"; entry: PaletteEntry; active: number; arg: CommandArgInfo; typed: string; start: number };

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
    | { event: "open_settings"; data?: null }
    | { event: "server_settings"; data: { settings: SettingRow[]; saved: boolean } }
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

//HOW MANY ROWS OF THE PALETTE ARE ON SCREEN AT ONCE, AS IN palette::MAX_ROWS - EACH HALF OF THE COLOR
//VOCABULARY IS EXACTLY THIS LONG, SO AN UNFILTERED POPUP SHOWS ONE HALF AT A TIME. ONE ROW IS leading-6
const PALETTE_ROWS = 8;

function commandEntry(command: CommandInfo): PaletteEntry
{
    return { name: command.name, word: command.triggers, parent: null, description: command.description, args: command.args };
}

function actionEntry(command: CommandInfo, sub: SubcommandInfo): PaletteEntry
{
    return {
        name: `${command.name} ${sub.name}`,
        word: sub.triggers,
        parent: command.triggers,
        description: sub.description,
        args: sub.args,
    };
}

//<REQUIRED> / [OPTIONAL], SPELLED THE WAY palette::format_arg SPELLS IT
function formatArg(arg: CommandArgInfo): string
{
    return arg.required ? `<${arg.name.toLowerCase()}>` : `[${arg.name.toLowerCase()}]`;
}

//WHICH PARAMETER THE CARET IS SITTING ON
function activeArg(args: CommandArgInfo[], tail: string): number
{
    const given = tail.split(/\s+/).filter(Boolean).length;

    //A TRAILING SPACE MEANS THE USER MOVED ON TO THE NEXT PARAMETER
    const index = /\s$/.test(tail) ? given : Math.max(given - 1, 0);

    //THE LAST PARAMETER SWALLOWS THE REST OF THE LINE (A PRIVATE MESSAGE), SO THERE IS NEVER A PARAMETER
    //BEYOND IT TO ADVANCE TO - KEEP IT ACTIVE NO MATTER HOW MUCH MORE IS TYPED
    return Math.min(index, args.length - 1);
}

//THE HALF-TYPED VALUE THE CARET IS ON - EMPTY ONCE THE USER HAS MOVED ON TO THE NEXT PARAMETER
function partial(tail: string): string
{
    if (/\s$/.test(tail)) return "";

    const words = tail.split(/\s+/).filter(Boolean);

    return words[words.length - 1] ?? "";
}

//THE ENTRY IS ALREADY SPELLED OUT ON THE LINE, SO ENTER SENDS IT INSTEAD OF COMPLETING IT
function entryTyped(entry: PaletteEntry, input: string): boolean
{
    if (!input.trim().startsWith("/")) return false;

    const rest = input.trim().slice(1).toLowerCase();

    if (entry.parent === null) return entry.word.includes(rest);

    //BOTH WORDS HAVE TO BE THERE - THE COMMAND WORD ALONE IS NOT THIS ENTRY
    const split = rest.search(/\s/);
    if (split < 0) return false;

    return entry.parent.includes(rest.slice(0, split)) && entry.word.includes(rest.slice(split).trim());
}

//THE PARAMETER THE CARET IS ON: ITS OWN ANSWERS WHERE IT HAS A CLOSED SET OF THEM, OTHERWISE THE PLAIN
//SIGNATURE HINT. THE ANSWERS THEMSELVES ARE NOT HERE - THEY ARE ASKED OF THE BRIDGE ONCE THIS SAYS WHICH
function hint(entry: PaletteEntry, tail: string, input: string): PaletteShape
{
    const active = activeArg(entry.args, tail);
    const arg = entry.args[active];

    if (arg && arg.values !== "free")
    {
        const typed = partial(tail);

        return { mode: "pending", entry, active, arg, typed: typed.toLowerCase(), start: input.length - typed.length };
    }

    return { mode: "signature", entry, active };
}

//THE ACTION WORD OF /command <action> ... - A MENU WHILE IT IS BEING TYPED, ITS PARAMETERS ONCE IT IS DONE
function actionShape(command: CommandInfo, tail: string, input: string): PaletteShape
{
    const split = tail.search(/\s/);

    //STILL TYPING THE ACTION - FILTER WHAT OUR ROLE MAY RUN (THE BRIDGE ALREADY DID THE FILTERING)
    if (split < 0)
    {
        const candidate = tail.toLowerCase();

        const entries = command.subcommands
            .filter((sub) => sub.triggers.some((trigger) => trigger.startsWith(candidate)))
            .map((sub) => actionEntry(command, sub));

        return entries.length > 0 ? { mode: "menu", entries } : { mode: "hidden" };
    }

    const action = tail.slice(0, split).toLowerCase();
    const sub = command.subcommands.find((candidate) => candidate.triggers.includes(action));

    //AN ACTION OUT OF OUR REACH IS NOT HINTED EITHER - IT IS NOT SUPPOSED TO BE THERE AT ALL
    if (!sub || sub.args.length === 0) return { mode: "hidden" };

    return hint(actionEntry(command, sub), tail.slice(split), input);
}

//WHAT THE PALETTE SHOULD BE SHOWING FOR THIS LINE - palette::update, WITH THE VOCABULARY LEFT FOR LATER.
//A COMMAND THAT IS A DOORWAY TO ACTIONS IS ONE ROW UNTIL ITS WORD IS FINISHED: /server IS NOT NINE
//COMMANDS IN THE LIST, IT IS ONE THAT OPENS ITS OWN
function analyze(input: string, commands: CommandInfo[]): PaletteShape
{
    if (!input.startsWith("/")) return { mode: "hidden" };

    const rest = input.slice(1);
    const split = rest.search(/\s/);

    //STILL TYPING THE COMMAND WORD - FILTER THE LIST
    if (split < 0)
    {
        const candidate = rest.toLowerCase();

        const entries = commands
            .filter((command) => command.triggers.some((trigger) => trigger.startsWith(candidate)))
            .map(commandEntry);

        return entries.length > 0 ? { mode: "menu", entries } : { mode: "hidden" };
    }

    const word = rest.slice(0, split).toLowerCase();
    const tail = rest.slice(split);

    const command = commands.find((candidate) => candidate.triggers.includes(word));
    if (!command) return { mode: "hidden" };

    //A COMMAND THAT TAKES AN ACTION HAS NOTHING OF ITS OWN TO HINT - THE ACTION OWNS EVERYTHING PAST IT
    if (command.subcommands.length > 0) return actionShape(command, tail.trimStart(), input);

    if (command.args.length === 0) return { mode: "hidden" };

    return hint(commandEntry(command), tail, input);
}

//THE TWO BUTTONS UNDER THE SERVER ROWS: THE ONE THEY ARE SENT BACK WITH, AND THE ONE THAT PUTS THE
//STARTUP-ONLY ONES IN USE
const SAVE_LABEL = "Save";
const RESTART_LABEL = "Restart server";

//OUR OWN CONFIG, GROUPED THE WAY THE BRIDGE GROUPED IT
function clientRows(settings: ClientSetting[]): SettingsRow[]
{
    const rows: SettingsRow[] = [];
    let section = "";

    for (const setting of settings)
    {
        if (setting.section !== section)
        {
            section = setting.section;
            if (section) rows.push({ row: "header", label: section });
        }

        rows.push({ row: "item", item: {
            label: setting.label,
            key: setting.key,
            value: { kind: "toggle", value: setting.on },
            hint: "",
            changed: false,
            restart: false,
        } });
    }

    return rows;
}

//THE SERVER'S OWN CONFIG. NOTHING HERE NAMES A KEY - THE ROWS, THE HEADINGS AND THE HINTS ARE ALL WHATEVER
//server.toml TURNED OUT TO HOLD, SO A KEY ADDED THERE NEEDS NO CLIENT CHANGE AT ALL
function serverRows(settings: SettingRow[]): SettingsRow[]
{
    const rows: SettingsRow[] = [];
    let section = "";

    for (const setting of settings)
    {
        if (setting.section !== section)
        {
            section = setting.section;
            if (section) rows.push({ row: "header", label: section });
        }

        rows.push({ row: "item", item: {
            label: setting.key.replace(/_/g, " "),
            key: setting.key,
            value: setting.value,
            hint: setting.description,
            changed: false,
            restart: setting.restart, //THE SERVER SAYS WHICH OF ITS OWN KEYS IT ONLY READS AT STARTUP
        } });
    }

    rows.push({ row: "action", label: SAVE_LABEL }); //NOTHING LEAVES THIS BOX UNTIL THIS IS PRESSED
    rows.push({ row: "action", label: RESTART_LABEL });

    return rows;
}

//MOVE THE SELECTION BY delta ROWS, SKIPPING HEADINGS AND STOPPING AT BOTH ENDS
function stepRow(rows: SettingsRow[], from: number, delta: number): number
{
    let index = from;

    for (;;)
    {
        index += delta;

        //RAN OUT OF ROWS - KEEP WHATEVER WAS SELECTED
        if (index < 0 || index >= rows.length) return from;

        if (rows[index].row !== "header") return index;
    }
}

//LAND ON index, OR ON THE NEAREST ROW THAT IS NOT A HEADING - ONE AT THE VERY END IS WHY THE OTHER
//DIRECTION IS TRIED AS WELL
function landRow(rows: SettingsRow[], index: number, direction: number): number
{
    if (rows.length === 0) return 0;

    const target = Math.min(Math.max(index, 0), rows.length - 1);
    if (rows[target].row !== "header") return target;

    const forward = stepRow(rows, target, direction);

    return forward === target ? stepRow(rows, target, -direction) : forward;
}

//A ROW HAS BEEN EDITED AND NOT SENT BACK YET
function unsavedRows(rows: SettingsRow[]): boolean
{
    return rows.some((row) => row.row === "item" && row.item.changed);
}

//A BORDERED BOX WITH ITS NAME SITTING IN THE TOP BORDER, AND ITS STATUS IN THE BOTTOM ONE.
//THE THREE OF THEM SIT OUTSIDE THE BORDER BOX, SO overflow-hidden HERE ERASES THEM - THE SCROLL CONTAINER
//INSIDE DOES THE CLIPPING INSTEAD. THEY ALSO SIT ABOVE IT: THEY ARE BORDER CELLS, AND A LINE SCROLLING
//PAST HAS TO GO UNDER THEM RATHER THAN THROUGH THEM, WHICH IS WHY THEY ARE OPAQUE AND WHY THEY ARE z-30
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
                <span className={`absolute -top-[0.5em] left-3 z-30 bg-background px-1 font-bold leading-none ${titleColor}`}>
                    {title}
                </span>
            )}
            {children}
            {left && <span className="absolute -bottom-[0.5em] left-3 z-30 bg-background px-1 leading-none text-muted-foreground">{left}</span>}
            {right && <span className="absolute -bottom-[0.5em] right-3 z-30 bg-background px-1 leading-none text-muted-foreground">{right}</span>}
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
    const [dismissed, setDismissed] = useState(false);
    const [settings, setSettings] = useState<SettingsBox | null>(null);
    const [vocabulary, setVocabulary] = useState<{ kind: ArgValues; values: VocabularyValue[] }>({ kind: "free", values: [] });
    const [unread, setUnread] = useState(0);

    const paneRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef<HTMLDivElement>(null);
    const settingsRowRef = useRef<HTMLDivElement>(null);
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
        setSettings(null);
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

                case "open_settings":
                {
                    invoke<ClientSetting[]>("get_client_settings").then((list) =>
                    {
                        const rows = clientRows(list);

                        setSettings({ rows, selected: landRow(rows, 0, 1), server: false, edit: null, saving: false, confirm: false });
                    }).catch((error: unknown) => setPopupMessage(String(error)));

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

                    setSettings({ rows, selected: landRow(rows, 0, 1), server: true, edit: null, saving: false, confirm: false });
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

    useEffect(() => { settingsRowRef.current?.scrollIntoView({ block: "nearest" }); }, [settings?.selected]);

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

    //EVERY EDIT OF THE BOX GOES THROUGH HERE, BECAUSE EVERY ONE OF THEM IS "THE SAME BOX, ONE ROW LATER"
    const editSettings = (change: (box: SettingsBox) => SettingsBox | null) =>
        setSettings((previous) => (previous ? change(previous) : previous));

    const closeSettings = () =>
    {
        setSettings(null);
        chatInputRef.current?.focus();
    };

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

    //LEFT/RIGHT: FLIP A TOGGLE, OR STEP A NUMBER. A FREE-FORM STRING HAS NO NEXT VALUE TO STEP TO
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
    const handleSettingsKey = (event: React.KeyboardEvent<HTMLDivElement>) =>
    {
        const box = settings;
        if (!box || box.edit !== null) return;

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

        if (!active) return;

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

    //THE POPUP NAMES WHAT IT IS OFFERING: THE COMMANDS, THE PARAMETER'S OWN VOCABULARY, OR THE PARAMETERS
    const paletteTitle = palette.mode === "values"
        ? ` ${palette.arg.name.charAt(0).toUpperCase()}${palette.arg.name.slice(1).toLowerCase()} `
        : palette.mode === "menu" ? " Commands " : " Parameters ";

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
                className={`flex items-baseline gap-2 whitespace-pre px-2 leading-6 ${index === null ? "" : "cursor-pointer"} ${chosen ? "bg-selected" : ""}`}
            >
                <span className="text-accent">{chosen ? "▌" : " "}</span>
                <span className="font-bold text-title">/{entry.name}</span>
                {entry.args.map((arg, position) => (
                    <span
                        key={arg.name}
                        className={position === activeArgument ? "text-accent" : arg.required ? "text-arg-required" : "text-arg-optional"}
                    >
                        {formatArg(arg)}
                    </span>
                ))}
                <span className="ml-auto pl-4 text-muted-foreground">{described?.description ?? entry.description}</span>
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
                className={`flex cursor-pointer items-baseline gap-2 whitespace-pre px-2 leading-6 ${chosen ? "bg-selected" : ""}`}
            >
                <span className="text-accent">{chosen ? "▌" : " "}</span>

                {/* THE SWATCH IS PAINTED AS A BACKGROUND, SO EVEN black AND dark_grey ARE SOMETHING TO LOOK AT */}
                {value.color !== null && (
                    <span className="inline-block w-[4ch] self-center" style={{ backgroundColor: ANSI[value.color] }}>&nbsp;</span>
                )}

                <span>{value.value}</span>
            </div>
        );
    };

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

    //THE SETTINGS BOX. IT OWNS THE KEYBOARD WHILE IT IS UP, THE WAY THE TUI'S OVERLAY DOES - THE FOCUS
    //MOVES INTO IT, SO NOTHING TYPED HERE REACHES THE INPUT LINE BEHIND IT
    const settingsBox = settings && (() =>
    {
        const box = settings;
        const editing = box.edit !== null;
        const unsaved = unsavedRows(box.rows);

        //THE VALUE COLUMN STARTS RIGHT BEHIND THE LONGEST LABEL, NOT AT SOME GUESSED OFFSET
        const labelWidth = Math.max(...box.rows.map((row) => (row.row === "item" ? row.item.label.length : 0)), 8);

        const title = box.server
            ? ` Server settings${box.saving ? " · saving…" : unsaved ? " · unsaved" : ""} `
            : " Settings ";

        const legend = editing
            ? " type a value │ ⏎ keep │ esc cancel "
            : box.server
                ? " ↑↓ move │ ←→ change │ ⏎ edit │ ^S save │ esc close "
                : " ↑↓ move │ ←→ change │ ⏎ select │ esc close ";

        //THE SERVER'S COMMENT ON A KEY IS A WHOLE SENTENCE AND HAS NO BUSINESS IN A TITLE BAR. IT SITS
        //UNDER A RULE IN THE FOOT OF THE BOX INSTEAD, WHERE IT READS AS AN EXPLANATION OF THE SELECTED ROW
        const chosen = box.rows[box.selected];
        const hint = chosen?.row === "item" ? chosen.item.hint : "";

        const value = (item: SettingsItem) =>
        {
            if (item.value.kind === "toggle")
            {
                return item.value.value
                    ? <span className="text-ok">● on</span>
                    : <span className="text-muted-foreground">○ off</span>;
            }

            if (item.value.kind === "number") return <span>{item.value.value}</span>;

            return item.value.value ? <span>{item.value.value}</span> : <span className="text-muted-foreground">(empty)</span>;
        };

        return (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 px-4">
                <div
                    ref={settingsRef}
                    tabIndex={-1}
                    onKeyDown={handleSettingsKey}
                    className="w-full max-w-[62ch] outline-none"
                >
                    <Panel active title={title} left={legend} className="flex flex-col bg-background">
                        <div className="custom-scrollbar overflow-auto py-2" style={{ maxHeight: "60vh" }}>
                            {box.rows.map((row, index) =>
                            {
                                //A SECTION HEADING CARRIES A RULE OUT TO THE EDGE, WHICH IS WHAT SEPARATES THE GROUPS
                                if (row.row === "header")
                                {
                                    return (
                                        <div key={`header-${row.label}`} className="flex items-center gap-2 px-3 leading-6">
                                            <span className="font-bold text-title">{row.label}</span>
                                            <span className="h-px flex-1 bg-border" />
                                        </div>
                                    );
                                }

                                const chosenRow = index === box.selected;

                                //A BUTTON IS LIVE WHEN IT HAS SOMETHING TO DO: Save WITH EDITED ROWS IN THE
                                //BOX, Restart WITH NONE
                                if (row.row === "action")
                                {
                                    const restart = row.label === RESTART_LABEL;
                                    const live = restart ? !unsaved && !box.saving : unsaved && !box.saving;
                                    const armed = restart && box.confirm;

                                    return (
                                        <div
                                            key={row.label}
                                            ref={chosenRow ? settingsRowRef : undefined}
                                            onClick={() => activateRow(index)}
                                            className={`flex cursor-pointer items-baseline whitespace-pre px-2 leading-6 ${chosenRow ? "bg-selected" : ""}`}
                                        >
                                            <span className="text-accent">{chosenRow ? "▌" : " "}</span>
                                            <span className={`flex-1 text-center ${armed ? "text-error" : chosenRow ? "text-accent" : live ? "" : "text-muted-foreground"}`}>
                                                {armed ? `[ ${row.label} · press again ]` : `[ ${row.label} ]`}
                                            </span>
                                        </div>
                                    );
                                }

                                const item = row.item;

                                return (
                                    <div
                                        key={item.key}
                                        ref={chosenRow ? settingsRowRef : undefined}
                                        onClick={() => { if (!editing) activateRow(index); }}
                                        className={`flex cursor-pointer items-baseline gap-2 whitespace-pre px-2 leading-6 ${chosenRow ? "bg-selected" : ""}`}
                                    >
                                        <span className="text-accent">{chosenRow ? "▌" : " "}</span>
                                        <span
                                            className={`shrink-0 overflow-hidden text-ellipsis ${chosenRow ? "text-accent" : ""}`}
                                            style={{ width: `${labelWidth}ch` }}
                                        >
                                            {item.label}
                                        </span>

                                        {/* THE ROW BEING TYPED INTO SHOWS THE TEXT AS IT STANDS, CARET AND ALL */}
                                        {chosenRow && editing
                                            ? (
                                                <input
                                                    autoFocus
                                                    value={box.edit ?? ""}
                                                    onChange={(event) =>
                                                    {
                                                        const typed = event.currentTarget.value;

                                                        //A NUMBER ROW ONLY TAKES A NUMBER - THE MINUS SIGN ONLY AS THE FIRST CHARACTER
                                                        if (item.value.kind === "number" && !/^-?\d*$/.test(typed)) return;

                                                        editSettings((current) => ({ ...current, edit: typed }));
                                                    }}
                                                    onKeyDown={(event) =>
                                                    {
                                                        event.stopPropagation();

                                                        //ESC PUTS THE OLD VALUE BACK, ⏎ KEEPS WHAT WAS TYPED - AND EITHER WAY
                                                        //THE KEYBOARD GOES BACK TO THE BOX
                                                        if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
                                                        else if (event.key === "Escape") { event.preventDefault(); editSettings((current) => ({ ...current, edit: null })); }
                                                        else return;

                                                        settingsRef.current?.focus();
                                                    }}
                                                    onBlur={commitEdit}
                                                    className="min-w-0 flex-1 bg-transparent text-accent caret-accent outline-none"
                                                    spellCheck={false}
                                                />
                                            )
                                            : <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">{value(item)}</span>}

                                        {/* AN EDITED ROW IS MARKED UNTIL THE SERVER HAS SAID WHAT IT STORED, AND ONE
                                            IT WILL NOT PICK UP UNTIL IT IS RESTARTED CARRIES THAT SAVED OR NOT */}
                                        {item.changed && <span className="text-notice">●</span>}
                                        {item.restart && <span className="text-muted-foreground">↻</span>}
                                    </div>
                                );
                            })}
                        </div>

                        {hint && (
                            <div className="border-t border-border px-3 pb-2 pt-1 text-muted-foreground">{hint}</div>
                        )}
                    </Panel>
                </div>
            </div>
        );
    })();

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

                    <div ref={paneRef} onScroll={onPaneScroll} className="custom-scrollbar relative z-10 min-h-0 flex-1 overflow-auto px-3 py-2">
                        {pane.map((entry, index) => entry.entry === "message"
                            ? renderMessage(entry.message, index)
                            : renderBlock(entry.title, entry.rows, index))}
                    </div>

                    {/* THE PALETTE SITS ON THE BOTTOM EDGE OF THE MESSAGE PANE, DIRECTLY ABOVE THE INPUT */}
                    {connected && palette.mode !== "hidden" && (
                        <div className="absolute inset-x-0 bottom-0 z-20 px-1 pb-1">
                            <Panel
                                active
                                title={paletteTitle}
                                left={active ? " ↑↓ select │ ⇥ complete " : undefined}
                                className="bg-background"
                            >
                                <div className="custom-scrollbar overflow-auto py-2" style={{ maxHeight: `${PALETTE_ROWS * 1.5}rem` }}>
                                    {palette.mode === "menu" && palette.entries.map((entry, index) => entryRow(entry, index, null))}
                                    {palette.mode === "signature" && entryRow(palette.entry, null, palette.active)}
                                    {palette.mode === "values" && palette.matches.map(valueRow)}
                                </div>
                            </Panel>
                        </div>
                    )}
                </Panel>

                {/* THE SIDEBAR HAS NOBODY TO LIST UNTIL WE ARE AUTHENTICATED - DO NOT SPEND THE WIDTH ON IT */}
                {connected && (
                    <div className="flex w-[26ch] shrink-0 flex-col gap-2">
                        <Panel title={` Online (${users.length}) `} className="flex flex-1 flex-col">
                            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto px-3 py-2">
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
                            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto px-3 py-2">
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
                                <button onClick={() => send("/settings")} className="hover:text-accent">settings</button>
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
                                onChange={(event) => writeInput(event.currentTarget.value)}
                                onKeyDown={handleChatKey}
                                className="w-full bg-transparent text-foreground caret-accent outline-none"
                                autoFocus
                                spellCheck={false}
                            />
                        </form>
                    </Panel>
                </div>
            )}

            {settingsBox}
            {loginBox}
            {tofuBox}
        </main>
    );
}

export default App;
