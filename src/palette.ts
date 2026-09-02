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

import type { CommandInfo, SubcommandInfo, CommandArgInfo, PaletteEntry, PaletteShape } from "./types";

//HOW MANY ROWS OF THE PALETTE ARE ON SCREEN AT ONCE, AS IN palette::MAX_ROWS
export const PALETTE_ROWS = 8;

export function commandEntry(command: CommandInfo): PaletteEntry
{
    return { name: command.name, word: command.triggers, parent: null, description: command.description, args: command.args };
}

export function actionEntry(command: CommandInfo, sub: SubcommandInfo): PaletteEntry
{
    return {
        name: `${command.name} ${sub.name}`,
        word: sub.triggers,
        parent: command.triggers,
        description: sub.description,
        args: sub.args,
    };
}

//<REQUIRED> / [OPTIONAL], SPELLED THE WAY palette::format_arg SPELLS IT
export function formatArg(arg: CommandArgInfo): string
{
    return arg.required ? `<${arg.name.toLowerCase()}>` : `[${arg.name.toLowerCase()}]`;
}

//WHICH PARAMETER THE CARET IS SITTING ON
export function activeArg(args: CommandArgInfo[], tail: string): number
{
    const given = tail.split(/\s+/).filter(Boolean).length;

    //A TRAILING SPACE MEANS THE USER MOVED ON TO THE NEXT PARAMETER
    const index = /\s$/.test(tail) ? given : Math.max(given - 1, 0);

    //THE LAST PARAMETER SWALLOWS THE REST OF THE LINE (A PRIVATE MESSAGE), SO THERE IS NEVER A PARAMETER
    //BEYOND IT TO ADVANCE TO - KEEP IT ACTIVE NO MATTER HOW MUCH MORE IS TYPED
    return Math.min(index, args.length - 1);
}

//THE HALF-TYPED VALUE THE CARET IS ON - EMPTY ONCE THE USER HAS MOVED ON TO THE NEXT PARAMETER
export function partial(tail: string): string
{
    if (/\s$/.test(tail)) return "";

    const words = tail.split(/\s+/).filter(Boolean);

    return words[words.length - 1] ?? "";
}

//THE ENTRY IS ALREADY SPELLED OUT ON THE LINE, SO ENTER SENDS IT INSTEAD OF COMPLETING IT
export function entryTyped(entry: PaletteEntry, input: string): boolean
{
    if (!input.trim().startsWith("/")) return false;

    const rest = input.trim().slice(1).toLowerCase();

    if (entry.parent === null) return entry.word.includes(rest);

    //BOTH WORDS HAVE TO BE THERE - THE COMMAND WORD ALONE IS NOT THIS ENTRY
    const split = rest.search(/\s/);
    if (split < 0) return false;

    return entry.parent.includes(rest.slice(0, split)) && entry.word.includes(rest.slice(split).trim());
}

//THE PARAMETER THE CARET IS ON: ITS OWN ANSWERS WHERE IT HAS A CLOSED SET OF THEM, OTHERWISE THE PLAIN
//SIGNATURE HINT. THE ANSWERS THEMSELVES ARE NOT HERE - THEY ARE ASKED OF THE BRIDGE ONCE THIS SAYS WHICH
export function hint(entry: PaletteEntry, tail: string, input: string): PaletteShape
{
    const active = activeArg(entry.args, tail);
    const arg = entry.args[active];

    if (arg && arg.values !== "free")
    {
        const typed = partial(tail);

        return { mode: "pending", entry, active, arg, typed: typed.toLowerCase(), start: input.length - typed.length };
    }

    return { mode: "signature", entry, active };
}

//THE ACTION WORD OF /command <action> ... - A MENU WHILE IT IS BEING TYPED, ITS PARAMETERS ONCE IT IS DONE
export function actionShape(command: CommandInfo, tail: string, input: string): PaletteShape
{
    const split = tail.search(/\s/);

    //STILL TYPING THE ACTION - FILTER WHAT OUR ROLE MAY RUN (THE BRIDGE ALREADY DID THE FILTERING)
    if (split < 0)
    {
        const candidate = tail.toLowerCase();

        const entries = command.subcommands
            .filter((sub) => sub.triggers.some((trigger) => trigger.startsWith(candidate)))
            .map((sub) => actionEntry(command, sub));

        return entries.length > 0 ? { mode: "menu", entries } : { mode: "hidden" };
    }

    const action = tail.slice(0, split).toLowerCase();
    const sub = command.subcommands.find((candidate) => candidate.triggers.includes(action));

    //AN ACTION OUT OF OUR REACH IS NOT HINTED EITHER - IT IS NOT SUPPOSED TO BE THERE AT ALL
    if (!sub || sub.args.length === 0) return { mode: "hidden" };

    return hint(actionEntry(command, sub), tail.slice(split), input);
}

//WHAT THE PALETTE SHOULD BE SHOWING FOR THIS LINE - palette::update, WITH THE VOCABULARY LEFT FOR LATER.
//A COMMAND THAT IS A DOORWAY TO ACTIONS IS ONE ROW UNTIL ITS WORD IS FINISHED: /server IS NOT NINE
//COMMANDS IN THE LIST, IT IS ONE THAT OPENS ITS OWN
export function analyze(input: string, commands: CommandInfo[]): PaletteShape
{
    if (!input.startsWith("/")) return { mode: "hidden" };

    const rest = input.slice(1);
    const split = rest.search(/\s/);

    //STILL TYPING THE COMMAND WORD - FILTER THE LIST
    if (split < 0)
    {
        const candidate = rest.toLowerCase();

        const entries = commands
            .filter((command) => command.triggers.some((trigger) => trigger.startsWith(candidate)))
            .map(commandEntry);

        return entries.length > 0 ? { mode: "menu", entries } : { mode: "hidden" };
    }

    const word = rest.slice(0, split).toLowerCase();
    const tail = rest.slice(split);

    const command = commands.find((candidate) => candidate.triggers.includes(word));
    if (!command) return { mode: "hidden" };

    //A COMMAND THAT TAKES AN ACTION HAS NOTHING OF ITS OWN TO HINT - THE ACTION OWNS EVERYTHING PAST IT
    if (command.subcommands.length > 0) return actionShape(command, tail.trimStart(), input);

    if (command.args.length === 0) return { mode: "hidden" };

    return hint(commandEntry(command), tail, input);
}

//THE TWO BUTTONS UNDER THE SERVER ROWS: THE ONE THEY ARE SENT BACK WITH, AND THE ONE THAT PUTS THE
