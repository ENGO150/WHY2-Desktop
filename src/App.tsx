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

//THE LOBBY HAS NO NAME - EVERY CHANNEL-KEYED MAP USES THE EMPTY STRING FOR IT
const LOBBY = "";

//WHAT REPLACING A PINNED KEY HAS TO BE TYPED OUT AS, SO IT CANNOT HAPPEN BY LEANING ON ENTER
const CHALLENGE = "yes";

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
}

//WHAT IS UP FOR DOWNLOAD. THE PROTOCOL CARRIES A NAME AND AN ID AND NOTHING ELSE - NO SIZE, NO TIME - SO
//THE ROW IS THE NAME, WHAT KIND OF FILE THE NAME SAYS IT IS, AND THE TWO IDS /download TAKES
interface FileInfo
{
    id: number;
    name: string;
}

//OUR OWN SHARE. THE MONITOR IS PICKED ON THIS MACHINE AND NEVER LEAVES IT, SO IT IS WORTH SAYING BACK
//TO THE ONE PERSON WHO CAN SEE IT - AND IT ONLY MEANS ANYTHING WHILE THERE IS A SHARE
interface ScreenState
{
    sharing: boolean;
    monitor: string | null;
}

//ONE USER WHOSE SCREEN IS UP FOR WATCHING
interface ScreenUser
{
    id: number;
    username: string;
}

interface FileOwner
{
    id: number;
    username: string;
    files: FileInfo[];
}

//ONE THING IN THE PANE. A LIST (/files, /list, THE BAN LIST) IS AN ENTRY IN THE SCROLLBACK RATHER THAN A
//WINDOW THAT COVERS IT - IT IS AN ANSWER TO SOMETHING THAT WAS ASKED, AND IT BELONGS WHERE IT WAS ASKED
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

//WHAT ONE OF OUR OWN KEYS HOLDS. A VOLUME CARRIES THE RANGE IT LIVES IN ALONG WITH IT, SO THE SLIDER IS
//DRAWN AGAINST THE VOICE CLIENT'S OWN CEILING RATHER THAN A NUMBER COPIED OVER HERE
type ClientValueInfo =
    | { kind: "toggle"; value: boolean }
    | { kind: "volume"; value: { percent: number; max: number; step: number } }
    | { kind: "device"; value: { id: string; input: boolean } }; //EMPTY ID = WHATEVER THE SYSTEM PICKS

//ONE ROW OF client.toml THE SETTINGS DIALOG OFFERS. EVERY ONE OF THEM IS WRITTEN THROUGH THE MOMENT IT IS
//TOUCHED - THIS CONFIG IS OURS, UNLIKE THE SERVER'S
interface ClientSetting
{
    label: string;
    key: string;
    section: string;
    value: ClientValueInfo;
}

//THE THREE DATATYPES server.toml UNDERSTANDS
type SettingValueInfo =
    | { kind: "toggle"; value: boolean }
    | { kind: "number"; value: number }
    | { kind: "text"; value: string };

//AND EVERYTHING A ROW OF THE DIALOG CAN HOLD, WHICHEVER CONFIG IT CAME FROM
type SettingsValue = SettingValueInfo | ClientValueInfo;

//ONE DEVICE AS THE PICKER SHOWS IT. THE id IS WHAT client.toml HOLDS AND WHAT THE VOICE CLIENT OPENS -
//THE label IS DISPLAY ONLY, AND IS NOT UNIQUE (ALSA HANDS OUT THE SAME DESCRIPTION TO SEVERAL PCMs)
interface AudioDevice
{
    id: string;
    label: string;
}

interface AudioDevices
{
    input: AudioDevice[];
    output: AudioDevice[];
}

//THE DEVICE LIST, OPENED ON TOP OF THE SETTINGS ROWS BY THE ROW THAT WANTS IT
interface Picker
{
    title: string;
    entries: AudioDevice[]; //ENTRY 0 IS ALWAYS THE SYSTEM DEFAULT
    selected: number;
    row: number;            //THE SETTINGS ROW THAT OPENED IT
}

//ONE USER OF THE CALL, AS THE VOICE LIST DRAWS THEM
interface VoiceUser
{
    id: number;
    username: string;
    speaking: boolean;
    latency: number;
    local: boolean; //US - THE ONE ROW WITH NO LATENCY TO SHOW
    muted: boolean;
}

//THE WHOLE OF WHAT THE WINDOW KNOWS ABOUT THE CALL. THE THREE MOVE INDEPENDENTLY, AND A PANEL DRAWN
//FROM HALF OF THEM WOULD LIE ABOUT THE REST, SO THEY ARRIVE TOGETHER
interface VoiceState
{
    enabled: boolean;
    mic: boolean;
    users: VoiceUser[];
}

//ONE ROW OF server.toml, BOTH WAYS - WHAT THE SERVER SENT, AND WHAT A SAVE SENDS BACK
interface SettingRow
{
    key: string;
    value: SettingValueInfo;
    section: string;
    description: string;
    restart: boolean;
}

//ONE ROW OF THE SETTINGS DIALOG, WHICHEVER CONFIG IT IS SHOWING
interface SettingsItem
{
    label: string;
    key: string;
    value: SettingsValue;
    hint: string;      //THE COMMENT THE SERVER SENT ALONG (EMPTY ON A CLIENT ROW)
    changed: boolean;  //EDITED AND NOT SAVED YET - ONLY A SERVER ROW IS EVER LEFT UNSAVED
    restart: boolean;  //SAVING IT STORES IT, BUT THE RUNNING SERVER KEEPS USING WHAT IT READ AT STARTUP
}

type SettingsRow =
    | { row: "header"; label: string }
    | { row: "item"; item: SettingsItem }
    | { row: "action"; label: string }; //A BUTTON - THE SERVER ROWS ARE THE ONLY THING THAT NEEDS ONE

//THE DIALOG ITSELF, IN EITHER OF ITS TWO MODES
interface SettingsBox
{
    rows: SettingsRow[];
    selected: number;
    server: boolean;          //THE ROWS BELONG TO server.toml, WHICH IS NOT OURS TO WRITE
    edit: string | null;      //WHAT IS BEING TYPED INTO THE SELECTED ROW
    saving: boolean;          //A SAVE IS ON THE WIRE, WAITING FOR THE SERVER TO ANSWER WITH WHAT IT STORED
    confirm: boolean;         //THE RESTART BUTTON IS ARMED BY ONE PRESS AND FIRED BY THE NEXT

