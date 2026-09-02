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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { StoredServer } from "./types";
import { avatarColor } from "./theme";
import { Icon, IconButton } from "./icons";

//WHAT A SERVER IS TYPED IN AS. THE PASSWORD IS PART OF IT BECAUSE THE WHOLE POINT OF THE LIST IS THAT
//NONE OF THIS IS ASKED TWICE - AND IT IS ALLOWED TO BE EMPTY, WHICH IS THE ROW SAYING "ASK ME"
export interface ServerForm
{
    address: string;
    username: string;
    password: string;
}

const FIELD = "mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-accent";
const CAPTION = "text-[11px] font-semibold uppercase tracking-wider text-muted";

//THE THREE THINGS A SERVER IS. THEY ARE ASKED IN TWO PLACES - THE CONNECT SCREEN WHILE THERE IS NO
//SESSION, AND A WINDOW OVER THE CHAT WHILE THERE IS - SO THEY ARE WRITTEN ONCE
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
        <>
            <label htmlFor="login-input" className={CAPTION}>Server address</label>

            <input
                id="login-input"
                ref={inputRef}
                type="text"
                value={form.address}
                onChange={(event) => setForm({ ...form, address: event.currentTarget.value })}
                placeholder="127.0.0.1:8080"
                className={FIELD}
                disabled={connecting}
                autoFocus={autoFocus}
                spellCheck={false}
            />

            <label htmlFor="login-username" className={`${CAPTION} mt-4 block`}>Username</label>

            <input
                id="login-username"
                type="text"
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.currentTarget.value })}
                className={FIELD}
                disabled={connecting}
                spellCheck={false}
            />

            <label htmlFor="login-password" className={`${CAPTION} mt-4 block`}>Password</label>

            <input
                id="login-password"
                type="password"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.currentTarget.value })}
                className={FIELD}
                disabled={connecting}
            />

            {/* THE HONEST FOOTNOTE. THERE IS NO KEY TO ENCRYPT THIS WITH THAT THE PROGRAM WOULD NOT HAVE
                TO KEEP BESIDE IT, SO IT SAYS WHAT IT DOES */}
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-faint">
                <Icon name="lock" className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>Kept in a file only you can read. Leave the password empty to be asked at every connect.</span>
            </div>
        </>
    );
}

//AND THE SAME FORM AS A WINDOW, FOR THE RAIL'S + WHILE THERE IS A SESSION BEHIND IT. A SERVER ADDED FROM
//IN HERE IS A SWITCH LIKE ANY OTHER: THE ONE WE ARE IN IS LEFT FIRST, AND THE CONNECT SCREEN TAKES OVER
//WITH WHAT WAS TYPED STILL IN IT
export function AddServerDialog(
{
    form, setForm, connecting, errorMsg, cardRef, dialogWrap, dialogCard, narrow, onSubmit, close,
}: {
    form: ServerForm;
    setForm: (form: ServerForm) => void;
    connecting: boolean;
    errorMsg: string;
    cardRef: React.RefObject<HTMLDivElement | null>;
    dialogWrap: string;
    dialogCard: (wide: string) => string;
    narrow: boolean;
    onSubmit: (event: React.FormEvent) => void;
    close: () => void;
})
{
    return (
        <div
            onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
            className={dialogWrap}
        >
            <div
                ref={cardRef}
                tabIndex={-1}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
                className={`rise ${dialogCard("flex max-h-[84vh] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none")}`}
            >
                <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                    <Icon name="plus" className="h-4 w-4 shrink-0 text-muted" />
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Add a server</h2>

                    <IconButton icon="close" label="Close" onClick={close} />
                </header>

                <form onSubmit={onSubmit} className="scroller scroller-quiet flex-1 px-5 py-4">
                    {/* THE SOFT KEYBOARD IS HALF THE SCREEN, SO ON A PHONE IT OPENS WHEN THE FIELD IS
                        TAPPED RATHER THAN BECAUSE A WINDOW CAME UP */}
                    <AddServerFields form={form} setForm={setForm} connecting={connecting} autoFocus={!narrow} />

                    <div className="mt-2 min-h-[1.25rem] text-xs">
                        {connecting
                            ? <span className="text-accent">Connecting…</span>
                            : errorMsg
                                ? <span className="text-error">{errorMsg}</span>
                                : null}
                    </div>

                    <button
                        type="submit"
                        disabled={connecting || !form.address}
                        className="mt-3 w-full rounded-app bg-accent py-2.5 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Add and connect
                    </button>

                    {/* IT LEAVES THE SERVER WE ARE IN, WHICH IS WORTH SAYING BEFORE IT HAPPENS */}
                    <div className="mt-2 text-center text-[11px] text-faint">This leaves the server you are on.</div>
                </form>
            </div>
        </div>
    );
}

