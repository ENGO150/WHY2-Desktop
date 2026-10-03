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

//ONE PALETTE (themes.css)
export interface Theme
{
    id: string;
    name: string;
    light: boolean;
    gradient: boolean;
    swatch: string; //WHAT ITS BUTTON IS PAINTED IN
}

export const DEFAULT_THEME = "why2";

//BOOT CACHE KEY
const CACHE = "why2-theme";

export const THEMES: Theme[] =
[
    { id: "why2", name: "WHY2", light: false, gradient: false, swatch: "#0d0b0c" },
    { id: "dark", name: "Dark", light: false, gradient: false, swatch: "#1c1d21" },
    { id: "ash", name: "Ash", light: false, gradient: false, swatch: "#313338" },
    { id: "light", name: "Light", light: true, gradient: false, swatch: "#ffffff" },

    { id: "sunset", name: "Sunset", light: false, gradient: true, swatch: "linear-gradient(150deg, #3b1f6e, #86356b, #c6683a)" },
    { id: "aurora", name: "Aurora", light: false, gradient: true, swatch: "linear-gradient(150deg, #0b3b38, #1b6656, #263f86, #45286f)" },
    { id: "twilight", name: "Twilight", light: false, gradient: true, swatch: "linear-gradient(150deg, #11163f, #2a2c84, #5a46b8)" },
    { id: "crimson", name: "Crimson", light: false, gradient: true, swatch: "linear-gradient(150deg, #160205, #5a0c17, #24030a)" },
    { id: "forest", name: "Forest", light: false, gradient: true, swatch: "linear-gradient(150deg, #10231a, #2a4a2e, #55592a)" },
    { id: "lagoon", name: "Lagoon", light: false, gradient: true, swatch: "linear-gradient(150deg, #0a2645, #13557a, #23807e)" },
    { id: "neon", name: "Neon", light: false, gradient: true, swatch: "linear-gradient(150deg, #170a3a, #6e1c86, #0d7395)" },
    { id: "mint", name: "Mint", light: true, gradient: true, swatch: "linear-gradient(150deg, #c3eed8, #a5d9c0, #dcf1c2)" },
    { id: "citrus", name: "Citrus", light: true, gradient: true, swatch: "linear-gradient(150deg, #fde2a4, #f8c6a0, #f3a59f)" },
    { id: "cotton", name: "Cotton candy", light: true, gradient: true, swatch: "linear-gradient(150deg, #f7d2e5, #e2d4f6, #cde3fa)" },
];

export function findTheme(id: string | null | undefined): Theme
{
    return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

//PUT A PALETTE ON THE PAGE
export function applyTheme(id: string | null | undefined)
{
    const theme = findTheme(id);
    const root = document.documentElement;

    if (theme.id === DEFAULT_THEME) delete root.dataset.theme;
    else root.dataset.theme = theme.id;

    if (theme.light) root.dataset.tone = "light";
    else delete root.dataset.tone;

    if (theme.gradient) root.dataset.backdrop = theme.light ? "light" : "dark";
    else delete root.dataset.backdrop;

    try { localStorage.setItem(CACHE, theme.id); } catch { /* NO STORAGE */ }
}

//THE LAST ONE USED, BEFORE THE BRIDGE ANSWERS
export function cachedTheme(): string | null
{
    try { return localStorage.getItem(CACHE); } catch { return null; }
}
