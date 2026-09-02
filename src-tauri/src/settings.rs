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

#[cfg(voice)]
use tokio::task;

use tauri::{ AppHandle, State };

use why2_chat::
{
    config,
    network::codes::{ PacketCode, ServerSetting, SettingValue },
};

//THE CALL AND THE SCREEN SHARE, WHICH THE ANDROID BUILD IS COMPILED WITHOUT - why2-chat IS PULLED IN
//THERE WITHOUT client_voice/client_screen, SO THESE MODULES DO NOT EXIST TO BE NAMED
#[cfg(voice)]
use why2_chat::network::voice::client::{ self as voice, options as voice_options };

use crate::types::*;
use crate::state::AppState;
use crate::emit::say;

#[cfg(voice)]
use crate::emit::emit_voice;

use crate::net::send_packet;

#[cfg(voice)]
pub(crate) const AUDIO_SETTINGS: &[SettingsKey] =
&[
    ("Audio", "Input device",      "input_device",      ClientKind::Device { input: true }),
    ("Audio", "Output device",     "output_device",     ClientKind::Device { input: false }),
    ("Audio", "Input volume",      "input_volume",      ClientKind::Volume),
    ("Audio", "Output volume",     "output_volume",     ClientKind::Volume),
    ("Audio", "Noise suppression", "noise_suppression", ClientKind::Toggle { invert: false }),
    ("Audio", "Automatic gain",    "automatic_gain",    ClientKind::Toggle { invert: false }),
];

#[cfg(not(voice))]
pub(crate) const AUDIO_SETTINGS: &[SettingsKey] = &[];

pub(crate) const INTERFACE_SETTINGS: &[SettingsKey] =
&[
    ("Interface", "Message colors",  "disable_colors", ClientKind::Toggle { invert: true }),
    ("Interface", "Show client IDs", "show_id",        ClientKind::Toggle { invert: false }),
];

//EVERY ROW THE BOX OFFERS, IN THE ORDER tui/settings.rs OPENS THEM
pub(crate) fn client_keys() -> impl Iterator<Item = &'static SettingsKey>
{
    AUDIO_SETTINGS.iter().chain(INTERFACE_SETTINGS)
}

//CELLS OF VOLUME BAR AND THE STEP EITHER ARROW MOVES IT BY, BOTH AS tui/settings.rs HAS THEM. THE BAR IS
//DRAWN IN THE WINDOW, SO ONLY THE STEP IS OURS - THE CEILING IS THE VOICE CLIENT'S OWN
#[cfg(voice)]
pub(crate) const VOLUME_STEP: u32 = 5;

//ONE ROW OF THE TABLE ABOVE: THE HEADING IT SITS UNDER, THE LABEL, THE KEY, AND WHAT THE KEY TAKES

#[tauri::command]
pub(crate) fn get_client_config() -> ClientConfig
{
    ClientConfig
    {
        show_id: config::read_config("show_id"),
        disable_colors: config::read_config("disable_colors"),
    }
}


pub(crate) fn client_kind(key: &str) -> Option<ClientKind>
{
    client_keys().find(|(_, _, candidate, _)| *candidate == key).map(|(_, _, _, kind)| *kind)
}

//OUR OWN CONFIG, AS THE SETTINGS BOX SHOWS IT. THE TUI READS EVERY VALUE OUT OF THE CONFIG ONCE WHEN THE
//OVERLAY OPENS AND NEVER RE-READS IT WHILE DRAWING - SO DOES THIS
pub(crate) fn client_settings() -> Vec<ClientSetting>
{
    client_keys().map(|(section, label, key, kind)| ClientSetting
    {
        label: label.to_string(),
        key: key.to_string(),
        section: section.to_string(),
        value: match kind
        {
            ClientKind::Toggle { invert } =>
            {
                let stored = config::read_config::<bool>(key);

                ClientValue::Toggle(if *invert { !stored } else { stored })
            },

            #[cfg(voice)]
            ClientKind::Volume => ClientValue::Volume
            {
                percent: voice_options::clamp_volume(config::read_config::<u32>(key)),
                max: voice_options::VOLUME_MAX,
                step: VOLUME_STEP,
            },

            #[cfg(voice)]
            ClientKind::Device { input } => ClientValue::Device
            {
                id: config::read_config::<String>(key),
                input: *input,
            },
        },
    }).collect()
}

