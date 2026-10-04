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

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { OnlineUser, OfflineUser, ClientConfig, VocabularyValue } from "./types";
import { Avatar, SectionLabel, MenuBox, MENU_ITEM } from "./components";
import { Icon } from "./icons";
import { messageColor } from "./messages";
import { deviceIcon, rosterSections, sectionLabel } from "./roster";
import { useHoldMenu, type HeldMenu } from "./servers";
import type { People } from "./profile";
import { t } from "./i18n";

//HEADER, SIX ITEMS AND THE ROLES
const MENU_HEIGHT = 360;

//WHO A ROW'S MENU IS ABOUT
interface HeldMember
{
    username: string;
    user: OnlineUser | null;
    role: string;
}

//WHAT OUR ROLE LETS US DO TO SOMEBODY
export interface Moderation
{
    kick: boolean;
    ban: boolean;
    banip: boolean;
    role: boolean;
}

//EVERYBODY ON THE SERVER, BY ROLE; A ROW OPENS THEIR CARD
export function MemberColumn(
{
    users, offline, username, config, narrow, drawer, people, panelRef, moderation, message, send,
}: {
    users: OnlineUser[];

    //null IS A SERVER THAT KEEPS THEM TO ITSELF
    offline: OfflineUser[] | null;

    username: string;
    config: ClientConfig;
    narrow: boolean;
    drawer: "left" | "right" | null;
    people: People;

    //MOVED BY HAND WHILE A DRAWER IS DRAGGED
    panelRef: React.Ref<HTMLElement>;

    moderation: Moderation;
    message: (user: OnlineUser) => void;
    send: (input: string) => void;
})
{
    const { menu, close, bind, held } = useHoldMenu<HeldMember>("pointer", MENU_HEIGHT);

    //A ROW'S PRESS, UNLESS IT ENDED A HOLD
    const press = (name: string) => (event: React.MouseEvent<HTMLElement>) =>
    {
        if (held()) return;

        close();
        people.open(name, event.currentTarget);
    };

    const row = `flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-hover ${narrow ? "py-2" : "py-1"}`;

    return (
        <aside ref={panelRef} className={narrow
            ? `drawer safe-top safe-bottom fixed bottom-0 right-0 top-[var(--chrome-top)] z-40 flex w-[86%] max-w-[300px] flex-col border-l border-border bg-sidebar shadow-2xl ${drawer === "right" ? "translate-x-0" : "drawer-shut translate-x-full"}`
            : "flex w-[240px] shrink-0 flex-col border-l border-border bg-sidebar"}>
            <div className="scroller scroller-quiet flex-1 px-2 pb-3 pt-3">
                {/* HIGHEST ROLE FIRST */}
                {rosterSections(users).map((section) => (
                    <div key={section[0].role}>
                        <SectionLabel>{sectionLabel(section[0].role)}</SectionLabel>

                        {section.map((user) =>
                        {
                            const own = user.username === username;
                            const color = messageColor(config, user.username_color);
                            const device = user.device ? deviceIcon(user.device) : null;
                            const status = people.status(user.username);

                            return (
                                <button
                                    key={user.id}
                                    type="button"
                                    title={t("members.in_channel", { username: user.username, channel: user.channel ?? "lobby" })}
                                    onClick={press(user.username)}
                                    {...bind({ username: user.username, user, role: user.role })}
                                    data-member={user.username}
                                    className={row}
                                >
                                    <span className="relative shrink-0">
                                        <Avatar name={user.username} color={color} size={26} src={people.avatar(user.username)} />
                                        <span className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-online" />
                                    </span>

                                    <span className="min-w-0 flex-1">
                                        <span
                                            className={`block truncate text-[13.5px] leading-tight ${color ? "" : own ? "text-accent" : "text-text"}`}
                                            style={color ? { color } : undefined}
                                        >
                                            {user.username}
                                        </span>

                                        {(status || user.channel) && (
                                            <span className="block truncate text-[11.5px] leading-tight text-faint">
                                                {status ?? `#${user.channel}`}
                                            </span>
                                        )}
                                    </span>

                                    {device && <Icon name={device} className="h-3.5 w-3.5 shrink-0 text-faint" />}
                                    {config.show_id && <span className="shrink-0 text-[11px] text-faint">{user.id}</span>}
                                </button>
                            );
                        })}
                    </div>
                ))}

                {/* REGISTERED, NOT HERE */}
                {offline && offline.length > 0 && (
                    <>
                        <SectionLabel>{t("sidebar.offline")}</SectionLabel>

                        {offline.map((user) =>
                        {
                            const color = messageColor(config, user.username_color);
                            const status = people.status(user.username);

                            return (
                                <button
                                    key={user.username}
                                    type="button"
                                    onClick={press(user.username)}
                                    {...bind({ username: user.username, user: null, role: user.role })}
                                    data-member={user.username}
                                    className={`${row} opacity-45 hover:opacity-100`}
                                >
                                    <Avatar name={user.username} color={color} size={26} src={people.avatar(user.username)} />

                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13.5px] leading-tight" style={color ? { color } : undefined}>{user.username}</span>
                                        {status && <span className="block truncate text-[11.5px] leading-tight text-faint">{status}</span>}
                                    </span>
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
type Action = "kick" | "ban" | "banip" | `role:${string}`;

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
    const { username, user, role: held } = at.value;

    //MODERATION TAKES A SECOND PRESS
    const [armed, setArmed] = useState<Action | null>(null);

    //THE ROLE LIST, WHILE OPEN
    const [roles, setRoles] = useState<string[] | null>(null);
    const [picking, setPicking] = useState(false);

    //ASK FOR THE RANKS
    useEffect(() =>
    {
        if (!picking || roles) return;

        invoke<VocabularyValue[]>("get_vocabulary", { values: "roles", typed: "" })
            .then((values) => setRoles(values.map((value) => value.value)))
            .catch(() => setRoles([]));
    }, [picking, roles]);

    const target = own ? null : user;

    //A BAN BY NAME, THE REST BY ID
    const moderate = (action: Action) =>
    {
        if (armed !== action) { setArmed(action); return; }

        close();
        send(`/server ${action} ${action === "ban" ? username : target!.id}`);
    };

    //SET A RANK
    const grant = (role: string) =>
    {
        const action: Action = `role:${role}`;

        if (armed !== action) { setArmed(action); return; }

        close();
        send(`/server role ${username} ${role}`);
    };

    const danger = (action: Action) => `${MENU_ITEM} ${armed === action ? "bg-error/10 text-error" : "text-error"}`;

    return (
        <MenuBox at={at} title={username}>
            <button type="button" onClick={() => { close(); profile(); }} className={MENU_ITEM}>
                <Icon name="user" className="h-4 w-4 text-muted" />
                {t("menu.view_profile")}
            </button>

            {target && (
                <button type="button" onClick={() => { close(); message(target); }} className={MENU_ITEM}>
                    <Icon name="at" className="h-4 w-4 text-muted" />
                    {t("menu.send_message")}
                </button>
            )}

            {(moderation.kick || moderation.ban || moderation.banip || moderation.role) && !own && <div className="mx-2 my-1 h-px bg-border" />}

            {target && moderation.kick && (
                <button type="button" onClick={() => moderate("kick")} className={danger("kick")}>
                    <Icon name="logout" className="h-4 w-4" />
                    {armed === "kick" ? t("menu.kick_confirm") : t("menu.kick")}
                </button>
            )}

            {!own && moderation.ban && (
                <button type="button" onClick={() => moderate("ban")} className={danger("ban")}>
                    <Icon name="ban" className="h-4 w-4" />
                    {armed === "ban" ? t("menu.ban_confirm") : t("menu.ban")}
                </button>
            )}

            {target && moderation.banip && (
                <button type="button" onClick={() => moderate("banip")} className={danger("banip")}>
                    <Icon name="globe" className="h-4 w-4" />
                    {armed === "banip" ? t("menu.banip_confirm") : t("menu.banip")}
                </button>
            )}

            {!own && moderation.role && (
                <button type="button" onClick={() => setPicking(!picking)} className={MENU_ITEM}>
                    <Icon name="shield" className="h-4 w-4 text-muted" />
                    <span className="flex-1">{t("menu.set_role")}</span>
                    <Icon name="chevron" className={`h-4 w-4 text-faint transition-transform ${picking ? "rotate-180" : ""}`} />
                </button>
            )}

            {!own && moderation.role && picking && roles?.map((role) => (
                <button key={role} type="button" disabled={role === held} onClick={() => grant(role)} className={`${MENU_ITEM} pl-10 ${armed === `role:${role}` ? "text-accent" : ""}`}>
                    <span className="flex-1 capitalize">{armed === `role:${role}` ? t("menu.make_role", { role }) : role}</span>
                    {role === held && <Icon name="check" className="h-4 w-4" />}
                </button>
            ))}
        </MenuBox>
    );
}
