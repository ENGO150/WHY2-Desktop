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


import { useEffect, useMemo, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { Icon } from "./icons";

//WHAT THE WINDOW'S OWN FRAME IS, WHICH IS THE ONE THING ON THIS SIDE THAT HAS TO KNOW WHICH PLATFORM IT
//IS ON - EVERYTHING ELSE IS ANSWERED BY WHAT THE BUILD CAN DO. "buttons" IS WINDOWS AND LINUX, WHERE
//NOBODY DRAWS A TITLE BAR BUT US; "native" IS MACOS, WHOSE TRAFFIC LIGHTS STAND OVER THE PAGE AND ARE
//NOT OURS TO REPLACE; "none" IS A PHONE, AND A BROWSER, WHERE THERE IS NO SUCH QUESTION
export type WindowChrome = "none" | "buttons" | "native";

//HOW MUCH ROOM THE TRAFFIC LIGHTS TAKE ON THE LEFT OF THE BAR THEY ARE DRAWN OVER. THEY ARE THE SYSTEM'S
//AND SIT AT ITS OWN COORDINATES, SO THE ONLY THING WE CAN DO ABOUT THEM IS NOT PUT ANYTHING UNDER THEM
const LIGHTS = 78;

//WHICH WAY AN EDGE PULLS. THE API TAKES THESE EIGHT AND DOES NOT EXPORT THE NAME OF THE TYPE, SO IT IS
//WRITTEN OUT HERE - THE STRINGS ARE THE WHOLE OF WHAT CROSSES
type ResizeDirection = "North" | "South" | "West" | "East" | "NorthWest" | "NorthEast" | "SouthWest" | "SouthEast";

//THE EDGES OF AN UNDECORATED WINDOW, WHICH IS WHERE THE WM WOULD HAVE PUT ITS OWN. WITHOUT THESE A
//WINDOW WITH NO DECORATIONS IS A WINDOW THAT CANNOT BE RESIZED AT ALL ON MOST OF X11 - THE CORNERS COME
//LAST SO THEY LIE OVER THE TWO EDGES THEY MEET
const EDGES: [ResizeDirection, string][] =
[
    ["North", "inset-x-0 top-0 h-[3px] cursor-ns-resize"],
    ["South", "inset-x-0 bottom-0 h-[3px] cursor-ns-resize"],
    ["West", "inset-y-0 left-0 w-[3px] cursor-ew-resize"],
    ["East", "inset-y-0 right-0 w-[3px] cursor-ew-resize"],
    ["NorthWest", "left-0 top-0 h-2.5 w-2.5 cursor-nwse-resize"],
    ["NorthEast", "right-0 top-0 h-2.5 w-2.5 cursor-nesw-resize"],
    ["SouthWest", "bottom-0 left-0 h-2.5 w-2.5 cursor-nesw-resize"],
    ["SouthEast", "bottom-0 right-0 h-2.5 w-2.5 cursor-nwse-resize"],
];

//THE BAR THE SYSTEM WOULD HAVE DRAWN, DRAWN BY THE PROGRAM INSTEAD: THE MARK AND THE NAME ON THE LEFT,
//THE THREE BUTTONS ON THE RIGHT, AND THE WHOLE WIDTH BETWEEN THEM A PLACE TO PICK THE WINDOW UP BY.
//data-tauri-drag-region IS WHAT MAKES IT ONE - IT IS ANSWERED BY THE CRATE, WHICH ALSO TAKES THE
//DOUBLE-CLICK - SO EVERYTHING INSIDE IT THAT IS NOT A BUTTON HAS TO LET THE PRESS THROUGH TO IT
export function TitleBar({ chrome, title }: { chrome: WindowChrome; title: string })
{
    const [maximized, setMaximized] = useState(false);

    const win = useMemo(getCurrentWindow, []);

    useEffect(() =>
    {
        //THE MIDDLE BUTTON FOLLOWS THE WINDOW RATHER THAN THE OTHER WAY ROUND: A DOUBLE-CLICK ON THE BAR,
        //A SNAP TO AN EDGE AND THE WM'S OWN SHORTCUT ALL ARRIVE HERE AS NOTHING BUT A RESIZE
        const read = () => { win.isMaximized().then(setMaximized).catch(() => {}); };

        read();

        const unlisten = win.onResized(read);

        return () => { unlisten.then((off) => off()).catch(() => {}); };
    }, [win]);

    return (
        <>
            <header
                data-tauri-drag-region
                style={chrome === "native" ? { paddingLeft: LIGHTS } : undefined}

                //relative z-50 AND NOT MERELY A ROW AT THE TOP: THE DRAWERS OF A NARROW WINDOW ARE fixed
                //AGAINST THE VIEWPORT AND WOULD OTHERWISE SLIDE OVER THE ONLY WAY TO CLOSE THE PROGRAM
                className={`relative z-50 flex h-8 shrink-0 select-none items-center gap-2 border-b border-border bg-deep ${chrome === "native" ? "" : "pl-3"}`}
            >
                {/* THE PRESS HAS TO REACH THE BAR ITSELF, SO NOTHING THAT IS NOT A BUTTON TAKES ONE */}
                <img src="/why2.svg" alt="" className="pointer-events-none h-4 w-4 opacity-70" />
                <span className="pointer-events-none text-xs font-semibold tracking-wide text-muted">{title}</span>

                {chrome === "buttons" && (
                    <div className="ml-auto flex h-full items-stretch">
                        <WindowButton icon="win_minimize" label="Minimize" onClick={() => { win.minimize().catch(() => {}); }} />

                        <WindowButton
                            icon={maximized ? "win_restore" : "win_maximize"}
                            label={maximized ? "Restore" : "Maximize"}
                            onClick={() => { win.toggleMaximize().catch(() => {}); }}
                        />

                        {/* THE ONE BUTTON THAT IS RED EVERYWHERE, AND THE ONLY PLACE IN THIS WINDOW WHERE
                            THE ERROR COLOUR MEANS "THIS ENDS SOMETHING" RATHER THAN "SOMETHING WENT WRONG" */}
                        <WindowButton icon="close" label="Close" close onClick={() => { win.close().catch(() => {}); }} />
                    </div>
                )}
            </header>

            {/* AND THE EDGES, WHICH ONLY EXIST WHERE WE TOOK THE FRAME AWAY - A MAXIMIZED WINDOW HAS NO
                EDGES TO PULL, AND A STRIP OVER THE SCREEN'S OWN IS A STRIP OVER SOMEBODY'S SCROLLBAR */}
            {chrome === "buttons" && !maximized && EDGES.map(([direction, where]) => (
                <div
                    key={direction}
                    onMouseDown={(event) =>
                    {
                        if (event.button !== 0) return;

                        win.startResizeDragging(direction).catch(() => {});
                    }}
                    className={`fixed z-50 ${where}`}
                />
            ))}
        </>
    );
}

//ONE OF THE THREE. THEY ARE NOT IconButton: THOSE ARE ROUNDED, SPACED AND FINGERTIP-SIZED, AND THESE ARE
//A ROW OF SQUARES RUNNING INTO THE CORNER OF THE GLASS, WHICH IS WHERE EVERY WINDOW HAS PUT THEM
function WindowButton({ icon, label, onClick, close }: { icon: string; label: string; onClick: () => void; close?: boolean })
{
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={`flex w-[46px] items-center justify-center text-muted transition-colors ${close ? "hover:bg-error hover:text-deep" : "hover:bg-hover hover:text-text"}`}
        >
            <Icon name={icon} className="h-3.5 w-3.5" />
        </button>
    );
}