    //WHAT cpal REPORTED, ENUMERATED ONCE WHEN THE DIALOG OPENS - THE SERVER'S ROWS HAVE NO USE FOR EITHER
    devices: AudioDevices;
    picker: Picker | null;
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
    | { event: "files"; data: { owners: FileOwner[] } }
    | { event: "open_settings"; data?: null }
    | { event: "client_settings"; data: { settings: ClientSetting[] } }
    | { event: "voice"; data: { voice: VoiceState } }
    | { event: "screen"; data: { screen: ScreenState } }
    | { event: "screens"; data: { users: ScreenUser[] } }
    | { event: "watching"; data: { username: string | null } }
    | { event: "server_settings"; data: { settings: SettingRow[]; saved: boolean } }
    | { event: "channel_changed"; data: { channel: string | null } }
    | { event: "channel_created"; data: { name: string } }
    | { event: "channel_destroyed"; data: { name: string } }
    | { event: "disconnected"; data: { reason: string | null } };

//THE SIXTEEN COLORS THE PROTOCOL CARRIES. THE DARK HALF IS LIFTED OFF THE FLOOR: THESE ARE PAINTED ON A
//NEAR-BLACK SURFACE RATHER THAN IN A TERMINAL, AND black ON black IS NOT A NAME ANYBODY COULD READ
const ANSI: Record<number, string> =
{
    0: "#6b6b6b", 1: "#e06c75", 2: "#7ec699", 3: "#d7b56b",
    4: "#7aa2f7", 5: "#c792ea", 6: "#56b6c2", 7: "#c0c0c0",
    8: "#909090", 9: "#ff6b7a", 10: "#8bea9b", 11: "#ffe07a",
    12: "#8ab4ff", 13: "#ff8be0", 14: "#7fe6ec", 15: "#ffffff",
};

//THE SWATCH IN THE COLOR PALETTE IS THE ACTUAL ANSI COLOR, NOT THE LIFTED ONE - IT IS THERE TO SAY WHICH
//COLOR IS BEING PICKED, AND A SQUARE OF IT IS BIG ENOUGH TO SEE EVEN AT black
const ANSI_TRUE: Record<number, string> =
{
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
};

//THE COLOR AN AVATAR FALLS BACK TO WHEN THE USER HAS NOT PICKED ONE - THE SAME NAME ALWAYS GETS THE SAME
//ONE, SO A FACE IS RECOGNISABLE DOWN THE PANE EVEN THOUGH NOTHING ABOUT IT IS STORED ANYWHERE
const AVATARS = ["#6f5ba8", "#a85b7a", "#5b86a8", "#a8875b", "#5ba884", "#a85b5b", "#7a5ba8", "#5ba8a0"];

function avatarColor(name: string): string
{
    let hash = 0;

    for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;

    return AVATARS[hash % AVATARS.length];
}

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

//HOW MANY ROWS OF THE PALETTE ARE ON SCREEN AT ONCE, AS IN palette::MAX_ROWS
const PALETTE_ROWS = 8;

//THE LINE ART. ONE COMPONENT AND A TABLE OF PATHS, BECAUSE AN ICON SET IS NOT WORTH A DEPENDENCY AND A
//STROKED 24×24 GRID IS WHAT EVERY ONE OF THESE WOULD HAVE BEEN ANYWAY
const ICONS: Record<string, string[]> =
{
    hash: ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3 14 21"],
    mic: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
    mic_off: ["M3 3l18 18", "M9 9.5V12a3 3 0 0 0 5.1 2.1", "M15 10.5V5a3 3 0 0 0-5.9-.7", "M19 10v2a7 7 0 0 1-10.9 5.8", "M12 19v3"],
    headset: ["M4 14v-2a8 8 0 0 1 16 0v2", "M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14z", "M20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5V14z"],
    hangup: ["M3 3l18 18", "M4 14v-2a8 8 0 0 1 12.5-6.6", "M20 11v3", "M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14z"],
    gear: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.1-2.9H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.3 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.1V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.1 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z"],
    plus: ["M12 5v14", "M5 12h14"],
    folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"],
    users: ["M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
    send: ["M22 2 11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
    logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
    close: ["M18 6 6 18", "M6 6l12 12"],
    download: ["M12 3v12", "M7 11l5 5 5-5", "M4 20h16"],
    chevron: ["M6 9l6 6 6-6"],
    shield: ["M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z"],
    alert: ["M12 3 3 19h18L12 3z", "M12 9v4", "M12 16.5h.01"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    arrow_down: ["M12 5v14", "M6 13l6 6 6-6"],
    speaker: ["M11 5 6 9H3v6h3l5 4V5z", "M15.5 9.5a3.5 3.5 0 0 1 0 5", "M18.5 6.5a7.5 7.5 0 0 1 0 11"],
    speaker_off: ["M11 5 6 9H3v6h3l5 4V5z", "M17 9.5l4 5", "M21 9.5l-4 5"],
    check: ["M20 6 9 17l-5-5"],
    info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 8h.01", "M11.25 12h.75v4.5h.75"],
    file: ["M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z", "M13 3v6h6"],
    image: ["M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M3 16l5-5 4 4 3-3 6 6", "M9 9.5h.01"],
    music: ["M9 18V6l10-2v12", "M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z", "M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"],
    video: ["M3 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z", "M16 10.5 22 7v10l-6-3.5z"],
    archive: ["M4 8h16v12H4z", "M3 4h18v4H3z", "M10 12h4"],
    code: ["M9 18l-6-6 6-6", "M15 6l6 6-6 6"],
    monitor: ["M3 5h18v11H3z", "M9 20h6", "M12 16v4"],
};

//AN ACCESS UNIT IS A KEYFRAME WHEN IT CARRIES AN IDR SLICE, OR THE PARAMETER SETS THAT COME IN FRONT OF
//ONE. A DECODER CANNOT START ANYWHERE ELSE, AND ANNEX-B PUTS THE TYPE IN THE LOW FIVE BITS OF THE FIRST
//BYTE AFTER EVERY START CODE - WHICH IS THE WHOLE OF WHAT HAS TO BE UNDERSTOOD ABOUT H.264 HERE
function isKeyFrame(bytes: Uint8Array): boolean
{
    for (let index = 0; index + 3 < bytes.length; index++)
    {
        if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue;

        const start = bytes[index + 2] === 1
            ? index + 3
            : bytes[index + 2] === 0 && bytes[index + 3] === 1 ? index + 4 : -1;

        if (start < 0 || start >= bytes.length) continue;

        const kind = bytes[start] & 0x1f;

        if (kind === 5 || kind === 7) return true;
    }

    return false;
}

//WHAT A NAME SAYS THE FILE IS. THE PROTOCOL SENDS NO TYPE AND NO SIZE, SO THE EXTENSION IS THE ONLY
//THING THERE IS TO GO ON - AND AN UNKNOWN ONE STILL NAMES ITSELF RATHER THAN SAYING NOTHING
const FILE_KINDS: [string, string, string[]][] =
[
    ["image", "Image", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "tiff"]],
    ["music", "Audio", ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "wma"]],
    ["video", "Video", ["mp4", "mkv", "webm", "mov", "avi", "wmv", "m4v"]],
    ["archive", "Archive", ["zip", "tar", "gz", "xz", "bz2", "7z", "rar", "zst"]],
    ["code", "Code", ["rs", "ts", "tsx", "js", "jsx", "py", "c", "h", "cpp", "hpp", "go", "java", "sh", "toml", "json", "yaml", "yml", "html", "css"]],
    ["file", "Document", ["txt", "md", "pdf", "doc", "docx", "odt", "rtf", "log"]],
];

function fileKind(name: string): { icon: string; label: string }
{
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";

    const found = FILE_KINDS.find(([, , extensions]) => extensions.includes(extension));
    if (found) return { icon: found[0], label: found[1] };

    return { icon: "file", label: extension ? `${extension.toUpperCase()} file` : "File" };
}

function Icon({ name, className }: { name: keyof typeof ICONS | string; className?: string })
{
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className ?? "h-4 w-4"}
            aria-hidden
        >
            {(ICONS[name] ?? []).map((path) => <path key={path} d={path} />)}
        </svg>
    );
}

//AN ICON THAT IS A BUTTON, WHICH IN THIS WINDOW IS MOST OF THEM. THE LABEL IS THE TOOLTIP AND THE
//ACCESSIBLE NAME BOTH - NOTHING HERE IS A GUESSING GAME ABOUT WHAT A GLYPH MEANT
function IconButton(
{
    icon,
    label,
    onClick,
    tone,
    active,
    className,
}: {
    icon: string;
    label: string;
    onClick: () => void;
    tone?: "default" | "error" | "ok";
    active?: boolean;
    className?: string;
})
{
    const color = tone === "error"
        ? "text-error hover:text-error"
        : tone === "ok"
            ? "text-online hover:text-online"
            : active ? "text-text" : "text-muted hover:text-text";

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={`flex h-8 w-8 items-center justify-center rounded-app transition-colors hover:bg-hover ${color} ${className ?? ""}`}
        >
            <Icon name={icon} className="h-[18px] w-[18px]" />
        </button>
    );
}

//A FACE. THERE ARE NO UPLOADED PICTURES IN THIS PROTOCOL, SO IT IS THE FIRST LETTER OVER THE COLOR THE
//USER PICKED - OR, WHERE THEY PICKED NONE, THE ONE THEIR NAME ALWAYS HASHES TO
function Avatar(
{
    name,
    color,
    size,
    ring,
}: {
    name: string;
    color?: string;
    size?: number;
    ring?: boolean;
})
{
    const side = size ?? 36;

    return (
        <div
            className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white/90 ${ring ? "speaking" : ""}`}
            style={{
                width: side,
                height: side,
                fontSize: side * 0.42,
                background: color ?? avatarColor(name),
            }}
        >
            {(name.trim()[0] ?? "?").toUpperCase()}
        </div>
    );
}

//A TOGGLE. THE TUI DREW THIS AS ●/○ BECAUSE A TERMINAL HAD NOTHING ELSE; A WINDOW HAS A SWITCH, AND A
//SWITCH SAYS WHICH WAY IS ON WITHOUT ANYBODY HAVING TO LEARN THE GLYPHS
function Switch({ on, onClick }: { on: boolean; onClick: () => void })
{
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={(event) => { event.stopPropagation(); onClick(); }}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-online" : "bg-border-strong"}`}
        >
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
        </button>
    );
}

//THE LABEL OVER A GROUP OF ROWS IN EITHER SIDEBAR
function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode })
{
    return (
        <div className="flex items-center gap-1 px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {action}
        </div>
    );
}

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

