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

//tui/input.rs: pos AT THE END MEANS "NOT SEARCHING", AND A HALF-WRITTEN MESSAGE IS BOTH PARKED WHEN THE
//SEARCH STARTS AND WHAT IT IS LOCKED TO - SO ↑ WALKS WHAT WAS TYPED BEFORE, NOT EVERYTHING EVER SENT
export interface History
{
    entries: string[];
    pos: number;
    stash: string | null;  //THE IN-PROGRESS LINE, TO COME BACK TO
    prefix: string | null; //NEVER A COMMAND - A LINE STARTING WITH / IS THE PALETTE'S SEARCH, NOT THIS ONE
}

export function historyMatches(history: History, entry: string): boolean
{
    return history.prefix === null || entry.startsWith(history.prefix);
}

//ONE STEP BACK THROUGH IT, OR null WHEN THERE IS NOWHERE LEFT TO GO
export function historyUp(history: History, typed: string): string | null
{
    if (history.entries.length === 0 || history.pos === 0) return null;

    if (history.pos === history.entries.length)
    {
        history.prefix = typed && !typed.startsWith("/") ? typed : null;
        history.stash = typed;
    }

    for (let index = history.pos - 1; index >= 0; index--)
    {
        if (!historyMatches(history, history.entries[index])) continue;

        history.pos = index;

        return history.entries[index];
    }

    return null;
}

//AND ONE STEP FORWARD, THE LAST OF WHICH IS BACK TO THE LINE THAT STARTED THE SEARCH
export function historyDown(history: History): string | null
{
    if (history.pos >= history.entries.length) return null;

    for (let index = history.pos + 1; index < history.entries.length; index++)
    {
        if (!historyMatches(history, history.entries[index])) continue;

        history.pos = index;

        return history.entries[index];
    }

    history.pos = history.entries.length;
    history.prefix = null;

    const stash = history.stash ?? "";
    history.stash = null;

    return stash;
}

//A SENT LINE JOINS IT, AND ENDS WHATEVER SEARCH WAS RUNNING. THE SAME LINE TWICE IN A ROW IS ONE ENTRY
export function pushHistory(history: History, input: string)
{
    if (history.entries[history.entries.length - 1] !== input) history.entries.push(input);

    history.pos = history.entries.length;
    history.stash = null;
    history.prefix = null;
}
