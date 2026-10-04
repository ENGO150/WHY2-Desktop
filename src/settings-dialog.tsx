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

import type { SettingsBox, SettingsItem, AccountAction } from "./types";
import { Icon } from "./icons";
import { Switch, Overlay, PanelHeader, PanelFooter } from "./components";
import { RESTART_LABEL, DEFAULT_DEVICE, NO_CHOICE, unsavedRows } from "./settings";
import { THEMES, type Theme } from "./themes";

//tui/settings.rs WITH CONTROLS: OURS WRITES THROUGH, THE SERVER'S IS SAVED IN ONE GO
export function SettingsDialog(
{
    settings, settingsRef, settingsRowRef, pickerRowRef, narrow,
    onKeyDown, setToggle, setVolume, setPicked, activateRow, commitEdit, editSettings, account, theme, pickTheme, close,
}: {
    settings: SettingsBox;
    settingsRef: React.RefObject<HTMLDivElement | null>;
    settingsRowRef: React.RefObject<HTMLDivElement | null>;
    pickerRowRef: React.RefObject<HTMLDivElement | null>;
    narrow: boolean;
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
    setToggle: (index: number, on: boolean) => void;
    setVolume: (index: number, percent: number, max: number) => void;
    setPicked: (index: number, id: string) => void; //A DEVICE OR A CHOICE
    activateRow: (index: number) => void;
    commitEdit: () => void;
    editSettings: (change: (box: SettingsBox) => SettingsBox | null) => void;
    account: ((action: AccountAction) => void) | null; //OURS ONLY, WHERE THE SERVER HAS /account
    theme: string | null; //OURS ONLY
    pickTheme: (id: string) => void;
    close: () => void;
})
{
    const box = settings;
    const editing = box.edit !== null;
    const unsaved = unsavedRows(box.rows);

    //THE ACTIONS ARE ROWS TO THE KEYBOARD, BUTTONS IN THE FOOTER
    const listed = box.rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.row !== "action");
    const actions = box.rows.map((row, index) => ({ row, index })).filter((entry) => entry.row.row === "action");

    //ON A PHONE THE CONTROL GOES UNDER THE NAME, EXCEPT A SWITCH
    const stacks = (item: SettingsItem) => narrow && item.value.kind !== "toggle";

    const picker = "flex items-center gap-2 rounded-lg bg-active px-3 py-1.5 text-left text-[13.5px] transition hover:brightness-125";

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
                    <span className={`w-[5ch] text-right text-[13px] tabular-nums ${percent === 0 ? "text-error" : "text-muted"}`}>{percent}%</span>
                </div>
            );
        }

        //THE LABEL IS LOOKED UP FOR THE cpal ID
        if (item.value.kind === "device")
        {
            const { id, input } = item.value.value;
            const found = (input ? box.devices.input : box.devices.output).find((device) => device.id === id);

            return (
                <button type="button" onClick={(event) => { event.stopPropagation(); activateRow(index); }} className={`${picker} ${wide}`}>
                    <span className={`min-w-0 flex-1 truncate ${id ? "" : "text-muted"}`}>{id ? found?.label ?? id : DEFAULT_DEVICE}</span>
                    <Icon name="chevron" className="h-4 w-4 shrink-0 text-faint" />
                </button>
            );
        }

        if (item.value.kind === "choice")
        {
            const { id, options } = item.value.value;
            const found = options.find((option) => option.id === id);

            return (
                <button type="button" onClick={(event) => { event.stopPropagation(); activateRow(index); }} className={`${picker} ${wide}`}>
                    <span className={`min-w-0 flex-1 truncate ${id ? "" : "text-muted"}`}>{id ? found?.label ?? id : NO_CHOICE}</span>
                    <Icon name="chevron" className="h-4 w-4 shrink-0 text-faint" />
                </button>
            );
        }

        //A NUMBER OR A STRING IS TYPED INTO THE ROW
        if (editing && index === box.selected)
        {
            return (
                <input
                    autoFocus
                    value={box.edit ?? ""}
                    onChange={(event) =>
                    {
                        const typed = event.currentTarget.value;

                        //DIGITS, AND A LEADING MINUS
                        if (item.value.kind === "number" && !/^-?\d*$/.test(typed)) return;

                        editSettings((current) => ({ ...current, edit: typed }));
                    }}
                    onKeyDown={(event) =>
                    {
                        event.stopPropagation();

                        //ENTER KEEPS, ESC PUTS IT BACK
                        if (event.key === "Enter") { event.preventDefault(); commitEdit(); }
                        else if (event.key === "Escape") { event.preventDefault(); editSettings((current) => ({ ...current, edit: null })); }
                        else return;

                        settingsRef.current?.focus();
                    }}
                    onBlur={commitEdit}
                    className={`${wide} rounded-lg border border-accent bg-transparent px-3 py-1.5 text-[13.5px] text-text caret-accent outline-none`}
                    spellCheck={false}
                />
            );
        }

        const text = String(item.value.value);

        return (
            <button
                type="button"
                onClick={(event) => { event.stopPropagation(); activateRow(index); }}
                className={`${wide} truncate rounded-lg bg-active px-3 py-1.5 text-left text-[13.5px] transition hover:brightness-125`}
            >
                {text || <span className="text-faint">empty</span>}
            </button>
        );
    };

    //ONE PALETTE, AS A LITTLE WINDOW
    const swatch = (entry: Theme) =>
    {
        const chosen = entry.id === theme;
        const [side, page, ink] = entry.swatch;

        return (
            <button
                key={entry.id}
                type="button"
                aria-pressed={chosen}
                onClick={() => pickTheme(entry.id)}
                className="flex flex-col items-start gap-1.5"
            >
                <span
                    className={`flex h-[62px] w-[96px] overflow-hidden rounded-lg border-2 transition-colors ${chosen ? "border-text" : "border-border hover:border-border-strong"}`}
                    style={{ background: page }}
                >
                    <span className="h-full w-[30%]" style={{ background: side }} />
                    <span className="flex flex-1 flex-col gap-1.5 p-2">
                        <span className="h-1.5 w-[70%] rounded-full" style={{ background: ink, opacity: 0.85 }} />
                        <span className="h-1 w-full rounded-full" style={{ background: ink, opacity: 0.25 }} />
                        <span className="h-1 w-[80%] rounded-full" style={{ background: ink, opacity: 0.25 }} />
                    </span>
                </span>

                <span className={`text-[12.5px] ${chosen ? "font-medium text-text" : "text-muted"}`}>{entry.name}</span>
            </button>
        );
    };

    //THE ROWS, BOXED BY SECTION
    const groups: { label: string | null; rows: { item: SettingsItem; index: number }[] }[] = [];

    for (const { row, index } of listed)
    {
        if (row.row === "header") groups.push({ label: row.label, rows: [] });
        else if (row.row === "item")
        {
            if (groups.length === 0) groups.push({ label: null, rows: [] });
            groups[groups.length - 1].rows.push({ item: row.item, index });
        }
    }

    const section = (label: string | null, children: React.ReactNode, key: string) => (
        <div key={key} id={`settings-${key}`} className="scroll-mt-4 pt-6 first:pt-1">
            {label && <h3 className="mb-2 text-[15px] font-semibold">{label}</h3>}
            <div className="group-box">{children}</div>
        </div>
    );

    //THE NAV, AND WHICH ENTRY THE SELECTED ROW IS UNDER
    const nav: { key: string; label: string }[] = [];

    if (theme !== null) nav.push({ key: "appearance", label: "Appearance" });
    groups.forEach((group, at) => nav.push({ key: `group-${at}`, label: group.label ?? "General" }));
    if (account) nav.push({ key: "account", label: "Account" });

    const current = groups.findIndex((group) => group.rows.some((row) => row.index === box.selected));

    return (
        <Overlay
            narrow={narrow}
            width={760}
            label={box.server ? "Server settings" : "Settings"}
            cardRef={settingsRef}
            onKeyDown={onKeyDown}
            close={close}
        >
            <div className="flex min-h-0 flex-1">
            {!narrow && (
                <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-2 pt-4">
                    <div className="px-2.5 pb-2 text-[16px] font-semibold">{box.server ? "Server" : "Settings"}</div>

                    {nav.map((entry) => (
                        <button
                            key={entry.key}
                            type="button"
                            onClick={() => document.getElementById(`settings-${entry.key}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
                            className={`rounded-md px-2.5 py-1.5 text-left text-[13.5px] transition-colors ${entry.key === `group-${current}` ? "bg-selected font-medium text-text" : "text-muted hover:bg-hover hover:text-text"}`}
                        >
                            {entry.label}
                        </button>
                    ))}
                </nav>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
            <PanelHeader
                title={narrow ? (box.server ? "Server settings" : "Settings") : ""}
                aside={box.saving
                    ? <span className="text-[13px] text-muted">Saving…</span>
                    : unsaved ? <span className="text-[13px] text-muted">Unsaved changes</span> : null}
                close={close}
            />

            <div className="scroller h-[min(640px,70vh)] flex-1 px-6 pb-6 pt-0">
                {/* THE WINDOW'S PALETTE */}
                {theme !== null && section("Appearance", (
                    <div className="flex flex-wrap gap-4 px-4 py-4">
                        {THEMES.map(swatch)}
                    </div>
                ), "appearance")}

                {groups.map((group, at) => section(group.label, group.rows.map(({ item, index }) =>
                {
                    const chosen = index === box.selected;
                    const stacked = stacks(item);

                    return (
                        <div
                            key={item.key}
                            ref={chosen ? settingsRowRef : undefined}
                            onMouseDown={() => editSettings((current) => ({ ...current, selected: index }))}
                            onClick={() => { if (item.value.kind === "toggle") activateRow(index); }}
                            className={`flex px-4 py-2.5 transition-colors ${stacked ? "flex-col items-start gap-2" : "items-center gap-6"} ${chosen ? "bg-selected" : ""}`}
                        >
                            <div className={`min-w-0 ${stacked ? "w-full" : "flex-1"}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[14px]">{item.label}</span>

                                    {/* UNSAVED, OR ONLY READ AT STARTUP */}
                                    {item.changed && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Edited" />}
                                    {item.restart && <span className="rounded-full bg-warning/15 px-2 py-px text-[11px] font-medium text-warning">Restart</span>}
                                </div>

                                {item.hint && <div className="mt-0.5 pr-2 text-[12.5px] leading-snug text-faint">{item.hint}</div>}
                            </div>

                            <div className={stacked ? "w-full" : "shrink-0"}>{control(item, index)}</div>
                        </div>
                    );
                }), `group-${at}`))}

                {/* THE SERVER'S, NOT client.toml'S */}
                {account && section("Account", (
                    <>
                        <button type="button" onClick={() => account("passwd")} className="flex w-full items-center px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-hover">
                            <span className="flex-1">Change password</span>
                            <Icon name="chevron_right" className="h-4 w-4 text-faint" />
                        </button>

                        <button type="button" onClick={() => account("delete")} className="flex w-full items-center px-4 py-2.5 text-left text-[14px] text-error transition-colors hover:bg-hover">
                            Delete account
                        </button>
                    </>
                ), "account")}
            </div>

            {/* ONLY THE SERVER'S ROWS NEED A BUTTON */}
            {actions.length > 0 && (
                <PanelFooter>
                    {box.confirm && <span className="mr-auto text-[13px] text-error">Everybody will be disconnected.</span>}

                    {actions.map(({ row, index }) =>
                    {
                        if (row.row !== "action") return null;

                        const restart = row.label === RESTART_LABEL;
                        const live = restart ? !unsaved && !box.saving : unsaved && !box.saving;
                        const armed = restart && box.confirm;
                        const chosen = index === box.selected;

                        return (
                            <button
                                key={row.label}
                                type="button"
                                disabled={!live}
                                onClick={() => activateRow(index)}
                                className={`btn ${restart ? `btn-danger ${armed ? "armed" : ""}` : "btn-accent"} ${chosen ? "ring-2 ring-border-strong ring-offset-2 ring-offset-overlay" : ""}`}
                            >
                                {armed ? "Restart now" : row.label}
                            </button>
                        );
                    })}
                </PanelFooter>
            )}
            </div>
            </div>

            {/* THE LIST A DEVICE OR CHOICE ROW OPENS */}
            {box.picker && (
                <div
                    onMouseDown={(event) =>
                    {
                        if (event.target !== event.currentTarget) return;

                        editSettings((current) => ({ ...current, picker: null }));
                        settingsRef.current?.focus();
                    }}
                    className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 px-6"
                >
                    <div className="w-full max-w-[400px] overflow-hidden rounded-xl border border-border-strong bg-overlay p-1 shadow-2xl">
                        <div className="label px-3 pb-1.5 pt-2">{box.picker.title}</div>

                        <div className="scroller" style={{ maxHeight: "48vh" }}>
                            {box.picker.entries.map((entry, index) =>
                            {
                                const chosen = index === box.picker!.selected;
                                const owner = box.rows[box.picker!.row];
                                const using = owner?.row === "item"
                                    && (owner.item.value.kind === "device" || owner.item.value.kind === "choice")
                                    && owner.item.value.value.id === entry.id;

                                return (
                                    <div
                                        key={entry.id || "default"}
                                        ref={chosen ? pickerRowRef : undefined}
                                        onMouseEnter={() => editSettings((current) => (current.picker ? { ...current, picker: { ...current.picker, selected: index } } : current))}
                                        onClick={() =>
                                        {
                                            setPicked(box.picker!.row, entry.id);
                                            editSettings((current) => ({ ...current, picker: null }));
                                            settingsRef.current?.focus();
                                        }}
                                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[14px] ${chosen ? "bg-selected" : ""}`}
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
        </Overlay>
    );
}
