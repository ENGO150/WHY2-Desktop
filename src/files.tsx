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
import { Icon } from "./icons";
import { Avatar, Overlay, PanelHeader } from "./components";
import { fileKind } from "./format";
import { t } from "./i18n";

//WHAT IS UP FOR DOWNLOAD; A ROW SENDS THE SAME /download TYPING WOULD
export function FilesBox(
{
    files, filter, setFilter, config, filesRef, narrow, send, refresh, close,
}: {
    files: FileOwner[];
    filter: string;
    setFilter: (value: string) => void;
    config: ClientConfig;
    filesRef: React.RefObject<HTMLDivElement | null>;
    narrow: boolean;
    send: (input: string) => void;
    refresh: () => void;
    close: () => void;
})
{
    const needle = filter.trim().toLowerCase();

    //BY FILE NAME OR BY OWNER
    const shown = files
        .map((owner) =>
        ({
            ...owner,
            files: owner.files.filter((file) => !needle
                || file.name.toLowerCase().includes(needle)
                || owner.username.toLowerCase().includes(needle)),
        }))
        .filter((owner) => owner.files.length > 0);

    return (
        <Overlay narrow={narrow} width={500} label={t("files.title")} cardRef={filesRef} close={close}>
            <PanelHeader
                title={t("files.title")}
                aside={(
                    <button type="button" title={t("files.refresh")} aria-label={t("files.refresh")} onClick={refresh} className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text">
                        <Icon name="refresh" className="h-[18px] w-[18px]" />
                    </button>
                )}
                close={close}
            />

            <div className="shrink-0 px-6 pb-2 pt-2">
                <div className="relative">
                    <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />

                    <input
                        autoFocus={!narrow}
                        value={filter}
                        onChange={(event) => setFilter(event.currentTarget.value)}
                        placeholder={t("files.search")}
                        className="field pl-10"
                        spellCheck={false}
                    />
                </div>
            </div>

            <div className="scroller min-h-[200px] flex-1 px-3 pb-5">
                {shown.length === 0 && (
                    <div className="px-4 py-16 text-center text-[14px] text-faint">
                        {needle ? t("files.no_results") : t("files.none")}
                    </div>
                )}

                {shown.map((owner) => (
                    <div key={owner.id}>
                        <div className="flex items-center gap-2 px-3 pb-1 pt-4">
                            <Avatar name={owner.username} size={20} />
                            <span className="label min-w-0 truncate">{owner.username}</span>
                            {config.show_id && <span className="label ml-auto font-normal">{owner.id}</span>}
                        </div>

                        {owner.files.map((file) =>
                        {
                            const kind = fileKind(file.name);

                            return (
                                <button
                                    key={file.id}
                                    type="button"
                                    title={t("files.download", { name: file.name })}
                                    onClick={() => send(`/download ${owner.id} ${file.id}`)}
                                    className="group flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-hover"
                                >
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted">
                                        <Icon name={kind.icon} className="h-[18px] w-[18px]" />
                                    </span>

                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[14.5px]">{file.name}</span>
                                        <span className="block text-[12.5px] text-faint">{kind.label}</span>
                                    </span>

                                    <Icon name="download" className="h-[18px] w-[18px] shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                                </button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </Overlay>
    );
}
