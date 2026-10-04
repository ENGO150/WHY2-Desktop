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
    swatch: [string, string, string]; //GROUND, SURFACE, ACCENT
}

export const DEFAULT_THEME = "why2";

//BOOT CACHE KEY
const CACHE = "why2-theme";

export const THEMES: Theme[] =
[
    { id: "why2", name: "Black", light: false, swatch: ["#0a0a0a", "#000000", "#e5e3dc"] },
    { id: "dark", name: "Dark", light: false, swatch: ["#191919", "#1e1e1e", "#e5e3dc"] },
    { id: "midnight", name: "Midnight", light: false, swatch: ["#0f131a", "#131821", "#6ea8fe"] },
    { id: "forest", name: "Forest", light: false, swatch: ["#0f1511", "#131a15", "#6cc28a"] },
    { id: "plum", name: "Plum", light: false, swatch: ["#161019", "#1a141e", "#b98cf0"] },
    { id: "mocha", name: "Mocha", light: false, swatch: ["#1a1511", "#1e1914", "#e39a5c"] },
    { id: "light", name: "Light", light: true, swatch: ["#f5f5f3", "#ffffff", "#252525"] },
    { id: "paper", name: "Paper", light: true, swatch: ["#f4f1ea", "#fbfaf6", "#2a2620"] },
    { id: "sky", name: "Sky", light: true, swatch: ["#eef2f7", "#f9fbfd", "#2f6fd6"] },
    { id: "mint", name: "Mint", light: true, swatch: ["#edf3ef", "#f8fbf9", "#2a8a55"] },
    { id: "rose", name: "Rose", light: true, swatch: ["#f7eef0", "#fdf9fa", "#c4456a"] },
    { id: "lavender", name: "Lavender", light: true, swatch: ["#f1eef7", "#fbfafd", "#7652c9"] },
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

    try { localStorage.setItem(CACHE, theme.id); } catch { /* NO STORAGE */ }
}

//THE LAST ONE USED, BEFORE THE BRIDGE ANSWERS
export function cachedTheme(): string | null
{
    try { return localStorage.getItem(CACHE); } catch { return null; }
}
