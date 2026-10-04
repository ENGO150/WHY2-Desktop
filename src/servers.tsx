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

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { StoredServer, IconSource } from "./types";
import { Icon } from "./icons";
import { SpaceIcon, Overlay, PanelHeader, MenuBox, MENU_ITEM, MENU_WIDTH } from "./components";
import { t } from "./i18n";

export { MENU_WIDTH };

//WHAT A SERVER IS TYPED IN AS; AN EMPTY PASSWORD IS "ASK ME"
export interface ServerForm
{
    address: string;
    username: string;
    password: string;
}

//THE THREE FIELDS, FOR THE CONNECT SCREEN AND THE DIALOG
export function AddServerFields(
{
    form, setForm, connecting, inputRef, autoFocus,
}: {
    form: ServerForm;
    setForm: (form: ServerForm) => void;
    connecting: boolean;
    inputRef?: React.RefObject<HTMLInputElement | null>;
    autoFocus: boolean;
})
{
    return (
        <div className="flex flex-col gap-3">
            <input
                id="login-input"
                ref={inputRef}
                type="text"
                aria-label={t("login.label.address")}
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.currentTarget.value })}
                placeholder={t("login.label.address")}
                className="field"
                disabled={connecting}
                autoFocus={autoFocus}
                spellCheck={false}
            />

            <input
                id="login-username"
                type="text"
                aria-label={t("login.label.username")}
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.currentTarget.value })}
                placeholder={t("login.label.username")}
                className="field"
                disabled={connecting}
                spellCheck={false}
            />

            <input
                id="login-password"
                type="password"
                aria-label={t("login.label.password")}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                placeholder={t("connect.password_optional")}
                className="field"
                disabled={connecting}
            />
        </div>
    );
}

//THE SAME FORM OVER A SESSION
export function AddServerDialog(
{
    form, setForm, connecting, errorMsg, cardRef, narrow, onSubmit, close,
}: {
    form: ServerForm;
    setForm: (form: ServerForm) => void;
    connecting: boolean;
    errorMsg: string;
    cardRef: React.RefObject<HTMLDivElement | null>;
    narrow: boolean;
    onSubmit: (event: React.FormEvent) => void;
    close: () => void;
})
{
    return (
        <Overlay narrow={narrow} width={420} label={t("connect.add")} cardRef={cardRef} close={close}>
            <PanelHeader title={t("connect.add")} close={close} />

            <form onSubmit={onSubmit} className="scroller scroller-quiet flex-1 px-6 pb-6 pt-3">
                <AddServerFields form={form} setForm={setForm} connecting={connecting} autoFocus={!narrow} />

                {(connecting || errorMsg) && (
                    <div className={`mt-3 text-[13px] ${connecting ? "text-muted" : "text-error"}`}>
                        {connecting ? t("login.connecting") : errorMsg}
                    </div>
                )}

                <button type="submit" disabled={connecting || !form.address} className="btn btn-accent mt-5 w-full py-2.5">
                    {t("connect.connect")}
                </button>
            </form>
        </Overlay>
    );
}

//A RIGHT-CLICK OR A HOLD OPENS A MENU ABOUT WHATEVER WAS HELD
const HOLD = 500;
const MENU_HEIGHT = 96;

export interface HeldMenu<T>
{
    value: T;
    x: number;
    y: number;
}

