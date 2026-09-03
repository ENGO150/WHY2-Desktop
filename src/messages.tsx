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

import type { ChatMessage, BlockRow, ClientConfig } from "./types";
import { ANSI } from "./theme";
import { Icon } from "./icons";
import { Avatar } from "./components";
import { branches, linkParts } from "./format";
import { openUrl } from "@tauri-apps/plugin-opener";

//A LINE AS IT IS READ: THE TEXT, WITH WHATEVER LOOKED LIKE A LINK IN IT DRAWN AS ONE. IT OPENS IN THE
//SYSTEM BROWSER RATHER THAN IN HERE - THIS WINDOW IS A CHAT CLIENT AND NOT A BROWSER, AND A PAGE THAT
//REPLACED IT WOULD TAKE THE SESSION WITH IT. THE href IS KEPT ON THE ELEMENT FOR THE HOVER AND THE
//CONTEXT MENU, AND THE DEFAULT NAVIGATION IS THE ONE THING IT MUST NOT DO
export function linked(text: string): React.ReactNode
{
    const parts = linkParts(text);

    if (parts.length === 1 && !parts[0].href) return text;

    return parts.map((part, index) => (part.href
        ? (
            <a
                key={index}
                href={part.href}
                onClick={(event) => { event.preventDefault(); openUrl(part.href!).catch(() => {}); }}
                className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
            >
                {part.text}
            </a>
        )
        : <span key={index}>{part.text}</span>));
}

//WHAT A LINE IS PAINTED IN, WHERE ANYTHING IS: THE PROTOCOL'S SIXTEEN, AND NOTHING AT ALL WHERE THE
//CONFIG TURNED THE MESSAGE COLORS OFF
export function messageColor(config: ClientConfig, code: number | null): string | undefined
{
    return code === null || config.disable_colors ? undefined : ANSI[code];
}

    //A LINE NOBODY SAID: A JOIN, AN UPLOAD, A SERVER NOTICE, THE ANSWER TO A COMMAND. IT GETS THE COLUMN
    //THE AVATARS SIT IN, SO THE TEXT OF THE WHOLE PANE STAYS UNDER ONE EDGE
export function renderNotice(message: ChatMessage, key: number)
    {
        const { tone, icon } =
        {
            system: { tone: "text-muted", icon: "info" },
            notice: { tone: "text-notice", icon: "info" },
            ok: { tone: "text-ok", icon: "check" },
            error: { tone: "text-error", icon: "alert" },
            user: { tone: "", icon: "info" },
            private: { tone: "", icon: "info" },
        }[message.kind];

        return (
            <div key={key} className="flex gap-4 border-l-2 border-transparent px-4 py-[3px] hover:bg-hover">
                <div className="flex w-9 shrink-0 justify-end pt-[3px]">
                    <Icon name={icon} className={`h-4 w-4 ${tone}`} />
                </div>
                <div className={`min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed ${tone}`}>
                    {message.prefix && <span className="text-faint">{message.prefix} </span>}
                    {linked(message.text)}
                </div>
            </div>
        );
}

    //SOMETHING SOMEBODY SAID. THE RUN OF LINES BY ONE PERSON IS ONE BLOCK WITH ONE FACE ON IT - grouped
    //IS EVERY LINE PAST THE FIRST, AND CARRIES NEITHER THE AVATAR NOR THE NAME AGAIN
export function renderChat(message: ChatMessage, key: number, grouped: boolean, config: ClientConfig, username: string, dm: boolean)
    {
        //THE ECHO OF A PM WE SENT NAMES THE PERSON IT WENT TO AND NOBODY ELSE, AND THE AUTHOR OF IT IS US
        const author = message.direct?.outgoing ? username : message.username;

        const own = author === username;

        //THE RULE DOWN THE SIDE IS WHAT SAYS A LINE IS PRIVATE. IN A CONVERSATION EVERY LINE IS, AND A
        //BADGE ON EVERY ONE OF THEM SAYS NOTHING THE COLUMN'S OWN HEADING HAS NOT SAID ALREADY
        const whisper = message.kind === "private" && !dm;

        //OUR OWN NAME IS PAINTED IN THE COLOUR WE PICKED, THE SAME AS EVERYBODY ELSE'S - THE TUI MAKES NO
        //EXCEPTION FOR THE PERSON READING AND NEITHER DOES THIS. THE ACCENT IS WHAT IS LEFT WHERE THERE IS
        //NO COLOUR TO USE (NOBODY PICKED ONE, OR disable_colors IS ON), SO "THIS ONE IS YOU" SURVIVES
        const color = messageColor(config, message.username_color);

        return (
            <div
                key={key}
                className={`flex gap-4 px-4 hover:bg-hover ${grouped ? "py-[1px]" : "mt-4 pb-[1px] pt-1"} ${whisper ? "border-l-2 border-accent bg-accent/[0.06]" : "border-l-2 border-transparent"}`}
            >
                <div className="w-9 shrink-0">
                    {!grouped && <Avatar name={author} color={messageColor(config, message.username_color)} />}
                </div>

                <div className="min-w-0 flex-1">
                    {!grouped && (
                        <div className="flex items-baseline gap-2">
                            <span
                                className={`text-[15px] font-semibold ${own && !color ? "text-accent" : ""}`}
                                style={{ color }}
                            >
                                {author}
                            </span>
                            {config.show_id && message.id !== null && <span className="text-[11px] text-faint">#{message.id}</span>}
                            {whisper && (
                                <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent">
                                    private
                                </span>
                            )}
                        </div>
                    )}

                    <div
                        className="select-text whitespace-pre-wrap break-words text-[15px] leading-relaxed"
                        style={{ color: messageColor(config, message.message_color) }}
                    >
                        {message.prefix && <span className="text-faint">{message.prefix} </span>}
                        {linked(message.text)}
                    </div>
                </div>
            </div>
        );
}

    //A LIST THE SERVER ANSWERED WITH. IT IS A CARD IN THE STREAM RATHER THAN A WINDOW OVER IT, AND THE
    //ROWS KEEP THE TERMINAL'S BRANCH GLYPHS - THEY ARE A TREE, AND A TREE IS WHAT THEY SHOULD LOOK LIKE
export function renderBlock(title: string, rows: BlockRow[], key: number)
    {
        const glyphs = branches(rows);

        //THE ID COLUMN IS AS WIDE AS THE WIDEST ID ON ITS OWN LEVEL, SO THE NAMES LINE UP UNDER EACH OTHER
        const widths = rows.reduce<Record<number, number>>((widths, row) =>
        {
            const width = row.id === null ? 1 : String(row.id).length;
            widths[row.depth] = Math.max(widths[row.depth] ?? 1, width);

            return widths;
        }, {});

        return (
            <div key={key} className="mx-4 mt-4 overflow-hidden rounded-app border border-border bg-raised">
                <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {title}
                </div>

                <div className="py-1">
                    {rows.map((row, index) => (
                        <div key={index} className="flex items-center whitespace-pre px-3 py-[3px] font-mono text-[13px]">
                            <span className="text-border-strong">{glyphs[index]}</span>
                            {row.id !== null && <span className="text-faint">{String(row.id).padStart(widths[row.depth])}{"  "}</span>}
                            <span className={row.accent ? "text-accent" : ""}>{row.text}</span>
                            {row.note && <span className="text-faint">{"  "}{row.note}</span>}
                        </div>
                    ))}
                </div>
            </div>
        );
}
