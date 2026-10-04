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

import type { ProfileInfo, OnlineUser, ClientConfig, VocabularyValue } from "./types";
import { Icon } from "./icons";
import { Avatar, Overlay, PanelHeader } from "./components";
import { linked } from "./messages";
import { deviceIcon } from "./roster";
import { ANSI_TRUE } from "./theme";
import { t } from "./i18n";

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
            aria-label={t("card.of", { username })}
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
                    {own && <span className="shrink-0 text-[12px] text-faint">{t("card.you")}</span>}
                </div>

                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                    <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${online ? "bg-online" : "bg-faint"}`} />
                        {online ? `#${online.channel ?? "lobby"}` : t("sidebar.offline")}
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

                {loading && !profile && <div className="mt-3 text-[13px] text-faint">{t("card.loading")}</div>}

                {(message || edit) && (
                    <div className="mt-4 flex gap-2">
                        {message && (
                            <button type="button" onClick={message} className="btn btn-accent flex-1 py-2">
                                {t("card.message")}
                            </button>
                        )}

                        {edit && (
                            <button type="button" onClick={edit} className="btn flex-1 py-2">
                                {t("card.edit")}
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

const colorName = (choice: VocabularyValue) => choice.value.replace(/_/g, " ");

//ONE COLOR, AND THE MENU OF THE OTHERS
function ColorRow({ label, colors, current, pick }: { label: string; colors: VocabularyValue[]; current: number | null; pick: (choice: VocabularyValue) => void })
{
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const chosen = colors.find((choice) => choice.color !== null && choice.color === current);

    //A PRESS OUTSIDE CLOSES IT
    useEffect(() =>
    {
        if (!open) return;

        const away = (event: MouseEvent) =>
        {
            if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
        };

        document.addEventListener("mousedown", away);

        return () => document.removeEventListener("mousedown", away);
    }, [open]);

    return (
        <div
            ref={boxRef}
            className="relative"
            onKeyDown={(event) => { if (open && event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="field flex w-full items-center gap-3 text-left"
            >
                <span className="flex-1 truncate">{label}</span>
                <span
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-border-strong"
                    style={{ backgroundColor: chosen?.color != null ? ANSI_TRUE[chosen.color] : "transparent" }}
                />
                <span className="text-[13px] text-muted">{chosen ? colorName(chosen) : t("card.not_set")}</span>
                <Icon name="chevron" className={`h-4 w-4 shrink-0 text-faint ${open ? "rotate-180" : ""}`} />
            </button>

            {open && (
                <div className="absolute right-0 top-full z-10 mt-1.5 grid grid-cols-8 gap-1.5 rounded-xl border border-border-strong bg-overlay p-2.5 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)]">
                    {colors.map((choice) => choice.color !== null && (
                        <button
                            key={choice.value}
                            type="button"
                            title={colorName(choice)}
                            aria-label={colorName(choice)}
                            aria-pressed={choice.color === current}
                            onClick={() => { pick(choice); setOpen(false); }}
                            className={`h-6 w-6 rounded-full ring-1 ring-border-strong ${choice.color === current ? "ring-2 ring-text ring-offset-2 ring-offset-overlay" : "hover:ring-muted"}`}
                            style={{ backgroundColor: ANSI_TRUE[choice.color] }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

//OUR OWN PROFILE, EDITABLE
export function ProfileEditor(
{
    username, profile, avatar, color, colors, nameColor, messageColor, pickColor, uploading, narrow, save, pickAvatar, dropAvatar, close,
}: {
    username: string;
    profile: ProfileInfo | null;
    avatar: string | undefined;
    color: string | undefined;
    colors: VocabularyValue[];
    nameColor: number | null;
    messageColor: number | null;
    pickColor: (name: boolean, choice: VocabularyValue) => void;
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
        <Overlay narrow={narrow} width={440} label={t("card.edit")} cardRef={cardRef} close={close}>
            <PanelHeader title={t("card.edit")} close={close} />

            <form onSubmit={submit} className="scroller scroller-quiet flex-1 px-6 pb-6 pt-2">
                <div className="flex flex-col items-center">
                    <button type="button" disabled={uploading} onClick={pickAvatar} title={t("card.change_picture")} className="group relative rounded-full">
                        <Avatar name={username} color={color} size={88} src={avatar} />
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <Icon name="upload" className="h-6 w-6" />
                        </span>
                    </button>

                    <div className="mt-2 flex gap-1">
                        <button type="button" disabled={uploading} onClick={pickAvatar} className="btn btn-quiet px-3 py-1 text-[13px] text-accent">
                            {uploading ? t("card.uploading") : t("card.change_picture")}
                        </button>

                        {profile?.avatar && (
                            <button type="button" disabled={uploading} onClick={dropAvatar} className="btn btn-quiet px-3 py-1 text-[13px]">
                                {t("card.remove")}
                            </button>
                        )}
                    </div>
                </div>

                {colors.length > 0 && (
                    <div className="mt-5 flex flex-col gap-3">
                        <ColorRow label={t("card.name_color")} colors={colors} current={nameColor} pick={(choice) => pickColor(true, choice)} />
                        <ColorRow label={t("card.message_color")} colors={colors} current={messageColor} pick={(choice) => pickColor(false, choice)} />
                    </div>
                )}

                <div className="mt-5 flex flex-col gap-3">
                    <input aria-label={t("profile.status")} value={draft.status} onChange={set("status")} placeholder={t("profile.status")} className="field" />
                    <input aria-label={t("profile.pronouns")} value={draft.pronouns} onChange={set("pronouns")} placeholder={t("profile.pronouns")} className="field" spellCheck={false} />
                    <input aria-label={t("profile.website")} value={draft.website} onChange={set("website")} placeholder={t("profile.website")} className={`field ${badWebsite ? "border-error" : ""}`} spellCheck={false} />
                    {badWebsite && <div className="-mt-1.5 px-1 text-[12.5px] text-error">{t("card.bad_website")}</div>}
                    <textarea aria-label={t("profile.bio")} rows={4} value={draft.bio} onChange={set("bio")} placeholder={t("card.about")} className="field resize-none leading-relaxed" />
                </div>

                <button type="submit" disabled={!changed || badWebsite || saving} className="btn btn-accent mt-5 w-full py-2">
                    {saving ? t("card.saving") : t("settings.save")}
                </button>
            </form>
        </Overlay>
    );
}
