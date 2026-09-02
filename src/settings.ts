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

import type { AudioDevice, AudioDevices, ClientSetting, SettingRow, SettingsRow } from "./types";

//STARTUP-ONLY ONES IN USE
export const SAVE_LABEL = "Save";
export const RESTART_LABEL = "Restart server";

export const DEFAULT_DEVICE = "System default"; //SHOWN FOR AN EMPTY input_device/output_device

export const NO_DEVICES: AudioDevices = { input: [], output: [] };

//THE SYSTEM DEFAULT PLUS EVERY DEVICE cpal REPORTED, WITH THE CONFIGURED ONE GUARANTEED TO BE IN THE LIST -
//ONE THAT IS CONFIGURED BUT CURRENTLY UNPLUGGED STILL DESERVES A ROW
export function deviceEntries(devices: AudioDevices, id: string, input: boolean): AudioDevice[]
{
    const entries: AudioDevice[] = [{ id: "", label: DEFAULT_DEVICE }, ...(input ? devices.input : devices.output)];

    if (id && !entries.some((entry) => entry.id === id)) entries.push({ id, label: id });

    return entries;
}

//OUR OWN CONFIG, GROUPED THE WAY THE BRIDGE GROUPED IT
export function clientRows(settings: ClientSetting[]): SettingsRow[]
{
    const rows: SettingsRow[] = [];
    let section = "";

    for (const setting of settings)
    {
        if (setting.section !== section)
        {
            section = setting.section;
            if (section) rows.push({ row: "header", label: section });
        }

        rows.push({ row: "item", item: {
            label: setting.label,
            key: setting.key,
            value: setting.value,
            hint: "",
            changed: false,
            restart: false,
        } });
    }

    return rows;
}

//THE SERVER'S OWN CONFIG. NOTHING HERE NAMES A KEY - THE ROWS, THE HEADINGS AND THE HINTS ARE ALL WHATEVER
//server.toml TURNED OUT TO HOLD, SO A KEY ADDED THERE NEEDS NO CLIENT CHANGE AT ALL
export function serverRows(settings: SettingRow[]): SettingsRow[]
{
    const rows: SettingsRow[] = [];
    let section = "";

    for (const setting of settings)
    {
        if (setting.section !== section)
        {
            section = setting.section;
            if (section) rows.push({ row: "header", label: section });
        }

        rows.push({ row: "item", item: {
            label: setting.key.replace(/_/g, " "),
            key: setting.key,
            value: setting.value,
            hint: setting.description,
            changed: false,
            restart: setting.restart, //THE SERVER SAYS WHICH OF ITS OWN KEYS IT ONLY READS AT STARTUP
        } });
    }

    rows.push({ row: "action", label: SAVE_LABEL }); //NOTHING LEAVES THIS BOX UNTIL THIS IS PRESSED
    rows.push({ row: "action", label: RESTART_LABEL });

    return rows;
}

//MOVE THE SELECTION BY delta ROWS, SKIPPING HEADINGS AND STOPPING AT BOTH ENDS
export function stepRow(rows: SettingsRow[], from: number, delta: number): number
{
    let index = from;

    for (;;)
    {
        index += delta;

        //RAN OUT OF ROWS - KEEP WHATEVER WAS SELECTED
        if (index < 0 || index >= rows.length) return from;

        if (rows[index].row !== "header") return index;
    }
}

//LAND ON index, OR ON THE NEAREST ROW THAT IS NOT A HEADING - ONE AT THE VERY END IS WHY THE OTHER
//DIRECTION IS TRIED AS WELL
export function landRow(rows: SettingsRow[], index: number, direction: number): number
{
    if (rows.length === 0) return 0;

    const target = Math.min(Math.max(index, 0), rows.length - 1);
    if (rows[target].row !== "header") return target;

    const forward = stepRow(rows, target, direction);

    return forward === target ? stepRow(rows, target, -direction) : forward;
}

//THE LINES ALREADY SENT, AND WHERE IN THEM ↑/↓ CURRENTLY STANDS. THIS IS InputBuffer'S HISTORY OUT OF

//A ROW HAS BEEN EDITED AND NOT SENT BACK YET
export function unsavedRows(rows: SettingsRow[]): boolean
{
    return rows.some((row) => row.row === "item" && row.item.changed);
}

//BELOW THIS THE THREE COLUMNS DO NOT FIT SIDE BY SIDE, AND THE WINDOW BECOMES THE ONE EVERY PHONE CHAT
