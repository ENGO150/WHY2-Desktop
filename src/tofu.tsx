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

import type { TofuPrompt } from "./types";
import { Icon } from "./icons";
import { fingerprint } from "./format";

//WHAT REPLACING A PINNED KEY HAS TO BE TYPED OUT AS
export const CHALLENGE = "yes";

//THE IDENTITY CHECK: A BUTTON FOR A FIRST CONTACT, TYPED OUT FOR A CHANGED KEY
export function TofuDialog(
{
    tofu, typed, setTyped, answer,
}: {
    tofu: TofuPrompt;
    typed: string;
    setTyped: (value: string) => void;
    answer: (accept: boolean) => void;
})
{
    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="w-full max-w-[440px] overflow-hidden rounded-xl border border-border-strong bg-overlay p-6 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)]">
                <div className="flex flex-col items-center text-center">
                    <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${tofu.mismatch ? "bg-error/12 text-error" : "bg-active text-text"}`}>
                        <Icon name={tofu.mismatch ? "alert" : "lock"} className="h-6 w-6" />
                    </span>

                    <h2 className="mt-4 text-[17px] font-semibold">{tofu.mismatch ? "Server key changed" : "Trust this server?"}</h2>
                    <div className="mt-1 break-all text-[14px] text-muted">{tofu.host}</div>
                </div>

                <div className="mt-5 rounded-lg border border-border px-4 py-3 text-center font-mono text-[12.5px] leading-6">
                    {tofu.mismatch && fingerprint(tofu.pinned ?? "").map((row) => <div key={row} className="text-faint line-through">{row}</div>)}
                    {fingerprint(tofu.hash).map((row) => <div key={row} className={tofu.mismatch ? "text-error" : "text-text"}>{row}</div>)}
                </div>

                {/* A CHANGED KEY IS TYPED OUT */}
                {tofu.mismatch && (
                    <input
                        id="tofu-input"
                        type="text"
                        aria-label={`Type ${CHALLENGE} to replace the key`}
                        placeholder={`Type "${CHALLENGE}" to replace the key`}
                        value={typed}
                        onChange={(event) => setTyped(event.currentTarget.value.toLowerCase())}
                        onKeyDown={(event) => { if (event.key === "Enter") answer(true); }}
                        className="field mt-4 text-center focus:border-error"
                        autoFocus
                        spellCheck={false}
                    />
                )}

                <div className="mt-5 flex gap-2">
                    <button type="button" onClick={() => answer(false)} className="btn flex-1 py-2.5">Cancel</button>

                    <button
                        type="button"
                        onClick={() => answer(true)}
                        disabled={tofu.mismatch && typed !== CHALLENGE}
                        className={`btn flex-1 py-2.5 ${tofu.mismatch ? "btn-danger armed" : "btn-accent"}`}
                    >
                        {tofu.mismatch ? "Replace key" : "Trust"}
                    </button>
                </div>
            </div>
        </div>
    );
}
