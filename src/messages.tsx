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

import React from "react";

import type { ChatMessage, BlockRow, ClientConfig, MessageImage, PictureStatus, TransferInfo } from "./types";
import type { People } from "./profile";
import { ANSI } from "./theme";
import { Icon } from "./icons";
import { Avatar, MenuBox, MENU_ITEM } from "./components";
import { branches, clock, linkParts, sentAt } from "./format";
import { mentions } from "./palette";
import { deviceIcon } from "./roster";
import { parse, rows, ITALIC, BOLD, UNDERLINE, STRIKE, type Inline, type Row, type Shape } from "./markup";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { HeldMenu } from "./servers";
import { t, tn, language } from "./i18n";
import { VoiceNote, type Voices } from "./voice";

//SCREENS ABOVE AND BELOW THE VIEW WHOSE PICTURES AND HISTORY ARE LOADED (tui/consts.rs)
export const PRELOAD_SCREENS = 1;

//THE TALLEST A PICTURE IS DRAWN IN THE PANE
const PICTURE_HEIGHT = 340;

//A PICTURE AS ITS MENU HOLDS IT, WITH THE LINE IT CAME ON WHERE THERE IS ONE
export interface HeldPicture
{
    image: MessageImage;
    message: ChatMessage | null;
}

//WHAT A PICTURE IN THE PANE CAN BE ASKED TO DO. NONE OF IT IS THE MESSAGE'S OWN BUSINESS - ONE PUTS A
//PACKET ON THE WIRE, ONE OPENS A WINDOW AND ONE OPENS A MENU, AND ALL OF THEM BELONG TO THE COMPONENT
//THAT HOLDS THE STATE. hold IS THE RIGHT-CLICK AND THE LONG PRESS, WHICH IS servers.tsx' OWN GESTURE
//WITH A PICTURE IN IT INSTEAD OF A SERVER, AND held IS WHETHER THE PRESS THAT IS ENDING OPENED ONE -
//A HOLD ENDS IN A CLICK LIKE ANY OTHER, AND THAT ONE WOULD OPEN THE PICTURE BEING HELD
export interface Pictures
{
    show: (hash: string) => void;

    //A PICTURE THE CACHE ALREADY HOLDS, ASKED FOR BECAUSE ITS CAPTION IS ON SCREEN - NOBODY PRESSED
    //ANYTHING FOR THIS ONE
    load: (hash: string) => void;
    open: (event: React.MouseEvent, image: MessageImage, message: ChatMessage) => void;
    hold: (picture: HeldPicture) => Record<string, unknown>;
    held: () => boolean;
}

//AND THE SAME THREE THINGS FOR A LINE OF TEXT: WHAT COPYING ONE DOES, AND THE GESTURE THAT ASKS FOR IT
export interface Lines
{
    copy: (text: string) => void;
    hold: (message: ChatMessage) => Record<string, unknown>;
    held: () => boolean;

    //HEARTS AND REPLIES, WHERE THE SERVER KEEPS THE LINE
    reacts: (message: ChatMessage) => boolean;
    heart: (message_id: number) => void;
    reply: (message: ChatMessage) => void;
    edits: (message: ChatMessage) => boolean;
    edit: (message: ChatMessage) => void;
    target: (message_id: number) => ChatMessage | null;
    jump: (message_id: number) => void;
    tap: (event: React.MouseEvent, message: ChatMessage) => void;
    hearts: (message: ChatMessage) => Record<string, unknown>;
    heartsHeld: () => boolean;
}

//HEART AND REPLY, IN BOTH MENUS
function ReactItems({ message, heart, reply, hearted, close }: {
    message: ChatMessage | null;
    heart: ((message_id: number) => void) | null;
    reply: ((message: ChatMessage) => void) | null;
    hearted: boolean;
    close: () => void;
})
{
    if (message?.message_id == null) return null;

    return (
        <>
            {heart && (
                <button type="button" onClick={() => { close(); heart(message.message_id!); }} className={MENU_ITEM}>
                    <Icon name="heart" className={`h-[18px] w-[18px] ${hearted ? "fill-current text-heart" : "text-muted"}`} />
                    {hearted ? t("menu.unheart") : t("menu.heart")}
                </button>
            )}

            {reply && (
                <button type="button" onClick={() => { close(); reply(message); }} className={MENU_ITEM}>
                    <Icon name="reply" className="h-4 w-4 text-muted" />
                    {t("menu.reply")}
                </button>
            )}
        </>
    );
}

