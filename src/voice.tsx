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

import React from "react";

import type { ChatMessage, MessageVoice, Waveform } from "./types";
import { Icon } from "./icons";
import { clock } from "./format";
import { t } from "./i18n";
import { PRELOAD_SCREENS } from "./messages";

//THE WAVEFORM'S DRAWING SPACE, STRETCHED TO THE LINE'S WIDTH
const WIDE = 1000;
const HIGH = 100;

//THE HALF-HEIGHT OF A FLAT ENVELOPE, AND OF A SILENT POINT
const FLAT = 0.08;
const FLOOR = 0.03;

//HOW FAR AHEAD OF THE LAST TICK THE BAR MAY RUN
const AHEAD = 250;

//WHAT PLAYS
export interface Playback
{
    hash: string | null;
    ms: number;
    loading: boolean;
    at: number; //WHEN ms WAS TRUE
}

//WHAT A VOICE LINE CAN ASK FOR
export interface Voices
{
    waveform: (hash: string) => Waveform | undefined;
    auto: boolean; //FETCH NEAR THE VIEW
    play: (hash: string) => void;
    stop: () => void;
    load: (hash: string) => void;
    seek: (hash: string, ms: number, event: React.MouseEvent, message: ChatMessage) => void;
}

//KEPT OUT OF THE WINDOW'S STATE, SINCE IT TICKS
let current: Playback = { hash: null, ms: 0, loading: false, at: 0 };
const listeners = new Set<() => void>();

export function setPlayback(hash: string | null, ms: number, loading: boolean)
{
    current = { hash, ms, loading, at: performance.now() };
    listeners.forEach((listener) => listener());
}

export function playback(): Playback
{
    return current;
}

function subscribe(listener: () => void)
{
    listeners.add(listener);

    return () => { listeners.delete(listener); };
}

//WHERE A CLIP IS, BETWEEN TICKS
function position(hash: string, duration: number): number
{
    const now = current;

    if (now.hash !== hash) return 0;
    if (now.loading) return now.ms;

    return Math.min(duration, now.ms + Math.min(performance.now() - now.at, AHEAD));
}

//A SMOOTH EDGE THROUGH THE POINTS (CATMULL-ROM)
function edge(points: [number, number][]): string
{
    let path = "";

    for (let index = 0; index < points.length - 1; index++)
    {
        const [x0, y0] = points[index - 1] ?? points[index];
        const [x1, y1] = points[index];
        const [x2, y2] = points[index + 1];
        const [x3, y3] = points[index + 2] ?? points[index + 1];

        const c1 = `${(x1 + (x2 - x0) / 6).toFixed(1)},${(y1 + (y2 - y0) / 6).toFixed(1)}`;
        const c2 = `${(x2 - (x3 - x1) / 6).toFixed(1)},${(y2 - (y3 - y1) / 6).toFixed(1)}`;

        path += ` C${c1} ${c2} ${x2.toFixed(1)},${y2.toFixed(1)}`;
    }

    return path;
}

//THE ENVELOPE, MIRRORED ABOUT THE MIDDLE
function envelope(levels: number[] | null): string
{
    const heights = levels && levels.length > 1 ? levels.map((level) => Math.max(FLOOR, level / 255)) : [FLAT, FLAT];
    const step = WIDE / (heights.length - 1);
    const middle = HIGH / 2;

    const top = heights.map((height, index): [number, number] => [index * step, middle - height * middle * 0.96]);
    const bottom = heights.map((height, index): [number, number] => [index * step, middle + height * middle * 0.96]).reverse();

    return `M${top[0][0]},${top[0][1].toFixed(1)}${edge(top)} L${bottom[0][0]},${bottom[0][1].toFixed(1)}${edge(bottom)} Z`;
}

