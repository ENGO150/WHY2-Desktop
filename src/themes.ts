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
    { id: "light", name: "Light", light: true, swatch: ["#f5f5f3", "#ffffff", "#252525"] },
    { id: "paper", name: "Paper", light: true, swatch: ["#f4f1ea", "#fbfaf6", "#2a2620"] },
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
