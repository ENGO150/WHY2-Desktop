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

import type { BlockRow } from "./types";

//THE FINGERPRINT IS 64 HEX CHARS - GROUPED IN EIGHTS AND BROKEN INTO ROWS SO IT CAN ACTUALLY BE
//COMPARED AGAINST WHAT THE OPERATOR PUBLISHED
export function fingerprint(hash: string): string[]
{
    const groups = hash.match(/.{1,8}/g) ?? [];
    const rows: string[] = [];

    for (let index = 0; index < groups.length; index += 4)
    {
        rows.push(groups.slice(index, index + 4).join(" "));
    }

    return rows;
}

//EVERY LIST BLOCK IS A TREE: ONE BRANCH PER ROW, THEN A RIGHT-ALIGNED ID COLUMN, THEN THE NAME.
//THE TRUNK KEEPS RUNNING PAST A NESTED ROW UNLESS ITS OWNER WAS THE LAST ONE
export function branches(rows: BlockRow[]): string[]
{
    const last = rows.map((row, index) =>
    {
        for (let next = index + 1; next < rows.length; next++)
        {
            if (rows[next].depth < row.depth) break;
            if (rows[next].depth === row.depth) return false;
        }

        return true;
    });

    return rows.map((row, index) =>
    {
        const branch = last[index] ? "╰─ " : "├─ ";

        if (row.depth === 0) return branch;

        let owner = index;
        while (owner >= 0 && rows[owner].depth !== 0) owner--;

        return `${owner < 0 || last[owner] ? "   " : "│  "}${branch}`;
    });
}

//WHAT A NAME SAYS THE FILE IS. THE PROTOCOL SENDS NO TYPE AND NO SIZE, SO THE EXTENSION IS THE ONLY
//THING THERE IS TO GO ON - AND AN UNKNOWN ONE STILL NAMES ITSELF RATHER THAN SAYING NOTHING
export const FILE_KINDS: [string, string, string[]][] =
[
    ["image", "Image", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "tiff"]],
    ["music", "Audio", ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "wma"]],
    ["video", "Video", ["mp4", "mkv", "webm", "mov", "avi", "wmv", "m4v"]],
    ["archive", "Archive", ["zip", "tar", "gz", "xz", "bz2", "7z", "rar", "zst"]],
    ["code", "Code", ["rs", "ts", "tsx", "js", "jsx", "py", "c", "h", "cpp", "hpp", "go", "java", "sh", "toml", "json", "yaml", "yml", "html", "css"]],
    ["file", "Document", ["txt", "md", "pdf", "doc", "docx", "odt", "rtf", "log"]],
];

export function fileKind(name: string): { icon: string; label: string }
{
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";

    const found = FILE_KINDS.find(([, , extensions]) => extensions.includes(extension));
    if (found) return { icon: found[0], label: found[1] };

    return { icon: "file", label: extension ? `${extension.toUpperCase()} file` : "File" };
}

//A LINE IS TEXT WITH LINKS IN IT, AND THIS IS WHERE THEY ARE. THE PROTOCOL CARRIES NO MARKUP, SO THE
//ONLY THING TO GO ON IS THE http:// OR https:// ITSELF - AND ONLY THOSE TWO, SINCE A LINK IS OPENED IN
//THE BROWSER AND file:// OR javascript: ARE NOT THINGS A STRANGER ON A SERVER GETS TO HAND US.
//THE TRAILING PUNCTUATION IS WALKED BACK OFF: A URL AT THE END OF A SENTENCE KEEPS THE FULL STOP
//OTHERWISE, AND A CLOSING BRACKET ONLY BELONGS TO THE URL IF IT OPENED ONE
const LINK = /https?:\/\/[^\s<>"']+/gi;

export interface TextPart
{
    text: string;
    href?: string;
}

export function linkParts(text: string): TextPart[]
{
    const parts: TextPart[] = [];
    let at = 0;

    for (const match of text.matchAll(LINK))
    {
        let found = match[0];

        while (found.length > 0)
        {
            const last = found[found.length - 1];

            if (".,;:!?'\"".includes(last) || (last === ")" && !found.includes("(")))
            {
                found = found.slice(0, -1);
                continue;
            }

            break;
        }

        //NOTHING LEFT OF IT ONCE THE PUNCTUATION IS OFF, SO IT WAS NEVER A LINK
        if (!/^https?:\/\/[^\s/]+/i.test(found)) continue;

        const start = match.index;

        if (start > at) parts.push({ text: text.slice(at, start) });

        parts.push({ text: found, href: found });
        at = start + found.length;
    }

    if (at < text.length) parts.push({ text: text.slice(at) });

    return parts;
}
