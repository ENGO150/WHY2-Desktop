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

import type { UIState, StoredServer } from "./types";
import { Icon } from "./icons";
import { avatarColor } from "./theme";
import type { ServerForm } from "./servers";
import { serverLabel, AddServerFields, ForgetMenu, useHoldMenu } from "./servers";

//THE SCREEN THAT STANDS WHILE THERE IS NO SESSION. IT IS THREE SCREENS IN ONE PLACE, BECAUSE THEY ARE
//THREE ANSWERS TO THE SAME QUESTION - WHICH SERVER, AND WHO ARE WE THERE:
//  - THE FORM THAT ADDS ONE, WHICH IS ALSO WHAT A WINDOW WITH AN EMPTY LIST OPENS ON
//  - THE ONE-FIELD PROMPT, FOR WHATEVER THE SERVER ASKED THAT WE HAD NOTHING STORED FOR
//  - THE LIST ITSELF, WHICH IS ALL IT IS: A SERVER IS PICKED OR ADDED, NEVER TYPED AT AGAIN, SINCE AN
//    ADDRESS FIELD BESIDE THE ROWS IS THE SAME QUESTION ASKED TWICE
export function LoginScreen(
{
    uiState, mode, servers, target, form, setForm, value, setValue, connecting, errorMsg, hint,
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
    //THE LIST IS WHERE A SERVER IS FORGOTTEN, SINCE IT IS WHERE THEY ALL ARE. IT IS THE SAME GESTURE THE
    //RAIL ASKS FOR, AND THE SAME MENU
    const { menu, close, bind, held } = useHoldMenu();

    const title = mode === "add"
        ? "Add a server"
        : { server_select: servers.length ? "Servers" : "Connect to a server", username_prompt: "Who are you?", password_prompt: registering ? "Create your account" : "Welcome back", connected: "" }[uiState];

    const label = { server_select: "", username_prompt: "Username", password_prompt: "Password", connected: "" }[uiState];
    const button = { server_select: "", username_prompt: "Continue", password_prompt: registering ? "Register" : "Log in", connected: "" }[uiState];

    //THE STATUS LINE, ALWAYS IN THE SAME PLACE: WHAT IS HAPPENING, WHAT WENT WRONG, OR THE SERVER'S OWN
    //RULES FOR WHAT IS BEING ASKED
    const status = (
        <div className="mt-2 min-h-[1.25rem] text-xs">
            {connecting
                ? <span className="text-accent">{uiState === "server_select" ? "Connecting…" : "Waiting for the server…"}</span>
                : errorMsg
                    ? <span className="text-error">{errorMsg}</span>
                    : <span className="text-faint">{hint}</span>}
        </div>
    );

    const field = "mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-accent";
    const caption = "text-[11px] font-semibold uppercase tracking-wider text-muted";


    //AN absolute inset-0 CHILD IS LAID OUT AGAINST ITS ANCESTOR'S *PADDING BOX*, SO IT COVERS THE NOTCH
    //THAT <main>'S PADDING WAS KEEPING CLEAR. IT PAYS THE INSETS AGAIN, THE WAY THE DIALOGS DO.
    //THE RAIL IS NOT HERE: THIS SCREEN IS THE LIST, AND A COLUMN OF ONE-LETTER TILES BESIDE IT WOULD BE
    //THE SAME SERVERS SAID TWICE
    return (
        <div className="safe-top safe-bottom absolute inset-0 z-40 flex bg-deep">
            <div className="flex min-w-0 flex-1 items-center justify-center px-4">
                <div className="rise relative w-full max-w-[420px]">
                    <div className="mb-6 text-center">
                        <div className="text-2xl font-bold tracking-tight">WHY2</div>
                        <div className="mt-1 text-sm text-muted">{title}</div>

                        {/* WHICH SERVER THIS IS ABOUT, WHILE IT IS ABOUT ONE - EVERY PROMPT PAST THE
                            ADDRESS BELONGS TO A SERVER, AND WITH A LIST THERE IS MORE THAN ONE TO MEAN */}
                        {target && mode !== "add" && (
                            <div className="mt-1 truncate font-mono text-[11px] text-faint">
                                {serverLabel(target)}{target.name ? ` · ${target.address}` : ""}
                            </div>
                        )}
                    </div>

                    {/* NOTHING IS ASKED IN THE LIST ITSELF, SO THERE IS NO FORM IN FRONT OF IT - ONLY THE
                        TWO MODES THAT HAVE A QUESTION DRAW ONE */}
                    {mode !== "idle" && (
                        <form onSubmit={onSubmit} className="rounded-xl border border-border bg-overlay p-5 shadow-2xl">
                            {mode === "add" ? (
                                <>
                                    <AddServerFields form={form} setForm={setForm} connecting={connecting} inputRef={inputRef} autoFocus={!narrow} />

                                    {status}
                                </>
                            ) : (
                                <>
                                    <label htmlFor="login-input" className={caption}>{label}</label>

                                    <input
                                        id="login-input"
                                        ref={inputRef}
                                        type={uiState === "password_prompt" ? "password" : "text"}
                                        value={value}
                                        onChange={(event) => setValue(event.currentTarget.value)}
                                        className={field}
                                        disabled={connecting}
                                        autoFocus={!narrow}
                                        spellCheck={false}
                                    />

                                    {status}
                                </>
                            )}

                            <button
                                type="submit"
                                disabled={connecting || (mode === "add" ? !form.address : !value)}
                                className="mt-3 w-full rounded-app bg-accent py-2.5 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {mode === "add" ? "Add and connect" : button}
                            </button>

                            {/* THE WAY BACK OUT OF THE FORM, WHICH ONLY EXISTS WHERE THERE IS SOMETHING TO
                                GO BACK TO: THE FIRST SERVER EVER ADDED HAS NO LIST BEHIND IT */}
                            {mode === "add" && servers.length > 0 && (
                                <button
                                    type="button"
                                    onClick={onCancel}
                                    disabled={connecting}
                                    className="mt-2 w-full rounded-app py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40"
                                >
                                    Cancel
                                </button>
                            )}
                        </form>
                    )}

                    {/* THE LIST ITSELF: THE WHOLE SCREEN WHILE NOTHING IS BEING ASKED, AND UNDER THE
                        QUESTION WHILE SOMETHING IS. IT IS WHERE A SERVER IS PICKED AND WHERE ONE IS ADDED */}
                    {mode !== "add" && servers.length > 0 && (
                        <div className={mode === "idle" ? "" : "mt-6"}>
                            {/* THE LIST HAS NO FORM TO CARRY THE STATUS LINE, SO IT CARRIES ITS OWN - AND
                                AS A BOX, SINCE A BARE SENTENCE BETWEEN A HEADING AND A LIST READS AS
                                NEITHER. IT IS DRAWN ONLY WHEN IT SAYS SOMETHING */}
                            {mode === "idle" && (connecting || errorMsg || hint) && (
                                <div className={`mb-3 flex items-start gap-2 rounded-app border px-3 py-2.5 text-xs ${!connecting && errorMsg
                                    ? "border-error/40 bg-error/10 text-error"
                                    : "border-border bg-overlay text-muted"}`}>
                                    <Icon name={!connecting && errorMsg ? "alert" : "info"} className="mt-px h-3.5 w-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1 break-words">{connecting ? "Connecting…" : errorMsg || hint}</span>
                                </div>
                            )}

                            <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Your servers</div>

                            <div className="scroller scroller-quiet max-h-[240px] rounded-xl border border-border bg-overlay p-1">
                                {servers.map((server) => (
                                    <button
                                        key={server.id}
                                        type="button"
                                        onClick={() => { if (held()) return; close(); onPick(server); }}
                                        {...bind(server.id)}
                                        disabled={connecting}
                                        className={`flex w-full select-none items-center gap-2.5 rounded-app px-2 py-2 text-left transition-colors hover:bg-hover disabled:opacity-40 ${target?.id === server.id ? "bg-selected" : ""}`}
                                    >
                                        <span
                                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white/90"
                                            style={{ background: avatarColor(server.name || server.address) }}
                                        >
                                            {(serverLabel(server).trim()[0] ?? "?").toUpperCase()}
                                        </span>

                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm">{serverLabel(server)}</span>
                                            <span className="block truncate font-mono text-[11px] text-faint">
                                                {server.address}{server.username ? ` · ${server.username}` : ""}
                                            </span>
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {menu && servers.some((server) => server.id === menu.id) && (
                                <ForgetMenu
                                    server={servers.find((server) => server.id === menu.id)!}
                                    at={menu}
                                    onForget={onForget}
                                    close={close}
                                />
                            )}

                            <button
                                type="button"
                                onClick={onAdd}
                                disabled={connecting}
                                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-app py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-text disabled:opacity-40"
                            >
                                <Icon name="plus" className="h-4 w-4" />
                                Add another server
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
