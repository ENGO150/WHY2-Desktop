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
import { Avatar } from "./components";
import type { People } from "./profile";
import { t } from "./i18n";

//ONE WIDGET'S HEAD
function WidgetHead({ title, action }: { title: React.ReactNode; action?: React.ReactNode })
{
    return (
        <div className="flex h-8 items-center gap-2 pl-2 pr-1">
            <span className="label min-w-0 flex-1 truncate">{title}</span>
            {action}
        </div>
    );
}

//THE SIDEBAR: CHANNELS, CONVERSATIONS, THE CALL, AND US
export function Sidebar(
{
    role, username, users, channels, currentChannel, directs, openDm,
    voice, screen, creating, setCreating, canServerSettings, hasVoice, narrow, drawer, theater,
    setDrawer, send, setSpeaker, showDirect, closeDirect, openScreens, switcher, people, panelRef,
}: {
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
    setSpeaker: (on: boolean) => void;
    showDirect: (peer: { id: number; username: string } | null) => void;
    closeDirect: (id: number) => void;
    openScreens: () => void;
    switcher: React.ReactNode;
    people: People;

    //MOVED BY HAND WHILE A DRAWER IS DRAGGED
    panelRef: React.Ref<HTMLElement>;
})
{
    const row = `group relative flex w-full items-center gap-2.5 rounded-md px-2 text-left text-[14px] transition-colors ${narrow ? "h-10" : "h-8"}`;

    return (
        <aside ref={panelRef} className={`${narrow
            ? `drawer safe-top safe-bottom fixed bottom-0 left-0 top-[var(--chrome-top)] z-40 w-[86%] max-w-[320px] shadow-2xl ${drawer === "left" ? "translate-x-0" : "drawer-shut -translate-x-full"}`
            : "w-[264px] shrink-0"} flex-col border-r border-border bg-sidebar ${theater ? "hidden" : "flex"}`}>
            <header className="relative flex h-14 shrink-0 items-center gap-1 px-2">
                {switcher}

                {canServerSettings && (
                    <IconButton icon="gear" label={t("settings.title.server")} onClick={() => send("/server settings")} />
                )}
            </header>

            <div className="scroller scroller-quiet flex flex-1 flex-col gap-2 px-2 pb-2">
                <div className="widget">
                    <WidgetHead
                        title={t("sidebar.channels")}
                        action={(
                            <button
                                type="button"
                                title={t("side.new_channel")}
                                aria-label={t("side.new_channel")}
                                onClick={() => setCreating("")}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-text"
                            >
                                <Icon name="plus" className="h-4 w-4" />
                            </button>
                        )}
                    />

                    {/* A CHANNEL EXISTS THE MOMENT WE WALK INTO IT */}
                    {creating !== null && (
                        <div className="px-1 pb-1">
                            <input
                                autoFocus
                                value={creating}
                                placeholder={t("side.channel_name")}
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
                                className="field py-1.5"
                                spellCheck={false}
                            />
                        </div>
                    )}

                    {channels.map((channel) =>
                    {
                        const here = channel === currentChannel && openDm === null;

                        return (
                            <button
                                key={channel || "lobby"}
                                type="button"
                                onClick={() =>
                                {
                                    //THE ONE WE STAND IN IS A WAY BACK, NOT A PACKET
                                    if (channel !== currentChannel) send(channel === LOBBY ? "/channel" : `/channel ${channel}`);

                                    showDirect(null);
                                    setDrawer(null);
                                }}
                                className={`${row} ${here ? "bg-selected font-medium text-text" : "text-muted hover:bg-hover hover:text-text"}`}
                            >
                                <span className="w-4 shrink-0 text-center text-[15px] text-faint">#</span>
                                <span className="min-w-0 flex-1 truncate">{channel === LOBBY ? "lobby" : channel}</span>
                            </button>
                        );
                    })}
                </div>

                {/* CONVERSATIONS LIVE AS LONG AS THE SESSION */}
                {directs.length > 0 && (
                    <div className="widget">
                        <WidgetHead title={t("side.direct")} />

                        {directs.map((chat) =>
                        {
                            const here = chat.id === openDm;
                            const online = users.some((user) => user.id === chat.id);

                            return (
                                <div key={chat.id} className={`${row} ${here ? "bg-selected" : "hover:bg-hover"}`}>
                                    <button
                                        type="button"
                                        onClick={() => { showDirect(chat); setDrawer(null); }}
                                        className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
                                    >
                                        <span className="relative shrink-0">
                                            <Avatar name={chat.username} size={20} src={people.avatar(chat.username)} />
                                            {online && <span className="absolute -bottom-px -right-px h-2 w-2 rounded-full border-[1.5px] border-raised bg-online" />}
                                        </span>

                                        <span className={`min-w-0 flex-1 truncate ${here || chat.unread ? "font-medium text-text" : "text-muted"}`}>{chat.username}</span>
                                    </button>

                                    {chat.unread > 0 && (
                                        <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                                            {chat.unread}
                                        </span>
                                    )}

                                    <button
                                        type="button"
                                        title={t("window.close")}
                                        aria-label={t("side.close_direct")}
                                        onClick={() => closeDirect(chat.id)}
                                        className={`h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:text-text group-hover:flex ${narrow ? "flex" : "hidden"}`}
                                    >
                                        <Icon name="close" className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* THE CALL IN THIS CHANNEL */}
                {(voice.enabled || voice.users.length > 0) && (
                    <div className="widget">
                        <WidgetHead
                            title={(
                                <span className="flex items-center gap-1.5">
                                    {voice.enabled && <span className="h-1.5 w-1.5 rounded-full bg-online" />}
                                    {t("sidebar.voice")} · #{currentChannel || "lobby"}
                                </span>
                            )}
                            action={voice.speaker !== null && voice.enabled && (
                                <button
                                    type="button"
                                    title={voice.speaker ? t("side.earpiece") : t("side.speaker")}
                                    aria-label={voice.speaker ? t("side.earpiece") : t("side.speaker")}
                                    onClick={() => setSpeaker(!voice.speaker)}
                                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-text"
                                >
                                    <Icon name={voice.speaker ? "speaker" : "earpiece"} className="h-4 w-4" />
                                </button>
                            )}
                        />

                        {/* A ROW MUTES THEM WHILE WE ARE IN IT TOO */}
                        {voice.users.map((user) => (
                            <button
                                key={user.id}
                                type="button"
                                disabled={!voice.enabled}
                                onClick={() => send(user.local ? "/mute" : `/mute ${user.id}`)}
                                title={voice.enabled ? (user.muted ? t("side.unmute") : t("side.mute")) : undefined}
                                className={`${row} hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent`}
                            >
                                <Avatar name={user.username} size={20} ring={user.speaking && !user.muted} src={people.avatar(user.username)} />

                                <span className={`min-w-0 flex-1 truncate ${user.muted ? "text-faint line-through" : "text-text"}`}>{user.username}</span>

                                {user.latency !== null && <span className="shrink-0 text-[11px] text-faint">{user.latency} ms</span>}
                                {user.muted && <Icon name="mic_off" className="h-3.5 w-3.5 shrink-0 text-error" />}
                            </button>
                        ))}

                        {(voice.enabled || hasVoice) && (
                            <div className="p-1 pt-1.5">
                                <button
                                    type="button"
                                    onClick={() => send("/voice")}
                                    className={`btn w-full py-1 ${voice.enabled ? "btn-danger" : ""}`}
                                >
                                    {voice.enabled ? t("side.leave") : t("side.join")}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* OUR SHARE */}
                {screen.sharing && (
                    <div className="widget flex items-center gap-2.5 py-1.5 pl-2.5 pr-1.5">
                        <Icon name="monitor" className="h-4 w-4 shrink-0 text-online" />

                        <button type="button" title={t("side.share_other")} onClick={openScreens} className="min-w-0 flex-1 truncate text-left text-[13.5px]">
                            {screen.monitor ? t("side.sharing_monitor", { monitor: screen.monitor }) : t("side.sharing")}
                        </button>

                        <button type="button" onClick={() => send("/screen")} className="btn btn-danger py-1">{t("screens.stop")}</button>
                    </div>
                )}
            </div>

            {/* US */}
            <div className="flex shrink-0 items-center gap-0.5 px-2 pb-2 pt-1">
                <button
                    type="button"
                    title={t("settings.title.own_profile")}
                    onClick={(event) => people.open(username, event.currentTarget)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-hover"
                >
                    <Avatar name={username} size={28} src={people.avatar(username)} />

                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium leading-tight">{username}</span>
                        <span className="block truncate text-[12px] capitalize leading-tight text-faint">{role}</span>
                    </span>
                </button>

                {/* WHAT IS ACTUALLY SENT; 0% IS MUTED */}
                {hasVoice && (
                    <IconButton
                        icon={voice.mic ? "mic" : "mic_off"}
                        label={voice.mic ? t("side.mic_mute") : t("side.mic_unmute")}
                        tone={voice.mic ? "default" : "error"}
                        onClick={() => send("/mute")}
                    />
                )}
                <IconButton icon="gear" label={t("settings.title.client")} onClick={() => send("/settings")} />
                <IconButton icon="logout" label={t("side.disconnect")} onClick={() => send("/exit")} />
            </div>
        </aside>
    );
}
