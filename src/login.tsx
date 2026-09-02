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

import type { UIState } from "./types";

//THE CONNECT SCREEN ASKS FOR EVERYTHING UNTIL WE ARE IN: THE ADDRESS, THEN WHOEVER THE SERVER WANTS US
//TO BE. IT IS THE WHOLE WINDOW RATHER THAN A BOX OVER THE CHAT, BECAUSE THERE IS NO CHAT BEHIND IT YET
export function LoginScreen(
{
    uiState, value, setValue, connecting, errorMsg, hint, registering, inputRef, onSubmit,
}: {
    uiState: UIState;
    value: string;
    setValue: (value: string) => void;
    connecting: boolean;
    errorMsg: string;
    hint: string;
    registering: boolean;
    inputRef: React.RefObject<HTMLInputElement | null>;
    onSubmit: (event: React.FormEvent) => void;
})
{
        const title = { server_select: "Connect to a server", username_prompt: "Who are you?", password_prompt: registering ? "Create your account" : "Welcome back", connected: "" }[uiState];
        const label = { server_select: "Server address", username_prompt: "Username", password_prompt: "Password", connected: "" }[uiState];
        const button = { server_select: "Connect", username_prompt: "Continue", password_prompt: registering ? "Register" : "Log in", connected: "" }[uiState];

        return (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-deep px-4">
                <div className="rise relative w-full max-w-[420px]">
                    <div className="mb-6 text-center">
                        <div className="text-2xl font-bold tracking-tight">WHY2</div>
                        <div className="mt-1 text-sm text-muted">{title}</div>
                    </div>

                    <form onSubmit={onSubmit} className="rounded-xl border border-border bg-overlay p-5 shadow-2xl">
                        <label htmlFor="login-input" className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</label>

                        <input
                            id="login-input"
                            ref={inputRef}
                            type={uiState === "password_prompt" ? "password" : "text"}
                            value={value}
                            onChange={(event) => setValue(event.currentTarget.value)}
                            placeholder={uiState === "server_select" ? "127.0.0.1:8080" : undefined}
                            className="mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-accent"
                            disabled={connecting}
                            autoFocus
                            spellCheck={false}
                        />

                        {/* THE STATUS LINE, ALWAYS IN THE SAME PLACE: WHAT IS HAPPENING, WHAT WENT WRONG,
                            OR THE SERVER'S OWN RULES FOR WHAT IS BEING ASKED */}
                        <div className="mt-2 min-h-[1.25rem] text-xs">
                            {connecting
                                ? <span className="text-accent">{uiState === "server_select" ? "Connecting…" : "Waiting for the server…"}</span>
                                : errorMsg
                                    ? <span className="text-error">{errorMsg}</span>
                                    : <span className="text-faint">{hint}</span>}
                        </div>

                        <button
                            type="submit"
                            disabled={connecting || !value}
                            className="mt-3 w-full rounded-app bg-accent py-2.5 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {button}
                        </button>
                    </form>
                </div>
            </div>
        );
}
