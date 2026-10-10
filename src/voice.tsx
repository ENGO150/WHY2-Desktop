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

//BARS A CLIP IS DRAWN WITH (voice_message.rs)
const BARS = 48;

//THE HEIGHT OF A BAR WITH NO WAVEFORM YET
const FLAT = 0.18;

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

//ONE VOICE MESSAGE: THE BUTTON, THE WAVEFORM AND THE TIME
export function VoiceNote({ voice, voices }: { voice: MessageVoice; voices: Voices })
{
    const now = React.useSyncExternalStore(subscribe, playback);
    const waveform = voices.waveform(voice.hash);

    const row = React.useRef<HTMLButtonElement>(null);
    const played = React.useRef<HTMLSpanElement>(null);
    const time = React.useRef<HTMLSpanElement>(null);
    const asked = React.useRef(false);

    const mine = now.hash === voice.hash;
    const playing = mine && !now.loading;
    const gone = waveform === "gone";

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

    //THE PLAYHEAD, BETWEEN TICKS
    React.useEffect(() =>
    {
        if (!playing) return;

        let frame = 0;

        const draw = () =>
        {
            const ms = Math.min(voice.duration, now.ms + Math.min(performance.now() - now.at, AHEAD));
            const left = 100 - (100 * ms) / Math.max(voice.duration, 1);

            if (played.current) played.current.style.clipPath = `inset(0 ${left}% 0 0)`;
            if (time.current) time.current.textContent = clock(ms);

            frame = requestAnimationFrame(draw);
        };

        draw();

        return () => cancelAnimationFrame(frame);
    }, [playing, now]);

    const heights = Array.isArray(waveform) ? waveform.map((level) => Math.max(0.12, level / 255)) : Array<number>(BARS).fill(FLAT);

    const bars = (tone: string) => heights.map((height, index) => (
        <span key={index} className={`min-w-[1.5px] max-w-[3px] flex-1 rounded-full ${tone}`} style={{ height: `${height * 100}%` }} />
    ));

    const label = mine ? t("chat.stop") : t("chat.play");

    return (
        <button
            ref={row}
            type="button"
            title={label}
            aria-label={`${t("chat.voice_message")} · ${clock(voice.duration)} · ${label}`}
            onClick={() => (mine ? voices.stop() : voices.play(voice.hash))}
            className="voice-note mt-1 flex w-full max-w-[360px] items-center gap-3 rounded-full border border-border bg-raised py-1.5 pl-1.5 pr-4 text-left transition-colors hover:border-border-strong"
        >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text text-chat">
                {mine && now.loading
                    ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-chat/40 border-t-chat" />
                    : <Icon name={mine ? "stop" : "play"} className="h-3.5 w-3.5 fill-current" />}
            </span>

            <span className={`relative flex h-7 min-w-0 flex-1 items-center justify-between gap-[2px] ${gone ? "opacity-40" : ""}`}>
                {bars(Array.isArray(waveform) ? "bg-faint" : "bg-faint/60")}

                {playing && (
                    <span ref={played} className="absolute inset-0 flex items-center justify-between gap-[2px]" style={{ clipPath: "inset(0 100% 0 0)" }}>
                        {bars("bg-text")}
                    </span>
                )}
            </span>

            {gone
                ? <span className="shrink-0 text-[12px] text-error">{t("chat.unavailable")}</span>
                : <span ref={time} className="shrink-0 text-[12px] tabular-nums text-muted">{clock(playing ? now.ms : voice.duration)}</span>}
        </button>
    );
}
