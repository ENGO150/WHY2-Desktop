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

import type { MessageImage, PaneEntry, PictureStatus } from "./types";

type Panes = Record<string, PaneEntry[]>;

//THE HISTORY REPLAYS A PICTURE AS ITS HASH, SO A CAPTION IS A LINE WITH SOMETHING STILL TO FETCH. THE
//SAME PICTURE CAN BE IN THE PANE TWICE - THE OLDEST LINE STILL WAITING FOR IT IS THE ONE AN ANSWER
//FILLS, AND THE SECOND ONE ASKED FOR ITSELF AND IS ANSWERED BY ITS OWN PACKET (tui/state.rs::deliver_image)
function waiting(entry: PaneEntry, hash: string, status: PictureStatus[]): boolean
{
    return entry.entry === "message"
        && entry.message.image?.hash === hash
        && status.includes(entry.picture ?? "absent");
}

//A PANE MAP WITH ONE ENTRY REWRITTEN: THE FIRST ONE, OLDEST FIRST, THAT IS STILL WAITING FOR THIS
//PICTURE. NOTHING ELSE IS COPIED, SO EVERY PANE THAT DID NOT CHANGE IS THE SAME ARRAY IT WAS
function rewrite(panes: Panes, hash: string, status: PictureStatus[], change: (entry: PaneEntry) => PaneEntry): Panes
{
    for (const channel of Object.keys(panes))
    {
        const index = panes[channel].findIndex((entry) => waiting(entry, hash, status));
        if (index < 0) continue;

        const pane = panes[channel].slice();
        pane[index] = change(pane[index]);

        return { ...panes, [channel]: pane };
    }

    return panes;
}

//ASKED FOR. A CAPTION THAT WAS ANSWERED WITH NOTHING IS ASKABLE AGAIN - THE PICTURE MAY HAVE LEFT THE
//HISTORY, AND IT MAY ALSO HAVE BEEN THE ONE ANSWER THAT WENT MISSING
export function markWaiting(panes: Panes, hash: string): Panes
{
    return rewrite(panes, hash, ["absent", "gone"], (entry) => ({ ...entry, picture: "waiting" }));
}

//AND THE ANSWER TO IT - OR THE LACK OF ONE, WHICH THE CAPTION THEN SAYS. THE FILENAME IS THE LINE'S OWN
//AND NOT THE PACKET'S: IT HAS CARRIED THAT SINCE THE HISTORY ARRIVED
export function deliverPicture(panes: Panes, hash: string, image: MessageImage | null): Panes
{
    return rewrite(panes, hash, ["waiting"], (entry) =>
    {
        if (entry.entry !== "message") return entry;
        if (!image) return { ...entry, picture: "gone" };

        const previous = entry.message.image;

        return {
            ...entry,
            picture: undefined,
            message: { ...entry.message, image: { ...image, filename: previous?.filename ?? image.filename, hash } },
        };
    });
}