const DEFAULT_DEVICE = "System default"; //SHOWN FOR AN EMPTY input_device/output_device

const NO_DEVICES: AudioDevices = { input: [], output: [] };

//THE SYSTEM DEFAULT PLUS EVERY DEVICE cpal REPORTED, WITH THE CONFIGURED ONE GUARANTEED TO BE IN THE LIST -
//ONE THAT IS CONFIGURED BUT CURRENTLY UNPLUGGED STILL DESERVES A ROW
function deviceEntries(devices: AudioDevices, id: string, input: boolean): AudioDevice[]
{
    const entries: AudioDevice[] = [{ id: "", label: DEFAULT_DEVICE }, ...(input ? devices.input : devices.output)];

    if (id && !entries.some((entry) => entry.id === id)) entries.push({ id, label: id });

    return entries;
}

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
            value: setting.value,
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

//THE LINES ALREADY SENT, AND WHERE IN THEM ↑/↓ CURRENTLY STANDS. THIS IS InputBuffer'S HISTORY OUT OF
//tui/input.rs: pos AT THE END MEANS "NOT SEARCHING", AND A HALF-WRITTEN MESSAGE IS BOTH PARKED WHEN THE
//SEARCH STARTS AND WHAT IT IS LOCKED TO - SO ↑ WALKS WHAT WAS TYPED BEFORE, NOT EVERYTHING EVER SENT
interface History
{
    entries: string[];
    pos: number;
    stash: string | null;  //THE IN-PROGRESS LINE, TO COME BACK TO
    prefix: string | null; //NEVER A COMMAND - A LINE STARTING WITH / IS THE PALETTE'S SEARCH, NOT THIS ONE
}

function historyMatches(history: History, entry: string): boolean
{
    return history.prefix === null || entry.startsWith(history.prefix);
}

//ONE STEP BACK THROUGH IT, OR null WHEN THERE IS NOWHERE LEFT TO GO
function historyUp(history: History, typed: string): string | null
{
    if (history.entries.length === 0 || history.pos === 0) return null;

    if (history.pos === history.entries.length)
    {
        history.prefix = typed && !typed.startsWith("/") ? typed : null;
        history.stash = typed;
    }

    for (let index = history.pos - 1; index >= 0; index--)
    {
        if (!historyMatches(history, history.entries[index])) continue;

        history.pos = index;

        return history.entries[index];
    }

    return null;
}

//AND ONE STEP FORWARD, THE LAST OF WHICH IS BACK TO THE LINE THAT STARTED THE SEARCH
function historyDown(history: History): string | null
{
    if (history.pos >= history.entries.length) return null;

    for (let index = history.pos + 1; index < history.entries.length; index++)
    {
        if (!historyMatches(history, history.entries[index])) continue;

        history.pos = index;

        return history.entries[index];
    }

    history.pos = history.entries.length;
    history.prefix = null;

    const stash = history.stash ?? "";
    history.stash = null;

    return stash;
}

//A SENT LINE JOINS IT, AND ENDS WHATEVER SEARCH WAS RUNNING. THE SAME LINE TWICE IN A ROW IS ONE ENTRY
function pushHistory(history: History, input: string)
{
    if (history.entries[history.entries.length - 1] !== input) history.entries.push(input);

    history.pos = history.entries.length;
    history.stash = null;
    history.prefix = null;
}