//ONE VOICE MESSAGE: THE BUTTON, THE WAVEFORM AND THE TIME
export function VoiceNote({ voice, voices, message }: { voice: MessageVoice; voices: Voices; message: ChatMessage })
{
    const now = React.useSyncExternalStore(subscribe, playback);
    const waveform = voices.waveform(voice.hash);

    const row = React.useRef<HTMLDivElement>(null);
    const played = React.useRef<SVGRectElement>(null);
    const hovered = React.useRef<SVGRectElement>(null);
    const time = React.useRef<HTMLSpanElement>(null);
    const asked = React.useRef(false);

    const id = `wave${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
    const playedClip = `${id}-played`;
    const hoverClip = `${id}-hover`;

    const mine = now.hash === voice.hash;
    const playing = mine && !now.loading;
    const gone = waveform === "gone";
    const levels = Array.isArray(waveform) ? waveform : null;

    const shape = React.useMemo(() => envelope(levels), [levels]);

    //THE PLAYED PART, AS A CLIP WIDTH
    const follow = () =>
    {
        const at = position(voice.hash, voice.duration) / Math.max(voice.duration, 1);

        played.current?.setAttribute("width", (at * WIDE).toFixed(1));

        return at;
    };

    //FETCHED ONCE NEAR THE VIEW
    React.useEffect(() =>
    {
        const node = row.current;

        if (!voices.auto || waveform !== undefined || !node || asked.current) return;

        const observer = new IntersectionObserver((entries) =>
        {
            if (!entries.some((entry) => entry.isIntersecting) || asked.current) return;

            asked.current = true;
            voices.load(voice.hash);
        }, { root: node.closest(".scroller"), rootMargin: `${PRELOAD_SCREENS * 100}% 0px` });

        observer.observe(node);

        return () => observer.disconnect();
    }, [voices.auto, waveform]);

    React.useLayoutEffect(() => { follow(); });

    //THE PLAYHEAD, BETWEEN TICKS
    React.useEffect(() =>
    {
        if (!playing) return;

        let frame = 0;

        const tick = () =>
        {
            follow();

            if (time.current) time.current.textContent = clock(position(voice.hash, voice.duration));

            frame = requestAnimationFrame(tick);
        };

        tick();

        return () => cancelAnimationFrame(frame);
    }, [playing, now]);

    //THE PART OF THE CLIP UNDER THE POINTER
    const under = (event: React.PointerEvent | React.MouseEvent) =>
    {
        const box = event.currentTarget.getBoundingClientRect();

        return Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(box.width, 1)));
    };

    const label = mine ? t("chat.stop") : t("chat.play");

    return (
        <div
            ref={row}
            className="voice-note mt-1 flex w-full max-w-[420px] items-center gap-3 rounded-full border border-border bg-raised py-1.5 pl-1.5 pr-4"
        >
            <button
                type="button"
                title={label}
                aria-label={`${t("chat.voice_message")} · ${clock(voice.duration)} · ${label}`}
                onClick={() => (mine ? voices.stop() : voices.play(voice.hash))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text text-chat transition hover:opacity-90"
            >
                {mine && now.loading
                    ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-chat/40 border-t-chat" />
                    : <Icon name={mine ? "stop" : "play"} className="h-3.5 w-3.5 fill-current" />}
            </button>

            {/* A CLICK PLAYS FROM THERE */}
            <svg
                role="slider"
                aria-label={t("chat.voice_message")}
                aria-valuemin={0}
                aria-valuemax={voice.duration}
                aria-valuenow={mine ? now.ms : 0}
                viewBox={`0 0 ${WIDE} ${HIGH}`}
                preserveAspectRatio="none"
                onClick={(event) => voices.seek(voice.hash, Math.round(under(event) * voice.duration), event, message)}
                onPointerMove={(event) =>
                {
                    if (event.pointerType === "mouse") hovered.current?.setAttribute("width", (under(event) * WIDE).toFixed(1));
                }}
                onPointerLeave={() => hovered.current?.setAttribute("width", "0")}
                className={`voice-wave block h-8 min-w-0 flex-1 cursor-pointer ${gone ? "opacity-40" : ""}`}
            >
                <defs>
                    <clipPath id={playedClip}><rect ref={played} x="0" y="0" width="0" height={HIGH} /></clipPath>
                    <clipPath id={hoverClip}><rect ref={hovered} x="0" y="0" width="0" height={HIGH} /></clipPath>
                </defs>

                <path d={shape} style={{ fill: "var(--faint)" }} />
                <path d={shape} clipPath={`url(#${hoverClip})`} style={{ fill: "var(--muted)" }} />
                <path d={shape} clipPath={`url(#${playedClip})`} style={{ fill: "var(--text)" }} />
            </svg>

            {gone
                ? <span className="shrink-0 text-[12px] text-error">{t("chat.unavailable")}</span>
                : <span ref={time} className="shrink-0 text-[12px] tabular-nums text-muted">{clock(mine ? now.ms : voice.duration)}</span>}
        </div>
    );
}
