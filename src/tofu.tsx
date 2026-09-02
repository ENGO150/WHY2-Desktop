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

//WHAT REPLACING A PINNED KEY HAS TO BE TYPED OUT AS, SO IT CANNOT HAPPEN BY LEANING ON ENTER
export const CHALLENGE = "yes";

//THE IDENTITY CHECK, ANSWERED IN BAND. A FIRST CONTACT IS ANSWERED WITH A BUTTON; REPLACING A KEY THAT
//IS ALREADY PINNED HAS TO BE TYPED OUT, EXACTLY AS THE TUI MAKES SOMEBODY TYPE IT
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
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="rise w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl">
                <header className={`flex items-center gap-3 border-b border-border px-5 py-4 ${tofu.mismatch ? "text-error" : "text-accent"}`}>
                    <Icon name={tofu.mismatch ? "alert" : "lock"} className="h-5 w-5" />
                    <h2 className="text-[15px] font-semibold">{tofu.mismatch ? "Server identity changed" : "Unknown server identity"}</h2>
                </header>

                <div className="px-5 py-4">
                    <p className="text-sm leading-relaxed text-muted">
                        {tofu.mismatch
                            ? "The server is presenting a different identity key than the one pinned for this address. Either the operator replaced the server's keys, or somebody is sitting between you and it."
                            : "This address has no pinned identity key yet. Accept it only if the fingerprint below matches the one the server's operator published."}
                    </p>

                    <div className="mt-4 rounded-app border border-border bg-deep p-3 font-mono text-[13px]">
                        <div className="flex gap-3">
                            <span className="w-[9ch] shrink-0 text-faint">Server</span>
                            <span className="min-w-0 break-all">{tofu.host}</span>
                        </div>

                        {fingerprint(tofu.pinned ?? "").map((row, index) => (
                            <div key={row} className="mt-1 flex gap-3 text-faint">
                                <span className="w-[9ch] shrink-0">{index === 0 ? "Pinned" : ""}</span>
                                <span>{row}</span>
                            </div>
                        ))}

                        {fingerprint(tofu.hash).map((row, index) => (
                            <div key={row} className="mt-1 flex gap-3">
                                <span className="w-[9ch] shrink-0 text-faint">{index === 0 ? (tofu.mismatch ? "New key" : "Key") : ""}</span>
                                <span className={tofu.mismatch ? "text-error" : "text-accent"}>{row}</span>
                            </div>
                        ))}
                    </div>

                    {/* REPLACING A PINNED KEY HAS TO BE TYPED OUT - A FIRST CONTACT IS THE ONLY ONE A BUTTON ANSWERS */}
                    {tofu.mismatch && (
                        <div className="mt-4">
                            <label htmlFor="tofu-input" className="text-xs text-muted">
                                Type <span className="font-mono text-text">{CHALLENGE}</span> to replace the pinned key with this one:
                            </label>
                            <input
                                id="tofu-input"
                                type="text"
                                value={typed}
                                onChange={(event) => setTyped(event.currentTarget.value.toLowerCase())}
                                onKeyDown={(event) => { if (event.key === "Enter") answer(true); }}
                                className="mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2 font-mono text-sm outline-none focus:border-error"
                                autoFocus
                                spellCheck={false}
                            />
                        </div>
                    )}
                </div>

                <footer className="flex justify-end gap-2 border-t border-border bg-deep/40 px-5 py-3">
                    <button
                        type="button"
                        onClick={() => answer(false)}
                        className="rounded-app border border-border px-4 py-1.5 text-sm font-semibold text-muted transition hover:border-error hover:text-error"
                    >
                        Reject
                    </button>
                    <button
                        type="button"
                        onClick={() => answer(true)}
                        disabled={tofu.mismatch && typed !== CHALLENGE}
                        className={`rounded-app px-4 py-1.5 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${tofu.mismatch ? "bg-error" : "bg-accent"}`}
                    >
                        {tofu.mismatch ? "Replace pinned key" : "Trust and save"}
                    </button>
                </footer>
            </div>
        </div>
    );
}
