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

//THE BOX UNDER THE FINGER THAT SCROLLS SIDEWAYS, IF THERE IS ONE. THREE THINGS IN THE PANE ARE WIDER THAN
//IT ON PURPOSE AND SCROLL INSIDE THEMSELVES - A FENCED BLOCK, DISPLAY MATH AND A LONG INLINE FORMULA - AND
//A DRAG ACROSS ONE OF THOSE IS SOMEBODY READING THE END OF IT, NOT SOMEBODY REACHING FOR A DRAWER.
//IT IS ASKED OF THE COMPUTED STYLE AND NOT OF A LIST OF CLASS NAMES: .scroller IS overflow-x: hidden AND
//IS THEREFORE NOT ONE OF THESE, WHICH IS THE WHOLE REASON THAT RULE IS WRITTEN OUT LOUD
export function scrollerAt(target: EventTarget | null, root: Element | null): HTMLElement | null
{
    let node = target instanceof Element ? target : null;

    while (node && node !== root)
    {
        if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1)
        {
            const overflow = getComputedStyle(node).overflowX;

            if (overflow === "auto" || overflow === "scroll") return node;
        }

        node = node.parentElement;
    }

    return null;
}

//AND WHETHER IT HAS ANYWHERE LEFT TO GO THE WAY THE FINGER IS PUSHING IT. A FINGER MOVING RIGHT PULLS THE
//CONTENT BACK TOWARDS ITS START, SO THE BOX ONLY OWNS THAT DRAG WHILE IT IS NOT ALREADY THERE - A FORMULA
//SCROLLED TO ITS END HANDS THE NEXT SWIPE ON TO THE DRAWER, WHICH IS WHAT A NATIVE ONE DOES TOO
export function canScroll(node: HTMLElement, across: number): boolean
{
    const left = Math.abs(node.scrollLeft); //rtl COUNTS THE OTHER WAY

    return across > 0 ? left > 1 : left < node.scrollWidth - node.clientWidth - 1;
}

//ONE MEDIA QUERY, WATCHED. BOTH QUESTIONS BELOW ARE THAT AND NOTHING ELSE, AND NEITHER OF THEM IS
//ANSWERED ONCE AT STARTUP: A WINDOW IS DRAGGED NARROWER AND A TABLET HAS A KEYBOARD PLUGGED INTO IT
function useMedia(query: string): boolean
{
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

    useEffect(() =>
    {
        const media = window.matchMedia(query);
        const onChange = () => setMatches(media.matches);

        onChange();
        media.addEventListener("change", onChange);

        return () => media.removeEventListener("change", onChange);
    }, [query]);

    return matches;
}

export function useNarrow(): boolean
{
    return useMedia(`(max-width: ${NARROW}px)`);
}

//WHETHER THE THING POINTING AT THE WINDOW CAN HOVER OVER IT. IT IS A DIFFERENT QUESTION FROM THE WIDTH -
//A PHONE IS BOTH AND A NARROW DESKTOP WINDOW IS ONLY THE FIRST - AND IT IS THE ONE TO ASK WHERE A GESTURE
//DIFFERS RATHER THAN A LAYOUT: A CLICK FROM SOMETHING THAT CANNOT HOVER IS A TAP, AND A TAP IS CHEAP
//ENOUGH TO MAKE BY ACCIDENT THAT IT SHOULD NOT MOVE THE PICTURE SOMEBODY IS LOOKING AT
export function useTouch(): boolean
{
    return useMedia("(hover: none)");
}
