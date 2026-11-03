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

import type { ChatMessage, ClientConfig } from "./types";
import { Icon } from "./icons";
import { Avatar, Overlay, PanelHeader } from "./components";
import { messageColor } from "./messages";
import { sentAt } from "./format";
import { t } from "./i18n";

//WHAT IS PINNED, AS A WINDOW OF ITS OWN RATHER THAN A CARD IN THE STREAM. A ROW IS A LINE SOMEBODY
//SAID, SO A PRESS GOES TO IT AND A HOLD OPENS ITS OWN MENU
export function PinsBox(
{
    pins, config, pinsRef, narrow, send, jump, hold, held, close,
}: {
    pins: ChatMessage[];
    config: ClientConfig;
    pinsRef: React.RefObject<HTMLDivElement | null>;
    narrow: boolean;
    send: (input: string) => void;
    jump: (message_id: number) => void;
    hold: (message: ChatMessage) => Record<string, unknown>;
    held: () => boolean;
    close: () => void;
})
{
    const width = Math.max(...pins.map((message) => String(message.message_id ?? "").length), 1);

    return (
        <Overlay narrow={narrow} width={520} label={t("chat.pins")} cardRef={pinsRef} close={close}>
            <PanelHeader
                title={t("pins.title", { count: pins.length }).replace(/[:：]$/, "")}
                aside={(
                    <button type="button" title={t("files.refresh")} aria-label={t("files.refresh")} onClick={() => send("/pins")} className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text">
                        <Icon name="refresh" className="h-[18px] w-[18px]" />
                    </button>
                )}
                close={close}
            />

            <div className="scroller min-h-[200px] flex-1 px-3 pb-5 pt-3">
                {pins.length === 0 && (
                    <div className="px-4 py-16 text-center text-[14px] text-faint">{t("pins.none")}</div>
                )}

                {pins.map((message) => (
                    <button
                        key={message.message_id}
                        type="button"
                        {...hold(message)}
                        onClick={() =>
                        {
                            //A HOLD ENDS IN A CLICK LIKE ANY OTHER PRESS
                            if (held()) return;

                            close();
                            if (message.message_id !== null) jump(message.message_id);
                        }}
                        className="group flex w-full select-none items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors [-webkit-touch-callout:none] hover:bg-hover"
                    >
                        <span className="shrink-0 text-right font-mono text-[12px] leading-5 text-faint" style={{ width: `${width + 1}ch` }}>#{message.message_id}</span>

                        <Avatar name={message.username} color={messageColor(config, message.username_color)} size={26} />

                        <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                                <span className="truncate text-[13.5px] font-medium" style={{ color: messageColor(config, message.username_color) }}>
                                    {message.username}
                                </span>

                                {config.show_timestamps && message.timestamp !== null && (
                                    <span className="shrink-0 text-[11.5px] text-faint">{sentAt(message.timestamp, true)}</span>
                                )}
                            </span>

                            <span
                                className={`block truncate text-[13px] ${message.voice ? "text-faint" : ""}`}
                                style={message.voice ? undefined : { color: messageColor(config, message.message_color) }}
                            >
                                {message.voice ? t("pins.voice") : message.text.replace(/\n/g, " ")}
                            </span>
                        </span>

                        <Icon name="chevron_right" className="h-4 w-4 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                ))}
            </div>
        </Overlay>
    );
}
