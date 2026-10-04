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

import type { OnlineUser, OfflineUser } from "./types";
import { tOr } from "./i18n";

//HIGHEST ROLE FIRST, US FIRST IN OURS, THE REST BY ID (tui/state.rs::sort_online)
export function sortRoster(users: OnlineUser[], username: string): OnlineUser[]
{
    return users.slice().sort((one, other) => other.rank - one.rank
        || Number(one.username !== username) - Number(other.username !== username) || one.id - other.id);
}

//THE ROSTER SPLIT BY ROLE (tui/state.rs::online_sections)
export function rosterSections(users: OnlineUser[]): OnlineUser[][]
{
    const sections: OnlineUser[][] = [];

    for (const user of users)
    {
        const last = sections[sections.length - 1];

        if (last && last[0].role === user.role) last.push(user);
        else sections.push([user]);
    }

    return sections;
}

//owner -> Owners (tui/draw.rs::section_label)
export function sectionLabel(role: string): string
{
    return tOr(`sidebar.roles.${role}`, `${role.charAt(0).toUpperCase()}${role.slice(1)}s`);
}

//AND THE OTHERS BY NAME, WHICH IS THE ONLY ORDER A LIST OF PEOPLE WITH NO IDS HAS (THE TUI KEEPS THEM
//IN A BTreeMap). A LEAVER IS FILED INTO THE SAME ORDER RATHER THAN LANDING AT THE END OF IT
export function sortOffline(users: OfflineUser[]): OfflineUser[]
{
    return users.slice().sort((one, other) => one.username.localeCompare(other.username));
}

//WHICH MARK STANDS FOR A CLIENT. THE TUI PRINTS THE WORD BECAUSE A TERMINAL HAS ONLY WORDS; A WINDOW HAS
//THE LINE ART ALREADY, AND A ROW OF NAMES IS NOT THE PLACE FOR A SECOND COLUMN OF TEXT
export function deviceIcon(device: string): string | null
{
    return device === "tui" ? "terminal" : device === "desktop" ? "monitor" : device === "phone" ? "phone" : null;
}
