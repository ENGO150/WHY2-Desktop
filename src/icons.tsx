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

//THE LINE ART. ONE COMPONENT AND A TABLE OF PATHS, BECAUSE AN ICON SET IS NOT WORTH A DEPENDENCY AND A
//STROKED 24×24 GRID IS WHAT EVERY ONE OF THESE WOULD HAVE BEEN ANYWAY
export const ICONS: Record<string, string[]> =
{
    hash: ["M4 9h16", "M4 15h16", "M10 3 8 21", "M16 3 14 21"],
    mic: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
    mic_off: ["M3 3l18 18", "M9 9.5V12a3 3 0 0 0 5.1 2.1", "M15 10.5V5a3 3 0 0 0-5.9-.7", "M19 10v2a7 7 0 0 1-10.9 5.8", "M12 19v3"],
    headset: ["M4 14v-2a8 8 0 0 1 16 0v2", "M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14z", "M20 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5V14z"],
    hangup: ["M3 3l18 18", "M4 14v-2a8 8 0 0 1 12.5-6.6", "M20 11v3", "M4 14h3v6H5.5A1.5 1.5 0 0 1 4 18.5V14z"],
    gear: ["M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.1-2.9H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.3 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.1V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.1 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z"],
    plus: ["M12 5v14", "M5 12h14"],
    folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"],
    users: ["M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
    send: ["M22 2 11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
    logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
    close: ["M18 6 6 18", "M6 6l12 12"],
    download: ["M12 3v12", "M7 11l5 5 5-5", "M4 20h16"],
    chevron: ["M6 9l6 6 6-6"],
    shield: ["M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z"],
    alert: ["M12 3 3 19h18L12 3z", "M12 9v4", "M12 16.5h.01"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    arrow_down: ["M12 5v14", "M6 13l6 6 6-6"],
    speaker: ["M11 5 6 9H3v6h3l5 4V5z", "M15.5 9.5a3.5 3.5 0 0 1 0 5", "M18.5 6.5a7.5 7.5 0 0 1 0 11"],
    earpiece: ["M6 3h3l1.5 4-2 1.5a11 11 0 0 0 5 5L15 11.5l4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"],
    speaker_off: ["M11 5 6 9H3v6h3l5 4V5z", "M17 9.5l4 5", "M21 9.5l-4 5"],
    check: ["M20 6 9 17l-5-5"],
    info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 8h.01", "M11.25 12h.75v4.5h.75"],
    file: ["M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z", "M13 3v6h6"],
    image: ["M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M3 16l5-5 4 4 3-3 6 6", "M9 9.5h.01"],
    music: ["M9 18V6l10-2v12", "M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z", "M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"],
    video: ["M3 6h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z", "M16 10.5 22 7v10l-6-3.5z"],
    archive: ["M4 8h16v12H4z", "M3 4h18v4H3z", "M10 12h4"],
    code: ["M9 18l-6-6 6-6", "M15 6l6 6-6 6"],
    monitor: ["M3 5h18v11H3z", "M9 20h6", "M12 16v4"],
    at: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"],
    menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
};

//AN ACCESS UNIT IS A KEYFRAME WHEN IT CARRIES AN IDR SLICE, OR THE PARAMETER SETS THAT COME IN FRONT OF
//ONE. A DECODER CANNOT START ANYWHERE ELSE, AND ANNEX-B PUTS THE TYPE IN THE LOW FIVE BITS OF THE FIRST

export function Icon({ name, className }: { name: keyof typeof ICONS | string; className?: string })
{
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className ?? "h-4 w-4"}
            aria-hidden
        >
            {(ICONS[name] ?? []).map((path) => <path key={path} d={path} />)}
        </svg>
    );
}

//AN ICON THAT IS A BUTTON, WHICH IN THIS WINDOW IS MOST OF THEM. THE LABEL IS THE TOOLTIP AND THE
//ACCESSIBLE NAME BOTH - NOTHING HERE IS A GUESSING GAME ABOUT WHAT A GLYPH MEANT
export function IconButton(
{
    icon,
    label,
    onClick,
    tone,
    active,
    className,
}: {
    icon: string;
    label: string;
    onClick: () => void;
    tone?: "default" | "error" | "ok";
    active?: boolean;
    className?: string;
})
{
    const color = tone === "error"
        ? "text-error hover:text-error"
        : tone === "ok"
            ? "text-online hover:text-online"
            : active ? "text-text" : "text-muted hover:text-text";

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={`touch-target flex h-8 w-8 items-center justify-center rounded-app transition-colors hover:bg-hover ${color} ${className ?? ""}`}
        >
            <Icon name={icon} className="h-[18px] w-[18px]" />
        </button>
    );
}

//A FACE. THERE ARE NO UPLOADED PICTURES IN THIS PROTOCOL, SO IT IS THE FIRST LETTER OVER THE COLOR THE
//USER PICKED - OR, WHERE THEY PICKED NONE, THE ONE THEIR NAME ALWAYS HASHES TO