//THE GESTURE IS THE SAME WHEREVER IT IS ASKED FOR AND WHAT IT OPENS A MENU *ABOUT* IS NOT - A SERVER IN
//THE TWO LISTS, A PICTURE IN THE PANE - SO WHAT IT CARRIES IS THE CALLER'S, WHOLE AND NOT AS AN ID TO
//LOOK BACK UP: A PICTURE HAS NO ID, THE LIVE ONES NOT EVEN A HASH
export function useHoldMenu<T>(anchor: "element" | "pointer" = "element", height = MENU_HEIGHT)
{
    const [menu, setMenu] = useState<HeldMenu<T> | null>(null);
    const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const firedRef = useRef(false);
    const pointRef = useRef({ x: 0, y: 0 });

    //FIT THE DRAWN MENU INSIDE THE WINDOW
    useLayoutEffect(() =>
    {
        if (menu === null) return;

        const drawn = document.querySelectorAll<HTMLElement>("[data-hold-menu]");
        const box = drawn[drawn.length - 1]?.getBoundingClientRect();

        if (!box) return;

        const fit = (at: number, size: number, limit: number, point: number) =>
        {
            if (at + size <= limit - 8) return at;
            if (anchor === "pointer" && point - size - 2 >= 8) return point - size - 2;

            return Math.max(8, limit - size - 8);
        };

        const x = fit(menu.x, box.width, window.innerWidth, pointRef.current.x);
        const y = fit(menu.y, box.height, window.innerHeight, pointRef.current.y);

        if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
    }, [menu]);

    //IT CLOSES THE WAY EVERY OTHER MENU HERE DOES - A PRESS THAT LANDED OUTSIDE IT, OR ESC - AND ALSO WHEN
    //WHATEVER IT IS POINTING AT MOVES, SINCE IT IS PLACED ONCE AND DOES NOT FOLLOW
    useEffect(() =>
    {
        if (menu === null) return;

        const outside = (event: Event) =>
        {
            if (!(event.target as HTMLElement | null)?.closest?.("[data-hold-menu]")) setMenu(null);
        };

        const key = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
        const moved = (event: Event) =>
        {
            if (!(event.target as HTMLElement | null)?.closest?.("[data-hold-menu]")) setMenu(null);
        };

        document.addEventListener("mousedown", outside);
        document.addEventListener("touchstart", outside);
        document.addEventListener("keydown", key);
        window.addEventListener("resize", moved);
        window.addEventListener("scroll", moved, true);

        return () =>
        {
            document.removeEventListener("mousedown", outside);
            document.removeEventListener("touchstart", outside);
            document.removeEventListener("keydown", key);
            window.removeEventListener("resize", moved);
            window.removeEventListener("scroll", moved, true);
        };
    }, [menu]);

    //BESIDE WHAT WAS HELD, OR AT THE POINT IT WAS HELD BY, AND INSIDE THE WINDOW EITHER WAY: SOMETHING
    //NEAR THE BOTTOM OR THE RIGHT EDGE WOULD OTHERWISE OPEN A MENU PAST IT.
    //WHICH OF THE TWO IS THE CALLER'S, AND IT FOLLOWS THE SIZE OF THE THING: A ROW IS A MOUTHFUL WIDE AND
    //A MENU BESIDE IT POINTS AT IT, WHILE A PICTURE IS HALF THE WINDOW AND ITS TOP CORNER IS NOWHERE NEAR
    //WHATEVER WAS ACTUALLY CLICKED
    const openAt = (value: T, element: HTMLElement, x: number, y: number) =>
    {
        const box = element.getBoundingClientRect();

        pointRef.current = { x, y };

        const left = anchor === "pointer" ? x + 2 : box.right + 8;
        const top = anchor === "pointer" ? y + 2 : box.top;

        setMenu(
        {
            value,
            x: Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8)),
            y: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
        });
    };

    const release = () =>
    {
        if (pressRef.current !== null) clearTimeout(pressRef.current);

        pressRef.current = null;
    };

    const bind = (value: T) => (
    {
        onContextMenu: (event: React.MouseEvent) =>
        {
            event.preventDefault();
            openAt(value, event.currentTarget as HTMLElement, event.clientX, event.clientY);
        },

        onTouchStart: (event: React.TouchEvent) =>
        {
            const element = event.currentTarget as HTMLElement;
            const touch = event.touches[0];

            //WHERE THE FINGER LANDED, TAKEN NOW: THE MENU OPENS HALF A SECOND LATER, AND THE EVENT IT
            //WOULD HAVE TO BE READ OUT OF THEN IS OVER
            const x = touch?.clientX ?? 0;
            const y = touch?.clientY ?? 0;

            firedRef.current = false;
            release();

            pressRef.current = setTimeout(() => { firedRef.current = true; openAt(value, element, x, y); }, HOLD);
        },

        onTouchEnd: release,
        onTouchMove: release,
    });

    //A HOLD ENDS IN A CLICK LIKE ANY OTHER PRESS, AND THAT ONE WOULD PICK THE VERY SERVER BEING HELD
    const held = () =>
    {
        const fired = firedRef.current;
        firedRef.current = false;

        return fired;
    };

    return { menu, close: () => setMenu(null), bind, held };
}