//FORGETTING A SERVER IS THE ONE DESTRUCTIVE THING THE LIST CAN DO, SO IT IS NOT A BUTTON SITTING THERE
//WAITING TO BE BRUSHED: IT IS A RIGHT-CLICK ON A DESKTOP AND A HOLD ON A PHONE, WHICH IS WHAT EVERY OTHER
//PROGRAM ASKS FOR BEFORE THROWING SOMETHING AWAY. BOTH LISTS THAT HAVE IT - THE RAIL AND THE SELECTION
//SCREEN - ASK THE SAME WAY, SO THE GESTURE IS WRITTEN ONCE
const HOLD = 500;
const MENU_WIDTH = 224;
const MENU_HEIGHT = 96;

export interface HeldMenu
{
    id: string;
    x: number;
    y: number;
}

export function useHoldMenu()
{
    const [menu, setMenu] = useState<HeldMenu | null>(null);
    const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const firedRef = useRef(false);

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
        const moved = () => setMenu(null);

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

    //BESIDE WHAT WAS HELD, AND INSIDE THE WINDOW: A ROW NEAR THE BOTTOM OR THE RIGHT EDGE WOULD OTHERWISE
    //OPEN A MENU PAST IT
    const openAt = (id: string, element: HTMLElement) =>
    {
        const box = element.getBoundingClientRect();

        setMenu(
        {
            id,
            x: Math.max(8, Math.min(box.right + 8, window.innerWidth - MENU_WIDTH - 8)),
            y: Math.max(8, Math.min(box.top, window.innerHeight - MENU_HEIGHT - 8)),
        });
    };

    const release = () =>
    {
        if (pressRef.current !== null) clearTimeout(pressRef.current);

        pressRef.current = null;
    };

    const bind = (id: string) => (
    {
        onContextMenu: (event: React.MouseEvent) =>
        {
            event.preventDefault();
            openAt(id, event.currentTarget as HTMLElement);
        },

        onTouchStart: (event: React.TouchEvent) =>
        {
            const element = event.currentTarget as HTMLElement;

            firedRef.current = false;
            release();

            pressRef.current = setTimeout(() => { firedRef.current = true; openAt(id, element); }, HOLD);
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

//THE MENU ITSELF, WHICH IS ONE ITEM. IT GOES THROUGH A PORTAL BECAUSE BOTH THINGS THAT OPEN IT LIVE IN
//BOXES THAT WOULD SWALLOW IT: A LIST THAT SCROLLS CLIPS WHATEVER LEAVES IT, AND A DRAWER IS TRANSLATED,
//WHICH IS ENOUGH TO MAKE position: fixed MEAN "INSIDE THE DRAWER"
export function ForgetMenu(
{
    server, at, onForget, close,
}: {
    server: StoredServer;
    at: HeldMenu;
    onForget: (id: string) => void;
    close: () => void;
})
{
    return createPortal(
        <div
            data-hold-menu
            style={{ left: at.x, top: at.y, width: MENU_WIDTH }}
            className="fixed z-[60] rounded-app border border-border bg-overlay p-1 shadow-2xl"
        >
            <div className="px-2 py-1.5">
                <div className="truncate text-sm font-semibold">{serverLabel(server)}</div>
                <div className="truncate font-mono text-[11px] text-faint">{server.address}</div>
            </div>

            <button
                type="button"
                onClick={() => { close(); onForget(server.id); }}
                className="flex w-full items-center gap-2 rounded-app px-2 py-1.5 text-left text-sm text-error transition-colors hover:bg-hover"
            >
                <Icon name="close" className="h-4 w-4" />
                Forget this server
            </button>
        </div>,
        document.body,
    );
}

//WHAT A SERVER IS CALLED WHEN THERE IS SOMETHING TO CALL IT BY: WHAT IT CALLED ITSELF LAST TIME, AND THE
//ADDRESS UNTIL IT HAS. A SERVER THAT HAS NEVER BEEN REACHED IS STILL A TILE, BECAUSE IT WAS TYPED IN
export function serverLabel(server: StoredServer): string
{
    return server.name || server.address;
}

//THE FAR-LEFT COLUMN: EVERY SERVER THE WINDOW REMEMBERS, THE ONE WE ARE IN MARKED, AND THE + THAT ADDS
//ANOTHER. IT IS DRAWN INSIDE THE SESSION AND NOT ON THE SELECTION SCREEN, WHICH IS THE SAME LIST WRITTEN
//OUT IN FULL - SO THE + IS THE WAY TO THE FORM FROM IN HERE, AND THE SELECTION SCREEN IS IT FROM OUT THERE
export function ServerRail(
{
    servers, active, connecting, onPick, onAdd, onForget,
}: {
    servers: StoredServer[];
    active: string | null;
    connecting: boolean;
    onPick: (server: StoredServer) => void;
    onAdd: () => void;
    onForget: (id: string) => void;
})
{
    const { menu, close, bind, held } = useHoldMenu();

    return (
        <nav className="scroller scroller-quiet relative z-10 flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-border bg-deep py-3">
            {servers.map((server) =>
            {
                const label = serverLabel(server);
                const current = server.id === active;

                return (
                    <div key={server.id} className="relative shrink-0">
                        <button
                            type="button"
                            title={`${label}\n${server.address}${server.username ? ` — ${server.username}` : ""}`}
                            aria-label={label}
                            onClick={() => { if (held()) return; close(); onPick(server); }}
                            {...bind(server.id)}
                            className={`flex h-12 w-12 select-none items-center justify-center text-[17px] font-semibold text-white/90 transition-all ${current
                                ? "rounded-2xl ring-2 ring-accent"
                                : "rounded-full opacity-70 hover:rounded-2xl hover:opacity-100"}`}
                            style={{ background: avatarColor(server.name || server.address) }}
                        >
                            {(label.trim()[0] ?? "?").toUpperCase()}
                        </button>

                        {/* THE ONE WE ARE IN, SAID THE WAY EVERY PROGRAM WITH A RAIL SAYS IT: A PILL AGAINST
                            THE EDGE RATHER THAN A WORD THERE IS NO ROOM FOR. IT IS FAINT WHILE WE ARE STILL
                            ON OUR WAY IN, SINCE THAT IS THE DIFFERENCE BETWEEN PICKED AND CONNECTED */}
                        {current && (
                            <span className={`absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-text ${connecting ? "opacity-40" : ""}`} />
                        )}

                    </div>
                );
            })}

            <button
                type="button"
                title="Add a server"
                aria-label="Add a server"
                onClick={() => { close(); onAdd(); }}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border-strong text-muted transition-all hover:rounded-2xl hover:border-accent hover:text-accent"
            >
                <Icon name="plus" className="h-5 w-5" />
            </button>

            {menu && servers.some((server) => server.id === menu.id) && (
                <ForgetMenu
                    server={servers.find((server) => server.id === menu.id)!}
                    at={menu}
                    onForget={onForget}
                    close={close}
                />
            )}
        </nav>
    );
}
