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

import type { StoredServer } from "./types";
import { avatarColor } from "./theme";
import { Icon } from "./icons";

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

//THE THREE THINGS A SERVER IS, ASKED ON THE CONNECT SCREEN AND NOWHERE ELSE: ADDING A SERVER IS
//SOMETHING THE SERVER SELECTION DOES, NOT SOMETHING A SESSION HAS A BUTTON FOR
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

//WHAT A SERVER IS CALLED WHEN THERE IS SOMETHING TO CALL IT BY: WHAT IT CALLED ITSELF LAST TIME, AND THE
//ADDRESS UNTIL IT HAS. A SERVER THAT HAS NEVER BEEN REACHED IS STILL A TILE, BECAUSE IT WAS TYPED IN
export function serverLabel(server: StoredServer): string
{
    return server.name || server.address;
}

//THE FAR-LEFT COLUMN: EVERY SERVER THE WINDOW REMEMBERS, WITH THE ONE WE ARE IN MARKED. IT IS THE WAY
//BETWEEN TWO SESSIONS AND NOTHING ELSE - THE SERVER SELECTION IS WHERE A SERVER IS ADDED, AND WHILE THAT
//IS UP THIS COLUMN IS NOT DRAWN AT ALL, SINCE IT WOULD BE THE SAME LIST STANDING BESIDE ITSELF
export function ServerRail(
{
    servers, active, connecting, onPick, onForget,
}: {
    servers: StoredServer[];
    active: string | null;
    connecting: boolean;
    onPick: (server: StoredServer) => void;
    onForget: (id: string) => void;
})
{
    //WHICH TILE'S MENU IS OPEN. IT IS A RIGHT-CLICK ON A DESKTOP AND A LONG PRESS ON A PHONE, BECAUSE
    //FORGETTING A SERVER IS NOT SOMETHING A STRAY TAP SHOULD BE ABLE TO DO
    const [menu, setMenu] = useState<string | null>(null);
    const railRef = useRef<HTMLDivElement>(null);
    const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    //IT CLOSES THE WAY EVERY OTHER MENU HERE DOES: A PRESS THAT LANDED OUTSIDE IT, OR ESC
    useEffect(() =>
    {
        if (menu === null) return;

        const outside = (event: MouseEvent) =>
        {
            if (!railRef.current?.contains(event.target as Node)) setMenu(null);
        };

        const key = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };

        document.addEventListener("mousedown", outside);
        document.addEventListener("keydown", key);

        return () =>
        {
            document.removeEventListener("mousedown", outside);
            document.removeEventListener("keydown", key);
        };
    }, [menu]);

    const hold = (id: string) =>
    {
        pressRef.current = setTimeout(() => setMenu(id), 500);
    };

    const release = () =>
    {
        if (pressRef.current !== null) clearTimeout(pressRef.current);

        pressRef.current = null;
    };

    return (
        <nav
            ref={railRef}
            className="scroller scroller-quiet relative z-10 flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-border bg-deep py-3"
        >
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
                            onClick={() => { setMenu(null); onPick(server); }}
                            onContextMenu={(event) => { event.preventDefault(); setMenu(server.id); }}
                            onTouchStart={() => hold(server.id)}
                            onTouchEnd={release}
                            onTouchMove={release}
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

                        {menu === server.id && (
                            <div className="absolute left-[52px] top-0 z-50 w-56 rounded-app border border-border bg-overlay p-1 shadow-2xl">
                                <div className="px-2 py-1.5">
                                    <div className="truncate text-sm font-semibold">{label}</div>
                                    <div className="truncate font-mono text-[11px] text-faint">{server.address}</div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => { setMenu(null); onForget(server.id); }}
                                    className="flex w-full items-center gap-2 rounded-app px-2 py-1.5 text-left text-sm text-error transition-colors hover:bg-hover"
                                >
                                    <Icon name="close" className="h-4 w-4" />
                                    Forget this server
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
