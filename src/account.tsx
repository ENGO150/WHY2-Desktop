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

import { useState } from "react";

import type { AccountAction } from "./types";
import { Icon, IconButton } from "./icons";

//AN OPEN /account FORM
export interface AccountBox
{
    action: AccountAction;
    busy: boolean;
    error: string;
    round: number; //BUMPED ON A REFUSAL, WHICH EMPTIES THE FIELDS
}

//THE FIELDS PER ACTION, AS IN tui/account.rs
const LABELS: Record<AccountAction, string[]> =
{
    passwd: ["Current password", "New password", "Confirm new password"],
    delete: ["Current password"],
};

const FIELD = "mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-accent";
const CAPTION = "text-[11px] font-semibold uppercase tracking-wider text-muted";

//THE FORM
export function AccountDialog(
{
    box, cardRef, dialogWrap, dialogCard, narrow, submit, close,
}: {
    box: AccountBox;
    cardRef: React.RefObject<HTMLDivElement | null>;
    dialogWrap: string;
    dialogCard: (wide: string) => string;
    narrow: boolean;
    submit: (password: string, newPassword: string | null) => void;
    close: () => void;
})
{
    const labels = LABELS[box.action];
    const deleting = box.action === "delete";

    const [fields, setFields] = useState(() => labels.map(() => ""));
    const [armed, setArmed] = useState(false);
    const [error, setError] = useState("");

    //AN EDIT TAKES THE CONFIRMATION BACK
    const write = (index: number, value: string) =>
    {
        setFields(fields.map((field, at) => (at === index ? value : field)));
        setArmed(false);
    };

    const onSubmit = (event: React.FormEvent) =>
    {
        event.preventDefault();

        if (box.busy) return;

        const empty = fields.findIndex((field) => field === "");

        if (empty >= 0)
        {
            setError(`Enter the ${labels[empty].toLowerCase()}.`);
            return;
        }

        if (!deleting && fields[1] !== fields[2])
        {
            setFields([fields[0], fields[1], ""]);
            setError("Passwords do not match.");
            return;
        }

        //ASK TWICE
        if (deleting && !armed)
        {
            setArmed(true);
            setError("");
            return;
        }

        setError("");
        submit(fields[0], deleting ? null : fields[1]);
    };

    const status = box.busy
        ? <span className="text-accent">Waiting for the server…</span>
        : armed
            ? <span className="text-error">This cannot be undone. Press the button again to delete your account.</span>
            : error || box.error
                ? <span className="text-error">{error || box.error}</span>
                : null;

    return (
        <div
            onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
            className={dialogWrap}
        >
            <div
                ref={cardRef}
                tabIndex={-1}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
                className={`rise ${dialogCard("flex max-h-[84vh] w-full max-w-[420px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none")}`}
            >
                <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                    <Icon name={deleting ? "trash" : "lock"} className="h-4 w-4 shrink-0 text-muted" />
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{deleting ? "Delete account" : "Change password"}</h2>

                    <IconButton icon="close" label="Close" onClick={close} />
                </header>

                <form onSubmit={onSubmit} className="scroller scroller-quiet flex-1 px-5 py-4">
                    {labels.map((label, index) => (
                        <div key={label} className={index > 0 ? "mt-4" : ""}>
                            <label htmlFor={`account-${index}`} className={CAPTION}>{label}</label>

                            <input
                                id={`account-${index}`}
                                type="password"
                                value={fields[index]}
                                onChange={(event) => write(index, event.currentTarget.value)}
                                className={FIELD}
                                disabled={box.busy}
                                autoFocus={index === 0 && !narrow}
                            />
                        </div>
                    ))}

                    <div className="mt-2 min-h-[1.25rem] text-xs">{status}</div>

                    <button
                        type="submit"
                        disabled={box.busy}
                        className={`mt-3 w-full rounded-app py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${deleting ? "bg-error text-black/85" : "bg-accent text-black/85"}`}
                    >
                        {deleting ? (armed ? "Delete for good" : "Delete account") : "Change password"}
                    </button>

                    {deleting && <div className="mt-2 text-center text-[11px] text-faint">This also ends the session.</div>}
                </form>
            </div>
        </div>
    );
}