//THE ONE THING TO DO WITH A HELD SERVER
export function ForgetMenu(
{
    server, at, onForget, close,
}: {
    server: StoredServer;
    at: HeldMenu<string>;
    onForget: (id: string) => void;
    close: () => void;
})
{
    return (
        <MenuBox at={at} title={serverLabel(server)}>
            <button type="button" onClick={() => { close(); onForget(server.id); }} className={`${MENU_ITEM} text-error`}>
                <Icon name="trash" className="h-4 w-4" />
                {t("menu.remove_server")}
            </button>
        </MenuBox>
    );
}

//WHAT A SERVER IS CALLED
export function serverLabel(server: StoredServer): string
{
    return server.name || server.address;
}

//ONE SERVER AS A ROW
export function ServerRow(
{
    server, here, connecting, icon, onPick, bind,
}: {
    server: StoredServer;
    here: boolean;
    connecting: boolean;
    icon?: IconSource[];
    onPick: () => void;
    bind: Record<string, unknown>;
})
{
    const label = serverLabel(server);

    return (
        <button
            type="button"
            onClick={onPick}
            {...bind}
            className={`group flex w-full select-none items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover ${here ? "bg-selected" : ""}`}
        >
            <SpaceIcon name={label} size={32} src={icon} />

            <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{label}</span>
                <span className="block truncate text-[12px] text-faint">{server.username ? `${server.username} · ${server.address}` : server.address}</span>
            </span>

            {here && connecting && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-faint border-t-accent" />}
            {here && !connecting && <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />}
        </button>
    );
}

//THE SERVER WE ARE ON, AND THE OTHERS UNDER IT
export function ServerSwitcher(
{
    servers, active, connecting, serverName, icon, icons, onPick, onAdd, onForget,
}: {
    servers: StoredServer[];
    active: string | null;
    connecting: boolean;
    serverName: string;
    address: string;
    icon?: IconSource[];                 //THE ONE WE ARE ON
    icons: Record<string, IconSource[]>; //EVERY KEPT ONE, BY HASH
    onPick: (server: StoredServer) => void;
    onAdd: () => void;
    onForget: (id: string) => void;
})
{
    const [open, setOpen] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    const { menu, close, bind, held } = useHoldMenu<string>();

    //A PRESS OUTSIDE, OR ESC
    useEffect(() =>
    {
        if (!open) return;

        const outside = (event: Event) =>
        {
            const target = event.target as HTMLElement | null;

            if (box.current?.contains(target) || target?.closest?.("[data-hold-menu]")) return;

            setOpen(false);
        };

        const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };

        document.addEventListener("mousedown", outside);
        document.addEventListener("touchstart", outside);
        document.addEventListener("keydown", key);

        return () =>
        {
            document.removeEventListener("mousedown", outside);
            document.removeEventListener("touchstart", outside);
            document.removeEventListener("keydown", key);
        };
    }, [open]);

    const name = serverName || "WHY2";

    return (
        <div ref={box} className="min-w-0 flex-1">
            <button
                type="button"
                title={t("connect.switch")}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className={`flex w-full min-w-0 items-center rounded-lg px-2 text-left transition-colors hover:bg-hover ${icon?.length ? "gap-3 py-1" : "gap-2.5 py-1.5"}`}
            >
                {/* A PICTURE IS WORTH THE ROOM */}
                <SpaceIcon name={name} size={icon?.length ? 40 : 26} src={icon} />
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{name}</span>
            </button>

            {open && (
                <div className="absolute left-2 right-2 top-full z-30 overflow-hidden rounded-xl border border-border-strong bg-overlay p-1 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)]">
                    <div className="scroller scroller-quiet max-h-[50vh]">
                        {servers.map((server) => (
                            <ServerRow
                                key={server.id}
                                server={server}
                                here={server.id === active}
                                connecting={connecting}
                                icon={server.icon ? icons[server.icon] : undefined}
                                bind={bind(server.id)}
                                onPick={() =>
                                {
                                    if (held()) return;

                                    close();
                                    setOpen(false);

                                    if (server.id !== active) onPick(server);
                                }}
                            />
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={() => { close(); setOpen(false); onAdd(); }}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[14px] text-muted transition-colors hover:bg-hover hover:text-text"
                    >
                        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-dashed border-border-strong">
                            <Icon name="plus" className="h-4 w-4" />
                        </span>
                        {t("connect.add")}
                    </button>
                </div>
            )}

            {menu && servers.some((server) => server.id === menu.value) && (
                <ForgetMenu
                    server={servers.find((server) => server.id === menu.value)!}
                    at={menu}
                    onForget={onForget}
                    close={close}
                />
            )}
        </div>
    );
}
