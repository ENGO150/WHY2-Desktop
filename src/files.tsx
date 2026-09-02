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

import type { FileOwner, ClientConfig } from "./types";
import { Icon, IconButton } from "./icons";
import { Avatar } from "./components";
import { fileKind } from "./format";

//A FILE LIST IS NOT A TREE AND IT IS NOT SOMETHING ANYBODY SAID - IT IS A DRAWER, AND A WINDOW LIKE THE
//SETTINGS DIALOG: THE OWNER IS A HEADING, THEIR FILES ARE ROWS, AND CLICKING ONE SENDS THE SAME
///download TYPING IT OUT WOULD HAVE. AN EMPTY ANSWER OPENS IT ANYWAY, SAYING SO - WHERE THE TUI PRINTS
//A LINE, A WINDOW THAT REFUSED TO OPEN WOULD LOOK LIKE A BUTTON THAT DOES NOTHING
export function FilesBox(
{
    files, filter, setFilter, config, filesRef, dialogWrap, dialogCard, send, refresh, close,
}: {
    files: FileOwner[];
    filter: string;
    setFilter: (value: string) => void;
    config: ClientConfig;
    filesRef: React.RefObject<HTMLDivElement | null>;
    dialogWrap: string;
    dialogCard: (wide: string) => string;
    send: (input: string) => void;
    refresh: () => void;
    close: () => void;
})
{
        const needle = filter.trim().toLowerCase();

        //THE SEARCH LOOKS AT BOTH HALVES OF WHAT A ROW SAYS - THE FILE'S NAME AND WHOSE IT IS - AND AN
        //OWNER WITH NOTHING LEFT TO SHOW DROPS OUT ALONG WITH THEIR HEADING
        const shown = files
            .map((owner) =>
            ({
                ...owner,
                files: owner.files.filter((file) => !needle
                    || file.name.toLowerCase().includes(needle)
                    || owner.username.toLowerCase().includes(needle)),
            }))
            .filter((owner) => owner.files.length > 0);

        const total = files.reduce((count, owner) => count + owner.files.length, 0);
        const matching = shown.reduce((count, owner) => count + owner.files.length, 0);

        return (
            <div
                onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
                className={dialogWrap}
            >
                <div
                    ref={filesRef}
                    tabIndex={-1}
                    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
                    className={`rise ${dialogCard("flex max-h-[84vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none")}`}
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                        <Icon name="folder" className="h-4 w-4 shrink-0 text-muted" />
                        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Files on the server</h2>

                        <span className="shrink-0 text-xs text-faint">
                            {needle ? `${matching} of ${total}` : `${total} ${total === 1 ? "file" : "files"}`}
                        </span>

                        <IconButton icon="close" label="Close" onClick={close} />
                    </header>

                    <div className="shrink-0 px-4 pt-3">
                        <input
                            autoFocus
                            value={filter}
                            onChange={(event) => setFilter(event.currentTarget.value)}
                            placeholder="Search files"
                            className="w-full rounded-app border border-border bg-deep px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-border-strong"
                            spellCheck={false}
                        />
                    </div>

                    <div className="scroller flex-1 px-2.5 py-2">
                        {shown.length === 0 && (
                            <div className="px-2 py-8 text-center text-sm text-faint">
                                {needle ? "Nothing here by that name." : "Nobody has a file up right now."}
                            </div>
                        )}

                        {shown.map((owner) => (
                            <div key={owner.id} className="mb-1 last:mb-0">
                                <div className="flex items-center gap-2 px-1.5 pb-1 pt-2">
                                    <Avatar name={owner.username} size={20} />
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted">{owner.username}</span>
                                    {config.show_id && <span className="shrink-0 font-mono text-[10px] text-faint">{owner.id}</span>}
                                </div>

                                {owner.files.map((file) =>
                                {
                                    const kind = fileKind(file.name);

                                    return (
                                        <button
                                            key={file.id}
                                            type="button"
                                            title={`Download ${file.name}`}
                                            onClick={() => send(`/download ${owner.id} ${file.id}`)}
                                            className="group flex w-full items-center gap-2.5 rounded-app px-1.5 py-1.5 text-left transition-colors hover:bg-hover"
                                        >
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-app bg-deep text-muted">
                                                <Icon name={kind.icon} className="h-4 w-4" />
                                            </span>

                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm">{file.name}</span>
                                                <span className="block text-[11px] text-faint">{kind.label}</span>
                                            </span>

                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-app text-faint transition-colors group-hover:bg-active group-hover:text-text">
                                                <Icon name="download" className="h-4 w-4" />
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                    {/* THE LIST IS A PHOTOGRAPH OF THE SERVER AT THE MOMENT IT WAS ASKED, SO THE WAY TO A
                        NEWER ONE IS TO ASK AGAIN - WHICH IS THE SAME /files THE HEADER'S FOLDER SENDS */}
                    <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/40 px-5 py-3">
                        <span className="flex-1 text-xs text-faint">A download starts where you keep them.</span>

                        <button
                            type="button"
                            onClick={refresh}
                            className="rounded-app border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-text"
                        >
                            Refresh
                        </button>
                    </footer>
                </div>
            </div>
        );
}
