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
import { Overlay, PanelHeader } from "./components";
import { t } from "./i18n";

//AN OPEN /account FORM
export interface AccountBox
{
    action: AccountAction;
    busy: boolean;
    error: string;
    round: number; //BUMPED ON A REFUSAL, WHICH EMPTIES THE FIELDS
}

//THE FIELDS PER ACTION, AS IN tui/account.rs
const FIELDS: Record<AccountAction, string[]> =
{
    passwd: ["current", "new", "confirm"],
    delete: ["current"],
};

//THE FORM
export function AccountDialog(
{
    box, cardRef, narrow, submit, close,
}: {
    box: AccountBox;
    cardRef: React.RefObject<HTMLDivElement | null>;
    narrow: boolean;
    submit: (password: string, newPassword: string | null) => void;
    close: () => void;
})
{
    const fieldKeys = FIELDS[box.action];
    const labels = fieldKeys.map((key) => t(`account.label.${key}`));
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
            setError(t(`account.missing.${fieldKeys[empty]}`));
            return;
        }

        if (!deleting && fields[1] !== fields[2])
        {
            setFields([fields[0], fields[1], ""]);
            setError(t("account.mismatch"));
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
        ? <span className="text-muted">{t("login.waiting")}</span>
        : armed
            ? <span className="text-error">{t("acct.delete_warning")}</span>
            : error || box.error
                ? <span className="text-error">{error || box.error}</span>
                : null;

    return (
        <Overlay narrow={narrow} width={400} label={deleting ? t("account.title.delete") : t("account.title.passwd")} cardRef={cardRef} close={close}>
            <PanelHeader title={deleting ? t("account.title.delete") : t("account.title.passwd")} close={close} />

            <form onSubmit={onSubmit} className="scroller scroller-quiet flex-1 px-6 pb-6 pt-3">
                <div className="flex flex-col gap-3">
                    {labels.map((label, index) => (
                        <input
                            key={fieldKeys[index]}
                            id={`account-${index}`}
                            type="password"
                            aria-label={label}
                            placeholder={label}
                            value={fields[index]}
                            onChange={(event) => write(index, event.currentTarget.value)}
                            className="field"
                            disabled={box.busy}
                            autoFocus={index === 0 && !narrow}
                        />
                    ))}
                </div>

                {status && <div className="mt-3 text-[13px]">{status}</div>}

                <button
                    type="submit"
                    disabled={box.busy}
                    className={`btn mt-5 w-full py-2.5 ${deleting ? "btn-danger armed" : "btn-accent"}`}
                >
                    {deleting ? (armed ? t("acct.delete_for_good") : t("account.title.delete")) : t("account.title.passwd")}
                </button>
            </form>
        </Overlay>
    );
}
