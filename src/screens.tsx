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
import { Icon } from "./icons";
import { Avatar, Overlay, PanelHeader, SectionLabel } from "./components";

//WHO TO WATCH, AND WHAT OF OURS TO SHARE
export function ScreensBox(
{
    sharers, monitors, watching, screen, username, narrow, send, askScreens, close,
}: {
    sharers: ScreenUser[];
    monitors: string[];
    watching: string | null;
    username: string;
    screen: { sharing: boolean; monitor: string | null };
    narrow: boolean;
    send: (input: string) => void;
    askScreens: () => void;
    close: () => void;
})
{
    return (
        <Overlay narrow={narrow} width={440} label="Screens" cardRef={(node) => { node?.focus(); }} close={close}>
            <PanelHeader
                title="Screens"
                aside={(
                    <button type="button" title="Refresh" aria-label="Refresh" onClick={askScreens} className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text">
                        <Icon name="refresh" className="h-[18px] w-[18px]" />
                    </button>
                )}
                close={close}
            />

            <div className="scroller flex-1 px-3 pb-5">
                <SectionLabel>Live</SectionLabel>

                {sharers.length === 0 && (
                    <div className="px-4 py-3 text-[14px] text-faint">Nobody is sharing</div>
                )}

                {sharers.map((user) =>
                {
                    const own = user.username === username;
                    const here = watching === user.username;

                    //OUR OWN IS WATCHABLE TOO
                    return (
                        <div key={user.id} className="flex items-center gap-3 rounded-xl px-3 py-2">
                            <Avatar name={user.username} size={32} />

                            <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{own ? `${user.username} (you)` : user.username}</span>

                            <button
                                type="button"
                                onClick={() => { send(here ? "/deattach" : `/attach ${user.id}`); if (!here) close(); }}
                                className={`btn ${here ? "btn-danger" : "btn-accent"}`}
                            >
                                {here ? "Stop" : "Watch"}
                            </button>
                        </div>
                    );
                })}

                <SectionLabel>Share</SectionLabel>

                {monitors.length === 0 && (
                    <div className="px-4 py-3 text-[14px] text-faint">No screens found</div>
                )}

                {monitors.map((name) =>
                {
                    const live = screen.sharing && screen.monitor === name;

                    return (
                        <button
                            key={name}
                            type="button"
                            onClick={() => { send(live ? "/screen" : `/screen ${name}`); if (!live) close(); }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-hover"
                        >
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border ${live ? "text-online" : "text-muted"}`}>
                                <Icon name="monitor" className="h-[18px] w-[18px]" />
                            </span>

                            <span className="min-w-0 flex-1 truncate text-[14.5px]">{name}</span>

                            {live && <span className="text-[13px] font-medium text-online">Sharing</span>}
                        </button>
                    );
                })}
            </div>
        </Overlay>
    );
}