//THE MENU A LINE OPENS, HEADED BY THE LINE
export function MessageMenu(
{
    at, copy, heart, reply, hearted, edit, remove, close,
}: {
    at: HeldMenu<ChatMessage>;
    copy: (text: string) => void;
    heart: ((message_id: number) => void) | null;
    reply: ((message: ChatMessage) => void) | null;
    hearted: boolean;
    edit: ((message: ChatMessage) => void) | null;
    remove: ((message_id: number) => void) | null;
    close: () => void;
})
{
    const message = at.value;

    return (
        <MenuBox at={at} title={message.voice ? `${t("chat.voice_message")} · ${clock(message.voice.duration)}` : message.text}>
            <ReactItems message={message} heart={heart} reply={reply} hearted={hearted} close={close} />

            {!message.voice && (
                <button type="button" onClick={() => { close(); copy(message.text); }} className={MENU_ITEM}>
                    <Icon name="copy" className="h-4 w-4 text-muted" />
                    {t("menu.copy_text")}
                </button>
            )}

            {edit && (
                <button type="button" onClick={() => { close(); edit(message); }} className={MENU_ITEM}>
                    <Icon name="pencil" className="h-4 w-4 text-muted" />
                    {t("menu.edit")}
                </button>
            )}

            {remove && message.message_id !== null && (
                <>
                    <div className="mx-2 my-1 h-px bg-border" />

                    <button type="button" onClick={() => { close(); remove(message.message_id!); }} className={`${MENU_ITEM} text-error`}>
                        <Icon name="trash" className="h-4 w-4" />
                        {t("menu.delete_message")}
                    </button>
                </>
            )}
        </MenuBox>
    );
}

//WHO HEARTED A LINE
export function HeartsMenu(
{
    at, username, people, color, heart, close,
}: {
    at: HeldMenu<ChatMessage>;
    username: string;
    people: People;
    color: (name: string) => string | undefined;
    heart: ((message_id: number) => void) | null;
    close: () => void;
})
{
    const message = at.value;
    const hearted = message.hearts.includes(username);

    return (
        <MenuBox
            at={at}
            title={(
                <span className="flex items-center gap-2">
                    <Icon name="heart" className="h-3.5 w-3.5 fill-current text-heart" />
                    {tn("menu.hearts", message.hearts.length)}
                </span>
            )}
        >
            <div className="scroller max-h-64">
                {message.hearts.map((name) => (
                    <button key={name} type="button" onClick={() => { close(); people.open(name, null); }} className={MENU_ITEM}>
                        <Avatar name={name} color={color(name)} size={20} src={people.avatar(name)} />
                        <span className="min-w-0 flex-1 truncate" style={{ color: color(name) }}>{name}</span>
                        {name === username && <span className="text-[12px] text-faint">{t("menu.you")}</span>}
                    </button>
                ))}
            </div>

            {heart && message.message_id !== null && (
                <>
                    <div className="mx-2 my-1 h-px bg-border" />

                    <button type="button" onClick={() => { close(); heart(message.message_id!); }} className={MENU_ITEM}>
                        <Icon name="heart" className={`h-[18px] w-[18px] ${hearted ? "fill-current text-heart" : "text-muted"}`} />
                        {hearted ? t("menu.unheart") : t("menu.heart")}
                    </button>
                </>
            )}
        </MenuBox>
    );
}

//A PICTURE'S MENU: PUT IT ON THE CLIPBOARD OR THE DISK
export function PictureMenu(
{
    at, copy, save, heart, reply, hearted, remove, close,
}: {
    at: HeldMenu<HeldPicture>;
    copy: ((image: MessageImage) => void) | null;
    save: (image: MessageImage) => void;
    heart: ((message_id: number) => void) | null;
    reply: ((message: ChatMessage) => void) | null;
    hearted: boolean;
    remove: ((message_id: number) => void) | null;
    close: () => void;
})
{
    const { image, message } = at.value;

    return (
        <MenuBox at={at} title={image.filename}>
            <ReactItems message={message} heart={heart} reply={reply} hearted={hearted} close={close} />

            {copy && (
                <button type="button" onClick={() => { close(); copy(image); }} className={MENU_ITEM}>
                    <Icon name="copy" className="h-4 w-4 text-muted" />
                    {t("menu.copy_image")}
                </button>
            )}

            <button type="button" onClick={() => { close(); save(image); }} className={MENU_ITEM}>
                <Icon name="download" className="h-4 w-4 text-muted" />
                {t("menu.save_image")}
            </button>

            {remove && message?.message_id != null && (
                <>
                    <div className="mx-2 my-1 h-px bg-border" />

                    <button type="button" onClick={() => { close(); remove(message.message_id!); }} className={`${MENU_ITEM} text-error`}>
                        <Icon name="trash" className="h-4 w-4" />
                        {t("menu.delete_image")}
                    </button>
                </>
            )}
        </MenuBox>
    );
}

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
                className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent"
            >
                {part.text}
            </a>
        )
        : <span key={index}>{part.text}</span>));
}

