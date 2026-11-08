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

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { ChatMessage, MessageImage } from "./types";
import { useTouch } from "./narrow";
import { Icon } from "./icons";
import { MenuBox, MENU_ITEM } from "./components";
import { t } from "./i18n";

const mediaType = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return ({ mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac", aac: "audio/aac" } as Record<string, string>)[ext];
};

export function Attachment({ image, message, auto, remove, like }: {
    image: MessageImage; message: ChatMessage; auto: boolean; remove: (() => void) | null; like: (() => void) | null;
})
{
    const [source, setSource] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [playing, setPlaying] = useState(false);
    const [pausedFrame, setPausedFrame] = useState<string | null>(null);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [volumeOpen, setVolumeOpen] = useState(false);
    const [opened, setOpened] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const touch = useTouch();
    const touchAt = useRef(-Infinity);
    const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);
    const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);
    const pending = useRef<Promise<string | null> | null>(null);
    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const player = useRef<HTMLVideoElement>(null);
    const frameChanged = useRef(false);
    const room = useRef<HTMLDivElement>(null);
    const alive = useRef(true);
    const mime = mediaType(image.filename);
    const [autoplay, setAutoplay] = useState(false);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        };
    }, []);
    useEffect(() => { if (player.current) player.current.volume = volume; }, [volume, source]);
    useEffect(() => {
        if (!menu && !volumeOpen) return;
        const dismiss = (event: PointerEvent) => {
            if (!(event.target as Element).closest("[data-attachment-volume]")) setVolumeOpen(false);
            if (!(event.target as Element).closest("[data-hold-menu]")) setMenu(null);
        };
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setVolumeOpen(false); } };
        window.addEventListener("pointerdown", dismiss);
        window.addEventListener("keydown", escape);
        return () => { window.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape); };
    }, [menu, volumeOpen]);
    useEffect(() => { if (auto && mime) void load(); }, [auto]);

    useEffect(() => {
        const play = (event: Event) => {
            if ((event as CustomEvent<number>).detail !== message.message_id) return;
            //A pinned card may show the same attachment a second time.
            if (document.querySelector(`[data-attachment-id="${message.message_id}"]`) !== room.current) return;
            setOpened(true);
            setAutoplay(true);
            void load();
        };
        const stop = () => { player.current?.pause(); if (player.current) player.current.currentTime = 0; setAutoplay(false); };
        window.addEventListener("why2-play-media", play);
        window.addEventListener("why2-stop-media", stop);
        return () => { window.removeEventListener("why2-play-media", play); window.removeEventListener("why2-stop-media", stop); };
    }, [message.message_id, source]);
    useEffect(() => {
        if (autoplay && source && player.current) {
            void player.current.play().catch((reason) => setError(String(reason)));
            setAutoplay(false);
        }
    }, [autoplay, source]);

    function load(): Promise<string | null>
    {
        if (source) return Promise.resolve(source);
        if (pending.current) return pending.current;
        pending.current = fetchSource().finally(() => { pending.current = null; });
        return pending.current;
    }

    async function fetchSource(): Promise<string | null>
    {
        setLoading(true);
        setError("");
        try {
            await invoke("request_image", { hash: image.hash });
            for (let attempt = 0; attempt < 120 && alive.current; attempt++) {
                const bytes = await invoke<string | null>("attachment_source", { hash: image.hash });
                if (!alive.current) return null;
                if (bytes) {
                    const url = `data:${mime ?? "application/octet-stream"};base64,${bytes}`;
                    setSource(url);
                    return url;
                }
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
            throw new Error(t("attachment.unavailable"));
        } catch (reason) {
            if (alive.current) setError(String(reason));
            return null;
        } finally { if (alive.current) setLoading(false); }
    }

    async function download()
    {
        const actions = await invoke<{ ask: boolean }>("picture_actions");
        const path = actions.ask ? await save({ defaultPath: image.filename }) : null;
        if (actions.ask && !path) return;
        const data = await load();
        if (!data || !alive.current) return;
        try { await invoke("save_image", { source: data, path, filename: image.filename }); }
        catch (reason) { setError(String(reason)); }
    }

    function togglePlayback()
    {
        if (playing) {
            player.current?.pause();
            setAutoplay(false);
        } else {
            setOpened(true);
            setAutoplay(true);
            void load();
        }
    }

    //Use an independent image while paused. The video compositor can lose its surface
    //during fullscreen; never replace the initial decoded poster with that surface.
    function capturePausedFrame()
    {
        const video = player.current;
        if (!frameChanged.current || !video || !video.paused || video.seeking || video.readyState < 2
            || !video.videoWidth || !video.videoHeight) return;
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return;
        try {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            setPausedFrame(canvas.toDataURL("image/jpeg", 0.92));
        } catch {
            //Keep the last valid image if a frame cannot be copied.
        }
    }

    function syncTime()
    {
        const video = player.current;
        if (!video) return;
        setPosition(Number.isFinite(video.currentTime) ? video.currentTime : 0);
        setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    }

    function seek(seconds: number)
    {
        if (!player.current || !Number.isFinite(seconds) || duration <= 0) return;
        const time = Math.max(0, Math.min(seconds, duration));
        frameChanged.current = true;
        player.current.currentTime = time;
        setPosition(time);
    }

    async function fullscreen()
    {
        try {
            if (document.fullscreenElement === room.current) await document.exitFullscreen();
            else { setOpened(true); void load(); await room.current?.requestFullscreen(); }
        } catch (reason) { setError(String(reason)); }
    }

    const shown = Boolean(mime && (auto || opened || source));
    const control = "attachment-control flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
    const button = (icon: string, label: string, action: () => void, disabled = false) => (
        <button type="button" title={label} aria-label={label} disabled={disabled} onClick={action} className={control}>
            <Icon name={icon} className="h-[18px] w-[18px]" />
        </button>
    );

    return <div ref={room} className="attachment-player my-2 w-full max-w-[520px] overflow-hidden rounded-xl border border-border bg-panel" data-attachment-id={message.message_id}
        onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (clickTimer.current !== null) clearTimeout(clickTimer.current);
            clickTimer.current = null;
            lastTap.current = null;
            if (remove) setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 248)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)) });
        }}>
        {shown && <div className="relative flex aspect-video min-h-0 flex-1 cursor-pointer items-center justify-center bg-deep focus-visible:outline-2 focus-visible:outline-accent"
            role="button" tabIndex={0} aria-label={t(playing ? "attachment.pause" : "chat.play")}
            style={{ touchAction: "manipulation" }}
            onPointerDown={(event) => {
                if (event.pointerType === "mouse") return;
                touchAt.current = performance.now();
                touchStart.current = event.isPrimary ? { x: event.clientX, y: event.clientY, at: touchAt.current } : null;
            }}
            onPointerCancel={() => {
                touchStart.current = null;
                lastTap.current = null;
                if (clickTimer.current !== null) clearTimeout(clickTimer.current);
                clickTimer.current = null;
            }}
            onPointerUp={(event) => {
                if (event.pointerType === "mouse") return;
                touchAt.current = performance.now();
                const start = touchStart.current;
                touchStart.current = null;
                //Scrolling, pinching and holding are not playback taps.
                if (!event.isPrimary || !start || touchAt.current - start.at > 500
                    || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) {
                    lastTap.current = null;
                    return;
                }
                const last = lastTap.current;
                if (last && touchAt.current - last.at <= 300
                    && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= 32) {
                    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
                    clickTimer.current = null;
                    lastTap.current = null;
                    like?.();
                    return;
                }
                if (clickTimer.current !== null) clearTimeout(clickTimer.current);
                lastTap.current = { x: event.clientX, y: event.clientY, at: touchAt.current };
                clickTimer.current = setTimeout(() => {
                    clickTimer.current = null;
                    lastTap.current = null;
                    togglePlayback();
                }, 300);
            }}
            onClick={(event) => {
                event.stopPropagation();
                //Android may synthesize click/dblclick after the pointer taps above.
                if (performance.now() - touchAt.current < 800 || (touch && event.detail > 0)) return;
                if (event.detail === 0) { togglePlayback(); return; }
                if (clickTimer.current !== null) clearTimeout(clickTimer.current);
                clickTimer.current = null;
                if (event.detail > 1) return;
                //Wait for a possible second click before changing playback.
                clickTimer.current = setTimeout(() => { clickTimer.current = null; togglePlayback(); }, 350);
            }}
            onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (touch || performance.now() - touchAt.current < 800) return;
                if (clickTimer.current !== null) clearTimeout(clickTimer.current);
                clickTimer.current = null;
                void fullscreen();
            }}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
                    clickTimer.current = null;
                    togglePlayback();
                }
            }}>

            <video ref={player} src={source ?? undefined} poster={image.source ?? undefined} playsInline preload="auto"
                className="h-full max-h-[65vh] w-full object-contain" aria-label={image.filename}
                onPlay={() => { frameChanged.current = true; setPlaying(true); }}
                onPause={() => { setPlaying(false); capturePausedFrame(); }}
                onEnded={() => { setPlaying(false); capturePausedFrame(); }}
                onLoadedMetadata={syncTime} onDurationChange={syncTime} onTimeUpdate={syncTime} onSeeked={() => { syncTime(); capturePausedFrame(); }}
                onError={() => setError(t("attachment.failed"))} />
            {!playing && (pausedFrame || image.source) && <img src={pausedFrame || image.source!} alt="" aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
            {!source && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-faint">
                <Icon name="video" className="h-10 w-10" />
            </div>}
        </div>}
        {shown && <div className="attachment-timeline flex shrink-0 items-center gap-3 border-t border-border px-3 pt-3 pb-1" onTouchStart={(event) => event.stopPropagation()}>
            <span className="shrink-0 text-[11px] tabular-nums text-muted">{mediaTime(position)}</span>
            <input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 0)}
                disabled={duration <= 0} aria-label={t("attachment.seek")}
                aria-valuetext={`${mediaTime(position)} / ${mediaTime(duration)}`}
                onChange={(event) => seek(Number(event.currentTarget.value))}
                style={{ touchAction: "pan-x" }} className="h-6 min-w-0 flex-1 cursor-pointer accent-current text-text disabled:cursor-default disabled:opacity-40" />
            <span className="shrink-0 text-[11px] tabular-nums text-muted">{mediaTime(duration)}</span>
        </div>}
        <div className={`flex shrink-0 items-center gap-1 px-2 py-1.5 ${shown ? "" : "border-t border-border"}`} onTouchStart={(event) => event.stopPropagation()}>
            {mime && button(playing ? "pause" : "play", t(playing ? "attachment.pause" : "chat.play"), togglePlayback, loading)}
            <span className="min-w-0 flex-1 truncate px-2 text-[12.5px] text-muted" title={image.filename}>{image.filename}</span>
            {mime && <div className="relative" data-attachment-volume>
                <button type="button" title={t("attachment.volume")} aria-label={t("attachment.volume")} aria-expanded={volumeOpen}
                    onClick={() => setVolumeOpen(!volumeOpen)} className={control}>
                    <Icon name={volume === 0 ? "speaker_off" : "speaker"} className="h-[18px] w-[18px]" />
                </button>
                {volumeOpen && <div className="absolute bottom-12 right-0 rounded-lg border border-border-strong bg-overlay px-3 py-2 shadow-lg">
                    <input autoFocus type="range" min="0" max="1" step="0.01" value={volume} aria-label={t("attachment.volume")}
                        onChange={(event) => setVolume(Number(event.currentTarget.value))} style={{ touchAction: "pan-x" }} className="block h-8 w-28 accent-current" />
                </div>}
            </div>}
            {button("download", t("attachment.download"), () => void download().catch((reason) => setError(String(reason))), loading)}
            {mime && button("fullscreen", t("attachment.fullscreen"), () => { setOpened(true); void fullscreen(); })}
        </div>
        {loading && <p role="status" className="px-4 pb-2 text-xs text-muted">{t("attachment.loading")}</p>}
        {error && <p role="alert" className="px-4 pb-2 text-xs text-error">{error}</p>}
        {menu && remove && <MenuBox at={menu} title={image.filename} portalTarget={document.fullscreenElement ?? undefined}>
            <button autoFocus type="button" className={`${MENU_ITEM} text-error`} onClick={() => { setMenu(null); remove(); }}>
                <Icon name="trash" className="h-4 w-4" />{t("attachment.delete")}
            </button>
        </MenuBox>}
    </div>;
}

export function isMedia(filename: string): boolean { return Boolean(mediaType(filename)); }

function mediaTime(seconds: number): string
{
    const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(total / 60);
    const rest = String(total % 60).padStart(2, "0");
    return minutes < 60 ? `${minutes}:${rest}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
}
