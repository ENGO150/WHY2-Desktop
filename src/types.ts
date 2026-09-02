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


//THE LOBBY HAS NO NAME - EVERY CHANNEL-KEYED MAP USES THE EMPTY STRING FOR IT
export const LOBBY = "";
export type UIState = "server_select" | "username_prompt" | "password_prompt" | "connected";

export type MessageKind = "user" | "private" | "system" | "notice" | "ok" | "error";

export interface ChatMessage
{
    kind: MessageKind;
    prefix: string | null;
    username: string;
    text: string;
    id: number | null;
    username_color: number | null;
    message_color: number | null;
    direct: DirectPeer | null; //SET ON A PRIVATE MESSAGE, AND ON NOTHING ELSE
}

//WHO A PRIVATE MESSAGE IS WITH - THE OTHER PERSON WHICHEVER WAY IT WENT. THE ECHO OF ONE WE SENT NAMES
//THE RECIPIENT AND CARRIES NO AUTHOR, SO outgoing IS WHICH SIDE OF THE CONVERSATION THE LINE IS ON
export interface DirectPeer
{
    id: number;
    username: string;
    outgoing: boolean;
}

//ONE CONVERSATION. A PM IS NOT A LINE OF WHATEVER CHANNEL WAS OPEN WHEN IT LANDED, SO IT KEEPS ITS OWN
//SCROLLBACK THE WAY A CHANNEL DOES - AND ITS OWN COUNT OF WHAT ARRIVED WHILE IT WAS NOT BEING LOOKED AT
export interface DirectChat
{
    id: number;
    username: string;
    pane: PaneEntry[];
    unread: number;
}

export interface BlockRow
{
    depth: number;
    id: number | null;
    text: string;
    note: string | null;
    accent: boolean;
}

//WHAT IS UP FOR DOWNLOAD. THE PROTOCOL CARRIES A NAME AND AN ID AND NOTHING ELSE - NO SIZE, NO TIME - SO
//THE ROW IS THE NAME, WHAT KIND OF FILE THE NAME SAYS IT IS, AND THE TWO IDS /download TAKES
export interface FileInfo
{
    id: number;
    name: string;
}

//OUR OWN SHARE. THE MONITOR IS PICKED ON THIS MACHINE AND NEVER LEAVES IT, SO IT IS WORTH SAYING BACK
//TO THE ONE PERSON WHO CAN SEE IT - AND IT ONLY MEANS ANYTHING WHILE THERE IS A SHARE
export interface ScreenState
{
    sharing: boolean;
    monitor: string | null;
}

//ONE USER WHOSE SCREEN IS UP FOR WATCHING
export interface ScreenUser
{
    id: number;
    username: string;
}

export interface FileOwner
{
    id: number;
    username: string;
    files: FileInfo[];
}

//ONE THING IN THE PANE. A LIST (/files, /list, THE BAN LIST) IS AN ENTRY IN THE SCROLLBACK RATHER THAN A
//WINDOW THAT COVERS IT - IT IS AN ANSWER TO SOMETHING THAT WAS ASKED, AND IT BELONGS WHERE IT WAS ASKED
export type PaneEntry =
    | { entry: "message"; message: ChatMessage }
    | { entry: "block"; title: string; rows: BlockRow[] };

export interface OnlineUser
{
    username: string;
    id: number;
    channel: string | null;
}

//THE NAME OF THE SET A PARAMETER ACCEPTS - "free" IS EVERYTHING ELSE, AND HAS NOTHING TO OFFER
export type ArgValues = "free" | "colors" | "monitors" | "roles";

export interface CommandArgInfo
{
    name: string;
    description: string;
    required: boolean;
    values: ArgValues;
}

export interface SubcommandInfo
{
    name: string;
    triggers: string[];
    description: string;
    args: CommandArgInfo[];
}

export interface CommandInfo
{
    name: string;
    triggers: string[];
    description: string;
    args: CommandArgInfo[];
    subcommands: SubcommandInfo[];
}

//WHAT ONE OF OUR OWN KEYS HOLDS. A VOLUME CARRIES THE RANGE IT LIVES IN ALONG WITH IT, SO THE SLIDER IS
//DRAWN AGAINST THE VOICE CLIENT'S OWN CEILING RATHER THAN A NUMBER COPIED OVER HERE
export type ClientValueInfo =
    | { kind: "toggle"; value: boolean }
    | { kind: "volume"; value: { percent: number; max: number; step: number } }
    | { kind: "device"; value: { id: string; input: boolean } }; //EMPTY ID = WHATEVER THE SYSTEM PICKS

//ONE ROW OF client.toml THE SETTINGS DIALOG OFFERS. EVERY ONE OF THEM IS WRITTEN THROUGH THE MOMENT IT IS
//TOUCHED - THIS CONFIG IS OURS, UNLIKE THE SERVER'S
export interface ClientSetting
{
    label: string;
    key: string;
    section: string;
    value: ClientValueInfo;
}