//A FENCED BLOCK. THE LANGUAGE IS USED AND NOT ONLY SHOWN - THE TUI PRINTS IT BECAUSE A TERMINAL HAS
//NOTHING TO HIGHLIGHT WITH, AND A WINDOW DOES - BUT ONLY WHERE THE FENCE NAMED ONE THE HIGHLIGHTER KNOWS:
//GUESSING IS TRYING EVERY GRAMMAR IT HAS AGAINST THREE LINES SOMEBODY PASTED, WHICH IS SLOW AND USUALLY
//WRONG. WHAT COMES BACK IS HTML highlight.js ESCAPED ITSELF, WHICH IS THE ONLY REASON IT MAY BE SET AS
//MARKUP - NOTHING OFF THE NETWORK IS EVER PUT IN A PAGE WITHOUT PASSING THROUGH IT
const CodeBlock = React.memo(function CodeBlock({ lang, body }: { lang: string | null; body: string })
{
    const language = lang && hljs.getLanguage(lang) ? lang : null;

    const painted = language ? hljs.highlight(body, { language, ignoreIllegals: true }).value : null;

    return (
        <div className="code-block">
            {lang && <div className="code-lang">{lang}</div>}

            <pre className="font-mono">
                {painted !== null
                    ? <code dangerouslySetInnerHTML={{ __html: painted }} />
                    : <code>{body}</code>}
            </pre>
        </div>
    );
});

//A FORMULA. THE TUI LAYS TeX OUT IN CELLS BECAUSE A TERMINAL HAS NOTHING ELSE; A WINDOW HAS A BROWSER IN
//IT, SO THIS IS REAL KaTeX AND NOT AN APPROXIMATION OF ONE - THE SAME $…$ AND $$…$$ THE CRATE'S PARSER
//FINDS, SET THE WAY THEY WOULD BE ANYWHERE ELSE. THE STRING IS OFF THE NETWORK, WHICH IS THE WHOLE OF WHY
//THE OPTIONS LOOK LIKE THIS: NOTHING IS TRUSTED (NO \href, NO RAW HTML), THE EXPANSION AND THE SIZES ARE
//BOUNDED, AND A FORMULA THAT WILL NOT PARSE IS DRAWN AS THE SOURCE SOMEBODY TYPED RATHER THAN THROWING
const Formula = React.memo(function Formula({ tex, display }: { tex: string; display: boolean })
{
    const html = katex.renderToString(tex,
    {
        displayMode: display,
        throwOnError: false,
        errorColor: "#ae5c68",
        strict: false,
        trust: false,
        maxSize: 20,
        maxExpand: 1000,
    });

    //INLINE MATH SITS IN THE SENTENCE IT WAS TYPED IN; DISPLAY MATH OWNS ITS ROWS, AND IS THE ONE THING
    //HERE THAT CAN BE WIDER THAN THE PANE - SO IT SCROLLS ON ITS OWN, THE WAY A BLOCK DOES
    return display
        ? <div className="math-display" dangerouslySetInnerHTML={{ __html: html }} />
        : <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
});

//EVERY EMPHASIS A PIECE OF TEXT IS INSIDE OF, AS THE ELEMENTS THAT MEAN THEM. THE TERMINAL SAYS THE SAME
//THING IN ONE Modifier SET, SINCE A CELL HAS NO NESTING - HERE THEY STACK, AND THE ORDER IS FIXED SO THAT
//THE SAME MESSAGE IS ALWAYS THE SAME TREE
function emphasize(node: React.ReactNode, modifier: number): React.ReactNode
{
    let out = node;

    if (modifier & ITALIC) out = <em>{out}</em>;
    if (modifier & BOLD) out = <strong>{out}</strong>;
    if (modifier & UNDERLINE) out = <u>{out}</u>;
    if (modifier & STRIKE) out = <s>{out}</s>;

    return out;
}

