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

//THE BRIDGE IS THIS FILE AND THE MODULES BELOW IT: run() IS ONLY WHAT PUTS THEM TOGETHER. THE ORDER IS
//THE ORDER THEY STAND ON EACH OTHER IN - THE TYPES THE WIRE AND THE WEBVIEW BOTH SPEAK, THE STATE A
//SESSION KEEPS, WHAT PUSHES AN EVENT AT THE WINDOW, AND THEN THE PATHS THAT DO SOMETHING: THE SOCKET,
//THE LINE THE USER TYPED, THE EVENTS COMING BACK, AND THE PICTURE OF SOMEBODY ELSE'S SCREEN
mod types;
mod state;
mod emit;
mod color;
mod settings;
mod palette;
mod servers;
mod net;
mod input;
mod events;
mod screen;
mod picture;

//THE ONLY PLACE IN THE APP THAT SPEAKS JNI, AND THE ONLY ONE A PHONE NEEDS: THE CALL HAS A PERMISSION TO
//ASK FOR AND cpal HAS A CONTEXT TO BE HANDED
#[cfg(target_os = "android")]
mod android;

use std::
{
    collections::BTreeMap,
    time::Instant,
    sync::
    {
        Mutex,
        atomic::{ AtomicBool, AtomicU64 },
    },
};

use tokio::sync::Mutex as MutexAsync;

use why2_chat::
{
    config,
    options,
    role::Role,
};

//THE APP'S OWN DATA DIR IS ASKED FOR THROUGH Manager, AND ONLY ANDROID ASKS
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(screen)]
use tokio::sync::mpsc;

#[cfg(screen)]
use why2_chat::network::screen::client as screen_client;

use state::AppState;

use net::{ connect_to_server, refresh_screens, answer_tofu };
use servers::{ get_servers, save_server, remove_server };
use input::{ send_input, upload_file_from_path, request_image };
use palette::{ get_commands, get_vocabulary };
use screen::{ watch_frames, drop_frames };
use settings::
{
    get_client_config,
    get_client_settings,
    get_audio_devices,
    set_client_setting,
    set_client_volume,
    set_client_device,
    set_voice_speaker,
    save_server_settings,
    restart_server,
};

#[cfg(screen)]
use screen::screen_frames;