//A ROW HAS BEEN EDITED AND NOT SENT BACK YET
function unsavedRows(rows: SettingsRow[]): boolean
{
    return rows.some((row) => row.row === "item" && row.item.changed);
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
    const [config, setConfig] = useState<ClientConfig>({ show_id: false, disable_colors: false });
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

    //THE MEMBER COLUMN IS A VIEW PREFERENCE AND NOT A SESSION FACT, SO IT SURVIVES A RECONNECT
    const [members, setMembers] = useState(true);

    //WHAT IS UP FOR DOWNLOAD, WHILE THE WINDOW SHOWING IT IS OPEN, AND WHAT IS BEING LOOKED FOR IN IT
    const [files, setFiles] = useState<FileOwner[] | null>(null);
    const [filter, setFilter] = useState("");

    //THE NAME OF THE CHANNEL BEING MADE, WHILE ONE IS BEING MADE. THERE IS NO COMMAND FOR CREATING ONE -
    //A CHANNEL IS WHEREVER SOMEBODY IS STANDING, SO THIS IS /channel WITH A NAME NOBODY IS IN YET
    const [creating, setCreating] = useState<string | null>(null);

    //THE LINES ALREADY SENT. IT IS A REF AND NOT STATE BECAUSE NOTHING IS DRAWN FROM IT - IT IS READ AND
    //WRITTEN BY ONE KEYPRESS AT A TIME, AND A RE-RENDER PER ARROW WOULD BE ONE PER RECALLED LINE ANYWAY
    const historyRef = useRef<History>({ entries: [], pos: 0, stash: null, prefix: null });

    const paneRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLDivElement>(null);
    const settingsRef = useRef<HTMLDivElement>(null);
    const filesRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const settingsRowRef = useRef<HTMLDivElement>(null);
    const pickerRowRef = useRef<HTMLDivElement>(null);
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

    const connected = uiState === "connected";

    //THE SERVER'S OWN CONFIG IS BEHIND A ROLE, AND THE COMMAND LIST IS ALREADY FILTERED BY THE ONE THE
    //SERVER GRANTED US - SO THE DOOR IS DRAWN EXACTLY WHERE THERE IS SOMETHING BEHIND IT
    const canServerSettings = commands.some((command) => command.name === "server"
        && command.subcommands.some((sub) => sub.triggers.includes("settings")));

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
        setVoice({ enabled: false, mic: false, users: [] });
        setScreen({ sharing: false, monitor: null });
        setScreensOpen(false);
        setMonitors([]);
        setSharers([]);
        setWatching(null);
        setViewerError("");
        setCreating(null);
        setFiles(null);

        pinnedRef.current = true;
        historyRef.current = { entries: [], pos: 0, stash: null, prefix: null };
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

                //TYPING /screens OPENS THE WINDOW THE ANSWER BELONGS IN, THE WAY /files OPENS ITS OWN
                case "screens":
                {
                    setSharers(payload.data.users);
                    setScreensOpen(true);
                    break;
                }

                case "watching":
                {
                    setWatching(payload.data.username);
                    setViewerError("");
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

    //THE FILE WINDOW TAKES THE KEYBOARD TOO, SO ESC REACHES IT AND NOTHING TYPED AT IT LANDS IN THE LINE
    //BEHIND IT. THE DEPENDENCY IS WHETHER IT IS OPEN AND NOT THE LIST ITSELF, WHICH IS A NEW ARRAY EVERY
    //TIME THE SERVER ANSWERS
    const filesOpen = files !== null;

    useEffect(() => { if (filesOpen) filesRef.current?.focus(); }, [filesOpen]);

    //ONE DOOR FOR BOTH HALVES OF THE SUBJECT: WHICH OF OUR SCREENS TO SHARE, AND WHOSE TO WATCH. THE
    //MONITORS ARE ASKED OF THE SAME VOCABULARY THE PALETTE USES, AND THE SHARERS OF THE SERVER, BECAUSE
    //IT ONLY EVER ANSWERS THAT QUESTION AND NEVER VOLUNTEERS IT
    const openScreens = () =>
    {
        setScreensOpen(true);

        invoke<VocabularyValue[]>("get_vocabulary", { values: "monitors" })
            .then((values) => setMonitors(values.map((value) => value.value)))
            .catch(() => setMonitors([]));

        send("/screens");
    };

    //SOMEBODY ELSE'S SCREEN, DRAWN HERE RATHER THAN IN A WINDOW OF THE CRATE'S OWN. THE FRAMES ARRIVE AS
    //H.264 ACCESS UNITS ON A BINARY CHANNEL AND THE WEBVIEW DECODES THEM - THE PICTURE NEVER TOUCHES THE
    //MAIN THREAD'S EVENT LOOP, WHICH IS TAURI'S AND NOT winit'S
    useEffect(() =>
    {
        if (!watching) return;

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");

        if (!canvas || !context) return;

        if (typeof VideoDecoder === "undefined")
        {
            setViewerError("This webview has no video decoder (WebCodecs is missing).");
            return;
        }

        let live = true;
        let ready = false;    //NOTHING IS DECODED BEFORE THE DECODER HAS BEEN TOLD WHAT IT IS DECODING
        let started = false;  //AND NOTHING BEFORE THE FIRST KEYFRAME, WHICH IS THE ONLY PLACE TO START
        let stamp = 0;

        const decoder = new VideoDecoder(
        {
            output: (frame) =>
            {
                //THE CANVAS IS THE SIZE OF WHAT IS BEING SENT; THE PAGE SCALES IT DOWN TO THE PANE
                if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight)
                {
                    canvas.width = frame.displayWidth;
                    canvas.height = frame.displayHeight;
                }

                context.drawImage(frame, 0, 0);
                frame.close();
            },

            error: (error) => { if (live) setViewerError(String(error)); },
        });

        //THE LEVEL IN THE CODEC STRING ONLY HAS TO BE AT LEAST THE STREAM'S, AND THE STREAM'S DEPENDS ON
        //THE MONITOR SOMEBODY ELSE IS SHARING - SO THE HIGHEST ONE THAT IS SUPPORTED IS THE ONE TO ASK FOR
        void (async () =>
        {
            for (const codec of ["avc1.42E034", "avc1.42E028", "avc1.42E01E"])
            {
                try
                {
                    const { supported } = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true });

                    if (!supported || !live) continue;

                    decoder.configure({ codec, optimizeForLatency: true });
                    ready = true;

                    return;
                }
                catch { /* THE NEXT ONE */ }
            }

            if (live) setViewerError("No H.264 decoder in this webview.");
        })();

        const channel = new Channel<ArrayBuffer>();

        channel.onmessage = (data) =>
        {
            if (!live || !ready || decoder.state !== "configured") return;

            const bytes = new Uint8Array(data);
            const key = isKeyFrame(bytes);

            //A DELTA FRAME BEFORE THE FIRST KEY ONE IS PREDICTED FROM A PICTURE NOBODY HAS
            if (!started && !key) return;

            started = true;

            decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: stamp, data: bytes }));

            stamp += 33333;
        };

        invoke("watch_frames", { channel }).catch((error: unknown) => setViewerError(String(error)));

        return () =>
        {
            live = false;

            invoke("drop_frames").catch(() => {});

            if (decoder.state !== "closed") decoder.close();
        };
    }, [watching]);

    const closeFiles = () =>
    {
        setFiles(null);
        setFilter("");
        chatInputRef.current?.focus();
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

        send(chatInput);
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

    const color = (code: number | null): string | undefined =>
        (code === null || config.disable_colors ? undefined : ANSI[code]);


    const channelLabel = currentChannel || "lobby";

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

    //A LINE NOBODY SAID: A JOIN, AN UPLOAD, A SERVER NOTICE, THE ANSWER TO A COMMAND. IT GETS THE COLUMN
    //THE AVATARS SIT IN, SO THE TEXT OF THE WHOLE PANE STAYS UNDER ONE EDGE
    const renderNotice = (message: ChatMessage, key: number) =>
    {
        const { tone, icon } =
        {
            system: { tone: "text-muted", icon: "info" },
            notice: { tone: "text-notice", icon: "info" },
            ok: { tone: "text-ok", icon: "check" },
            error: { tone: "text-error", icon: "alert" },
            user: { tone: "", icon: "info" },
            private: { tone: "", icon: "info" },
        }[message.kind];

        return (
            <div key={key} className="flex gap-4 border-l-2 border-transparent px-4 py-[3px] hover:bg-hover">
                <div className="flex w-9 shrink-0 justify-end pt-[3px]">
                    <Icon name={icon} className={`h-4 w-4 ${tone}`} />
                </div>
                <div className={`min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed ${tone}`}>
                    {message.prefix && <span className="text-faint">{message.prefix} </span>}
                    {message.text}
                </div>
            </div>
        );
    };

    //SOMETHING SOMEBODY SAID. THE RUN OF LINES BY ONE PERSON IS ONE BLOCK WITH ONE FACE ON IT - grouped
    //IS EVERY LINE PAST THE FIRST, AND CARRIES NEITHER THE AVATAR NOR THE NAME AGAIN
    const renderChat = (message: ChatMessage, key: number, grouped: boolean) =>
    {
        const own = message.username === username;
        const whisper = message.kind === "private";

        return (
            <div
                key={key}
                className={`flex gap-4 px-4 hover:bg-hover ${grouped ? "py-[1px]" : "mt-4 pb-[1px] pt-1"} ${whisper ? "border-l-2 border-accent bg-accent/[0.06]" : "border-l-2 border-transparent"}`}
            >
                <div className="w-9 shrink-0">
                    {!grouped && <Avatar name={message.username} color={color(message.username_color)} />}
                </div>

                <div className="min-w-0 flex-1">
                    {!grouped && (
                        <div className="flex items-baseline gap-2">
                            <span
                                className={`text-[15px] font-semibold ${own ? "text-accent" : ""}`}
                                style={{ color: own ? undefined : color(message.username_color) }}
                            >
                                {message.username}
                            </span>
                            {config.show_id && message.id !== null && <span className="text-[11px] text-faint">#{message.id}</span>}
                            {whisper && (
                                <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent">
                                    private
                                </span>
                            )}
                        </div>
                    )}

                    <div
                        className="select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed"
                        style={{ color: color(message.message_color) }}
                    >
                        {message.prefix && <span className="text-faint">{message.prefix} </span>}
                        {message.text}
                    </div>
                </div>
            </div>
        );
    };

    //A LIST THE SERVER ANSWERED WITH. IT IS A CARD IN THE STREAM RATHER THAN A WINDOW OVER IT, AND THE
    //ROWS KEEP THE TERMINAL'S BRANCH GLYPHS - THEY ARE A TREE, AND A TREE IS WHAT THEY SHOULD LOOK LIKE
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
            <div key={key} className="mx-4 mt-4 overflow-hidden rounded-app border border-border bg-raised">
                <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {title}
                </div>

                <div className="py-1">
                    {rows.map((row, index) => (
                        <div key={index} className="flex items-center whitespace-pre px-3 py-[3px] font-mono text-[13px]">
                            <span className="text-border-strong">{glyphs[index]}</span>
                            {row.id !== null && <span className="text-faint">{String(row.id).padStart(widths[row.depth])}{"  "}</span>}
                            <span className={row.accent ? "text-accent" : ""}>{row.text}</span>
                            {row.note && <span className="text-faint">{"  "}{row.note}</span>}
                        </div>
                    ))}
                </div>
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

            return renderChat(message, index, grouped);
        });
    })();

    //THE SETTINGS DIALOG. IT OWNS THE KEYBOARD WHILE IT IS UP, THE WAY THE TUI'S OVERLAY DOES - THE FOCUS
    //MOVES INTO IT, SO NOTHING TYPED HERE REACHES THE COMPOSER BEHIND IT
    const settingsBox = settings && (() =>
    {
        const box = settings;
        const editing = box.edit !== null;
        const unsaved = unsavedRows(box.rows);

        //THE ACTIONS ARE ROWS LIKE ANY OTHER AS FAR AS THE KEYBOARD IS CONCERNED, BUT THEY BELONG IN THE
        //FOOT OF THE DIALOG AND NOT IN THE MIDDLE OF THE LIST - SO THEY ARE DRAWN THERE, INDEX AND ALL
        const listed = box.rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.row !== "action");
        const actions = box.rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.row === "action");

        const control = (item: SettingsItem, index: number) =>
        {
            if (item.value.kind === "toggle")
            {
                const on = item.value.value;

                return <Switch on={on} onClick={() => setToggle(index, !on)} />;
            }

            if (item.value.kind === "volume")
            {
                const { percent, max, step } = item.value.value;

                return (
                    <div className="flex items-center gap-3">
                        <Icon name={percent === 0 ? "speaker_off" : "speaker"} className={`h-4 w-4 ${percent === 0 ? "text-faint" : "text-muted"}`} />
                        <input
                            type="range"
                            min={0}
                            max={max}
                            step={step}
                            value={percent}
                            onChange={(event) => setVolume(index, Number(event.currentTarget.value), max)}
                            onKeyDown={(event) => event.stopPropagation()}
                            className="slider w-[150px]"
                            style={{ accentColor: "var(--accent)" }}
                        />
                        <span className="w-[4ch] text-right font-mono text-xs text-muted">{percent}%</span>
                    </div>
                );
            }

            //client.toml HOLDS THE cpal ID, WHICH IS NOT SOMETHING TO READ - THE LABEL IS LOOKED UP FOR IT
            if (item.value.kind === "device")
            {
                const { id, input } = item.value.value;
                const found = (input ? box.devices.input : box.devices.output).find((device) => device.id === id);

                return (
                    <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); activateRow(index); }}
                        className="flex w-[220px] items-center gap-2 rounded-app border border-border bg-deep px-3 py-1.5 text-left text-sm hover:border-border-strong"
                    >
                        <span className={`min-w-0 flex-1 truncate ${id ? "" : "text-muted"}`}>{id ? found?.label ?? id : DEFAULT_DEVICE}</span>
                        <Icon name="chevron" className="h-4 w-4 shrink-0 text-faint" />
                    </button>
                );
            }

            //A NUMBER OR A STRING IS TYPED INTO THE ROW ITSELF
            if (editing && index === box.selected)
            {
                return (
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

                            //ESC PUTS THE OLD VALUE BACK, ENTER KEEPS WHAT WAS TYPED - AND EITHER WAY THE
                            //KEYBOARD GOES BACK TO THE DIALOG
                            if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
                            else if (event.key === "Escape") { event.preventDefault(); editSettings((current) => ({ ...current, edit: null })); }
                            else return;

                            settingsRef.current?.focus();
                        }}
                        onBlur={commitEdit}
                        className="w-[220px] rounded-app border border-accent bg-deep px-3 py-1.5 text-sm text-accent caret-accent outline-none"
                        spellCheck={false}
                    />
                );
            }

            const text = String(item.value.value);

            return (
                <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); activateRow(index); }}
                    className="w-[220px] truncate rounded-app border border-border bg-deep px-3 py-1.5 text-left text-sm hover:border-border-strong"
                >
                    {text || <span className="text-faint">empty</span>}
                </button>
            );
        };

        return (
            <div
                //ANYWHERE OUTSIDE THE BOX IS "I AM DONE HERE" - ON THE PRESS AND NOT THE RELEASE, SO A
                //SELECTION DRAGGED OUT OF THE DIALOG DOES NOT CLOSE IT ON LETTING GO
                onMouseDown={(event) => { if (event.target === event.currentTarget) closeSettings(); }}
                className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
            >
                <div
                    ref={settingsRef}
                    tabIndex={-1}
                    onKeyDown={handleSettingsKey}
                    className="rise relative flex max-h-[84vh] w-full max-w-[660px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none"
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                        <Icon name="gear" className="h-4 w-4 text-muted" />
                        <h2 className="flex-1 text-[15px] font-semibold">{box.server ? "Server settings" : "Settings"}</h2>

                        {box.saving && <span className="text-xs text-muted">saving</span>}
                        {!box.saving && unsaved && <span className="text-xs text-notice">unsaved changes</span>}

                        <IconButton icon="close" label="Close" onClick={closeSettings} />
                    </header>

                    <div className="scroller flex-1 px-3 py-2">
                        {listed.map(({ row, index }) =>
                        {
                            //A SECTION HEADING CARRIES A RULE OUT TO THE EDGE, WHICH IS WHAT SEPARATES THE GROUPS
                            if (row.row === "header")
                            {
                                return (
                                    <div key={`header-${row.label}`} className="flex items-center gap-3 px-2 pb-1 pt-5 first:pt-2">
                                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{row.label}</span>
                                        <span className="h-px flex-1 bg-border" />
                                    </div>
                                );
                            }

                            if (row.row !== "item") return null;

                            const item = row.item;
                            const chosen = index === box.selected;

                            return (
                                <div
                                    key={item.key}
                                    ref={chosen ? settingsRowRef : undefined}
                                    onMouseDown={() => editSettings((current) => ({ ...current, selected: index }))}
                                    onClick={() => { if (item.value.kind === "toggle") activateRow(index); }}
                                    className={`flex items-center gap-6 rounded-app border-l-2 px-3 py-2.5 ${chosen ? "border-accent bg-selected" : "border-transparent hover:bg-hover"}`}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm">{item.label}</span>

                                            {/* AN EDITED ROW IS MARKED UNTIL THE SERVER HAS SAID WHAT IT STORED, AND ONE IT
                                                WILL NOT PICK UP UNTIL IT IS RESTARTED CARRIES THAT SAVED OR NOT */}
                                            {item.changed && <span className="rounded bg-notice/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-notice">edited</span>}
                                            {item.restart && <span className="rounded bg-warning/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">restart</span>}
                                        </div>

                                        {item.hint && <div className="mt-0.5 pr-2 text-xs leading-snug text-faint">{item.hint}</div>}
                                    </div>

                                    <div className="shrink-0">{control(item, index)}</div>
                                </div>
                            );
                        })}
                    </div>

                    {/* THE SERVER'S ROWS ARE THE ONLY ONES THAT ARE NOT WRITTEN THROUGH ON THE SPOT, SO THEY
                        ARE THE ONLY ONES WITH ANYTHING TO PRESS */}
                    {actions.length > 0 && (
                        <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/40 px-5 py-3">
                            <span className="flex-1 text-xs text-faint">
                                {box.confirm
                                    ? "Restarting drops every client on the server."
                                    : unsaved ? "Nothing leaves this window until you save." : "Arrows move and change, esc closes."}
                            </span>

                            {actions.map(({ row, index }) =>
                            {
                                if (row.row !== "action") return null;

                                const restart = row.label === RESTART_LABEL;
                                const live = restart ? !unsaved && !box.saving : unsaved && !box.saving;
                                const armed = restart && box.confirm;
                                const chosen = index === box.selected;

                                const skin = restart
                                    ? `border ${armed ? "border-error bg-error/15 text-error" : "border-border text-muted hover:border-error hover:text-error"}`
                                    : "bg-accent text-black/85 hover:brightness-110";

                                return (
                                    <button
                                        key={row.label}
                                        type="button"
                                        disabled={!live}
                                        onClick={() => activateRow(index)}
                                        className={`rounded-app px-4 py-1.5 text-sm font-semibold transition ${skin} ${chosen ? "ring-2 ring-accent/60" : ""} disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        {armed ? "Press again" : row.label}
                                    </button>
                                );
                            })}
                        </footer>
                    )}

                    {/* THE DEVICE LIST, ON TOP OF THE ROWS AND NOT BESIDE THEM - IT IS ANSWERING THE ROW
                        UNDERNEATH IT, AND THERE IS NOTHING ELSE TO DO IN THE DIALOG UNTIL IT IS ANSWERED */}
                    {box.picker && (
                        <div
                            onMouseDown={(event) =>
                            {
                                if (event.target !== event.currentTarget) return;

                                editSettings((current) => ({ ...current, picker: null }));
                                settingsRef.current?.focus();
                            }}
                            className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 px-6"
                        >
                            <div className="rise w-full max-w-[440px] overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl">
                                <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                                    {box.picker.title}
                                </div>

                                <div className="scroller p-1" style={{ maxHeight: "48vh" }}>
                                    {box.picker.entries.map((entry, index) =>
                                    {
                                        const chosen = index === box.picker!.selected;
                                        const owner = box.rows[box.picker!.row];
                                        const using = owner?.row === "item" && owner.item.value.kind === "device" && owner.item.value.value.id === entry.id;

                                        return (
                                            <div
                                                key={entry.id || "default"}
                                                ref={chosen ? pickerRowRef : undefined}
                                                onMouseEnter={() => editSettings((current) => (current.picker ? { ...current, picker: { ...current.picker, selected: index } } : current))}
                                                onClick={() =>
                                                {
                                                    setDevice(box.picker!.row, entry.id);
                                                    editSettings((current) => ({ ...current, picker: null }));
                                                    settingsRef.current?.focus();
                                                }}
                                                className={`flex cursor-pointer items-center gap-2 rounded-app px-3 py-2 text-sm ${chosen ? "bg-selected" : ""}`}
                                            >
                                                <span className={`min-w-0 flex-1 truncate ${entry.id ? "" : "text-muted"}`}>{entry.label}</span>
                                                {using && <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    })();

    //WHAT IS ON THE SERVER, IN A WINDOW OF ITS OWN. NOBODY SAID IT, SO IT DOES NOT BELONG IN THE
    //SCROLLBACK - IT IS A DRAWER THAT IS OPENED, LOOKED THROUGH AND CLOSED, AND IT CLOSES THE WAY EVERY
    //OTHER MENU HERE DOES: ESC, THE X, OR A PRESS THAT LANDED OUTSIDE IT
    const filesBox = files && (() =>
    {
        const needle = filter.trim().toLowerCase();

        //THE SEARCH LOOKS AT BOTH HALVES OF WHAT A ROW SAYS - THE FILE'S NAME AND WHOSE IT IS - AND AN
        //OWNER WITH NOTHING LEFT TO SHOW DROPS OUT ALONG WITH THEIR HEADING
        const shown = files
            .map((owner) =>
            ({
                ...owner,
                files: owner.files.filter((file) => !needle
                    || file.name.toLowerCase().includes(needle)
                    || owner.username.toLowerCase().includes(needle)),
            }))
            .filter((owner) => owner.files.length > 0);

        const total = files.reduce((count, owner) => count + owner.files.length, 0);
        const matching = shown.reduce((count, owner) => count + owner.files.length, 0);

        return (
            <div
                onMouseDown={(event) => { if (event.target === event.currentTarget) closeFiles(); }}
                className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
            >
                <div
                    ref={filesRef}
                    tabIndex={-1}
                    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeFiles(); } }}
                    className="rise flex max-h-[84vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none"
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                        <Icon name="folder" className="h-4 w-4 shrink-0 text-muted" />
                        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Files on the server</h2>

                        <span className="shrink-0 text-xs text-faint">
                            {needle ? `${matching} of ${total}` : `${total} ${total === 1 ? "file" : "files"}`}
                        </span>

                        <IconButton icon="close" label="Close" onClick={closeFiles} />
                    </header>

                    <div className="shrink-0 px-4 pt-3">
                        <input
                            autoFocus
                            value={filter}
                            onChange={(event) => setFilter(event.currentTarget.value)}
                            placeholder="Search files"
                            className="w-full rounded-app border border-border bg-deep px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-border-strong"
                            spellCheck={false}
                        />
                    </div>

                    <div className="scroller flex-1 px-2.5 py-2">
                        {shown.length === 0 && (
                            <div className="px-2 py-8 text-center text-sm text-faint">
                                {needle ? "Nothing here by that name." : "Nobody has a file up right now."}
                            </div>
                        )}

                        {shown.map((owner) => (
                            <div key={owner.id} className="mb-1 last:mb-0">
                                <div className="flex items-center gap-2 px-1.5 pb-1 pt-2">
                                    <Avatar name={owner.username} size={20} />
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted">{owner.username}</span>
                                    {config.show_id && <span className="shrink-0 font-mono text-[10px] text-faint">{owner.id}</span>}
                                </div>

                                {owner.files.map((file) =>
                                {
                                    const kind = fileKind(file.name);

                                    return (
                                        <button
                                            key={file.id}
                                            type="button"
                                            title={`Download ${file.name}`}
                                            onClick={() => send(`/download ${owner.id} ${file.id}`)}
                                            className="group flex w-full items-center gap-2.5 rounded-app px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
                                        >
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-app bg-deep text-muted">
                                                <Icon name={kind.icon} className="h-4 w-4" />
                                            </span>

                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm">{file.name}</span>
                                                <span className="block text-[11px] text-faint">{kind.label}</span>
                                            </span>

                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-app text-faint transition-colors group-hover:bg-active group-hover:text-text">
                                                <Icon name="download" className="h-4 w-4" />
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    {/* THE LIST IS A PHOTOGRAPH OF THE SERVER AT THE MOMENT IT WAS ASKED, SO THE WAY TO A
                        NEWER ONE IS TO ASK AGAIN - WHICH IS THE SAME /files THE HEADER'S FOLDER SENDS */}
                    <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/40 px-5 py-3">
                        <span className="flex-1 text-xs text-faint">A download starts where you keep them.</span>

                        <button
                            type="button"
                            onClick={() => send("/files")}
                            className="rounded-app border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-text"
                        >
                            Refresh
                        </button>
                    </footer>
                </div>
            </div>
        );
    })();

    //SCREENS, BOTH WAYS ROUND: WHICH OF OURS TO SHARE AND WHOSE TO WATCH. THE PICK NEVER LEAVES THIS
    //MACHINE - THE SERVER ONLY EVER KNOWS *THAT* WE ARE SHARING - AND NAMING ANOTHER MONITOR WHILE THE
    //SHARE IS UP SWAPS THE CAPTURE OVER WITHOUT STOPPING IT
    const screensBox = screensOpen && (
        <div
            onMouseDown={(event) => { if (event.target === event.currentTarget) setScreensOpen(false); }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4"
        >
            <div
                ref={(node) => { node?.focus(); }}
                tabIndex={-1}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setScreensOpen(false); } }}
                className="rise flex max-h-[84vh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none"
            >
                <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                    <Icon name="monitor" className="h-4 w-4 shrink-0 text-muted" />
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Screens</h2>

                    <IconButton icon="close" label="Close" onClick={() => setScreensOpen(false)} />
                </header>

                <div className="scroller flex-1 px-2.5 pb-3">
                    <SectionLabel>Yours</SectionLabel>

                    {monitors.length === 0 && (
                        <div className="px-2 py-2 text-sm text-faint">No monitor to share.</div>
                    )}

                    {monitors.map((name) =>
                    {
                        const live = screen.sharing && screen.monitor === name;

                        return (
                            <button
                                key={name}
                                type="button"
                                title={live ? "Stop sharing this screen" : screen.sharing ? "Share this one instead" : "Share this screen"}
                                onClick={() => { send(live ? "/screen" : `/screen ${name}`); if (!live) setScreensOpen(false); }}
                                className="flex w-full items-center gap-2.5 rounded-app px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
                            >
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-app bg-deep ${live ? "text-online" : "text-muted"}`}>
                                    <Icon name="monitor" className="h-4 w-4" />
                                </span>

                                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>

                                {live && <span className="shrink-0 rounded bg-online/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-online">sharing</span>}
                            </button>
                        );
                    })}

                    <SectionLabel>Everybody else</SectionLabel>

                    {sharers.filter((user) => user.username !== username).length === 0 && (
                        <div className="px-2 py-2 text-sm text-faint">Nobody else is sharing right now.</div>
                    )}

                    {sharers.filter((user) => user.username !== username).map((user) =>
                    {
                        const here = watching === user.username;

                        return (
                            <div key={user.id} className="flex items-center gap-2.5 rounded-app px-1.5 py-1.5">
                                <Avatar name={user.username} size={28} />

                                <span className="min-w-0 flex-1 truncate text-sm">{user.username}</span>

                                <button
                                    type="button"
                                    onClick={() => { send(here ? "/deattach" : `/attach ${user.id}`); if (!here) setScreensOpen(false); }}
                                    className={`shrink-0 rounded-app px-3 py-1.5 text-xs font-semibold transition ${here
                                        ? "border border-border text-muted hover:border-error hover:text-error"
                                        : "bg-accent text-black/85 hover:brightness-110"}`}
                                >
                                    {here ? "Stop watching" : "Watch"}
                                </button>
                            </div>
                        );
                    })}
                </div>

                <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/40 px-5 py-3">
                    <span className="flex-1 text-xs text-faint">Everybody on the server can watch what you share.</span>

                    <button
                        type="button"
                        onClick={() => send("/screens")}
                        className="rounded-app border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-text"
                    >
                        Refresh
                    </button>
                </footer>
            </div>
        </div>
    );

    //THE CONNECT SCREEN ASKS FOR EVERYTHING UNTIL WE ARE IN: THE ADDRESS, THEN WHOEVER THE SERVER WANTS US
    //TO BE. IT IS THE WHOLE WINDOW RATHER THAN A BOX OVER THE CHAT, BECAUSE THERE IS NO CHAT BEHIND IT YET
    const loginScreen = !connected && !tofu && (() =>
    {
        const title = { server_select: "Connect to a server", username_prompt: "Who are you?", password_prompt: registering ? "Create your account" : "Welcome back", connected: "" }[uiState];
        const label = { server_select: "Server address", username_prompt: "Username", password_prompt: "Password", connected: "" }[uiState];
        const button = { server_select: "Connect", username_prompt: "Continue", password_prompt: registering ? "Register" : "Log in", connected: "" }[uiState];

        return (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-deep px-4">
                <div className="rise relative w-full max-w-[420px]">
                    <div className="mb-6 text-center">
                        <div className="text-2xl font-bold tracking-tight">WHY2</div>
                        <div className="mt-1 text-sm text-muted">{title}</div>
                    </div>

                    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-overlay p-5 shadow-2xl">
                        <label htmlFor="login-input" className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</label>

                        <input
                            id="login-input"
                            ref={loginInputRef}
                            type={uiState === "password_prompt" ? "password" : "text"}
                            value={inputValue}
                            onChange={(event) => setInputValue(event.currentTarget.value)}
                            placeholder={uiState === "server_select" ? "127.0.0.1:8080" : undefined}
                            className="mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-accent"
                            disabled={connecting}
                            autoFocus
                            spellCheck={false}
                        />

                        {/* THE STATUS LINE, ALWAYS IN THE SAME PLACE: WHAT IS HAPPENING, WHAT WENT WRONG,
                            OR THE SERVER'S OWN RULES FOR WHAT IS BEING ASKED */}
                        <div className="mt-2 min-h-[1.25rem] text-xs">
                            {connecting
                                ? <span className="text-accent">{uiState === "server_select" ? "Connecting…" : "Waiting for the server…"}</span>
                                : errorMsg
                                    ? <span className="text-error">{errorMsg}</span>
                                    : <span className="text-faint">{hint}</span>}
                        </div>

                        <button
                            type="submit"
                            disabled={connecting || !inputValue}
                            className="mt-3 w-full rounded-app bg-accent py-2.5 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {button}
                        </button>
                    </form>
                </div>
            </div>
        );
    })();

    //THE IDENTITY CHECK. IT COVERS EVEN THE CONNECT SCREEN, BECAUSE IT IS THE ONLY THING THE USER MAY
    //ANSWER WHILE IT IS UP - AND IT CAN APPEAR MID-SESSION TOO, SINCE THE PERIODIC REKEY RUNS THE SAME CHECK
    const tofuBox = tofu && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="rise w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl">
                <header className={`flex items-center gap-3 border-b border-border px-5 py-4 ${tofu.mismatch ? "text-error" : "text-accent"}`}>
                    <Icon name={tofu.mismatch ? "alert" : "lock"} className="h-5 w-5" />
                    <h2 className="text-[15px] font-semibold">{tofu.mismatch ? "Server identity changed" : "Unknown server identity"}</h2>
                </header>

                <div className="px-5 py-4">
                    <p className="text-sm leading-relaxed text-muted">
                        {tofu.mismatch
                            ? "The server is presenting a different identity key than the one pinned for this address. Either the operator replaced the server's keys, or somebody is sitting between you and it."
                            : "This address has no pinned identity key yet. Accept it only if the fingerprint below matches the one the server's operator published."}
                    </p>

                    <div className="mt-4 rounded-app border border-border bg-deep p-3 font-mono text-[13px]">
                        <div className="flex gap-3">
                            <span className="w-[9ch] shrink-0 text-faint">Server</span>
                            <span className="min-w-0 break-all">{tofu.host}</span>
                        </div>

                        {fingerprint(tofu.pinned ?? "").map((row, index) => (
                            <div key={row} className="mt-1 flex gap-3 text-faint">
                                <span className="w-[9ch] shrink-0">{index === 0 ? "Pinned" : ""}</span>
                                <span>{row}</span>
                            </div>
                        ))}

                        {fingerprint(tofu.hash).map((row, index) => (
                            <div key={row} className="mt-1 flex gap-3">
                                <span className="w-[9ch] shrink-0 text-faint">{index === 0 ? (tofu.mismatch ? "New key" : "Key") : ""}</span>
                                <span className={tofu.mismatch ? "text-error" : "text-accent"}>{row}</span>
                            </div>
                        ))}
                    </div>

                    {/* REPLACING A PINNED KEY HAS TO BE TYPED OUT - A FIRST CONTACT IS THE ONLY ONE A BUTTON ANSWERS */}
                    {tofu.mismatch && (
                        <div className="mt-4">
                            <label htmlFor="tofu-input" className="text-xs text-muted">
                                Type <span className="font-mono text-text">{CHALLENGE}</span> to replace the pinned key with this one:
                            </label>
                            <input
                                id="tofu-input"
                                type="text"
                                value={tofuTyped}
                                onChange={(event) => setTofuTyped(event.currentTarget.value.toLowerCase())}
                                onKeyDown={(event) => { if (event.key === "Enter") answerTofu(true); }}
                                className="mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2 font-mono text-sm outline-none focus:border-error"
                                autoFocus
                                spellCheck={false}
                            />
                        </div>
                    )}
                </div>

                <footer className="flex justify-end gap-2 border-t border-border bg-deep/40 px-5 py-3">
                    <button
                        type="button"
                        onClick={() => answerTofu(false)}
                        className="rounded-app border border-border px-4 py-1.5 text-sm font-semibold text-muted transition hover:border-error hover:text-error"
                    >
                        Reject
                    </button>
                    <button
                        type="button"
                        onClick={() => answerTofu(true)}
                        disabled={tofu.mismatch && tofuTyped !== CHALLENGE}
                        className={`rounded-app px-4 py-1.5 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${tofu.mismatch ? "bg-error" : "bg-accent"}`}
                    >
                        {tofu.mismatch ? "Replace pinned key" : "Trust and save"}
                    </button>
                </footer>
            </div>
        </div>
    );

    return (
        <main
            //A CLICK ANYWHERE THAT IS NOT THE COMPOSER PUTS THE PALETTE AWAY - IT IS A MENU LIKE ANY OTHER,
            //AND THE NEXT KEYSTROKE IN THE LINE BRINGS IT STRAIGHT BACK
            onMouseDown={() => setDismissed(true)}
            className="noise-overlay relative flex h-screen w-screen overflow-hidden bg-chat text-[15px] text-text"
        >
            {connected && (
                <>
                    {/* THE LEFT COLUMN: WHERE WE ARE, WHERE WE COULD BE, AND WHO WE ARE WHILE WE ARE THERE */}
                    <aside className="flex w-[240px] shrink-0 flex-col border-r border-border bg-sidebar">
                        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{serverName || "WHY2"}</div>
                                <div className="truncate text-[11px] text-faint">{address}</div>
                            </div>
                            {canServerSettings && (
                                <IconButton icon="gear" label="Server settings" onClick={() => send("/server settings")} />
                            )}
                        </header>

                        <div className="scroller scroller-quiet flex-1 px-2 pb-3">
                            <SectionLabel
                                action={(
                                    <button
                                        type="button"
                                        title="Create a channel"
                                        aria-label="Create a channel"
                                        onClick={() => setCreating("")}
                                        className="flex h-4 w-4 items-center justify-center rounded text-faint transition-colors hover:text-text"
                                    >
                                        <Icon name="plus" className="h-4 w-4" />
                                    </button>
                                )}
                            >
                                Channels
                            </SectionLabel>

                            {/* A NAME NOBODY IS IN YET IS A CHANNEL THE MOMENT WE WALK INTO IT, SO THE ROW IS
                                THE SAME /channel THE LIST ITSELF SENDS - AND IT IS GONE THE MOMENT IT IS LEFT ALONE */}
                            {creating !== null && (
                                <div className="flex items-center gap-1.5 rounded-app bg-deep px-2 py-1.5">
                                    <Icon name="hash" className="h-4 w-4 shrink-0 text-faint" />

                                    <input
                                        autoFocus
                                        value={creating}
                                        placeholder="new-channel"
                                        onChange={(event) => setCreating(event.currentTarget.value)}
                                        onBlur={() => setCreating(null)}
                                        onKeyDown={(event) =>
                                        {
                                            if (event.key === "Escape") { event.preventDefault(); setCreating(null); }
                                            else if (event.key === "Enter")
                                            {
                                                event.preventDefault();

                                                const name = creating.trim();
                                                if (name) send(`/channel ${name}`);

                                                setCreating(null);
                                            }
                                        }}
                                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                                        spellCheck={false}
                                    />
                                </div>
                            )}

                            {channels.map((channel) =>
                            {
                                const here = channel === currentChannel;

                                return (
                                    <button
                                        key={channel || "lobby"}
                                        type="button"
                                        onClick={() => send(channel === LOBBY ? "/channel" : `/channel ${channel}`)}
                                        className={`flex w-full items-center gap-1.5 rounded-app px-2 py-1.5 text-left transition-colors ${here ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"}`}
                                    >
                                        <Icon name="hash" className="h-4 w-4 shrink-0 text-faint" />
                                        <span className="truncate text-sm">{channel === LOBBY ? "lobby" : channel}</span>
                                    </button>
                                );
                            })}

                            {/* THE CALL, WHILE THERE IS ONE AND SOMEBODY IS IN IT. CLICKING A ROW MUTES WHOEVER
                                IS ON IT - OUR OWN ROW IS THE MICROPHONE, AND IS THE ONE /mute TAKES NO ID FOR */}
                            {voice.enabled && voice.users.length > 0 && (
                                <>
                                    <SectionLabel>Voice — {voice.users.length}</SectionLabel>

                                    {voice.users.map((user) => (
                                        <button
                                            key={user.id}
                                            type="button"
                                            onClick={() => send(user.local ? "/mute" : `/mute ${user.id}`)}
                                            title={user.muted ? "Unmute" : "Mute"}
                                            className="flex w-full items-center gap-2 rounded-app px-2 py-1 text-left hover:bg-hover"
                                        >
                                            <Avatar name={user.username} size={22} ring={user.speaking && !user.muted} />
                                            <span className={`min-w-0 flex-1 truncate text-sm ${user.muted ? "text-faint line-through" : user.speaking ? "text-text" : "text-muted"}`}>
                                                {user.username}
                                            </span>
                                            {!user.local && <span className="shrink-0 font-mono text-[10px] text-faint">{user.latency}ms</span>}
                                            {user.muted && <Icon name="mic_off" className="h-3.5 w-3.5 shrink-0 text-error" />}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>

                        {/* THE SHARE SAYS SO IN THE SAME PLACE THE CALL DOES, AND CARRIES THE TWO THINGS
                            THERE ARE TO DO WITH IT: POINT IT AT ANOTHER SCREEN, OR STOP IT */}
                        {screen.sharing && (
                            <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-app bg-deep/70 px-2 py-2">
                                <Icon name="monitor" className="h-4 w-4 shrink-0 text-online" />

                                <button
                                    type="button"
                                    title="Share a different screen"
                                    onClick={openScreens}
                                    className="min-w-0 flex-1 text-left"
                                >
                                    <div className="text-xs font-semibold text-online">Sharing your screen</div>
                                    <div className="truncate text-[11px] text-faint">{screen.monitor ?? "this screen"}</div>
                                </button>

                                <IconButton icon="close" label="Stop sharing" tone="error" onClick={() => send("/screen")} />
                            </div>
                        )}

                        {/* THE CALL'S OWN STRIP, WHERE IT IS IN EVERY OTHER CHAT CLIENT: ABOVE THE PERSON
                            USING THE PROGRAM, AND HOLDING THE ONE BUTTON THAT ENDS IT */}
                        {voice.enabled && (
                            <div className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-app bg-deep/70 px-2 py-2">
                                <Icon name="headset" className="h-4 w-4 shrink-0 text-online" />
                                <div className="min-w-0 flex-1">
                                    <div className="text-xs font-semibold text-online">Voice connected</div>
                                    <div className="truncate text-[11px] text-faint">{serverName || address}</div>
                                </div>
                                <IconButton icon="hangup" label="Disconnect" tone="error" onClick={() => send("/voice")} />
                            </div>
                        )}

                        <div className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/60 px-2 py-2">
                            <Avatar name={username} size={32} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{username}</div>
                                <div className="flex items-center gap-1 text-[11px] text-muted">
                                    <Icon name="shield" className="h-3 w-3" />
                                    <span className="truncate">{role}</span>
                                </div>
                            </div>

                            {/* THE MICROPHONE READS WHAT IS ACTUALLY BEING SENT: THE CAPTURE CALLBACK COUNTS
                                0% AS OFF, SO A SLIDER AT THE BOTTOM SHOWS UP HERE AS MUTED */}
                            <IconButton
                                icon={voice.mic ? "mic" : "mic_off"}
                                label={voice.mic ? "Mute microphone" : "Unmute microphone"}
                                tone={voice.mic ? "default" : "error"}
                                onClick={() => send("/mute")}
                            />
                            <IconButton icon="gear" label="Settings" onClick={() => send("/settings")} />
                            <IconButton icon="logout" label="Disconnect from the server" tone="error" onClick={() => send("/exit")} />
                        </div>
                    </aside>

                    {/* THE MIDDLE: THE CHANNEL, WHAT WAS SAID IN IT, AND THE LINE THAT SAYS THE NEXT THING */}
                    <section className="flex min-w-0 flex-1 flex-col bg-chat">
                        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
                            <Icon name="hash" className="h-5 w-5 shrink-0 text-faint" />
                            <span className="truncate font-semibold">{channelLabel}</span>

                            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
                            <span className="hidden min-w-0 truncate text-xs text-faint sm:block">{users.length} online</span>

                            <div className="ml-auto flex items-center gap-1">
                                <IconButton
                                    icon="folder"
                                    label="Files on the server"
                                    active={filesOpen}
                                    onClick={() => (filesOpen ? closeFiles() : send("/files"))}
                                />
                                <IconButton
                                    icon="monitor"
                                    label="Screens"
                                    tone={screen.sharing ? "ok" : "default"}
                                    active={screen.sharing || screensOpen}
                                    onClick={openScreens}
                                />
                                <IconButton
                                    icon="headset"
                                    label={voice.enabled ? "Leave the call" : "Join the call"}
                                    tone={voice.enabled ? "ok" : "default"}
                                    onClick={() => send("/voice")}
                                />
                                <IconButton icon="users" label="Members" active={members} onClick={() => setMembers((previous) => !previous)} />
                            </div>
                        </header>

                        {/* SOMEBODY ELSE'S SCREEN, IN THE WINDOW AND NOT BESIDE IT - THE CHAT KEEPS RUNNING
                            UNDERNEATH IT, WHICH IS THE WHOLE POINT OF WATCHING ONE IN A CHAT PROGRAM */}
                        {watching && (
                            <div className="flex min-h-0 shrink-0 basis-[52%] flex-col border-b border-border bg-deep">
                                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                                    <Icon name="monitor" className="h-4 w-4 shrink-0 text-online" />

                                    <span className="min-w-0 flex-1 truncate text-sm">
                                        <span className="font-semibold">{watching}</span>
                                        <span className="text-muted">&apos;s screen</span>
                                    </span>

                                    <IconButton icon="close" label="Stop watching" tone="error" onClick={() => send("/deattach")} />
                                </div>

                                <div className="relative min-h-0 flex-1">
                                    <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-contain" />

                                    {viewerError && (
                                        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-error">
                                            {viewerError}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="relative flex min-h-0 flex-1 flex-col">
                            <div ref={paneRef} onScroll={onPaneScroll} className="scroller relative min-h-0 flex-1 pb-4">
                                {/* THE HEAD OF EVERY CHANNEL SAYS WHAT IT IS - AND WITH NOTHING SAID IN IT YET,
                                    IT IS THE WHOLE OF WHAT THERE IS TO LOOK AT */}
                                <div className="px-4 pb-2 pt-8">
                                    <h1 className="text-2xl font-bold">Welcome to #{channelLabel}</h1>
                                    <p className="mt-1 text-sm text-muted">
                                        {currentChannel
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

                        <div className="relative shrink-0 px-4 pb-5 pt-1" onMouseDown={(event) => event.stopPropagation()}>
                            {/* THE PALETTE SITS ON THE COMPOSER, WHICH IS WHERE THE LINE IT IS TALKING ABOUT IS */}
                            {palette.mode !== "hidden" && (
                                <div className="rise absolute inset-x-4 bottom-full z-20 mb-2 overflow-hidden rounded-app border border-border bg-overlay shadow-2xl">
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

                            <form onSubmit={handleChatSubmit} className="flex items-center gap-1 rounded-app bg-raised px-2 py-1.5">
                                <IconButton icon="plus" label="Upload a file" onClick={uploadFile} />

                                <input
                                    ref={chatInputRef}
                                    id="chat-input"
                                    type="text"
                                    value={chatInput}
                                    onChange={(event) => writeInput(event.currentTarget.value)}
                                    onKeyDown={handleChatKey}
                                    placeholder={`Message #${channelLabel}`}
                                    className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[15px] outline-none placeholder:text-faint"
                                    autoFocus
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
                    {members && (
                        <aside className="flex w-[220px] shrink-0 flex-col border-l border-border bg-sidebar">
                            <div className="scroller scroller-quiet flex-1 px-2 pb-3">
                                <SectionLabel>Online — {users.length}</SectionLabel>

                                {users.map((user) =>
                                {
                                    const own = user.username === username;

                                    return (
                                        <div
                                            key={user.id}
                                            className="flex items-center gap-2 rounded-app px-2 py-1 hover:bg-hover"
                                            title={user.channel ? `#${user.channel}` : "lobby"}
                                        >
                                            <div className="relative shrink-0">
                                                <Avatar name={user.username} size={28} />
                                                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-online" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className={`truncate text-sm ${own ? "text-accent" : "text-muted"}`}>{user.username}</div>
                                                {user.channel && <div className="truncate text-[11px] text-faint">#{user.channel}</div>}
                                            </div>

                                            {config.show_id && <span className="shrink-0 font-mono text-[10px] text-faint">{user.id}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </aside>
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
            {loginScreen}
            {tofuBox}
        </main>
    );
}

export default App;