//ONE PIECE OF A ROW. AN ESCAPED CHARACTER IS NOT LINKIFIED - IT IS A CHARACTER SOMEBODY TYPED OUT, AND
//THE AUTO-LINKING IS FOR WHAT THEY DID NOT
function renderInline(node: Inline, index: number): React.ReactNode
{
    if (node.kind === "code")
    {
        return <code key={index} className="code-inline font-mono">{emphasize(node.text, node.modifier)}</code>;
    }

    if (node.kind === "math") return <Formula key={index} tex={node.text} display={false} />;

    //A LINK IS A LINK, WHICH IS WHAT A WINDOW HAS AND A TERMINAL DOES NOT: THE TUI PRINTS THE TARGET IN
    //BRACKETS BESIDE THE TEXT BECAUSE NOTHING THERE CAN BE CLICKED. THE TWO SCHEMES ARE THE ONLY ONES
    //OPENED ANYWHERE IN HERE (SEE linkParts) - ANYTHING ELSE IS THE LABEL AS TEXT, TARGET AND ALL
    if (node.kind === "link")
    {
        if (!/^https?:\/\//i.test(node.url)) return <span key={index} title={node.url}>{node.text}</span>;

        return (
            <a
                key={index}
                href={node.url}
                title={node.url}
                onClick={(event) => { event.preventDefault(); openUrl(node.url).catch(() => {}); }}
                className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent"
            >
                {node.text}
            </a>
        );
    }

    return <span key={index}>{emphasize(node.linkify ? linked(node.text) : node.text, node.modifier)}</span>;
}

function renderNodes(nodes: Inline[]): React.ReactNode
{
    return nodes.map((node, index) => renderInline(node, index));
}

//WHAT A ROW IS INDENTED BY, WHERE IT WAS TYPED WITH SPACES IN FRONT OF ITS MARKER. THE TERMINAL PADS
//THE ROW OUT BY HAND; A LIST INSIDE A LIST IS THE ONLY THING ANYBODY MEANS BY IT
function indented(shape: Shape): React.CSSProperties | undefined
{
    const indent = shape.kind === "plain" ? 0 : shape.indent;

    return indent > 0 ? { marginInlineStart: `${indent * 0.6}em` } : undefined;
}

//A MESSAGE AS IT IS READ. WHAT SOMEBODY TYPED GOES THROUGH tui/markup.rs' PARSER (markup.ts IS THAT FILE
//REWRITTEN), SO A FENCE IS A BLOCK, A BACKTICK IS A RUN OF CODE AND A HASH IS A HEADING HERE THE SAME WAY
//THEY ARE THERE - AND WHAT IS LEFT IS TEXT, WITH WHATEVER LOOKED LIKE A LINK IN IT DRAWN AS ONE.
//THE TERMINAL DRAWS THE LINE-LEVEL MARKDOWN AS THE GLYPHS A CELL GRID HAS (A BULLET, A QUOTE'S EDGE, A
//RULE OF BOX-DRAWING); A WINDOW HAS THE ELEMENTS THEMSELVES, SO A LIST IS A LIST AND A QUOTE IS A
//BLOCKQUOTE - THE SAME ROWS, DRAWN WITH WHAT THIS SIDE ACTUALLY HAS
export function markup(text: string, render_math: boolean): React.ReactNode
{
    const segments = parse(text, render_math);

    //NOTHING IN IT, WHICH IS ALMOST EVERY LINE - THE ROWS AND THE KEYS ARE NOT WORTH BUILDING
    //A ROW STARTING WITH ONE OF THESE MAY CARRY A MARKER OR BE A RULE, AND NOTHING ELSE CAN
    if (segments.length === 1 && segments[0].kind === "text" && !/^ *[#>*+_\-0-9]/m.test(text))
    {
        return linked(text);
    }

    return renderRows(rows(segments));
}

//THE ROWS, WITH WHAT BELONGS TOGETHER GROUPED: A RUN OF LIST ROWS IS ONE LIST AND A RUN OF QUOTED ONES IS
//ONE QUOTE, WHICH IS THE ONE THING A WINDOW HAS TO DECIDE THAT A TERMINAL DRAWING ROW BY ROW DOES NOT.
//PLAIN ROWS ARE JOINED BY THE NEWLINE THEY WERE TYPED WITH - THE PANE IS pre-wrap, SO NOTHING ELSE IS
//NEEDED FOR THEM, AND A BLOCK ELEMENT BREAKS THE LINE BY ITSELF
function renderRows(list: Row[]): React.ReactNode
{
    const out: React.ReactNode[] = [];
    let index = 0;

    while (index < list.length)
    {
        const row = list[index];

        if (row.kind === "rule") { out.push(<hr key={out.length} className="md-rule" />); index++; continue; }

        if (row.kind === "block") { out.push(<CodeBlock key={out.length} lang={row.lang} body={row.body} />); index++; continue; }

        if (row.kind === "display") { out.push(<Formula key={out.length} tex={row.text} display />); index++; continue; }

        const shape = row.shape;

        if (shape.kind === "heading")
        {
            const Tag = `h${shape.level}` as "h1" | "h2" | "h3";

            out.push(<Tag key={out.length} className={`md-heading md-h${shape.level}`} style={indented(shape)}>{renderNodes(row.nodes)}</Tag>);
            index++;

            continue;
        }

        //THE THREE THAT RUN TOGETHER. A QUOTE KEEPS THE NEWLINES INSIDE IT, SINCE ITS ROWS ARE ONE
        //PARAGRAPH BEHIND ONE EDGE; A LIST'S ROWS ARE ITEMS AND EACH OF THEM IS ITS OWN ELEMENT
        const run: Row[] = [];
        while (index < list.length)
        {
            const next = list[index];

            if (next.kind !== "row" || next.shape.kind !== shape.kind) break;

            run.push(next);
            index++;
        }

        if (shape.kind === "quote")
        {
            out.push(
                <blockquote key={out.length} className="md-quote" style={indented(shape)}>
                    {run.map((quoted, at) => (
                        <React.Fragment key={at}>
                            {at > 0 && "\n"}
                            {quoted.kind === "row" && renderNodes(quoted.nodes)}
                        </React.Fragment>
                    ))}
                </blockquote>,
            );

            continue;
        }

        if (shape.kind === "bullet" || shape.kind === "ordinal")
        {
            const items = run.map((item, at) => (item.kind === "row" && (
                <li key={at} className="md-item" style={indented(item.shape)}
                    value={item.shape.kind === "ordinal" ? item.shape.number : undefined}>
                    {renderNodes(item.nodes)}
                </li>
            )));

            out.push(shape.kind === "bullet"
                ? <ul key={out.length} className="md-list">{items}</ul>
                : <ol key={out.length} className="md-list" start={shape.number}>{items}</ol>);

            continue;
        }

        //PLAIN, AND THE NEWLINES BETWEEN THEM
        out.push(
            <span key={out.length}>
                {run.map((plain, at) => (
                    <React.Fragment key={at}>
                        {at > 0 && "\n"}
                        {plain.kind === "row" && renderNodes(plain.nodes)}
                    </React.Fragment>
                ))}
            </span>,
        );
    }

    return out;
}

//THE LINE BEING TYPED, AS THE PANE WILL DRAW IT
export function MarkupPreview({ text, config }: { text: string; config: ClientConfig })
{
    return (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-border-strong bg-overlay shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)]">
            <div className="scroller select-text whitespace-pre-wrap break-words px-4 py-3 text-[15px] leading-[1.6]" style={{ maxHeight: "40vh" }}>
                {markup(text, config.render_math)}
            </div>
        </div>
    );
}

//A PROTOCOL COLOR, UNLESS THE CONFIG TURNED THEM OFF
export function messageColor(config: ClientConfig, code: number | null): string | undefined
{
    return code === null || config.disable_colors ? undefined : ANSI[code];
}

//A DIVIDER WHERE THE DAY CHANGES
export function renderDay(timestamp: number, key: string)
{
    const date = new Date(timestamp * 1000);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);

    const label = date.toDateString() === today.toDateString()
        ? t("chat.today")
        : date.toDateString() === yesterday.toDateString()
            ? t("chat.yesterday")
            : date.toLocaleDateString(language(), { weekday: "long", day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });

    return <div key={key} className="day">{label}</div>;
}

