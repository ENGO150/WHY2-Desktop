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

import type { UIState, StoredServer } from "./types";
import { Icon } from "./icons";
import type { ServerForm } from "./servers";
import { serverLabel, AddServerFields, ForgetMenu, ServerRow, useHoldMenu } from "./servers";

//THE SCREEN WHILE THERE IS NO SESSION: ADD A SERVER, ANSWER ITS QUESTION, OR PICK ONE
export function LoginScreen(
{
    uiState, mode, servers, target, form, setForm, value, setValue, connecting, retrying, errorMsg, hint,
    registering, inputRef, narrow, onSubmit, onPick, onAdd, onForget, onCancel,
}: {
    uiState: UIState;
    mode: "add" | "prompt" | "idle";
    servers: StoredServer[];
    target: StoredServer | null;
    form: ServerForm;
    setForm: (form: ServerForm) => void;
    value: string;
    setValue: (value: string) => void;
    connecting: boolean;
    retrying: string;
    errorMsg: string;
    hint: string;
    registering: boolean;
    inputRef: React.RefObject<HTMLInputElement | null>;
    narrow: boolean;
    onSubmit: (event: React.FormEvent) => void;
    onPick: (server: StoredServer) => void;
    onAdd: () => void;
    onForget: (id: string) => void;
    onCancel: () => void;
})
{
    //FORGET IS A RIGHT-CLICK OR A HOLD
    const { menu, close, bind, held } = useHoldMenu<string>();

    //THE LIST, UNDER A PROMPT
    const [others, setOthers] = useState(false);

    const title = mode === "add"
        ? "Add server"
        : { server_select: "WHY2", username_prompt: "Username", password_prompt: registering ? "Create a password" : "Password", connected: "" }[uiState];

    const button = { server_select: "", username_prompt: "Continue", password_prompt: registering ? "Create account" : "Log in", connected: "" }[uiState];

    //WHAT IS HAPPENING, WHAT WENT WRONG, OR THE SERVER'S RULES
    const status = connecting
        ? <span className="text-muted">{retrying || (uiState === "server_select" ? "Connecting…" : "Waiting for the server…")}</span>
        : errorMsg
            ? <span className="text-error">{errorMsg}</span>
            : hint ? <span className="text-faint">{hint}</span> : null;

    return (
        <div className="safe-top safe-bottom absolute inset-0 z-40 flex bg-chat">
            <div className="scroller flex min-w-0 flex-1 flex-col items-center px-5 py-10">
                <div className={`my-auto w-full ${narrow ? "" : "max-w-[380px]"}`}>
                    <div className="mb-7 flex flex-col items-center text-center">
                        <img src="/why2.svg" alt="" draggable={false} className="h-14 w-14 rounded-[14px]" />
                        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>

                        {/* WHICH SERVER A QUESTION IS ABOUT */}
                        {target && mode !== "add" && uiState !== "server_select" && (
                            <div className="mt-1 max-w-full truncate text-[14px] text-muted">{serverLabel(target)}</div>
                        )}
                    </div>

                    {/* ONLY A QUESTION GETS A FORM */}
                    {mode !== "idle" && (
                        <form onSubmit={onSubmit}>
                            {mode === "add" ? (
                                <AddServerFields form={form} setForm={setForm} connecting={connecting} inputRef={inputRef} autoFocus={!narrow} />
                            ) : (
                                <input
                                    id="login-input"
                                    ref={inputRef}
                                    type={uiState === "password_prompt" ? "password" : "text"}
                                    aria-label={title}
                                    placeholder={title}
                                    value={value}
                                    onChange={(event) => setValue(event.currentTarget.value)}
                                    className="field py-2.5 text-[15px]"
                                    disabled={connecting}
                                    autoFocus={!narrow}
                                    spellCheck={false}
                                />
                            )}

                            {status && <div className="mt-3 px-1 text-[13px]">{status}</div>}

                            <button
                                type="submit"
                                disabled={connecting || (mode === "add" ? !form.address : !value)}
                                className="btn btn-accent mt-5 w-full py-2.5"
                            >
                                {mode === "add" ? "Connect" : button}
                            </button>

                            {/* BACK TO THE LIST, WHERE THERE IS ONE */}
                            {mode === "add" && servers.length > 0 && (
                                <button type="button" onClick={onCancel} disabled={connecting} className="btn btn-quiet mt-2 w-full py-2.5">
                                    Back
                                </button>
                            )}

                            {mode === "prompt" && servers.length > 1 && !others && (
                                <button type="button" onClick={() => setOthers(true)} className="btn btn-quiet mt-2 w-full py-2.5">
                                    Other servers
                                </button>
                            )}
                        </form>
                    )}

                    {/* THE LIST */}
                    {(mode === "idle" || (mode === "prompt" && others)) && servers.length > 0 && (
                        <>
                            <div className={`rounded-xl border border-border p-1 ${mode === "idle" ? "" : "mt-5"}`}>
                                {servers.map((server) => (
                                    <ServerRow
                                        key={server.id}
                                        server={server}
                                        here={target?.id === server.id && connecting}
                                        connecting={connecting}
                                        bind={bind(server.id)}
                                        onPick={() => { if (held() || connecting) return; close(); onPick(server); }}
                                    />
                                ))}

                                <button
                                    type="button"
                                    onClick={onAdd}
                                    disabled={connecting}
                                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[14px] text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40"
                                >
                                    <span className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-dashed border-border-strong">
                                        <Icon name="plus" className="h-4 w-4" />
                                    </span>
                                    Add server
                                </button>
                            </div>

                            {mode === "idle" && status && <div className="mt-4 text-center text-[13px]">{status}</div>}

                            {menu && servers.some((server) => server.id === menu.value) && (
                                <ForgetMenu
                                    server={servers.find((server) => server.id === menu.value)!}
                                    at={menu}
                                    onForget={onForget}
                                    close={close}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
