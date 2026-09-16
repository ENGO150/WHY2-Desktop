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
    | { kind: "raw"; text: string }                          //A CHARACTER THE BACKSLASH TOOK THE MARKUP OFF
    | { kind: "code"; text: string }                         //INLINE `code`
    | { kind: "block"; lang: string | null; body: string }   //FENCED ```code```
    | { kind: "math"; text: string }                         //INLINE $math$
    | { kind: "display"; text: string }                      //$$math$$
    | { kind: "link"; text: string; url: string }            //[text](url)
    | { kind: "open"; modifier: number }                     //EMPHASIS OPENS
    | { kind: "close"; modifier: number };                   //AND CLOSES

//WHAT A RUN OF DELIMITERS MEANS. THEY ARE A SET AND NOT A LIST, THE WAY ratatui'S Modifier IS: TEXT IS
//INSIDE EVERY EMPHASIS THAT IS OPEN OVER IT, AND active BELOW IS tui/markup.rs' FOLD OF THE SAME STACK
export const ITALIC = 1;
export const BOLD = 2;
export const UNDERLINE = 4;
export const STRIKE = 8;

//WHAT A ROW OF A MESSAGE OPENS WITH - tui/markup.rs' Marker, AS THE THING A WINDOW DRAWS RATHER THAN THE
//SPANS A CELL GRID DOES. THE TERMINAL PADS ITS WRAPPED ROWS UNDER THE MARKER BY HAND; HERE A LIST IS A
//LIST AND A QUOTE IS A BLOCKQUOTE, SO THE HANGING INDENT IS THE BROWSER'S PROBLEM AND NOT OURS
export type Shape =
    | { kind: "plain" }
    | { kind: "heading"; level: number; indent: number }
    | { kind: "quote"; indent: number }
    | { kind: "bullet"; indent: number }
    | { kind: "ordinal"; number: number; indent: number };

//ONE PIECE OF A ROW, WITH EVERY EMPHASIS IT IS INSIDE OF ON IT
export type Inline =
    | { kind: "text"; text: string; modifier: number; linkify: boolean }
    | { kind: "code"; text: string; modifier: number }
    | { kind: "math"; text: string; modifier: number }
    | { kind: "link"; text: string; url: string };

//AND ONE ROW OF IT. THE THREE THAT OWN THEIR ROWS CARRY NOTHING ELSE
export type Row =
    | { kind: "row"; shape: Shape; nodes: Inline[] }
    | { kind: "rule" }
    | { kind: "block"; lang: string | null; body: string }
    | { kind: "display"; text: string };

//CONSTS
const MAX_LANG = 20;      //LONGER THAN THIS AND THE FIRST WORD IS CODE, NOT A LANGUAGE NAME
const MARKUP_KINDS = 9;   //DELIMITERS THE PARSER GIVES UP ON SEPARATELY
const ESCAPABLE = "`$*_~[\\#>-"; //WHAT A BACKSLASH TAKES THE MARKUP OFF
const MAX_HEADING = 3;    //MORE HASHES THAN THIS AND THE ROW IS TEXT
const MAX_ORDINAL = 9;    //AND MORE DIGITS THAN THIS IS NOT A LIST
const MIN_RULE = 3;       //MARKERS A HORIZONTAL RULE IS DRAWN FROM
const MAX_RUN = 3;        //AND DELIMITERS ONE EMPHASIS IS OPENED WITH

const ALNUM = /[\p{L}\p{N}]/u;

