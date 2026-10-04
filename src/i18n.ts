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

//WHAT i18n.rs::get_locale HANDS OVER
export interface Locale
{
    code: string;
    plurals: string;
    text: Record<string, string>;
}

type Args = Record<string, string | number>;

let current: Locale = { code: "en", plurals: "one-other", text: {} };

//SWAP THE LANGUAGE
export function setLocale(locale: Locale)
{
    current = locale;
    document.documentElement.lang = locale.code;
}

//THE LANGUAGE CODE, FOR Intl
export function language(): string
{
    return current.code;
}

//FILL {name} PLACEHOLDERS, {{ AND }} LITERAL
function fill(template: string, args?: Args): string
{
    if (!args) return template.replace(/\{\{|\}\}/g, (pair) => pair[0]);

    return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (match, name?: string) =>
        name === undefined ? match[0] : name in args ? String(args[name]) : match);
}

//WHICH FORM A COUNT TAKES (i18n.rs::category)
function category(count: number): string
{
    const tens = count % 10;
    const hundreds = count % 100;
    const teen = hundreds >= 12 && hundreds <= 14;

    switch (current.plurals)
    {
        case "other": return "other";
        case "one-few-other": return count === 1 ? "one" : count >= 2 && count <= 4 ? "few" : "other";
        case "one-few-many": return tens === 1 && hundreds !== 11 ? "one" : tens >= 2 && tens <= 4 && !teen ? "few" : "many";
        case "polish": return count === 1 ? "one" : tens >= 2 && tens <= 4 && !teen ? "few" : "many";
        default: return count === 1 ? "one" : "other";
    }
}

//TEXT FOR key, OR THE KEY
export function t(key: string, args?: Args): string
{
    return fill(current.text[key] ?? key, args);
}

//THE FORM FOR count, BOUND AS {count}
export function tn(key: string, count: number, args?: Args): string
{
    const form = current.text[`${key}.${category(count)}`] ?? current.text[`${key}.other`] ?? key;

    return fill(form, { ...args, count });
}

//A KEY THE LOCALE MAY NOT HAVE
export function tOr(key: string, fallback: string, args?: Args): string
{
    return key in current.text ? t(key, args) : fallback;
}

//THE TEXT EITHER SIDE OF {name}, null WHERE IT STANDS (i18n.rs::split)
export function around(key: string, name: string): (string | null)[]
{
    const [before, after] = t(key).split(`{${name}}`, 2);

    return after === undefined ? [before] : [before, null, after].filter((part) => part !== "");
}
