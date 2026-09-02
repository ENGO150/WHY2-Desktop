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

import type { ScreenUser } from "./types";
import { Icon, IconButton } from "./icons";
import { Avatar, SectionLabel } from "./components";

//THE ONE DOOR FOR BOTH DIRECTIONS OF THE SCREEN SHARE: EVERYBODY WHO IS SHARING - OURS AMONG THEM,
//MARKED AND WATCHABLE LIKE ANY OTHER - OVER OUR OWN MONITORS, THE LIVE ONE BADGED. THE LIST IS A
//PHOTOGRAPH OF THE MOMENT IT WAS ASKED FOR, WHICH IS WHY IT CARRIES ITS OWN Refresh
export function ScreensBox(
{
    sharers, monitors, watching, screen, username, dialogWrap, dialogCard, send, askScreens, close,
}: {
    sharers: ScreenUser[];
    monitors: string[];
    watching: string | null;
    username: string;
    screen: { sharing: boolean; monitor: string | null };
    dialogWrap: string;
    dialogCard: (wide: string) => string;
    send: (input: string) => void;
    askScreens: () => void;
    close: () => void;
})
{
    return (
        <div
            onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
            className={dialogWrap}
        >
            <div
                ref={(node) => { node?.focus(); }}
                tabIndex={-1}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
                className={`rise ${dialogCard("flex max-h-[84vh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none")}`}
            >
                <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                    <Icon name="monitor" className="h-4 w-4 shrink-0 text-muted" />
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Screens</h2>

                    <IconButton icon="close" label="Close" onClick={() => close()} />
                </header>

                <div className="scroller flex-1 px-2.5 pb-3">
                    <SectionLabel>Being shared</SectionLabel>

                    {sharers.length === 0 && (
                        <div className="px-2 py-2 text-sm text-faint">Nobody is sharing right now.</div>
                    )}

                    {sharers.map((user) =>
                    {
                        const own = user.username === username;
                        const here = watching === user.username;

                        //OUR OWN SHARE IS WATCHABLE LIKE ANY OTHER - IT IS THE ONLY WAY TO SEE WHAT EVERYBODY
                        //ELSE IS SEEING OF IT, WHICH IS THE ONE THING THE PERSON SHARING CANNOT OTHERWISE CHECK
                        return (
                            <button
                                key={user.id}
                                type="button"
                                title={here
                                    ? `Stop watching ${own ? "your own screen" : user.username}`
                                    : own ? "Watch your own screen as everybody else sees it" : `Watch ${user.username}'s screen`}
                                onClick={() => { send(here ? "/deattach" : `/attach ${user.id}`); if (!here) close(); }}
                                className="flex w-full items-center gap-2.5 rounded-app px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
                            >
                                <Avatar name={user.username} size={28} />

                                <span className="min-w-0 flex-1 truncate text-sm">{user.username}</span>

                                {own && <span className="shrink-0 text-[11px] text-faint">you</span>}

                                <span className={`shrink-0 rounded-app px-3 py-1.5 text-xs font-semibold transition ${here
                                    ? "border border-border text-muted"
                                    : "bg-accent text-black/85"}`}
                                >
                                    {here ? "Stop watching" : "Watch"}
                                </span>
                            </button>
                        );
                    })}

                    <SectionLabel>Share one of yours</SectionLabel>

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
                                onClick={() => { send(live ? "/screen" : `/screen ${name}`); if (!live) close(); }}
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
                </div>

                <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/40 px-5 py-3">
                    <span className="flex-1 text-xs text-faint">Everybody on the server can watch what you share.</span>

                    <button
                        type="button"
                        onClick={askScreens}
                        className="rounded-app border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-text"
                    >
                        Refresh
                    </button>
                </footer>
            </div>
        </div>
    );
}
