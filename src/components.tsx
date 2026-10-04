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
import { createPortal } from "react-dom";

import { avatarColor } from "./theme";
import { IconButton } from "./icons";
import { t } from "./i18n";

//HOLD MENUS ARE THIS WIDE
export const MENU_WIDTH = 224;

//ONE ROW OF A MENU
export const MENU_ITEM = "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent";

//A FACE: THEIR PICTURE, OR THEIR INITIAL ON A QUIET DISC OF THEIR COLOR
export function Avatar(
{
    name,
    color,
    size,
    ring,
    src,
}: {
    name: string;
    color?: string;
    size?: number;
    ring?: boolean;
    src?: string; //THEIR PICTURE, WHERE THEY HAVE ONE
})
{
    const side = size ?? 36;
    const hue = color ?? avatarColor(name);

    if (src)
    {
        return (
            <img
                src={src}
                alt={name}
                draggable={false}
                className={`shrink-0 select-none rounded-full object-cover ${ring ? "speaking" : ""}`}
                style={{ width: side, height: side }}
            />
        );
    }

    return (
        <div
            className={`flex shrink-0 select-none items-center justify-center rounded-full font-medium ${ring ? "speaking" : ""}`}
            style={{
                width: side,
                height: side,
                fontSize: Math.max(9, side * 0.44),
                color: `color-mix(in oklab, ${hue} 85%, var(--text))`,
                background: `color-mix(in oklab, ${hue} 22%, var(--raised))`,
            }}
        >
            {(name.trim()[0] ?? "?").toUpperCase()}
        </div>
    );
}

//A SERVER'S ICON, A ROUNDED SQUARE: ITS PICTURE, OR ITS INITIAL
export function SpaceIcon({ name, size, src }: { name: string; size: number; src?: string })
{
    const hue = avatarColor(name);

    if (src)
    {
        return (
            <img
                src={src}
                alt={name}
                draggable={false}
                className="shrink-0 select-none object-cover"
                style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
            />
        );
    }

    return (
        <span
            className="flex shrink-0 select-none items-center justify-center font-semibold text-white"
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.28),
                fontSize: size * 0.48,
                background: `linear-gradient(135deg, color-mix(in oklab, ${hue} 85%, white), color-mix(in oklab, ${hue} 85%, black))`,
            }}
        >
            {(name.trim()[0] ?? "?").toUpperCase()}
        </span>
    );
}

//A TOGGLE
export function Switch({ on, onClick }: { on: boolean; onClick: () => void })
{
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={(event) => { event.stopPropagation(); onClick(); }}
            className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? "bg-text" : "bg-active"}`}
        >
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full shadow-sm transition-all ${on ? "left-4 bg-chat" : "left-[2px] bg-white"}`} />
        </button>
    );
}

//THE LABEL OVER A GROUP OF ROWS
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode })
{
    return (
        <div className="label flex h-8 items-center gap-2 px-2.5">
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {action}
        </div>
    );
}

//A WINDOW OVER THE CONVERSATION; A PHONE GETS THE WHOLE SCREEN
export function Overlay(
{
    narrow, width, label, cardRef, onKeyDown, close, children,
}: {
    kind?: "sheet" | "modal";
    narrow: boolean;
    width: number;
    label: string;
    cardRef?: React.Ref<HTMLDivElement>;
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    close: () => void;
    children: React.ReactNode;
})
{
    const wrap = narrow
        ? "safe-top safe-bottom absolute inset-0 z-40 flex bg-overlay"
        : "absolute inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-8";

    const card = narrow
        ? "relative flex h-full w-full flex-col overflow-hidden bg-overlay outline-none"
        : "relative flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-border-strong bg-overlay shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)] outline-none";

    return (
        <div onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} className={wrap}>
            <div
                ref={cardRef}
                tabIndex={-1}
                role="dialog"
                aria-label={label}
                onKeyDown={onKeyDown ?? ((event) => { if (event.key === "Escape") { event.preventDefault(); close(); } })}
                className={card}
                style={narrow ? undefined : { maxWidth: width }}
            >
                {children}
            </div>
        </div>
    );
}

//THE HEAD OF A DIALOG
export function PanelHeader({ title, aside, close }: { kicker?: string; title: string; aside?: React.ReactNode; close: () => void })
{
    return (
        <header className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-4">
            <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{title}</h2>

            {aside}

            <IconButton icon="close" label={t("window.close")} onClick={close} />
        </header>
    );
}

export function PanelFooter({ children }: { children: React.ReactNode })
{
    return (
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
            {children}
        </footer>
    );
}

//A MENU AT A POINT, OUT OF ANY BOX THAT WOULD CLIP IT
export function MenuBox({ at, title, children }: { at: { x: number; y: number }; title?: React.ReactNode; children: React.ReactNode })
{
    return createPortal(
        <div
            data-hold-menu
            style={{ left: at.x, top: at.y, width: MENU_WIDTH }}
            className="fixed z-[70] overflow-hidden rounded-xl border border-border-strong bg-overlay p-1 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)]"
        >
            {title && <div className="truncate px-2 pb-1 pt-1.5 text-[12px] text-faint">{title}</div>}
            {children}
        </div>,
        document.body,
    );
}