//THE THREE DATATYPES server.toml UNDERSTANDS
export type SettingValueInfo =
    | { kind: "toggle"; value: boolean }
    | { kind: "number"; value: number }
    | { kind: "text"; value: string };

//AND EVERYTHING A ROW OF THE DIALOG CAN HOLD, WHICHEVER CONFIG IT CAME FROM
export type SettingsValue = SettingValueInfo | ClientValueInfo;

//ONE DEVICE AS THE PICKER SHOWS IT. THE id IS WHAT client.toml HOLDS AND WHAT THE VOICE CLIENT OPENS -
//THE label IS DISPLAY ONLY, AND IS NOT UNIQUE (ALSA HANDS OUT THE SAME DESCRIPTION TO SEVERAL PCMs)
export interface AudioDevice
{
    id: string;
    label: string;
}

export interface AudioDevices
{
    input: AudioDevice[];
    output: AudioDevice[];
}

//THE DEVICE LIST, OPENED ON TOP OF THE SETTINGS ROWS BY THE ROW THAT WANTS IT
export interface Picker
{
    title: string;
    entries: AudioDevice[]; //ENTRY 0 IS ALWAYS THE SYSTEM DEFAULT
    selected: number;
    row: number;            //THE SETTINGS ROW THAT OPENED IT
}

//ONE USER OF THE CALL, AS THE VOICE LIST DRAWS THEM
export interface VoiceUser
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
export interface VoiceState
{
    enabled: boolean;
    mic: boolean;
    users: VoiceUser[];
}

//ONE ROW OF server.toml, BOTH WAYS - WHAT THE SERVER SENT, AND WHAT A SAVE SENDS BACK
export interface SettingRow
{
    key: string;
    value: SettingValueInfo;
    section: string;
    description: string;
    restart: boolean;
}

//ONE ROW OF THE SETTINGS DIALOG, WHICHEVER CONFIG IT IS SHOWING
export interface SettingsItem
{
    label: string;
    key: string;
    value: SettingsValue;
    hint: string;      //THE COMMENT THE SERVER SENT ALONG (EMPTY ON A CLIENT ROW)
    changed: boolean;  //EDITED AND NOT SAVED YET - ONLY A SERVER ROW IS EVER LEFT UNSAVED
    restart: boolean;  //SAVING IT STORES IT, BUT THE RUNNING SERVER KEEPS USING WHAT IT READ AT STARTUP
}

export type SettingsRow =
    | { row: "header"; label: string }
    | { row: "item"; item: SettingsItem }
    | { row: "action"; label: string }; //A BUTTON - THE SERVER ROWS ARE THE ONLY THING THAT NEEDS ONE

//THE DIALOG ITSELF, IN EITHER OF ITS TWO MODES
export interface SettingsBox
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
export interface VocabularyValue
{
    value: string;
    color: number | null;
}

export interface ClientConfig
{
    show_id: boolean;
    disable_colors: boolean;
}

export interface TofuPrompt
{
    host: string;
    hash: string;
    pinned: string | null;
    mismatch: boolean;
}

//ONE ROW OF THE COMMAND PALETTE: A COMMAND, OR ONE ACTION OF A COMMAND THAT TAKES ONE (/server mute).
//AN ACTION SPEAKS FOR ITSELF FROM HERE ON - ITS OWN PARAMETERS, ITS OWN DESCRIPTION
export interface PaletteEntry
{
    name: string;              //WHAT THE USER TYPES TO GET HERE, WITHOUT THE PARAMETERS (server mute)
    word: string[];            //EVERY SPELLING OF THE LAST WORD OF IT - THE ONE BEING TYPED
    parent: string[] | null;   //EVERY SPELLING OF THE COMMAND WORD IN FRONT OF IT, WHERE THERE IS ONE
    description: string;
    args: CommandArgInfo[];
}

//WHAT THE PALETTE IS SHOWING. THE TUI'S PaletteMode, MINUS NOTHING: A MENU OF COMMANDS OR ACTIONS, THE
//ANSWERS ONE PARAMETER ACCEPTS WHERE THERE IS A KNOWN LIST OF THEM, OR THE PLAIN SIGNATURE HINT
export type PaletteState =
    | { mode: "hidden" }
    | { mode: "menu"; entries: PaletteEntry[] }
    | { mode: "values"; arg: CommandArgInfo; matches: VocabularyValue[]; start: number }
    | { mode: "signature"; entry: PaletteEntry; active: number | null };

//THE SHAPE OF THE PALETTE BEFORE ITS VOCABULARY IS IN HAND - EVERYTHING BUT THE VALUES MODE IS ALREADY
//FINAL, AND THAT ONE STILL HAS TO BE ASKED FOR
export type PaletteShape =
    | PaletteState
    | { mode: "pending"; entry: PaletteEntry; active: number; arg: CommandArgInfo; typed: string; start: number };

export type BridgeEvent =
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