//A LINE NOBODY SAID
export function renderNotice(message: ChatMessage, key: number)
{
    const { tone, icon } =
    {
        plain: { tone: "text-text", icon: "info" },
        system: { tone: "text-muted", icon: "info" },
        notice: { tone: "text-notice", icon: "info" },
        ok: { tone: "text-muted", icon: "check" },
        error: { tone: "text-error", icon: "alert" },
        title: { tone: "text-text font-medium", icon: "chevron_right" },
        user: { tone: "", icon: "info" },
        private: { tone: "", icon: "info" },
    }[message.kind];

    return (
        <div key={key} className={`note ${message.kind === "title" ? "head" : ""}`}>
            <span className="flex justify-center pt-[2px]">
                <Icon name={icon} className={`h-4 w-4 ${message.kind === "error" ? "text-error" : "text-faint"}`} />
            </span>

            <span className={`select-text whitespace-pre-wrap break-words ${tone}`}>{linked(message.text)}</span>
        </div>
    );
}

//BYTES AS SOMETHING READABLE (tui/theme.rs::size)
function size(bytes: number): string
{
    const units = ["B", "KB", "MB", "GB"];

    let value = bytes;
    let unit = 0;

    while (value >= 1000 && unit < units.length - 1)
    {
        value /= 1000;
        unit += 1;
    }

    return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

//A FILE ON ITS WAY
export function renderTransfer(transfer: TransferInfo | undefined, key: number)
{
    if (!transfer) return null;

    const { upload, image, avatar, icon, filename, done, total, outcome } = transfer;

    const percent = total === 0 ? 100 : Math.floor((Math.min(done, total) * 100) / total);

    const state = outcome === null
        ? t(upload ? "chat.transfer.uploading" : "chat.transfer.downloading", { percent, size: size(total) })
        : outcome ? t(upload ? "chat.transfer.uploaded" : "chat.transfer.downloaded", { size: size(total) }) : t("chat.transfer.failed");

    return (
        <div key={key} className="note">
            <span className="flex justify-center pt-[12px]">
                <Icon name={upload ? "upload" : "download"} className="h-4 w-4 text-faint" />
            </span>

            <div className="my-1 w-full max-w-[380px] rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-center gap-3">
                    <Icon name={image || avatar || icon ? "image" : "file"} className="h-5 w-5 shrink-0 text-muted" />

                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-text">{avatar ? t("chat.transfer.avatar") : icon ? t("chat.transfer.icon") : filename}</span>
                        <span className={`block text-[12px] ${outcome === false ? "text-error" : "text-faint"}`}>{state}</span>
                    </span>
                </div>

                {outcome === null && (
                    <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-active">
                        <div className="h-full rounded-full bg-text transition-[width] duration-200" style={{ width: `${percent}%` }} />
                    </div>
                )}
            </div>
        </div>
    );
}

//A PICTURE, OR THE CAPTION STANDING IN FOR ONE
export function renderPicture(message: ChatMessage, image: MessageImage, status: PictureStatus, pictures: Pictures)
{
    if (image.source)
    {
        return (
            <button
                type="button"
                title={image.filename}
                {...pictures.hold({ image, message })}
                onClick={(event) => { if (!pictures.held()) pictures.open(event, image, message); }}
                className="picture-hold mt-1 block max-w-full overflow-hidden rounded-lg border border-border transition hover:opacity-95"
            >
                <img
                    src={image.source}
                    alt={image.filename}
                    width={image.width || undefined}
                    height={image.height || undefined}
                    style={pictureBox(image)}
                    className="block max-h-[340px] w-auto max-w-full object-contain"
                />
            </button>
        );
    }

    return <Caption image={image} status={status} pictures={pictures} />;
}

//ITS SIZE BEFORE IT IS DECODED
function pictureBox(image: MessageImage): React.CSSProperties | undefined
{
    if (!image.width || !image.height) return undefined;

    return { width: Math.min(image.width, PICTURE_HEIGHT * image.width / image.height), aspectRatio: `${image.width} / ${image.height}` };
}

//A NAMED PICTURE, LOADED ONCE IT IS NEAR THE VIEW
function Caption({ image, status, pictures }: { image: MessageImage; status: PictureStatus; pictures: Pictures })
{
    const row = React.useRef<HTMLDivElement>(null);
    const asked = React.useRef(false);

    React.useEffect(() =>
    {
        const node = row.current;

        if (status !== "deferred" || !node || asked.current) return;

        //THE PANE, GROWN BY PRELOAD_SCREENS EACH WAY
        const observer = new IntersectionObserver((entries) =>
        {
            if (!entries.some((entry) => entry.isIntersecting) || asked.current) return;

            asked.current = true;
            pictures.load(image.hash!);
        }, { root: node.closest(".scroller"), rootMargin: `${PRELOAD_SCREENS * 100}% 0px` });

        observer.observe(node);

        return () => observer.disconnect();
    }, [status]);

    const loading = status === "waiting" || status === "deferred";

    return (
        <div ref={row} className="mt-1 inline-flex max-w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-[14px]">
            {loading
                ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-faint border-t-text" />
                : <Icon name="image" className="h-4 w-4 shrink-0 text-muted" />}

            <span className="min-w-0 truncate">{image.filename}</span>
            {status === "gone" && <span className="shrink-0 text-[12.5px] text-error">{t("chat.unavailable")}</span>}

            {!loading && image.hash && (
                <button type="button" onClick={() => pictures.show(image.hash!)} className="shrink-0 text-[13px] font-medium text-accent hover:underline">
                    {status === "gone" ? t("chat.retry") : t("chat.show")}
                </button>
            )}
        </div>
    );
}

//SOMETHING SOMEBODY SAID. grouped CONTINUES A RUN
export function renderChat(message: ChatMessage, key: number, grouped: boolean, config: ClientConfig, username: string, dm: boolean,
    picture: PictureStatus, pictures: Pictures, lines: Lines, people: People, compact: boolean, voices: Voices)
{
    //OUR OWN PM ECHO IS OURS
    const author = message.direct?.outgoing ? username : message.username;

    const own = author === username;

    //PRIVATE IS ONLY NEWS OUTSIDE A CONVERSATION
    const whisper = message.kind === "private" && !dm;

    const color = messageColor(config, message.username_color);

    //A PICTURE OR A CLIP IS NOT TEXT TO COPY
    const copyable = !message.image && !message.voice;

    //A PICTURE HAS ITS OWN MENU
    const holdable = !message.image;

    //THE BODY'S COLOR, ALSO FOR HEADINGS
    const body = messageColor(config, message.message_color);

    const messageId = config.show_message_ids && message.message_id !== null ? `#${message.message_id}` : null;
    const time = config.show_timestamps && message.timestamp !== null ? message.timestamp : null;

    const reacts = lines.reacts(message);
    const hearted = message.hearts.includes(username);
    const target = message.reply !== null ? lines.target(message.reply) : null;

    //SOMEBODY ELSE NAMING OR ANSWERING US
    const mentioned = !own && ((!message.image && mentions(message.text, username)) || target?.username === username);

    //THE CLICK THAT ENDS A HOLD IS SWALLOWED ON THE WAY DOWN
    const swallowHeld = (event: React.MouseEvent) =>
    {
        if (!lines.held()) return;

        event.preventDefault();
        event.stopPropagation();
    };

    const full = time !== null ? new Date(time * 1000).toLocaleString(language()) : undefined;

    return (
        <div
            key={key}
            {...(holdable ? lines.hold(message) : {})}
            data-message-id={message.message_id ?? undefined}
            onClickCapture={holdable ? swallowHeld : undefined}
            onClick={reacts ? (event) => lines.tap(event, message) : undefined}
            className={`group msg ${grouped ? "" : "first"} ${mentioned ? "mention" : whisper ? "whisper" : ""}`}
        >
            <div>
                {grouped
                    ? time !== null && <div className="msg-time" title={full}>{sentAt(time, true)}</div>
                    : (
                        <button
                            type="button"
                            aria-label={t("card.of", { username: author })}
                            onClick={(event) => people.open(author, event.currentTarget)}
                            className="mt-0.5 block rounded-full transition hover:opacity-85"
                        >
                            <Avatar name={author} color={color} size={compact ? 30 : 32} src={people.avatar(author)} />
                        </button>
                    )}
            </div>

            <div className="min-w-0">
                {!grouped && (
                    <div className="flex items-baseline gap-2">
                        <button
                            type="button"
                            onClick={(event) => people.open(author, event.currentTarget)}
                            className="min-w-0 truncate text-[14px] font-semibold hover:underline"
                            style={{ color }}
                        >
                            {author}
                        </button>

                        {config.show_id && message.id !== null && <span className="text-[12px] text-faint">{message.id}</span>}
                        {whisper && <span className="text-[12px] text-accent">{t("chat.private")}</span>}
                        {time !== null && <span className="shrink-0 text-[12px] text-faint" title={full}>{sentAt(time, true)}</span>}
                    </div>
                )}

                {message.reply !== null && replyQuote(message.reply, target, config, lines)}

                <div className="flex items-end gap-2">
                    <div
                        className="message-body min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-[15px] leading-[1.6]"
                        style={{ color: body, "--msg-color": body } as React.CSSProperties}
                    >
                        {message.image
                            ? renderPicture(message, message.image, picture, pictures)
                            : message.voice
                                ? <VoiceNote voice={message.voice} voices={voices} />
                                : markup(message.text, config.render_math)}
                    </div>

                    {(messageId || message.edited) && (
                        <span className="shrink-0 whitespace-nowrap text-[11.5px] leading-6 text-faint">
                            {message.edited && t("message.edited")}
                            {message.edited && messageId && " · "}
                            {messageId}
                        </span>
                    )}
                </div>

                {/* WHO HEARTED IT */}
                {message.hearts.length > 0 && (
                    <button
                        type="button"
                        title={message.hearts.join(", ")}
                        aria-disabled={!reacts}
                        {...heartsHold(lines.hearts(message))}
                        onClick={() => { if (!lines.heartsHeld() && reacts) lines.heart(message.message_id!); }}
                        className={`mb-0.5 mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12.5px] transition-colors ${reacts ? "" : "cursor-default"} ${hearted
                            ? "border-heart/40 bg-heart/10 text-heart"
                            : `border-border-strong text-muted ${reacts ? "hover:bg-hover" : ""}`}`}
                    >
                        <Icon name="heart" className={`h-3.5 w-3.5 ${hearted ? "fill-current" : ""}`} />
                        {message.hearts.length}
                    </button>
                )}
            </div>

            {/* ON HOVER; A HOLD ON A PHONE */}
            {(copyable || reacts) && (
                <div className="row-action absolute -top-3.5 right-3 z-10 flex rounded-lg border border-border-strong bg-overlay p-0.5 text-muted shadow-[0_6px_18px_-6px_rgba(0,0,0,0.4)]">
                    {reacts && rowButton(hearted ? t("menu.unheart") : t("menu.heart"), "heart", () => lines.heart(message.message_id!),
                        hearted ? "fill-current text-heart" : "")}
                    {reacts && rowButton(t("menu.reply"), "reply", () => lines.reply(message))}
                    {lines.edits(message) && rowButton(t("menu.edit"), "pencil", () => lines.edit(message))}
                    {copyable && rowButton(t("menu.copy"), "copy", () => lines.copy(message.text))}
                </div>
            )}
        </div>
    );
}

//THE CHIP'S OWN HOLD, KEPT OFF THE ROW'S
function heartsHold(bind: Record<string, unknown>)
{
    const own = (handler: unknown) => (event: React.SyntheticEvent) =>
    {
        event.stopPropagation();
        (handler as (event: React.SyntheticEvent) => void)(event);
    };

    return {
        onContextMenu: own(bind.onContextMenu),
        onTouchStart: own(bind.onTouchStart),
        onTouchEnd: own(bind.onTouchEnd),
        onTouchMove: own(bind.onTouchMove),
    };
}

//ONE BUTTON OF THE HOVER BAR
function rowButton(label: string, icon: string, onClick: () => void, tone = "")
{
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-text"
        >
            <Icon name={icon} className={`h-[15px] w-[15px] ${tone}`} />
        </button>
    );
}