//WHAT THE WINDOW'S OWN FRAME IS. THIS IS THE ONE THING THE PAGE IS TOLD ABOUT THE PLATFORM IT IS ON -
//EVERYTHING ELSE IT ASKS AS "CAN THIS BUILD DO IT" AND IS ANSWERED BY get_commands - BECAUSE A TITLE BAR
//IS NOT A CAPABILITY: IT IS EITHER DRAWN BY SOMEBODY ELSE OR IT IS OURS TO DRAW, AND ONLY THE TARGET
//SAYS WHICH. WINDOWS AND LINUX RUN UNDECORATED (tauri.conf.json), MACOS KEEPS ITS TRAFFIC LIGHTS OVER
//THE PAGE (tauri.macos.conf.json), AND A PHONE HAS NO WINDOW FRAME TO SPEAK OF
#[tauri::command]
fn window_chrome() -> &'static str
{
    #[cfg(target_os = "android")]
    { "none" }

    #[cfg(target_os = "macos")]
    { "native" }

    #[cfg(not(any(target_os = "android", target_os = "macos")))]
    { "buttons" }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run()
{
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    //THE ONE WAY TO A content:// URI FROM RUST, AND ANDROID'S PICKER ANSWERS WITH NOTHING ELSE. IT IS NOT
    //ON THE DESKTOP SIDE BECAUSE THERE IS NOTHING THERE THAT NEEDS IT - SEE input.rs::stage_content_uri
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fs::init());

    builder
        .manage(AppState
        {
            write_stream: MutexAsync::new(None),
            tofu_reply: Mutex::new(None),
            events: Mutex::new(None),
            role: Mutex::new(Role::default()),
            session: AtomicU64::new(0),
            last_sent: Mutex::new(Instant::now()),
            roster_queued: AtomicBool::new(false),
            screens_queued: AtomicBool::new(false),
            leaving: AtomicBool::new(false),
            list_requested: AtomicBool::new(false),
            version_checked: AtomicBool::new(false),
            voice_enabled: AtomicBool::new(false),
            username: Mutex::new(String::new()),
            voice_roster: Mutex::new(BTreeMap::new()),
            voice_activity: Mutex::new(Vec::new()),
            screen_channel: Mutex::new(None),
            screen_decode: AtomicBool::new(false),
        })
        //THE FRAMES OF A WATCHED SHARE ARE PULLED OUT OF THE CRATE ONCE, FOR THE LIFE OF THE PROCESS: THE
        //SINK IS WHAT KEEPS IT FROM OPENING A WINDOW OF ITS OWN, AND IT MUST BE SET BEFORE ANY ATTACH.
        //A THREAD AND NOT A TASK, BECAUSE DECODING ONE IS TENS OF MILLISECONDS OF UNBROKEN CPU
        .setup(|_app|
        {
            //THE CRATE EXPANDS {HOME} INTO EVERY PATH IT KEEPS ITS CONFIG AND ITS TOFU STATE IN, AND AN
            //ANDROID PROCESS HAS NO HOME DIRECTORY AT ALL - dirs::home_dir() IS None THERE, WHICH THE
            //CRATE EXPECTS ITS WAY OUT OF. THE ANSWER THE PLATFORM DOES HAVE IS THE APP'S OWN DATA DIR,
            //SO POINT HOME AT IT AND LEAVE THE EXPANSION ALONE. IT IS SET BEFORE init_config BECAUSE
            //THAT IS THE FIRST THING TO READ IT, WHICH IS ALSO WHY THE CONFIG IS OPENED IN HERE RATHER
            //THAN AHEAD OF THE BUILDER: NOTHING KNOWS THE PATH UNTIL THERE IS AN App TO ASK
            #[cfg(target_os = "android")]
            {
                let home = _app.path().app_data_dir().expect("Could not determine app data directory");

                std::fs::create_dir_all(&home).expect("Could not create app data directory");

                std::env::set_var("HOME", &home);

                //AND THE JAVA SIDE OF THE CALL, WHICH IS EVERYTHING JNI_OnLoad IS NOT ALLOWED TO DO
                //WHILE THE ACTIVITY'S OWN CLASSES ARE STILL INITIALIZING - HERE THEY ARE STANDING
                android::prepare();
            }

            config::init_config();

            //AND THE AUDIO DEVICES A PHONE WROTE DOWN LAST TIME GO, WHICH IS THE FIRST THING THERE IS A
            //CONFIG TO ASK: AN AAudio DEVICE ID BELONGS TO THE BOOT THAT HANDED IT OUT, AND ONE THAT
            //MATCHES NOTHING IS A CALL WITH NO STREAMS RATHER THAN A CALL ON THE DEFAULT DEVICE
            #[cfg(target_os = "android")]
            android::forget_devices();

            //EVERY DIAL GOES THROUGH THE PROXY WHEN THE CONFIG ASKS FOR IT
            if config::read_config("socks5_enabled") { options::enable_socks5(); }

            #[cfg(screen)]
            {
                let (frames_tx, frames_rx) = mpsc::unbounded_channel::<Vec<u8>>();

                *screen_client::SCREEN_FRAME_SINK.write().unwrap() = Some(frames_tx);

                let handle = _app.handle().clone();

                std::thread::spawn(move || screen_frames(&handle, frames_rx));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler!
        [
            connect_to_server,
            send_input,
            get_commands,
            get_vocabulary,
            get_client_config,
            get_client_settings,
            get_audio_devices,
            set_client_setting,
            set_client_volume,
            set_client_device,
            set_voice_speaker,
            save_server_settings,
            restart_server,
            answer_tofu,
            upload_file_from_path,
            request_image,
            watch_frames,
            drop_frames,
            refresh_screens,
            get_servers,
            save_server,
            remove_server,
            window_chrome,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

