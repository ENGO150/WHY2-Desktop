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

#[cfg(media)]
use std::sync::atomic::Ordering;

use tauri::{ Emitter, AppHandle };

#[cfg(media)]
use tauri::Manager;

#[cfg(media)]
use why2_chat::options;

//THE CALL AND THE SCREEN SHARE, WHICH THE ANDROID BUILD IS COMPILED WITHOUT - why2-chat IS PULLED IN
//THERE WITHOUT client_voice/client_screen, SO THESE MODULES DO NOT EXIST TO BE NAMED
#[cfg(media)]
use why2_chat::network::
{
    client::VoiceUser,
    voice::client::options as voice_options,
    screen::client::options as screen_options,
};

use crate::types::*;
use crate::state::EVENT;

#[cfg(media)]
use crate::state::AppState;
#[cfg(media)]
use why2_chat::network::screen::client::capture as screen_capture;

pub(crate) fn emit(app: &AppHandle, event: UiEvent) //HAND ONE EVENT TO THE WEBVIEW
{
    app.emit(EVENT, event).ok();
}

pub(crate) fn say(app: &AppHandle, message: ChatMessage) //PUSH ONE LINE INTO THE PANE
{
    emit(app, UiEvent::Message { message });
}

pub(crate) fn popup(app: &AppHandle, text: impl Into<String>) //PUSH ONE TOAST
{
    emit(app, UiEvent::Popup { text: text.into() });
}

pub(crate) fn block(app: &AppHandle, title: String, rows: Vec<BlockRow>) //PUSH ONE TREE INTO THE PANE
{
    emit(app, UiEvent::Block { title, rows });
}

//THE CALL AS IT STANDS. EVERYTHING THAT TOUCHES ANY PART OF IT ENDS HERE - THE ROSTER ARRIVING, THE
//SERVER LETTING US IN OR PUTTING US OUT, A MUTE TOGGLED, A VOLUME SLID - BECAUSE THE PANEL AND THE
//MICROPHONE READING ARE ONE PICTURE AND HALF OF IT IS ALWAYS WRONG
#[cfg(media)]
pub(crate) fn emit_voice(app: &AppHandle)
{
    let state = app.state::<AppState>();

    emit(app, UiEvent::Voice
    {
        voice: VoiceState
        {
            enabled: state.voice_enabled.load(Ordering::Relaxed),
            mic: !options::is_muted(None) && voice_options::get_input_volume() > 0,
            users: state.voice_users.lock().unwrap().clone(),
        },
    });
}

//OUR SHARE AS IT STANDS. BOTH HALVES OF IT LIVE IN THE CRATE'S GLOBALS AND MOVE WITHOUT US - THE SERVER
//TOGGLES THE SHARE, THE COMMAND SWAPS THE MONITOR - SO THEY ARE READ HERE RATHER THAN KEPT
#[cfg(media)]
pub(crate) fn emit_screen(app: &AppHandle)
{
    let sharing = screen_options::get_use_screen();

    emit(app, UiEvent::Screen
    {
        screen: ScreenState
        {
            sharing,

            //WHAT THE CAPTURE IS POINTED AT ONLY MEANS ANYTHING WHILE THERE IS ONE
            monitor: sharing.then(screen_capture::current_monitor).flatten(),
        },
    });
}

//THERE IS NO CALL AND NO SHARE IN THIS BUILD, AND THE ANSWER TO BOTH QUESTIONS IS THE SAME EVERY TIME -
//WHICH IS WHAT THE WINDOW DRAWS ITS (ABSENT) HEADSET AND MONITOR BUTTONS FROM
#[cfg(not(media))]
pub(crate) fn emit_voice(app: &AppHandle)
{
    emit(app, UiEvent::Voice { voice: VoiceState { enabled: false, mic: false, users: Vec::new() } });
}

#[cfg(not(media))]
pub(crate) fn emit_screen(app: &AppHandle)
{
    emit(app, UiEvent::Screen { screen: ScreenState { sharing: false, monitor: None } });
}

//ONE USER OF THE CALL, WITH THE MUTE READ OFF THE CRATE'S GLOBALS THE WAY tui/draw.rs READS IT: OUR OWN
//ROW ASKS ABOUT THE MICROPHONE, EVERYBODY ELSE'S ABOUT THEIR ID
#[cfg(media)]
pub(crate) fn voice_user(user: VoiceUser) -> VoiceUserInfo
{
    VoiceUserInfo
    {
        muted: options::is_muted((!user.is_local).then_some(user.id)),
        id: user.id,
        username: user.username,
        speaking: user.is_speaking,
        latency: user.latency,
        local: user.is_local,
    }
}

//EVERY PIECE OF SESSION STATE THAT LIVES IN THE CRATE'S GLOBALS. THE NEXT HANDSHAKE HAS TO START FROM
//THE SAME PLACE THE FIRST ONE DID - THE SEQUENCE NUMBERS ESPECIALLY, SINCE A SECOND CONNECTION THAT
//KEPT THE FIRST ONE'S COUNTERS WOULD HAVE EVERY PACKET IT SENDS REFUSED
