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

import type { MessageVoice, Waveform } from "./types";
import { Icon } from "./icons";
import { clock } from "./format";
import { t } from "./i18n";
import { PRELOAD_SCREENS } from "./messages";

//A BAR AND THE GAP AFTER IT, IN CSS PIXELS
const BAR = 2;
const GAP = 1.5;

//THE HEIGHT OF A BAR WITH NO WAVEFORM YET, AND THE LOWEST ONE WITH
const FLAT = 0.18;
const FLOOR = 0.1;

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
    play: (hash: string) => void;
    stop: () => void;
    load: (hash: string) => void;
    seek: (hash: string, ms: number) => void;
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

//ONE VOICE MESSAGE: THE BUTTON, THE WAVEFORM AND THE TIME
export function VoiceNote({ voice, voices }: { voice: MessageVoice; voices: Voices })
{
    const now = React.useSyncExternalStore(subscribe, playback);
    const waveform = voices.waveform(voice.hash);

    const row = React.useRef<HTMLDivElement>(null);
    const canvas = React.useRef<HTMLCanvasElement>(null);
    const time = React.useRef<HTMLSpanElement>(null);
    const hover = React.useRef<number | null>(null);
    const asked = React.useRef(false);

    const mine = now.hash === voice.hash;
    const playing = mine && !now.loading;
    const gone = waveform === "gone";
    const levels = Array.isArray(waveform) ? waveform : null;

    //AS MANY BARS AS FIT, PLAYED PART IN text
    const draw = () =>
    {
        const node = canvas.current;
        if (!node) return;

        const width = node.clientWidth;
        const height = node.clientHeight;
        const ratio = window.devicePixelRatio || 1;

        if (!width || !height) return;

        if (node.width !== Math.round(width * ratio) || node.height !== Math.round(height * ratio))
        {
            node.width = Math.round(width * ratio);
            node.height = Math.round(height * ratio);
        }

        const context = node.getContext("2d");
        if (!context) return;

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);

        const style = getComputedStyle(node);
        const tone = (name: string) => style.getPropertyValue(name).trim();
        const [played, hovered, rest] = [tone("--text"), tone("--muted"), tone("--faint")];

        const at = position(voice.hash, voice.duration) / Math.max(voice.duration, 1);
        const bars = Math.max(8, Math.floor((width + GAP) / (BAR + GAP)));

        for (let bar = 0; bar < bars; bar++)
        {
            //LOUDEST POINT UNDER THE BAR
            let level = FLAT;

            if (levels && levels.length)
            {
                const first = Math.floor((bar * levels.length) / bars);
                const last = Math.max(first + 1, Math.floor(((bar + 1) * levels.length) / bars));

                level = Math.max(FLOOR, Math.max(...levels.slice(first, last)) / 255);
            }

            const x = bar * (BAR + GAP);
            const middle = (x + BAR / 2) / width;
            const tall = level * height;

            context.fillStyle = middle <= at ? played : hover.current !== null && middle <= hover.current ? hovered : rest;
            context.beginPath();

            if (context.roundRect) context.roundRect(x, (height - tall) / 2, BAR, tall, BAR / 2);
            else context.rect(x, (height - tall) / 2, BAR, tall);

            context.fill();
        }
    };

    //LOADED ONCE NEAR THE VIEW
    React.useEffect(() =>
    {
        const node = row.current;

        if (voice.state !== "deferred" || waveform !== undefined || !node || asked.current) return;

        const observer = new IntersectionObserver((entries) =>
        {
            if (!entries.some((entry) => entry.isIntersecting) || asked.current) return;

            asked.current = true;
            voices.load(voice.hash);
        }, { root: node.closest(".scroller"), rootMargin: `${PRELOAD_SCREENS * 100}% 0px` });

        observer.observe(node);

        return () => observer.disconnect();
    }, [voice.state, waveform]);

    //EVERY RENDER, AND EVERY RESIZE
    React.useLayoutEffect(draw);

    React.useEffect(() =>
    {
        const node = canvas.current;
        if (!node) return;

        const observer = new ResizeObserver(() => draw());
        observer.observe(node);

        return () => observer.disconnect();
    }, [levels]);

    //THE PLAYHEAD, BETWEEN TICKS
    React.useEffect(() =>
    {
        if (!playing) return;

        let frame = 0;

        const tick = () =>
        {
            draw();

            if (time.current) time.current.textContent = clock(position(voice.hash, voice.duration));

            frame = requestAnimationFrame(tick);
        };

        tick();

        return () => cancelAnimationFrame(frame);
    }, [playing, now, levels]);

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
            <canvas
                ref={canvas}
                role="slider"
                aria-label={t("chat.voice_message")}
                aria-valuemin={0}
                aria-valuemax={voice.duration}
                aria-valuenow={mine ? now.ms : 0}
                onClick={(event) => voices.seek(voice.hash, Math.round(under(event) * voice.duration))}
                onPointerMove={(event) =>
                {
                    if (event.pointerType !== "mouse") return;

                    hover.current = under(event);
                    draw();
                }}
                onPointerLeave={() =>
                {
                    hover.current = null;
                    draw();
                }}
                className={`block h-8 min-w-0 flex-1 cursor-pointer ${gone ? "opacity-40" : ""}`}
            />

            {gone
                ? <span className="shrink-0 text-[12px] text-error">{t("chat.unavailable")}</span>
                : <span ref={time} className="shrink-0 text-[12px] tabular-nums text-muted">{clock(mine ? now.ms : voice.duration)}</span>}
        </div>
    );
}
