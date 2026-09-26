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

import { useState } from "react";
import { createPortal } from "react-dom";

import type { OnlineUser, OfflineUser, ClientConfig } from "./types";
import { Avatar, SectionLabel } from "./components";
import { Icon } from "./icons";
import { messageColor } from "./messages";
import { deviceIcon } from "./roster";
import { useHoldMenu, MENU_WIDTH, type HeldMenu } from "./servers";
import type { People } from "./profile";

//HEADER AND FIVE ITEMS
const MENU_HEIGHT = 240;

//WHO A ROW'S MENU IS ABOUT
interface HeldMember
{
    username: string;
    user: OnlineUser | null;
}

//WHAT OUR ROLE LETS US DO TO SOMEBODY
export interface Moderation
{
    kick: boolean;
    ban: boolean;
    banip: boolean;
}

//THE RIGHT COLUMN: EVERYBODY ON THE SERVER, AND WHICH CHANNEL THEY ARE SITTING IN. A ROW IS A BUTTON AND
//IT OPENS THAT PERSON'S PROFILE CARD, WHICH IS WHERE THE CONVERSATION WITH THEM STARTS
export function MemberColumn(
{
    users, offline, username, config, narrow, drawer, people, panelRef, moderation, message, send,
}: {
    users: OnlineUser[];

    //THE REGISTERED USERS NOBODY IS CONNECTED AS, WHERE THE SERVER SENDS THEM - null IS NO SUCH SECTION
    offline: OfflineUser[] | null;

    username: string;
    config: ClientConfig;
    narrow: boolean;
    drawer: "left" | "right" | null;
    people: People;

    //THE COLUMN ITSELF, WHICH App.tsx MOVES BY HAND WHILE A FINGER IS DRAGGING THE DRAWER
    panelRef: React.Ref<HTMLElement>;

    moderation: Moderation;
    message: (user: OnlineUser) => void;
    send: (input: string) => void;
})
{
    const { menu, close, bind, held } = useHoldMenu<HeldMember>("pointer", MENU_HEIGHT);

    //A ROW'S PRESS, UNLESS IT WAS THE END OF A HOLD
    const press = (name: string) => (event: React.MouseEvent<HTMLElement>) =>
    {
        if (held()) return;

        close();
        people.open(name, event.currentTarget);
    };

    return (
                        <aside ref={panelRef} className={narrow
                            ? `drawer safe-top safe-bottom fixed bottom-0 right-0 top-[var(--chrome-top)] z-40 flex w-[86%] max-w-[300px] flex-col border-l border-border bg-sidebar shadow-2xl ${drawer === "right" ? "translate-x-0" : "drawer-shut translate-x-full"}`
                            : "flex w-[220px] shrink-0 flex-col border-l border-border bg-sidebar"}>
                            <div className="scroller scroller-quiet flex-1 px-2 pb-3">
                                <SectionLabel>Online — {users.length}</SectionLabel>

                                {users.map((user) =>
                                {
                                    const own = user.username === username;

                                    //EVERYBODY IS NAMED IN THEIR OWN COLOR HERE TOO - THE ACCENT IS ONLY
                                    //WHAT IS LEFT ON OUR OWN ROW WHERE THERE IS NO COLOR TO USE
                                    const color = messageColor(config, user.username_color);

                                    //WHAT THEY ARE ON, WHERE THEY SHARE IT. THE TUI PRINTS THE WORD; A
                                    //WINDOW HAS THE LINE ART, AND IT SITS ON THE RIGHT EDGE EITHER WAY
                                    const device = user.device ? deviceIcon(user.device) : null;

                                    const status = people.status(user.username);

                                    return (
                                        <button
                                            key={user.id}
                                            type="button"
                                            title={user.channel ? `${user.username} in #${user.channel}` : undefined}
                                            onClick={press(user.username)}
                                            {...bind({ username: user.username, user })}
                                            data-member={user.username}
                                            className={`flex w-full cursor-pointer select-none items-center gap-2 rounded-app px-2 text-left hover:bg-hover ${narrow ? "py-2" : "py-1"}`}
                                        >
                                            <div className="relative shrink-0">
                                                <Avatar name={user.username} color={color} size={28} src={people.avatar(user.username)} />
                                                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-online" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div
                                                    className={`truncate text-sm ${color ? "" : own ? "text-accent" : "text-muted"}`}
                                                    style={color ? { color } : undefined}
                                                >
                                                    {user.username}
                                                </div>
                                                {status
                                                    ? <div className="truncate text-[11px] text-muted">{status}</div>
                                                    : user.channel && <div className="truncate text-[11px] text-faint">#{user.channel}</div>}
                                            </div>

                                            {device && <Icon name={device} className="h-3.5 w-3.5 shrink-0 text-faint" />}

                                            {config.show_id && <span className="shrink-0 font-mono text-[10px] text-faint">{user.id}</span>}
                                        </button>
                                    );
                                })}

                                {/* THE SERVER'S OWN USERS WHO ARE NOT HERE. THEIR CARD HAS NO MESSAGE
                                    BUTTON - A PM NEEDS AN ID, AND SOMEBODY OFFLINE HAS NONE */}
                                {offline && offline.length > 0 && (
                                    <>
                                        <SectionLabel>Offline — {offline.length}</SectionLabel>

                                        {offline.map((user) =>
                                        {
                                            const color = messageColor(config, user.username_color);
                                            const status = people.status(user.username);

                                            return (
                                                <button
                                                    key={user.username}
                                                    type="button"
                                                    onClick={press(user.username)}
                                                    {...bind({ username: user.username, user: null })}
                                                    data-member={user.username}
                                                    className={`flex w-full select-none items-center gap-2 rounded-app px-2 text-left hover:bg-hover ${narrow ? "py-2" : "py-1"}`}
                                                >
                                                    <div className="relative shrink-0">
                                                        <div className="opacity-50">
                                                            <Avatar name={user.username} color={color} size={28} src={people.avatar(user.username)} />
                                                        </div>
                                                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-faint" />
                                                    </div>

                                                    <div className="min-w-0 flex-1">
                                                        <div
                                                            className={`truncate text-sm ${color ? "opacity-60" : "text-faint"}`}
                                                            style={color ? { color } : undefined}
                                                        >
                                                            {user.username}
                                                        </div>
                                                        {status && <div className="truncate text-[11px] text-faint">{status}</div>}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </>
                                )}

                            </div>

                            {menu && (menu.value.user === null || users.some((user) => user.id === menu.value.user!.id)) && (
                                <MemberMenu
                                    key={menu.value.username}
                                    at={menu}
                                    own={menu.value.username === username}
                                    moderation={moderation}
                                    profile={() => people.open(menu.value.username, document.querySelector<HTMLElement>(`[data-member="${CSS.escape(menu.value.username)}"]`))}
                                    message={message}
                                    send={send}
                                    close={close}
                                />
                            )}
                        </aside>
    );
}

//WHAT THE MENU CAN DO TO SOMEBODY
type Action = "kick" | "ban" | "banip";

//THE MENU A ROW OPENS
function MemberMenu(
{
    at, own, moderation, profile, message, send, close,
}: {
    at: HeldMenu<HeldMember>;
    own: boolean;
    moderation: Moderation;
    profile: () => void;
    message: (user: OnlineUser) => void;
    send: (input: string) => void;
    close: () => void;
})
{
    const { username, user } = at.value;

    //MODERATION TAKES A SECOND PRESS
    const [armed, setArmed] = useState<Action | null>(null);

    const target = own ? null : user;

    const item = "flex w-full items-center gap-2 rounded-app px-2 py-1.5 text-left text-sm transition-colors hover:bg-hover";

    //KICK BY ID, BANS BY NAME
    const moderate = (action: Action) =>
    {
        if (armed !== action) { setArmed(action); return; }

        close();
        send(`/server ${action} ${action === "kick" ? target!.id : username}`);
    };

    return createPortal(
        <div
            data-hold-menu
            style={{ left: at.x, top: at.y, width: MENU_WIDTH }}
            className="fixed z-[70] rounded-app border border-border bg-overlay p-1 shadow-2xl"
        >
            <div className="truncate px-2 py-1.5 text-sm font-semibold">{username}</div>

            <button type="button" onClick={() => { close(); profile(); }} className={item}>
                <Icon name="user" className="h-4 w-4" />
                View profile
            </button>

            {target && (
                <button type="button" onClick={() => { close(); message(target); }} className={item}>
                    <Icon name="send" className="h-4 w-4" />
                    Send message
                </button>
            )}

            {target && moderation.kick && (
                <button type="button" onClick={() => moderate("kick")} className={`${item} text-error`}>
                    <Icon name="logout" className="h-4 w-4" />
                    {armed === "kick" ? "Press again to kick" : "Kick"}
                </button>
            )}

            {!own && moderation.ban && (
                <button type="button" onClick={() => moderate("ban")} className={`${item} text-error`}>
                    <Icon name="ban" className="h-4 w-4" />
                    {armed === "ban" ? "Press again to ban" : "Ban"}
                </button>
            )}

            {target && moderation.banip && (
                <button type="button" onClick={() => moderate("banip")} className={`${item} text-error`}>
                    <Icon name="globe" className="h-4 w-4" />
                    {armed === "banip" ? "Press again to ban IP" : "Ban IP"}
                </button>
            )}
        </div>,
        document.body,
    );
}
