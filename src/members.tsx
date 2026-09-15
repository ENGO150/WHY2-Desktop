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

import type { OnlineUser, OfflineUser, ClientConfig } from "./types";
import { Avatar, SectionLabel } from "./components";
import { Icon } from "./icons";
import { messageColor } from "./messages";
import { deviceIcon } from "./roster";

//THE RIGHT COLUMN: EVERYBODY ON THE SERVER, AND WHICH CHANNEL THEY ARE SITTING IN. A ROW IS A BUTTON AND
//IT OPENS THE CONVERSATION WITH THAT PERSON - OURS IS NOT ONE, SINCE THE SERVER REFUSES A PM TO OURSELVES
export function MemberColumn(
{
    users, offline, username, config, narrow, drawer, setDrawer, showDirect, panelRef,
}: {
    users: OnlineUser[];

    //THE REGISTERED USERS NOBODY IS CONNECTED AS, WHERE THE SERVER SENDS THEM - null IS NO SUCH SECTION
    offline: OfflineUser[] | null;

    username: string;
    config: ClientConfig;
    narrow: boolean;
    drawer: "left" | "right" | null;
    setDrawer: (drawer: "left" | "right" | null) => void;
    showDirect: (peer: { id: number; username: string } | null) => void;

    //THE COLUMN ITSELF, WHICH App.tsx MOVES BY HAND WHILE A FINGER IS DRAGGING THE DRAWER
    panelRef: React.Ref<HTMLElement>;
})
{
    return (
                        <aside ref={panelRef} className={narrow
                            ? `drawer safe-top safe-bottom fixed bottom-0 right-0 top-[var(--chrome-top)] z-40 flex w-[86%] max-w-[300px] flex-col border-l border-border bg-sidebar shadow-2xl ${drawer === "right" ? "translate-x-0" : "drawer-shut translate-x-full"}`
                            : "flex w-[220px] shrink-0 flex-col border-l border-border bg-sidebar"}>
                            <div className="scroller scroller-quiet flex-1 px-2 pb-3">
                                <SectionLabel>Online — {users.length}</SectionLabel>

                                {users.map((user) =>
                                {
                                    const own = user.username === username;

                                    //CLICKING SOMEBODY OPENS THE CONVERSATION WITH THEM, WHICH IS WHERE
                                    //EVERY OTHER CHAT PROGRAM PUTS IT. OUR OWN ROW IS NOT ONE OF THOSE -
                                    //THE SERVER REFUSES A PM TO OURSELVES, AND SO DOES THIS
                                    const Row = own ? "div" : "button";

                                    //EVERYBODY IS NAMED IN THEIR OWN COLOR HERE TOO - THE ACCENT IS ONLY
                                    //WHAT IS LEFT ON OUR OWN ROW WHERE THERE IS NO COLOR TO USE
                                    const color = messageColor(config, user.username_color);

                                    //WHAT THEY ARE ON, WHERE THEY SHARE IT. THE TUI PRINTS THE WORD; A
                                    //WINDOW HAS THE LINE ART, AND IT SITS ON THE RIGHT EDGE EITHER WAY
                                    const device = user.device ? deviceIcon(user.device) : null;

                                    return (
                                        <Row
                                            key={user.id}
                                            type={own ? undefined : "button"}
                                            onClick={own ? undefined : () => { showDirect(user); setDrawer(null); }}
                                            className={`flex w-full items-center gap-2 rounded-app px-2 text-left hover:bg-hover ${narrow ? "py-2" : "py-1"} ${own ? "" : "cursor-pointer"}`}
                                            title={own
                                                ? user.channel ? `#${user.channel}` : "lobby"
                                                : `Message ${user.username}`}
                                        >
                                            <div className="relative shrink-0">
                                                <Avatar name={user.username} color={color} size={28} />
                                                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-online" />
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div
                                                    className={`truncate text-sm ${color ? "" : own ? "text-accent" : "text-muted"}`}
                                                    style={color ? { color } : undefined}
                                                >
                                                    {user.username}
                                                </div>
                                                {user.channel && <div className="truncate text-[11px] text-faint">#{user.channel}</div>}
                                            </div>

                                            {device && <Icon name={device} className="h-3.5 w-3.5 shrink-0 text-faint" />}

                                            {config.show_id && <span className="shrink-0 font-mono text-[10px] text-faint">{user.id}</span>}
                                        </Row>
                                    );
                                })}

                                {/* THE SERVER'S OWN USERS WHO ARE NOT HERE. THERE IS NOTHING TO DO WITH
                                    ONE - A PM NEEDS AN ID, AND SOMEBODY OFFLINE HAS NONE - SO THE ROW IS
                                    A NAME AND NOT A BUTTON */}
                                {offline && offline.length > 0 && (
                                    <>
                                        <SectionLabel>Offline — {offline.length}</SectionLabel>

                                        {offline.map((user) =>
                                        {
                                            const color = messageColor(config, user.username_color);

                                            return (
                                                <div
                                                    key={user.username}
                                                    className={`flex w-full items-center gap-2 rounded-app px-2 ${narrow ? "py-2" : "py-1"}`}
                                                >
                                                    <div className="shrink-0 opacity-50">
                                                        <Avatar name={user.username} color={color} size={28} />
                                                    </div>

                                                    <div
                                                        className={`min-w-0 flex-1 truncate text-sm ${color ? "opacity-60" : "text-faint"}`}
                                                        style={color ? { color } : undefined}
                                                    >
                                                        {user.username}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}

                            </div>
                        </aside>
    );
}
