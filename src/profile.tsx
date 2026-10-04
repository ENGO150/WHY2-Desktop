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

import type { ProfileInfo, OnlineUser, ClientConfig } from "./types";
import { Icon } from "./icons";
import { Avatar, Overlay, PanelHeader } from "./components";
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

const CARD_WIDTH = 308;
const GAP = 8;

//A WEBSITE WORTH OPENING
function webUrl(text: string): boolean
{
    return /^https?:\/\//i.test(text.trim());
}

//THE CARD A NAME OPENS
export function ProfileCard(
{
    username, profile, loading, avatar, color, online, own, role, config, anchor, narrow, message, edit, close,
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
            className={`${placed} overflow-hidden rounded-xl border border-border-strong bg-overlay shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)]`}
        >
            <div className="p-4">
                <div className="flex items-start justify-between">
                    <Avatar name={username} color={color} size={56} src={avatar} />

                    {device && <Icon name={device} className="mt-1 h-[17px] w-[17px] text-faint" />}
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[18px] font-semibold" style={{ color }}>{username}</span>
                    {config.show_id && online && <span className="shrink-0 text-[12px] text-faint">{online.id}</span>}
                    {own && <span className="shrink-0 text-[12px] text-faint">you</span>}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                    <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${online ? "bg-online" : "bg-faint"}`} />
                        {online ? `#${online.channel ?? "lobby"}` : "Offline"}
                    </span>
                    {profile?.pronouns && <span>· {profile.pronouns}</span>}
                    {role && <span className="capitalize">· {role}</span>}
                </div>

                {profile?.status && (
                    <div className="mt-3 text-[14px]">{profile.status}</div>
                )}

                {profile?.bio && (
                    <div className="mt-2 select-text whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-muted">{linked(profile.bio)}</div>
                )}

                {website && (
                    <button
                        type="button"
                        disabled={!webUrl(website)}
                        onClick={() => { openUrl(website).catch(() => {}); }}
                        className="mt-2 flex w-full min-w-0 items-center gap-1.5 text-left text-[13.5px] text-accent hover:underline disabled:text-muted disabled:no-underline"
                    >
                        <Icon name="globe" className="h-4 w-4 shrink-0" />
                        <span className="truncate">{website.replace(/^https?:\/\//i, "")}</span>
                    </button>
                )}

                {loading && !profile && <div className="mt-3 text-[13px] text-faint">Loading…</div>}

                {(message || edit) && (
                    <div className="mt-4 flex gap-2">
                        {message && (
                            <button type="button" onClick={message} className="btn btn-accent flex-1 py-2">
                                Message
                            </button>
                        )}

                        {edit && (
                            <button type="button" onClick={edit} className="btn flex-1 py-2">
                                Edit profile
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

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
    username, profile, avatar, color, uploading, narrow, save, pickAvatar, dropAvatar, close,
}: {
    username: string;
    profile: ProfileInfo | null;
    avatar: string | undefined;
    color: string | undefined;
    uploading: boolean;
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
        <Overlay narrow={narrow} width={440} label="Edit profile" cardRef={cardRef} close={close}>
            <PanelHeader title="Edit profile" close={close} />

            <form onSubmit={submit} className="scroller scroller-quiet flex-1 px-6 pb-6 pt-2">
                <div className="flex flex-col items-center">
                    <button type="button" disabled={uploading} onClick={pickAvatar} title="Change picture" className="group relative rounded-full">
                        <Avatar name={username} color={color} size={88} src={avatar} />
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <Icon name="upload" className="h-6 w-6" />
                        </span>
                    </button>

                    <div className="mt-2 flex gap-1">
                        <button type="button" disabled={uploading} onClick={pickAvatar} className="btn btn-quiet px-3 py-1 text-[13px] text-accent">
                            {uploading ? "Uploading…" : "Change picture"}
                        </button>

                        {profile?.avatar && (
                            <button type="button" disabled={uploading} onClick={dropAvatar} className="btn btn-quiet px-3 py-1 text-[13px]">
                                Remove
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-4 flex flex-col gap-3">
                    <input aria-label="Status" value={draft.status} onChange={set("status")} placeholder="Status" className="field" />
                    <input aria-label="Pronouns" value={draft.pronouns} onChange={set("pronouns")} placeholder="Pronouns" className="field" spellCheck={false} />
                    <input aria-label="Website" value={draft.website} onChange={set("website")} placeholder="Website" className={`field ${badWebsite ? "border-error" : ""}`} spellCheck={false} />
                    {badWebsite && <div className="-mt-1.5 px-1 text-[12.5px] text-error">Starts with http:// or https://</div>}
                    <textarea aria-label="About" rows={4} value={draft.bio} onChange={set("bio")} placeholder="About you" className="field resize-none leading-relaxed" />
                </div>

                <button type="submit" disabled={!changed || badWebsite || saving} className="btn btn-accent mt-5 w-full py-2">
                    {saving ? "Saving…" : "Save"}
                </button>
            </form>
        </Overlay>
    );
}
