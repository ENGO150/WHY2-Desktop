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

import { useState, useEffect } from "react";

//APP DRAWS: THE CONVERSATION FULL WIDTH, WITH THE TWO SIDEBARS AS DRAWERS OVER IT. IT IS A WIDTH AND NOT
//A PLATFORM CHECK ON PURPOSE - A DESKTOP WINDOW DRAGGED THIS NARROW HAS EXACTLY THE SAME PROBLEM
export const NARROW = 820;

//HOW FAR A FINGER HAS TO TRAVEL SIDEWAYS TO MEAN A DRAWER, AND HOW STRAIGHT IT HAS TO BE: A SWIPE THAT IS
//MOSTLY VERTICAL IS SOMEBODY SCROLLING THE PANE AND MUST NOT MOVE ANYTHING
export const SWIPE = 56;
export const SWIPE_SLOPE = 1.4;

//A DRAG MEANS NOTHING UNTIL IT HAS GONE THIS FAR: UNDER IT A FINGER IS STILL A TAP, AND WHICH WAY IT WAS
//GOING IS NOT A QUESTION WITH AN ANSWER YET
export const SWIPE_SLOP = 10;

//HOW LONG THE LAST STRETCH TAKES ONCE THE FINGER IS OFF - THE SAME 180ms .drawer AND .scrim TRANSITION IN,
//SINCE THIS IS WHEN THE INLINE POSITION IS HANDED BACK TO THEM
export const DRAWER_MS = 180;

export function useNarrow(): boolean
{
    const query = `(max-width: ${NARROW}px)`;

    const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);

    useEffect(() =>
    {
        const media = window.matchMedia(query);
        const onChange = () => setNarrow(media.matches);

        onChange();
        media.addEventListener("change", onChange);

        return () => media.removeEventListener("change", onChange);
    }, [query]);

    return narrow;
}