#[tauri::command]
pub(crate) fn get_client_settings() -> Vec<ClientSetting>
{
    client_settings()
}

//EVERY DEVICE THE VOICE CLIENT COULD OPEN. THE LIST COMES FROM THE VOICE CLIENT ITSELF, SO IT IS
//ENUMERATED IN THE SAME cpal HOST THAT LATER OPENS THE CHOSEN ONE (BLOCKING, HENCE spawn_blocking)
#[tauri::command]
pub(crate) async fn get_audio_devices() -> AudioDevices
{
    #[cfg(not(voice))]
    return AudioDevices::default();

    #[cfg(voice)]
    task::spawn_blocking(||
    {
        let entry = |device: voice::AudioDevice| AudioDeviceInfo { id: device.id, label: device.label };
        let (input, output) = voice::list_devices();

        AudioDevices
        {
            input: input.into_iter().map(entry).collect(),
            output: output.into_iter().map(entry).collect(),
        }
    }).await.unwrap_or_default()
}

//FLIP ONE TOGGLE. IT IS WRITTEN THROUGH IMMEDIATELY - client.toml IS OURS, AND THE INTERFACE KEYS ARE THE
//ONES THE PANE DRAWS ITSELF FROM, SO THE CONFIG COMES BACK FOR THE WINDOW TO REDRAW ON THE SPOT
#[tauri::command]
pub(crate) fn set_client_setting(key: String, on: bool) -> Result<ClientConfig, String>
{
    let Some(ClientKind::Toggle { invert }) = client_kind(&key) else { return Err(String::from("Unknown setting!")) };

    config::client_write_bool(&key, if invert { !on } else { on });

    //THE TWO AUDIO TOGGLES ARE READ BY THE CAPTURE CALLBACK OUT OF ITS OWN GLOBALS, NOT OFF THE DISK
    #[cfg(voice)]
    match key.as_str()
    {
        "noise_suppression" => voice_options::set_noise_suppression(on),
        "automatic_gain" => voice_options::set_automatic_gain(on),
        _ => {},
    }

    Ok(get_client_config())
}

//SLIDE ONE VOLUME. THE STORED VALUE COMES BACK BECAUSE THE CEILING IS THE VOICE CLIENT'S, NOT THE BOX'S -
//A ROW THAT DREW WHAT IT ASKED FOR RATHER THAN WHAT WAS KEPT WOULD SIT ABOVE THE MAXIMUM LOOKING APPLIED
#[tauri::command]
pub(crate) fn set_client_volume(key: String, percent: u32, app: AppHandle) -> Result<u32, String>
{
    //THERE IS NO VOLUME TO SLIDE IN A BUILD WITH NO STREAMS TO SLIDE IT ON, AND NO ROW THAT ASKS
    #[cfg(not(voice))]
    { let _ = (key, percent, app); return Err(String::from("Voice is not available on this platform.")) }

    #[cfg(voice)]
    {
    let Some(ClientKind::Volume) = client_kind(&key) else { return Err(String::from("Unknown setting!")) };

    let percent = voice_options::clamp_volume(percent);

    config::client_write_int(&key, percent as i64);

    //LIVE-UPDATE THE RUNNING STREAMS - A VOLUME IS THE ONE SETTING THAT IS USELESS A SESSION LATER
    match key.as_str()
    {
        "input_volume" => voice_options::set_input_volume(percent),
        "output_volume" => voice_options::set_output_volume(percent),
        _ => {},
    }

    //THE MICROPHONE READING IN THE STATUS ROW COUNTS 0% AS OFF, SO IT MOVES WITH THIS
    emit_voice(&app);

    Ok(percent)
    }
}

