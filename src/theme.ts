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

//THE SIXTEEN COLORS THE PROTOCOL CARRIES. THE DARK HALF IS LIFTED OFF THE FLOOR: THESE ARE PAINTED ON A
//NEAR-BLACK SURFACE RATHER THAN IN A TERMINAL, AND black ON black IS NOT A NAME ANYBODY COULD READ
export const ANSI: Record<number, string> =
{
    0: "#6b6b6b", 1: "#e06c75", 2: "#7ec699", 3: "#d7b56b",
    4: "#7aa2f7", 5: "#c792ea", 6: "#56b6c2", 7: "#c0c0c0",
    8: "#909090", 9: "#ff6b7a", 10: "#8bea9b", 11: "#ffe07a",
    12: "#8ab4ff", 13: "#ff8be0", 14: "#7fe6ec", 15: "#ffffff",
};

//THE SWATCH IN THE COLOR PALETTE IS THE ACTUAL ANSI COLOR, NOT THE LIFTED ONE - IT IS THERE TO SAY WHICH
//COLOR IS BEING PICKED, AND A SQUARE OF IT IS BIG ENOUGH TO SEE EVEN AT black
export const ANSI_TRUE: Record<number, string> =
{
    0: "#000000", 1: "#800000", 2: "#008000", 3: "#808000",
    4: "#000080", 5: "#800080", 6: "#008080", 7: "#c0c0c0",
    8: "#808080", 9: "#ff0000", 10: "#00ff00", 11: "#ffff00",
    12: "#0000ff", 13: "#ff00ff", 14: "#00ffff", 15: "#ffffff",
};

//THE COLOR AN AVATAR FALLS BACK TO WHEN THE USER HAS NOT PICKED ONE - THE SAME NAME ALWAYS GETS THE SAME
//ONE, SO A FACE IS RECOGNISABLE DOWN THE PANE EVEN THOUGH NOTHING ABOUT IT IS STORED ANYWHERE
export const AVATARS = ["#6f5ba8", "#a85b7a", "#5b86a8", "#a8875b", "#5ba884", "#a85b5b", "#7a5ba8", "#5ba8a0"];

export function avatarColor(name: string): string
{
    let hash = 0;

    for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;

    return AVATARS[hash % AVATARS.length];
}
