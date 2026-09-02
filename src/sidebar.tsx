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

import type { ScreenState, VoiceState, OnlineUser, DirectChat } from "./types";
import { LOBBY } from "./types";
import { Icon, IconButton } from "./icons";
import { Avatar, SectionLabel } from "./components";

//THE LEFT COLUMN: THE SERVER AND, WHERE OUR ROLE HAS ONE, THE DOOR TO ITS CONFIG; THE CHANNELS WITH A +
//THAT MAKES ONE; THE CONVERSATIONS WHILE THERE ARE ANY; THEN THE CALL, AND AT THE BOTTOM THE PERSON
//USING THE PROGRAM. THE TWO GEARS ARE TWO DIFFERENT CONFIGS AND SIT WITH WHAT THEY BELONG TO
export function Sidebar(
{
    serverName, address, role, username, users, channels, currentChannel, directs, openDm,
    voice, screen, creating, setCreating, canServerSettings, hasVoice, narrow, drawer, theater,
    setDrawer, send, showDirect, closeDirect, openScreens,
}: {
    serverName: string;
    address: string;
    role: string;
    username: string;
    users: OnlineUser[];
    channels: string[];
    currentChannel: string;
    directs: DirectChat[];
    openDm: number | null;
    voice: VoiceState;
    screen: ScreenState;
    creating: string | null;
    setCreating: (value: string | null) => void;
    canServerSettings: boolean;
    hasVoice: boolean;
    narrow: boolean;
    drawer: "left" | "right" | null;
    theater: boolean;
    setDrawer: (drawer: "left" | "right" | null) => void;
    send: (input: string) => void;
    showDirect: (peer: { id: number; username: string } | null) => void;
    closeDirect: (id: number) => void;
    openScreens: () => void;
})
{
    return (
                    <aside className={`${narrow
                        ? `drawer safe-top safe-bottom fixed inset-y-0 left-0 z-40 w-[86%] max-w-[300px] shadow-2xl ${drawer === "left" ? "translate-x-0" : "drawer-shut -translate-x-full"}`
                        : "w-[240px] shrink-0"} flex-col border-r border-border bg-sidebar ${theater ? "hidden" : "flex"}`}>
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
                                        onClick={() =>
                                        {
                                            //A CHANNEL IS ALREADY UNDER WHATEVER CONVERSATION IS IN FRONT
                                            //OF IT, SO THE ONE WE ARE STANDING IN IS A WAY BACK AND NOT A
                                            //PACKET - THE SERVER HAS NOTHING TO BE TOLD ABOUT EITHER
                                            if (channel !== currentChannel) send(channel === LOBBY ? "/channel" : `/channel ${channel}`);

                                            showDirect(null);
                                            setDrawer(null);
                                        }}
                                        className={`flex w-full items-center gap-1.5 rounded-app px-2 py-1.5 text-left transition-colors ${here ? "bg-active text-text" : "text-muted hover:bg-hover hover:text-text"}`}
                                    >
                                        <Icon name="hash" className="h-4 w-4 shrink-0 text-faint" />
                                        <span className="truncate text-sm">{channel === LOBBY ? "lobby" : channel}</span>
                                    </button>
                                );
                            })}

                            {/* THE CONVERSATIONS. THERE IS NO SUCH THING ON THE SERVER - IT ROUTES A PM AND
                                KEEPS NOTHING - SO A ROW IS HERE BECAUSE SOMEBODY OPENED IT OR BECAUSE
                                SOMETHING ARRIVED IN IT, AND CLOSING ONE IS CLOSING IT FOR GOOD */}
                            {directs.length > 0 && (
                                <>
                                    <SectionLabel>Direct messages</SectionLabel>

                                    {directs.map((chat) =>
                                    {
                                        const here = chat.id === openDm;
                                        const online = users.some((user) => user.id === chat.id);

                                        return (
                                            <div
                                                key={chat.id}
                                                className={`group flex w-full items-center gap-2 rounded-app px-2 py-1 transition-colors ${here ? "bg-active" : "hover:bg-hover"}`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => { showDirect(chat); setDrawer(null); }}
                                                    className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                                                >
                                                    <div className="relative shrink-0">
                                                        <Avatar name={chat.username} size={22} />
                                                        <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-sidebar ${online ? "bg-online" : "bg-border-strong"}`} />
                                                    </div>

                                                    <span className={`min-w-0 flex-1 truncate text-sm ${here ? "text-text" : "text-muted"}`}>
                                                        {chat.username}
                                                    </span>
                                                </button>

                                                {chat.unread > 0 && (
                                                    <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-bold text-black/85">
                                                        {chat.unread}
                                                    </span>
                                                )}

                                                <button
                                                    type="button"
                                                    title="Close the conversation"
                                                    aria-label="Close the conversation"
                                                    onClick={() => closeDirect(chat.id)}
                                                    className={`h-4 w-4 shrink-0 items-center justify-center rounded text-faint transition-colors hover:text-text group-hover:flex ${narrow ? "flex" : "hidden"}`}
                                                >
                                                    <Icon name="close" className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </>
                            )}

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
                            {hasVoice && (
                                <IconButton
                                    icon={voice.mic ? "mic" : "mic_off"}
                                    label={voice.mic ? "Mute microphone" : "Unmute microphone"}
                                    tone={voice.mic ? "default" : "error"}
                                    onClick={() => send("/mute")}
                                />
                            )}
                            <IconButton icon="gear" label="Settings" onClick={() => send("/settings")} />
                            <IconButton icon="logout" label="Disconnect from the server" tone="error" onClick={() => send("/exit")} />
                        </div>
                    </aside>
    );
}
