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

//WHAT A MESSAGE IS MADE OF ONCE THE MARKUP IS OFF IT - tui/markup.rs' OWN Segment, AND THE PARSER BELOW
//IS THAT FILE'S parse REWRITTEN. EVERYTHING THAT IS NOT ONE OF THESE IS text, MARKUP THAT NEVER CLOSED
//INCLUDED: AN UNTERMINATED FENCE IS BACKTICKS SOMEBODY TYPED, NOT A BLOCK THAT SWALLOWS THE REST OF IT
export type Segment =
    | { kind: "text"; text: string }
    | { kind: "code"; text: string }                        //INLINE `code`
    | { kind: "block"; lang: string | null; body: string };  //FENCED ```code```

//CONSTS
const MAX_LANG = 20; //LONGER THAN THIS AND THE FIRST WORD IS CODE, NOT A LANGUAGE NAME

//FUNCTIONS
//ONE MESSAGE, IN THE PIECES IT IS DRAWN FROM. IT NEVER FAILS AND NEVER CONSUMES ANYTHING IT CANNOT
//CLOSE, WHICH IS THE ONLY BEHAVIOUR THAT CANNOT SWALLOW A MESSAGE SOMEBODY ELSE WROTE
export function parse(text: string): Segment[]
{
    const chars = [...text]; //CODE POINTS, THE WAY RUST COUNTS THEM - NOT UTF-16 HALVES

    const out: Segment[] = [];
    let buffer = "";
    let index = 0;

    //A DELIMITER THAT WAS NOT FOUND ONCE IS NOT THERE AT ALL: THE SEARCH ONLY EVER STARTS LATER IN THE
    //MESSAGE, SO IT CANNOT SUCCEED AFTERWARDS. REMEMBERING THAT IS WHAT KEEPS A MESSAGE OF NOTHING BUT
    //BACKTICKS FROM COSTING A SEARCH PER BACKTICK
    const missing = [false, false, false];

    const flush = () =>
    {
        if (buffer.length > 0) { out.push({ kind: "text", text: buffer }); buffer = ""; }
    };

    while (index < chars.length)
    {
        //A BACKSLASH TAKES THE MARKUP OFF WHATEVER FOLLOWS IT, AND OFF NOTHING ELSE
        if (chars[index] === "\\" && (chars[index + 1] === "`" || chars[index + 1] === "\\"))
        {
            buffer += chars[index + 1];
            index += 2;

            continue;
        }

        const taken = chars[index] === "`" ? backtick(chars, index, out, flush, missing) : null;

        if (taken === null)
        {
            buffer += chars[index];
            index += 1;
        }
        else index = taken;
    }

    flush();

    return out;
}

//A RUN OF THREE OR MORE BACKTICKS OPENS A FENCE, ONE OR TWO OPEN INLINE CODE THAT THE SAME RUN CLOSES
function backtick(chars: string[], index: number, out: Segment[], flush: () => void, missing: boolean[]): number | null
{
    let run = 0;
    while (chars[index + run] === "`") run++;

    const kind = Math.min(run, 3) - 1;

    if (missing[kind]) return null;

    if (run >= 3)
    {
        const start = index + 3;
        const end = seen(find(chars, start, "```"), missing, kind);

        if (end === null) return null;

        flush();
        out.push(fence(chars.slice(start, end).join("")));

        return end + 3;
    }

    const start = index + run;
    const close = "`".repeat(run);
    const end = seen(findEscaped(chars, start, close), missing, kind);

    if (end === null) return null;

    const inner = chars.slice(start, end).join("");

    if (inner.length === 0) return null;

    flush();
    out.push({ kind: "code", text: inner });

    return end + run;
}

//DISCORD'S RULE: A FIRST WORD ON A LINE OF ITS OWN IS THE LANGUAGE, ANYTHING ELSE IS THE FIRST LINE OF
//CODE. THE LEADING NEWLINE GOES EITHER WAY - IT IS THE FENCE'S, NOT THE CODE'S
function fence(inner: string): Segment
{
    const stop = inner.indexOf("\n");
    const first = stop < 0 ? null : inner.slice(0, stop);

    const [lang, body] = first !== null && isLanguage(first)
        ? [first.trim(), inner.slice(stop + 1)]
        : [null, inner.startsWith("\n") ? inner.slice(1) : inner];

    return { kind: "block", lang, body: body.endsWith("\n") ? body.slice(0, -1) : body };
}

function isLanguage(word: string): boolean
{
    const trimmed = word.trim();

    return trimmed.length > 0 && trimmed.length <= MAX_LANG && /^[A-Za-z0-9+#\-_.]+$/.test(trimmed);
}

function find(chars: string[], from: number, needle: string): number | null //FIRST needle AT OR AFTER from
{
    const parts = [...needle];

    for (let index = from; index + parts.length <= chars.length; index++)
    {
        if (parts.every((char, offset) => chars[index + offset] === char)) return index;
    }

    return null;
}

//THE SAME, PAST BACKSLASHES. A FENCE IS SEARCHED FOR WITHOUT THIS: WHAT IS INSIDE ONE IS VERBATIM, SO A
//LINE OF CODE ENDING IN A BACKSLASH CANNOT BE ALLOWED TO SWALLOW THE FENCE THAT CLOSES IT
function findEscaped(chars: string[], from: number, needle: string): number | null
{
    const parts = [...needle];
    let index = from;

    while (index + parts.length <= chars.length)
    {
        if (chars[index] === "\\") { index += 2; continue; }
        if (parts.every((char, offset) => chars[index + offset] === char)) return index;

        index++;
    }

    return null;
}

function seen(found: number | null, missing: boolean[], kind: number): number | null //A FAILED SEARCH IS NOT REPEATED
{
    missing[kind] = found === null;

    return found;
}
