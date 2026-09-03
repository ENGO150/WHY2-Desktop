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

import type { SettingsBox, SettingsItem } from "./types";
import { Icon, IconButton } from "./icons";
import { Switch } from "./components";
import { RESTART_LABEL, DEFAULT_DEVICE, unsavedRows } from "./settings";

//tui/settings.rs WITH REAL CONTROLS IN IT. THE TWO HALVES ARE NOT SYMMETRICAL AND THAT IS THE WHOLE
//SHAPE OF IT: client.toml IS OURS AND A ROW IS WRITTEN THROUGH THE MOMENT IT IS FLIPPED, WHILE
//server.toml IS NOT - ITS ROWS ARE EDITED LOCALLY, MARKED, AND SENT IN ONE GO. THE Save AND
//Restart server ROWS ARE STILL ROWS AS FAR AS THE KEYBOARD IS CONCERNED, DRAWN AS BUTTONS IN THE FOOTER
export function SettingsDialog(
{
    settings, settingsRef, settingsRowRef, pickerRowRef, dialogWrap, dialogCard, narrow,
    onKeyDown, setToggle, setVolume, setDevice, activateRow, commitEdit, editSettings, close,
}: {
    settings: SettingsBox;
    settingsRef: React.RefObject<HTMLDivElement | null>;
    settingsRowRef: React.RefObject<HTMLDivElement | null>;
    pickerRowRef: React.RefObject<HTMLDivElement | null>;
    dialogWrap: string;
    dialogCard: (wide: string) => string;
    narrow: boolean;
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    setToggle: (index: number, on: boolean) => void;
    setVolume: (index: number, percent: number, max: number) => void;
    setDevice: (index: number, id: string) => void;
    activateRow: (index: number) => void;
    commitEdit: () => void;
    editSettings: (change: (box: SettingsBox) => SettingsBox | null) => void;
    close: () => void;
})
{
        const box = settings;
        const editing = box.edit !== null;
        const unsaved = unsavedRows(box.rows);

        //THE ACTIONS ARE ROWS LIKE ANY OTHER AS FAR AS THE KEYBOARD IS CONCERNED, BUT THEY BELONG IN THE
        //FOOT OF THE DIALOG AND NOT IN THE MIDDLE OF THE LIST - SO THEY ARE DRAWN THERE, INDEX AND ALL
        const listed = box.rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.row !== "action");
        const actions = box.rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.row === "action");

        //A ROW IS A NAME AND A CONTROL BESIDE IT UNTIL THERE IS NOT THE ROOM, AND ON A PHONE THERE NEVER
        //IS: A 220px CONTROL AND A 24px GAP LEAVE A SETTING'S NAME ABOUT THREE LETTERS AND AN ELLIPSIS.
        //SO THE CONTROL GOES UNDER THE NAME AND TAKES THE WIDTH - EXCEPT A SWITCH, WHICH IS SMALL ENOUGH
        //TO STAY WHERE EVERY OTHER SETTINGS SCREEN PUTS IT, ON THE RIGHT OF THE THING IT TURNS OFF
        const stacks = (item: SettingsItem) => narrow && item.value.kind !== "toggle";

        const control = (item: SettingsItem, index: number) =>
        {
            const wide = stacks(item) ? "w-full" : "w-[220px]";

            if (item.value.kind === "toggle")
            {
                const on = item.value.value;

                return <Switch on={on} onClick={() => setToggle(index, !on)} />;
            }

            if (item.value.kind === "volume")
            {
                const { percent, max, step } = item.value.value;

                return (
                    <div className={`flex items-center gap-3 ${stacks(item) ? "w-full" : ""}`}>
                        <Icon name={percent === 0 ? "speaker_off" : "speaker"} className={`h-4 w-4 ${percent === 0 ? "text-faint" : "text-muted"}`} />
                        <input
                            type="range"
                            min={0}
                            max={max}
                            step={step}
                            value={percent}
                            onChange={(event) => setVolume(index, Number(event.currentTarget.value), max)}
                            onKeyDown={(event) => event.stopPropagation()}
                            className={`slider ${stacks(item) ? "min-w-0 flex-1" : "w-[150px]"}`}
                            style={{ accentColor: "var(--accent)" }}
                        />
                        <span className="w-[4ch] text-right font-mono text-xs text-muted">{percent}%</span>
                    </div>
                );
            }

            //client.toml HOLDS THE cpal ID, WHICH IS NOT SOMETHING TO READ - THE LABEL IS LOOKED UP FOR IT
            if (item.value.kind === "device")
            {
                const { id, input } = item.value.value;
                const found = (input ? box.devices.input : box.devices.output).find((device) => device.id === id);

                return (
                    <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); activateRow(index); }}
                        className={`flex ${wide} items-center gap-2 rounded-app border border-border bg-deep px-3 py-1.5 text-left text-sm hover:border-border-strong`}
                    >
                        <span className={`min-w-0 flex-1 truncate ${id ? "" : "text-muted"}`}>{id ? found?.label ?? id : DEFAULT_DEVICE}</span>
                        <Icon name="chevron" className="h-4 w-4 shrink-0 text-faint" />
                    </button>
                );
            }

            //A NUMBER OR A STRING IS TYPED INTO THE ROW ITSELF
            if (editing && index === box.selected)
            {
                return (
                    <input
                        autoFocus
                        value={box.edit ?? ""}
                        onChange={(event) =>
                        {
                            const typed = event.currentTarget.value;

                            //A NUMBER ROW ONLY TAKES A NUMBER - THE MINUS SIGN ONLY AS THE FIRST CHARACTER
                            if (item.value.kind === "number" && !/^-?\d*$/.test(typed)) return;

                            editSettings((current) => ({ ...current, edit: typed }));
                        }}
                        onKeyDown={(event) =>
                        {
                            event.stopPropagation();

                            //ESC PUTS THE OLD VALUE BACK, ENTER KEEPS WHAT WAS TYPED - AND EITHER WAY THE
                            //KEYBOARD GOES BACK TO THE DIALOG
                            if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
                            else if (event.key === "Escape") { event.preventDefault(); editSettings((current) => ({ ...current, edit: null })); }
                            else return;

                            settingsRef.current?.focus();
                        }}
                        onBlur={commitEdit}
                        className={`${wide} rounded-app border border-accent bg-deep px-3 py-1.5 text-sm text-accent caret-accent outline-none`}
                        spellCheck={false}
                    />
                );
            }

            const text = String(item.value.value);

            return (
                <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); activateRow(index); }}
                    className={`${wide} truncate rounded-app border border-border bg-deep px-3 py-1.5 text-left text-sm hover:border-border-strong`}
                >
                    {text || <span className="text-faint">empty</span>}
                </button>
            );
        };

        return (
            <div
                //ANYWHERE OUTSIDE THE BOX IS "I AM DONE HERE" - ON THE PRESS AND NOT THE RELEASE, SO A
                //SELECTION DRAGGED OUT OF THE DIALOG DOES NOT CLOSE IT ON LETTING GO
                onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
                className={dialogWrap}
            >
                <div
                    ref={settingsRef}
                    tabIndex={-1}
                    onKeyDown={onKeyDown}
                    className={`rise relative ${dialogCard("flex max-h-[84vh] w-full max-w-[660px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none")}`}
                >
                    <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                        <Icon name="gear" className="h-4 w-4 text-muted" />
                        <h2 className="flex-1 text-[15px] font-semibold">{box.server ? "Server settings" : "Settings"}</h2>

                        {box.saving && <span className="text-xs text-muted">saving</span>}
                        {!box.saving && unsaved && <span className="text-xs text-notice">unsaved changes</span>}

                        <IconButton icon="close" label="Close" onClick={close} />
                    </header>

                    <div className="scroller flex-1 px-3 py-2">
                        {listed.map(({ row, index }) =>
                        {
                            //A SECTION HEADING CARRIES A RULE OUT TO THE EDGE, WHICH IS WHAT SEPARATES THE GROUPS
                            if (row.row === "header")
                            {
                                return (
                                    <div key={`header-${row.label}`} className="flex items-center gap-3 px-2 pb-1 pt-5 first:pt-2">
                                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{row.label}</span>
                                        <span className="h-px flex-1 bg-border" />
                                    </div>
                                );
                            }

                            if (row.row !== "item") return null;

                            const item = row.item;
                            const chosen = index === box.selected;
                            const stacked = stacks(item);

                            return (
                                <div
                                    key={item.key}
                                    ref={chosen ? settingsRowRef : undefined}
                                    onMouseDown={() => editSettings((current) => ({ ...current, selected: index }))}
                                    onClick={() => { if (item.value.kind === "toggle") activateRow(index); }}
                                    className={`flex rounded-app border-l-2 px-3 py-2.5 ${stacked ? "flex-col items-start gap-2" : "items-center gap-6"} ${chosen ? "border-accent bg-selected" : "border-transparent hover:bg-hover"}`}
                                >
                                    <div className={`min-w-0 ${stacked ? "w-full" : "flex-1"}`}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {/* A SETTING'S NAME IS A PHRASE AND NOT SOMETHING MEASURED IN
                                                CHARACTERS, SO A LONG ONE WRAPS RATHER THAN BEING CUT */}
                                            <span className="text-sm">{item.label}</span>

                                            {/* AN EDITED ROW IS MARKED UNTIL THE SERVER HAS SAID WHAT IT STORED, AND ONE IT
                                                WILL NOT PICK UP UNTIL IT IS RESTARTED CARRIES THAT SAVED OR NOT */}
                                            {item.changed && <span className="rounded bg-notice/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-notice">edited</span>}
                                            {item.restart && <span className="rounded bg-warning/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">restart</span>}
                                        </div>

                                        {item.hint && <div className="mt-0.5 pr-2 text-xs leading-snug text-faint">{item.hint}</div>}
                                    </div>

                                    <div className={stacked ? "w-full" : "shrink-0"}>{control(item, index)}</div>
                                </div>
                            );
                        })}
                    </div>

                    {/* THE SERVER'S ROWS ARE THE ONLY ONES THAT ARE NOT WRITTEN THROUGH ON THE SPOT, SO THEY
                        ARE THE ONLY ONES WITH ANYTHING TO PRESS */}
                    {actions.length > 0 && (
                        <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-deep/40 px-5 py-3">
                            <span className="flex-1 text-xs text-faint">
                                {box.confirm
                                    ? "Restarting drops every client on the server."
                                    : unsaved ? "Nothing leaves this window until you save." : "Arrows move and change, esc closes."}
                            </span>

                            {actions.map(({ row, index }) =>
                            {
                                if (row.row !== "action") return null;

                                const restart = row.label === RESTART_LABEL;
                                const live = restart ? !unsaved && !box.saving : unsaved && !box.saving;
                                const armed = restart && box.confirm;
                                const chosen = index === box.selected;

                                const skin = restart
                                    ? `border ${armed ? "border-error bg-error/15 text-error" : "border-border text-muted hover:border-error hover:text-error"}`
                                    : "bg-accent text-black/85 hover:brightness-110";

                                return (
                                    <button
                                        key={row.label}
                                        type="button"
                                        disabled={!live}
                                        onClick={() => activateRow(index)}
                                        className={`rounded-app px-4 py-1.5 text-sm font-semibold transition ${skin} ${chosen ? "ring-2 ring-accent/60" : ""} disabled:cursor-not-allowed disabled:opacity-40`}
                                    >
                                        {armed ? "Press again" : row.label}
                                    </button>
                                );
                            })}
                        </footer>
                    )}

                    {/* THE DEVICE LIST, ON TOP OF THE ROWS AND NOT BESIDE THEM - IT IS ANSWERING THE ROW
                        UNDERNEATH IT, AND THERE IS NOTHING ELSE TO DO IN THE DIALOG UNTIL IT IS ANSWERED */}
                    {box.picker && (
                        <div
                            onMouseDown={(event) =>
                            {
                                if (event.target !== event.currentTarget) return;

                                editSettings((current) => ({ ...current, picker: null }));
                                settingsRef.current?.focus();
                            }}
                            className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 px-6"
                        >
                            <div className="rise w-full max-w-[440px] overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl">
                                <div className="border-b border-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                                    {box.picker.title}
                                </div>

                                <div className="scroller p-1" style={{ maxHeight: "48vh" }}>
                                    {box.picker.entries.map((entry, index) =>
                                    {
                                        const chosen = index === box.picker!.selected;
                                        const owner = box.rows[box.picker!.row];
                                        const using = owner?.row === "item" && owner.item.value.kind === "device" && owner.item.value.value.id === entry.id;

                                        return (
                                            <div
                                                key={entry.id || "default"}
                                                ref={chosen ? pickerRowRef : undefined}
                                                onMouseEnter={() => editSettings((current) => (current.picker ? { ...current, picker: { ...current.picker, selected: index } } : current))}
                                                onClick={() =>
                                                {
                                                    setDevice(box.picker!.row, entry.id);
                                                    editSettings((current) => ({ ...current, picker: null }));
                                                    settingsRef.current?.focus();
                                                }}
                                                className={`flex cursor-pointer items-center gap-2 rounded-app px-3 py-2 text-sm ${chosen ? "bg-selected" : ""}`}
                                            >
                                                <span className={`min-w-0 flex-1 truncate ${entry.id ? "" : "text-muted"}`}>{entry.label}</span>
                                                {using && <Icon name="check" className="h-4 w-4 shrink-0 text-accent" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
}