//FUNCTIONS
//ONE MESSAGE, IN THE PIECES IT IS DRAWN FROM. IT NEVER FAILS AND NEVER CONSUMES ANYTHING IT CANNOT
//CLOSE, WHICH IS THE ONLY BEHAVIOUR THAT CANNOT SWALLOW A MESSAGE SOMEBODY ELSE WROTE.
//math IS render_math: WITH IT OFF NO MATH SEGMENT IS EVER OPENED, SO A DOLLAR SIGN IS A DOLLAR SIGN
export function parse(text: string, math: boolean): Segment[]
{
    const chars = [...text]; //CODE POINTS, THE WAY RUST COUNTS THEM - NOT UTF-16 HALVES

    const out: Segment[] = [];
    const stack: { run: number; end: number; modifier: number }[] = [];
    let buffer = "";
    let index = 0;

    //A DELIMITER THAT WAS NOT FOUND ONCE IS NOT THERE AT ALL: THE SEARCH ONLY EVER STARTS LATER IN THE
    //MESSAGE, SO IT CANNOT SUCCEED AFTERWARDS. REMEMBERING THAT IS WHAT KEEPS A MESSAGE OF NOTHING BUT
    //BACKTICKS FROM COSTING A SEARCH PER BACKTICK
    const missing = new Array<boolean>(MARKUP_KINDS).fill(false);

    const flush = () =>
    {
        if (buffer.length > 0) { out.push({ kind: "text", text: buffer }); buffer = ""; }
    };

    while (index < chars.length)
    {
        //A BACKSLASH TAKES THE MARKUP OFF WHATEVER FOLLOWS IT, AND OFF NOTHING ELSE
        if (chars[index] === "\\" && chars[index + 1] !== undefined && ESCAPABLE.includes(chars[index + 1]))
        {
            flush();
            out.push({ kind: "raw", text: chars[index + 1] });

            index += 2;

            continue;
        }

        const char = chars[index];

        const taken = char === "`" ? backtick(chars, index, out, flush, missing)
            : char === "$" && math ? dollar(chars, index, out, flush, missing)
            : char === "[" ? link(chars, index, out, flush, missing)
            : char === "*" || char === "_" || char === "~" ? emphasis(chars, index, out, flush, stack, missing, math)
            : null;

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

//WHAT MAKES A SPACE BESIDE A DELIMITER FORGIVABLE: A BACKSLASH, A SUPERSCRIPT, A SUBSCRIPT OR A BRACE.
//NOTHING ELSE IS TeX AND NOT PROSE - AND A PRICE HAS NONE OF THEM, WHICH IS THE WHOLE POINT (SEE dollar)
const TEX = /[\\^_{}]/;

//MATH. THE GUARDS ARE WHAT KEEPS PRICES OUT OF IT: AN OPENING $ IS NOT FOLLOWED BY A SPACE, A CLOSING ONE
//IS NOT PRECEDED BY ONE AND NOT FOLLOWED BY A DIGIT, SO "$5 AND $10 LEFT" IS THREE WORDS AND NOT MATH.
//THAT RULE IS PANDOC'S AND IT IS THE CRATE'S, AND IT IS TOO BLUNT FOR SOMETHING ACTUALLY WRITTEN IN TeX:
//`$\sin $` IS A FORMULA BY ANY READING AND WAS DRAWN AS THE THREE CHARACTERS SOMEBODY TYPED. SO THE SPACE
//IS FORGIVEN - ON EITHER SIDE - WHERE WHAT IS BETWEEN THE DOLLARS IS UNMISTAKABLY TeX (TEX ABOVE), AND
//FOR DISPLAY MATH ALWAYS, SINCE NOBODY EVER WROTE A PRICE WITH TWO OF THEM. THIS IS THE ONE PLACE THIS
//PARSER IS DELIBERATELY WIDER THAN tui/markup.rs: EVERYTHING THE TERMINAL RENDERS IS RENDERED HERE, AND
//A LINE LIKE THAT ONE IS RENDERED HERE AND NOT THERE
function dollar(chars: string[], index: number, out: Segment[], flush: () => void, missing: boolean[]): number | null
{
    const display = chars[index + 1] === "$";
    const close = display ? "$$" : "$";
    const start = index + close.length;
    const kind = 2 + close.length;

    if (missing[kind]) return null;
    if (start >= chars.length) return null;

    const end = seen(findEscaped(chars, start, close), missing, kind);

    if (end === null) return null;

    const text = chars.slice(start, end).join("");
    const loose = display || TEX.test(text);

    if (!loose && (/\s/.test(chars[start]) || /\s/.test(chars[end - 1]))) return null;
    if (!display && chars[end + 1] !== undefined && /[0-9]/.test(chars[end + 1])) return null;

    flush();

    //THE SPACES THAT WERE FORGIVEN ARE NOT PART OF THE FORMULA EITHER
    out.push({ kind: display ? "display" : "math", text: text.trim() });

    return end + close.length;
}

//A LINK, WHOSE TARGET HAS TO BE ONE WORD
function link(chars: string[], index: number, out: Segment[], flush: () => void, missing: boolean[]): number | null
{
    const kind = kindOf("[");

    if (missing[kind]) return null;

    const label = seen(findEscaped(chars, index + 1, "]"), missing, kind);

    if (label === null || chars[label + 1] !== "(") return null;

    const end = find(chars, label + 2, ")");

    if (end === null) return null;

    const text = chars.slice(index + 1, label).join("");
    const url = chars.slice(label + 2, end).join("");

    if (text.length === 0 || url.length === 0 || /\s/.test(url)) return null;

    flush();
    out.push({ kind: "link", text, url });

    return end + 1;
}

//EMPHASIS; A RUN ONLY OPENS IF ITS CLOSE IS ALREADY IN SIGHT
function emphasis(chars: string[], index: number, out: Segment[], flush: () => void,
    stack: { run: number; end: number; modifier: number }[], missing: boolean[], math: boolean): number | null
{
    //WHATEVER IS OPEN CLOSES HERE
    if (stack.length > 0 && stack[stack.length - 1].end === index)
    {
        const open = stack.pop()!;

        flush();
        out.push({ kind: "close", modifier: open.modifier });

        return index + open.run;
    }

    const char = chars[index];

    let run = 0;
    while (chars[index + run] === char && run < MAX_RUN) run++;

    const modifier = modifierOf(char, run);

    if (modifier === null) return null;

    const kind = kindOf(char);

    if (missing[kind]) return null;

    const start = index + run;

    if (chars[start] === undefined || /\s/.test(chars[start])) return null;
    if (char === "_" && index > 0 && ALNUM.test(chars[index - 1])) return null; //snake_case IS A WORD

    const end = seen(findRun(chars, start, char, run, math), missing, kind);

    if (end === null) return null;
    if (char === "_" && chars[end + run] !== undefined && ALNUM.test(chars[end + run])) return null;

    flush();
    stack.push({ run, end, modifier });
    out.push({ kind: "open", modifier });

    return start;
}

function modifierOf(char: string, run: number): number | null //WHAT A RUN OF THAT LENGTH MEANS
{
    if (char === "*") return run === 1 ? ITALIC : run === 2 ? BOLD : BOLD | ITALIC;
    if (char === "_") return run === 1 ? ITALIC : run === 2 ? UNDERLINE : UNDERLINE | ITALIC;

    return run === 1 ? null : STRIKE;
}

function kindOf(char: string): number //ITS SLOT IN THE MISSING TABLE
{
    return char === "*" ? 5 : char === "_" ? 6 : char === "~" ? 7 : 8;
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

//AND THE RUN THAT COULD CLOSE AN EMPHASIS, PAST BACKSLASHES, CODE AND MATH
function findRun(chars: string[], from: number, needle: string, run: number, math: boolean): number | null
{
    let index = from;

    while (index < chars.length)
    {
        if (chars[index] === "\\") { index += 2; continue; }

        const next = spanEnd(chars, index, math);

        if (next !== null) { index = next; continue; }

        let length = 0;
        while (chars[index + length] === needle && length < run) length++;

        if (length === 0) { index++; continue; }
        if (length >= run && !/\s/.test(chars[index - 1])) return index; //A CLOSE HANGS ON THE WORD BEFORE IT

        index += length;
    }

    return null;
}

function spanEnd(chars: string[], index: number, math: boolean): number | null //HOW FAR A CODE OR MATH SPAN REACHES
{
    const delimiter = chars[index] === "`" ? "`" : chars[index] === "$" && math ? "$" : null;

    if (delimiter === null) return null;

    let run = 0;
    while (chars[index + run] === delimiter && run < 3) run++;

    const end = find(chars, index + run, delimiter.repeat(run));

    return end === null ? null : end + run;
}

function seen(found: number | null, missing: boolean[], kind: number): number | null //A FAILED SEARCH IS NOT REPEATED
{
    missing[kind] = found === null;

    return found;
}

//THE ROWS A MESSAGE DRAWS AS - tui/markup.rs' render, MINUS THE WRAPPING A CELL GRID HAS TO DO ITSELF.
//THE LINE-LEVEL MARKDOWN IS TAKEN OFF THE FRONT OF A ROW, AND ONLY WHILE NOTHING IS ON IT YET: A HASH
//IN THE MIDDLE OF A SENTENCE IS A HASH, AND SO IS ONE A BACKSLASH TOOK THE MARKUP OFF
export function rows(segments: Segment[]): Row[]
{
    const out: Row[] = [];
    const stack: number[] = [];

    let nodes: Inline[] = [];
    let shape: Shape = { kind: "plain" };
    let open = true;  //A ROW IS BEING BUILT
    let start = true; //AND NOTHING IS ON IT YET

    const active = () => stack.reduce((all, modifier) => all | modifier, 0);

    const flush = () =>
    {
        if (!open) return;

        out.push({ kind: "row", shape, nodes });

        nodes = [];
        shape = { kind: "plain" };
        open = false;
    };

    //A ROW WITH NOTHING ON IT IS NOT A ROW; A MARKER WITH NOTHING AFTER IT STILL IS
    const close = () =>
    {
        if (nodes.length === 0 && shape.kind === "plain") open = false;
        else flush();
    };

    for (const segment of segments)
    {
        switch (segment.kind)
        {
            //THE ONLY LINE BREAK INSIDE TEXT
            case "text":
            {
                const parts = segment.text.split("\n");

                for (let index = 0; index < parts.length; index++)
                {
                    let part = parts[index];

                    if (index > 0)
                    {
                        flush();

                        open = true;
                        start = true;
                    }

                    //A LINE OF NOTHING BUT MARKERS IS A RULE
                    if (start && isRule(part))
                    {
                        out.push({ kind: "rule" });

                        open = false;
                        start = false;

                        continue;
                    }

                    if (start)
                    {
                        const found = marker(part);

                        if (found !== null)
                        {
                            shape = found.shape;
                            part = found.rest;
                            start = false;
                            open = true;
                        }
                    }

                    if (part.length > 0)
                    {
                        nodes.push({ kind: "text", text: part, modifier: active(), linkify: true });

                        open = true;
                        start = false;
                    }
                }

                break;
            }

            case "raw":
                nodes.push({ kind: "text", text: segment.text, modifier: active(), linkify: false });

                open = true;
                start = false;

                break;

            //A NEWLINE INSIDE INLINE CODE IS A SPACE: IT IS ONE RUN OF TEXT, AND A FENCE IS WHAT SPANS ROWS
            case "code":
                nodes.push({ kind: "code", text: segment.text.replace(/\n/g, " "), modifier: active() });

                open = true;
                start = false;

                break;

            case "math":
                nodes.push({ kind: "math", text: segment.text, modifier: active() });

                open = true;
                start = false;

                break;

            case "link":
                nodes.push({ kind: "link", text: segment.text, url: segment.url });

                open = true;
                start = false;

                break;

            //BOTH OWN THEIR ROWS, SO WHATEVER IS BEING BUILT CLOSES HERE
            case "block":
                close();
                out.push({ kind: "block", lang: segment.lang, body: segment.body });

                start = true;

                break;

            case "display":
                close();
                out.push({ kind: "display", text: segment.text });

                start = true;

                break;

            case "open": stack.push(segment.modifier); break;

            case "close":
                if (stack[stack.length - 1] === segment.modifier) stack.pop();

                break;
        }
    }

    //A MESSAGE THAT ENDS ON A BLOCK ENDS THERE
    flush();

    return out;
}

//THE LINE-LEVEL MARKDOWN, TAKEN OFF THE FRONT OF A ROW
function marker(part: string): { shape: Shape; rest: string } | null
{
    const body = part.replace(/^ +/, "");
    const indent = part.length - body.length;

    //A HEADING, WHOSE MARKER IS NOT DRAWN AT ALL
    const hashes = body.length - body.replace(/^#+/, "").length;

    if (hashes >= 1 && hashes <= MAX_HEADING && body[hashes] === " ")
    {
        return { shape: { kind: "heading", level: hashes, indent }, rest: body.slice(hashes).replace(/^ +/, "") };
    }

    if (body.startsWith("> ") || body === ">")
    {
        return { shape: { kind: "quote", indent }, rest: body.slice(2) };
    }

    if (["- ", "* ", "+ "].includes(body.slice(0, 2)))
    {
        return { shape: { kind: "bullet", indent }, rest: body.slice(2).replace(/^ +/, "") };
    }

    //AN ORDERED LIST KEEPS THE NUMBER IT WAS TYPED WITH
    const digits = body.length - body.replace(/^[0-9]+/, "").length;

    if (digits >= 1 && digits <= MAX_ORDINAL && (body[digits] === "." || body[digits] === ")") && body[digits + 1] === " ")
    {
        const shape: Shape = { kind: "ordinal", number: Number(body.slice(0, digits)), indent };

        return { shape, rest: body.slice(digits + 2).replace(/^ +/, "") };
    }

    return null;
}

function isRule(text: string): boolean //THREE OR MORE OF THE SAME MARKER, AND NOTHING ELSE
{
    const chars = [...text.trim()];

    if (chars.length < MIN_RULE || !"-*_".includes(chars[0])) return false;

    return chars.every((char) => char === chars[0]);
}

//WHETHER THERE IS ANYTHING IN A LINE FOR THE MARKUP TO DO. THE COMPOSER ASKS BEFORE IT DRAWS A PREVIEW:
//A LINE OF PLAIN TEXT PREVIEWED IS THE SAME LINE TWICE, WHICH IS A PANEL IN THE WAY AND NOTHING ELSE
export function hasMarkup(text: string, math: boolean): boolean
{
    const segments = parse(text, math);

    if (segments.some((segment) => segment.kind !== "text")) return true;

    return rows(segments).some((row) => row.kind !== "row" || row.shape.kind !== "plain");
}
