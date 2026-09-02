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

import { avatarColor } from "./theme";

export function Avatar(
{
    name,
    color,
    size,
    ring,
}: {
    name: string;
    color?: string;
    size?: number;
    ring?: boolean;
})
{
    const side = size ?? 36;

    return (
        <div
            className={`flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white/90 ${ring ? "speaking" : ""}`}
            style={{
                width: side,
                height: side,
                fontSize: side * 0.42,
                background: color ?? avatarColor(name),
            }}
        >
            {(name.trim()[0] ?? "?").toUpperCase()}
        </div>
    );
}

//A TOGGLE. THE TUI DREW THIS AS ●/○ BECAUSE A TERMINAL HAD NOTHING ELSE; A WINDOW HAS A SWITCH, AND A
//SWITCH SAYS WHICH WAY IS ON WITHOUT ANYBODY HAVING TO LEARN THE GLYPHS
export function Switch({ on, onClick }: { on: boolean; onClick: () => void })
{
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={(event) => { event.stopPropagation(); onClick(); }}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-online" : "bg-border-strong"}`}
        >
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
        </button>
    );
}

//THE LABEL OVER A GROUP OF ROWS IN EITHER SIDEBAR
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode })
{
    return (
        <div className="flex items-center gap-1 px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <span className="min-w-0 flex-1 truncate">{children}</span>
            {action}
        </div>
    );
}