//POINT ONE OF THE TWO DEVICE KEYS SOMEWHERE ELSE. AN EMPTY ID IS "WHATEVER THE SYSTEM PICKS", WHICH IS
//WHAT THE CONFIG SHIPS WITH - AND A RUNNING CALL REBUILDS ITS STREAMS WITHOUT BEING DROPPED
#[tauri::command]
pub(crate) fn set_client_device(key: String, id: String) -> Result<(), String>
{
    #[cfg(not(voice))]
    { let _ = (key, id); return Err(String::from("Voice is not available on this platform.")) }

    #[cfg(voice)]
    {
        let Some(ClientKind::Device { .. }) = client_kind(&key) else { return Err(String::from("Unknown setting!")) };

        config::client_write(&key, &id);
        voice_options::mark_devices_changed();

        Ok(())
    }
}

//THE EDITED SERVER ROWS, IN ONE GO. THE BOX HOLDS THEM UNTIL THIS IS CALLED BECAUSE server.toml IS NOT
//OURS TO WRITE - THE ANSWER IS THE CONFIG AS IT ACTUALLY STANDS, WHICH IS WHAT REDRAWS THE ROWS
#[tauri::command]
pub(crate) async fn save_server_settings(settings: Vec<SettingRow>, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    if settings.is_empty() { return Ok(()) }

    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(String::from("Not connected!")) };

    //A KEY THE SERVER ONLY READS AT STARTUP IS STORED LIKE ANY OTHER - IT JUST WILL NOT DO ANYTHING YET
    let restart = settings.iter().filter(|row| row.restart).map(|row| row.key.clone()).collect::<Vec<String>>();

    let settings = settings.into_iter().map(|row| ServerSetting
    {
        key: row.key,
        value: match row.value
        {
            SettingValueInfo::Toggle(on) => SettingValue::Toggle(on),
            SettingValueInfo::Number(number) => SettingValue::Number(number),
            SettingValueInfo::Text(text) => SettingValue::Text(text),
        },

        //THE SERVER IS THE ONE WHO KNOWS THESE - SENDING THEM BACK WOULD ONLY BE US QUOTING IT
        section: String::new(),
        description: String::new(),
        restart: false,
    }).collect();

    send_packet(&state, &write_stream, PacketCode::ServerSettings { settings: Some(settings), save: true }).await;

    //STORED IS NOT THE SAME AS IN USE FOR THESE - SAY SO ONCE, WHERE THE USER READS THINGS
    if !restart.is_empty()
    {
        say(&app, ChatMessage::notice(format!("{} takes effect when the server is restarted.", restart.join(", "))));
    }

    Ok(())
}

//THE ONE BUTTON THAT ENDS THE SESSION FOR EVERYBODY ON THE SERVER. IT IS THE LAST THING THIS SOCKET
//CARRIES: THE SERVER ANSWERS BY DISCONNECTING EVERYBODY AND GOING DOWN, WHICH LANDS US BACK IN THE
//CONNECT BOX LIKE ANY OTHER DROP
#[tauri::command]
pub(crate) async fn restart_server(app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(String::from("Not connected!")) };

    send_packet(&state, &write_stream, PacketCode::ServerRestart).await;

    say(&app, ChatMessage::notice("Restarting the server..."));

    Ok(())
}

//THE ANSWERS ONE PARAMETER ACCEPTS. THE COLOR NAMES ARE crossterm'S OWN AND ARE NOWHERE ON THE SCREEN, AND
//A MONITOR IS NAMED BY THE DISPLAY SERVER (DP-3, \\.\DISPLAY2) - NEITHER IS SOMETHING TO GUESS AT. THIS IS
//ASKED FOR EVERY TIME THE CARET LANDS ON SUCH A PARAMETER RATHER THAN ONCE: A MONITOR PLUGGED IN MID-SESSION
//IS STILL SUPPOSED TO SHOW UP HERE
