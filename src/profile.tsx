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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { ProfileInfo, OnlineUser, ClientConfig, AccountAction } from "./types";
import { avatarColor } from "./theme";
import { Icon, IconButton } from "./icons";
import { Avatar } from "./components";
import { linked } from "./messages";
import { deviceIcon } from "./roster";

//WHAT A NAME ANYWHERE IN THE WINDOW CAN ASK FOR
export interface People
{
    avatar: (username: string) => string | undefined;
    status: (username: string) => string | undefined;
    open: (username: string, anchor: HTMLElement | null) => void;
}

//THE FIELDS A SAVE CARRIES
export type ProfileFields = Pick<ProfileInfo, "bio" | "pronouns" | "website" | "status">;

const CARD_WIDTH = 300;
const GAP = 8;

//A WEBSITE WORTH OPENING
function webUrl(text: string): boolean
{
    return /^https?:\/\//i.test(text.trim());
}

//THE POPUP A NAME OPENS
export function ProfileCard(
{
    username, profile, loading, avatar, color, online, own, role, config, anchor, narrow, message, edit, account, close,
}: {
    username: string;
    profile: ProfileInfo | null;
    loading: boolean;
    avatar: string | undefined;
    color: string | undefined;
    online: OnlineUser | null;
    own: boolean;
    role: string | null;
    config: ClientConfig;
    anchor: DOMRect | null;
    narrow: boolean;
    message: (() => void) | null;
    edit: (() => void) | null;
    account: ((action: AccountAction) => void) | null;
    close: () => void;
})
{
    const card = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState<{ x: number; y: number } | null>(null);

    //BESIDE WHAT WAS CLICKED, INSIDE THE WINDOW
    useLayoutEffect(() =>
    {
        const node = card.current;

        if (!node || narrow || !anchor) { setAt(null); return; }

        const height = node.offsetHeight;
        const right = anchor.left + anchor.width / 2 > window.innerWidth / 2;

        const x = right ? anchor.left - CARD_WIDTH - GAP : anchor.right + GAP;

        setAt(
        {
            x: Math.max(GAP, Math.min(x, window.innerWidth - CARD_WIDTH - GAP)),
            y: Math.max(GAP, Math.min(anchor.top, window.innerHeight - height - GAP)),
        });
    }, [anchor, narrow, profile, loading]);

    //ESC OR A PRESS OUTSIDE
    useEffect(() =>
    {
        const onDown = (event: MouseEvent | TouchEvent) =>
        {
            if (card.current && event.target instanceof Node && !card.current.contains(event.target)) close();
        };

        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };

        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("touchstart", onDown, true);
        window.addEventListener("keydown", onKey);

        return () =>
        {
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("touchstart", onDown, true);
            window.removeEventListener("keydown", onKey);
        };
    }, [close]);

    const banner = color ?? avatarColor(username);
    const device = online?.device ? deviceIcon(online.device) : null;
    const website = profile?.website.trim() ?? "";

    //CENTRED WITHOUT AN ANCHOR, A SHEET ON A PHONE
    const placed = narrow
        ? "fixed inset-x-2 bottom-2 z-[65]"
        : at ? "fixed z-[65]" : "fixed left-1/2 top-1/2 z-[65] -translate-x-1/2 -translate-y-1/2";

    return createPortal(
        <div
            ref={card}
            role="dialog"
            aria-label={`${username}'s profile`}
            style={narrow ? undefined : at
                ? { left: at.x, top: at.y, width: CARD_WIDTH }
                : { width: CARD_WIDTH, visibility: anchor ? "hidden" : undefined }}
            className={`${placed} rise overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl`}
        >
            <div className="h-16" style={{ background: banner, opacity: 0.55 }} />

            <div className="relative px-4 pb-4">
                <div className="-mt-10 mb-2 flex items-end justify-between">
                    <div className="rounded-full border-4 border-overlay bg-overlay">
                        <Avatar name={username} color={color} size={80} src={avatar} />
                    </div>

                    {device && <Icon name={device} className="mb-1 h-4 w-4 text-faint" />}
                </div>

                <div className="flex items-baseline gap-2">
                    <span className={`min-w-0 truncate text-lg font-bold ${color ? "" : "text-text"}`} style={{ color }}>
                        {username}
                    </span>
                    {config.show_id && online && <span className="shrink-0 font-mono text-[11px] text-faint">#{online.id}</span>}
                </div>

                {profile?.pronouns && <div className="text-sm text-muted">{profile.pronouns}</div>}

                {profile?.status && (
                    <div className="mt-2 rounded-app bg-deep/70 px-2.5 py-1.5 text-sm text-text">{profile.status}</div>
                )}

                <div className="my-3 h-px bg-border" />

                {profile?.bio && (
                    <>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">About me</div>
                        <div className="mt-1 select-text whitespace-pre-wrap break-words text-sm leading-relaxed">{linked(profile.bio)}</div>
                    </>
                )}

                {website && (
                    <button
                        type="button"
                        disabled={!webUrl(website)}
                        onClick={() => { openUrl(website).catch(() => {}); }}
                        className="mt-2 flex w-full min-w-0 items-center gap-1.5 text-left text-sm text-accent hover:underline disabled:text-muted disabled:no-underline"
                    >
                        <Icon name="globe" className="h-4 w-4 shrink-0" />
                        <span className="truncate">{website}</span>
                    </button>
                )}

                {loading && !profile && <div className="text-sm text-faint">Loading profile...</div>}

                <div className="mt-2 space-y-0.5 text-xs text-faint">
                    {online
                        ? <div>Online in #{online.channel ?? "lobby"}</div>
                        : <div>Offline</div>}
                    {role && <div className="flex items-center gap-1"><Icon name="shield" className="h-3 w-3" />{role}</div>}
                </div>

                {(message || edit) && (
                    <div className="mt-3 flex gap-2">
                        {message && (
                            <button
                                type="button"
                                onClick={message}
                                className="flex flex-1 items-center justify-center gap-2 rounded-app bg-accent px-3 py-2 text-sm font-semibold text-black/85 transition hover:brightness-110"
                            >
                                <Icon name="at" className="h-4 w-4" />
                                Message
                            </button>
                        )}

                        {edit && (
                            <button
                                type="button"
                                onClick={edit}
                                className="flex flex-1 items-center justify-center gap-2 rounded-app border border-border px-3 py-2 text-sm font-semibold transition hover:bg-hover"
                            >
                                <Icon name="pencil" className="h-4 w-4" />
                                Edit profile
                            </button>
                        )}
                    </div>
                )}

                {own && !edit && <div className="mt-3 text-xs text-faint">This is you.</div>}

                {/* THE ACCOUNT ITSELF */}
                {account && (
                    <div className="mt-3 flex justify-between gap-2 text-xs">
                        <button type="button" onClick={() => account("passwd")} className="flex items-center gap-1.5 text-muted transition-colors hover:text-text">
                            <Icon name="lock" className="h-3.5 w-3.5" />
                            Change password
                        </button>

                        <button type="button" onClick={() => account("delete")} className="flex items-center gap-1.5 text-error transition hover:brightness-125">
                            <Icon name="trash" className="h-3.5 w-3.5" />
                            Delete account
                        </button>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

const FIELD = "mt-1.5 w-full rounded-app border border-border bg-deep px-3 py-2 text-[15px] outline-none placeholder:text-faint focus:border-accent";
const CAPTION = "text-[11px] font-semibold uppercase tracking-wider text-muted";

function fieldsOf(profile: ProfileInfo | null): ProfileFields
{
    return {
        bio: profile?.bio ?? "",
        pronouns: profile?.pronouns ?? "",
        website: profile?.website ?? "",
        status: profile?.status ?? "",
    };
}

function same(one: ProfileFields, other: ProfileFields): boolean
{
    return one.bio === other.bio && one.pronouns === other.pronouns
        && one.website === other.website && one.status === other.status;
}

//OUR OWN PROFILE, EDITABLE
export function ProfileEditor(
{
    username, profile, avatar, color, uploading, dialogWrap, dialogCard, narrow, save, pickAvatar, dropAvatar, close,
}: {
    username: string;
    profile: ProfileInfo | null;
    avatar: string | undefined;
    color: string | undefined;
    uploading: boolean;
    dialogWrap: string;
    dialogCard: (wide: string) => string;
    narrow: boolean;
    save: (fields: ProfileFields) => Promise<unknown>;
    pickAvatar: () => void;
    dropAvatar: () => void;
    close: () => void;
})
{
    const [draft, setDraft] = useState<ProfileFields>(() => fieldsOf(profile));
    const [base, setBase] = useState<ProfileFields>(() => fieldsOf(profile));
    const [saving, setSaving] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    //THE SERVER'S ANSWER WINS OVER UNTOUCHED ROWS
    useEffect(() =>
    {
        const next = fieldsOf(profile);

        if (saving || same(draft, base)) setDraft(next);

        setBase(next);
        setSaving(false);
    }, [profile]);

    useEffect(() => { if (!narrow) cardRef.current?.focus(); }, []);

    const website = draft.website.trim();
    const badWebsite = website !== "" && !webUrl(website);
    const changed = !same(draft, base);

    const submit = (event: React.FormEvent) =>
    {
        event.preventDefault();

        if (!changed || badWebsite || saving) return;

        setSaving(true);

        //NOTHING WENT OUT, SO NOTHING IS COMING BACK
        save({ ...draft, website }).catch(() => setSaving(false));
    };

    const set = (key: keyof ProfileFields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft({ ...draft, [key]: event.currentTarget.value });

    return (
        <div
            onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
            className={dialogWrap}
        >
            <div
                ref={cardRef}
                tabIndex={-1}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }}
                className={`rise ${dialogCard("flex max-h-[88vh] w-full max-w-[460px] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl outline-none")}`}
            >
                <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
                    <Icon name="pencil" className="h-4 w-4 shrink-0 text-muted" />
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">Your profile</h2>
                    {saving && <span className="text-xs text-faint">saving...</span>}
                    {!saving && changed && <span className="text-xs text-notice">unsaved</span>}
                    <IconButton icon="close" label="Close" onClick={close} />
                </header>

                <form onSubmit={submit} className="scroller scroller-quiet flex-1 px-5 py-4">
                    <div className="flex items-center gap-4">
                        <Avatar name={username} color={color} size={72} src={avatar} />

                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <button
                                type="button"
                                disabled={uploading}
                                onClick={pickAvatar}
                                className="flex items-center justify-center gap-2 rounded-app border border-border px-3 py-1.5 text-sm font-semibold transition hover:bg-hover disabled:opacity-50"
                            >
                                <Icon name="upload" className="h-4 w-4" />
                                {uploading ? "Uploading..." : "Change avatar"}
                            </button>

                            {profile?.avatar && (
                                <button
                                    type="button"
                                    disabled={uploading}
                                    onClick={dropAvatar}
                                    className="flex items-center justify-center gap-2 rounded-app border border-border px-3 py-1.5 text-sm text-muted transition hover:border-error hover:text-error disabled:opacity-50"
                                >
                                    <Icon name="trash" className="h-4 w-4" />
                                    Remove avatar
                                </button>
                            )}
                        </div>
                    </div>

                    <label htmlFor="profile-pronouns" className={`${CAPTION} mt-5 block`}>Pronouns</label>
                    <input id="profile-pronouns" value={draft.pronouns} onChange={set("pronouns")} className={FIELD} spellCheck={false} />

                    <label htmlFor="profile-status" className={`${CAPTION} mt-4 block`}>Status</label>
                    <input id="profile-status" value={draft.status} onChange={set("status")} placeholder="What are you up to?" className={FIELD} />

                    <label htmlFor="profile-website" className={`${CAPTION} mt-4 block`}>Website</label>
                    <input id="profile-website" value={draft.website} onChange={set("website")} placeholder="https://" className={FIELD} spellCheck={false} />
                    {badWebsite && <div className="mt-1 text-xs text-error">A website has to start with http:// or https://</div>}

                    <label htmlFor="profile-bio" className={`${CAPTION} mt-4 block`}>About me</label>
                    <textarea id="profile-bio" rows={4} value={draft.bio} onChange={set("bio")} className={`${FIELD} resize-none`} />

                    <div className="mt-5 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={close}
                            className="rounded-app px-4 py-2 text-sm text-muted transition hover:bg-hover hover:text-text"
                        >
                            Close
                        </button>

                        <button
                            type="submit"
                            disabled={!changed || badWebsite || saving}
                            className="rounded-app bg-accent px-4 py-2 text-sm font-semibold text-black/85 transition hover:brightness-110 disabled:opacity-40"
                        >
                            Save
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