//THE LINE A REPLY ANSWERS, ONE ROW
function replyQuote(reply: number, target: ChatMessage | null, config: ClientConfig, lines: Lines)
{
    const text = target?.image ? t("chat.picture") : target?.voice ? t("chat.voice_message") : target?.text.split("\n")[0] ?? t("chat.message_number", { id: reply });

    return (
        <button
            type="button"
            onClick={() => lines.jump(reply)}
            className="mb-0.5 mt-0.5 flex w-full min-w-0 items-center gap-2 text-left text-[13px] text-muted transition-colors hover:text-text"
        >
            <Icon name="reply" className="h-3.5 w-3.5 shrink-0 -scale-x-100 text-faint" />
            {target && <span className="shrink-0 font-medium" style={{ color: messageColor(config, target.username_color) }}>{target.username}</span>}
            <span className="min-w-0 truncate">{text}</span>
        </button>
    );
}

//A LIST THE SERVER ANSWERED WITH, AS A TREE
export function renderBlock(title: string, rows: BlockRow[], key: number, config: ClientConfig)
{
    const glyphs = branches(rows);

    //EACH LEVEL'S IDS LINE UP
    const widths = rows.reduce<Record<number, number>>((widths, row) =>
    {
        const width = row.id === null ? 1 : String(row.id).length;
        widths[row.depth] = Math.max(widths[row.depth] ?? 1, width);

        return widths;
    }, {});

    return (
        <div key={key} className="note head">
            <span className="flex justify-center pt-[12px]">
                <Icon name="menu" className="h-4 w-4 text-faint" />
            </span>

            <div className="w-fit max-w-full rounded-lg border border-border px-4 py-3 text-text">
                <div className="mb-2 text-[13.5px] font-medium">{title}</div>

                {rows.map((row, index) =>
                {
                    const color = messageColor(config, row.color);
                    const device = row.device ? deviceIcon(row.device) : null;

                    return (
                        <div key={index} className="flex items-start whitespace-pre-wrap py-[1px] font-mono text-[12.5px] leading-5">
                            <span className="shrink-0 whitespace-pre text-faint/60">{glyphs[index]}</span>
                            {row.id !== null && <span className="shrink-0 whitespace-pre text-faint">{String(row.id).padStart(widths[row.depth])}{"  "}</span>}
                            <span className={`min-w-0 break-words ${color ? "" : row.accent ? "text-accent" : ""}`} style={color ? { color } : undefined}>{row.text}</span>
                            {device && <Icon name={device} className="mx-1.5 mt-[3px] h-3.5 w-3.5 shrink-0 text-faint" />}
                            {row.note && <span className="text-faint">{"  "}{row.note}</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
