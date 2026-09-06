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

use std::
{
    collections::BTreeMap,
    time::{ Duration, Instant },
    sync::
    {
        Arc,
        Mutex,
        atomic::{ AtomicBool, AtomicU64 },
    },
};

use tokio::
{
    net::tcp::OwnedWriteHalf,
    sync::
    {
        oneshot,
        mpsc::Sender,
        Mutex as MutexAsync,
    },
};

use tauri::ipc::{ Channel, InvokeResponseBody };

use why2_chat::
{
    role::Role,
    options::{ self, LoginState },
    network::client::{ self, ClientEvent },
};

//THE CALL AND THE SCREEN SHARE, WHICH THE ANDROID BUILD HAS THE FIRST OF AND NOT THE SECOND - why2-chat
//IS PULLED IN THERE WITHOUT client_screen, SO THAT MODULE DOES NOT EXIST TO BE NAMED
#[cfg(voice)]
use why2_chat::network::voice::client::options as voice_options;

#[cfg(screen)]
use why2_chat::network::screen::client::options as screen_options;

use crate::types::VoiceUserInfo;

pub(crate) const EVENT: &str = "why2-event"; //THE ONE EVENT THE WEBVIEW LISTENS ON

//THE SERVER'S DEFAULT min_message_delay. IT COUNTS EVERY PACKET, NOT ONLY THE ONES THE USER TYPED, AND
//IT IS NEVER SENT TO US - SO THE ONLY THING A CLIENT CAN DO IS KEEP ITS OWN CHATTER THIS FAR APART
pub(crate) const ROSTER_GAP: Duration = Duration::from_millis(750);

//WHAT A DECODED FRAME IS RE-ENCODED AT WHEN THE WEBVIEW HAS NO DECODER OF ITS OWN. IT IS A SCREEN, NOT A

pub(crate) const ROSTER_COALESCE: Duration = Duration::from_millis(50);

//THE WHOLE VOCABULARY OF /color AND /ucolor, IN CODE ORDER - THE POSITION IN THIS TABLE IS WHAT THE WIRE

pub(crate) struct AppState
{
    pub(crate) write_stream: MutexAsync<Option<Arc<MutexAsync<OwnedWriteHalf>>>>, //WRITE HALF OF THE LIVE SESSION
    pub(crate) tofu_reply: Mutex<Option<oneshot::Sender<bool>>>,                  //THE HANDSHAKE IS PARKED ON THIS
    pub(crate) events: Mutex<Option<Sender<ClientEvent>>>,                        //WHERE THE LIVE SESSION'S EVENTS GO
    pub(crate) role: Mutex<Role>,                                                 //WHAT THIS SERVER GRANTED US
    pub(crate) session: AtomicU64,                                                //ONLY THE NEWEST SESSION COUNTS
    pub(crate) last_sent: Mutex<Instant>,                                         //WHEN WE LAST PUT SOMETHING ON THE WIRE
    pub(crate) roster_queued: AtomicBool,                                         //A ROSTER REFRESH IS ALREADY ON ITS WAY
    pub(crate) screens_queued: AtomicBool,                                        //AND SO IS A SCREENS ONE
    pub(crate) leaving: AtomicBool,                                               //THE DISCONNECT WAS ASKED FOR
    pub(crate) list_requested: AtomicBool,                                        //THE NEXT ROSTER OPENS A MODAL
    pub(crate) version_checked: AtomicBool,                                       //crates.io IS ASKED ONCE PER PROCESS
    pub(crate) voice_enabled: AtomicBool,                                         //THE SERVER LET US INTO THE CALL

    //OUR OWN NAME, OFF THE LINE THAT ANSWERED THE IDENTITY STEP - THE TUI'S App::username. NOTHING ELSE
    //EVER TELLS US: THE PM ECHO NAMES ONLY THE RECIPIENT, AND THE VOICE ROSTER IS EVERYBODY BUT US
    pub(crate) username: Mutex<String>,

    //THE TWO HALVES OF THE VOICE PANEL, KEPT APART BECAUSE ONLY ONE OF THEM ARRIVES WHILE WE ARE NOT IN
    //THE CALL OURSELVES: THE ROSTER IS THE SERVER'S TRUTH ABOUT WHO IS IN VOICE IN OUR CHANNEL (US
    //EXCLUDED, IN ID ORDER), AND THE ACTIVITY IS WHO WE ARE ACTUALLY HEARING - WHETHER THEY ARE TALKING
    //AND WHAT THEIR PING IS. emit_voice MERGES THEM, THE WAY tui/state.rs::rebuild_voice DOES.
    //THE ACTIVITY IS KEPT RATHER THAN PASSED STRAIGHT ON BECAUSE VoiceActivity ARRIVES ONLY WHILE THERE
    //IS AUDIO TO ARRIVE WITH, SO A MUTE TOGGLED IN A SILENT CALL HAS NOTHING TO REDRAW THE PANEL WITH
    pub(crate) voice_roster: Mutex<BTreeMap<usize, String>>,
    pub(crate) voice_activity: Mutex<Vec<VoiceUserInfo>>,

    //WHERE AN ATTACHED SHARE'S FRAMES GO. THE CRATE HANDS THEM OVER AS H.264 ACCESS UNITS AND THE PICTURE
    //LANDS IN THE CHAT WINDOW RATHER THAN IN A WINDOW OF THE CRATE'S OWN - EITHER DECODED BY THE WEBVIEW,
    //OR, WHERE IT HAS NO DECODER, DECODED HERE AND SENT ON AS JPEG
    pub(crate) screen_channel: Mutex<Option<Channel<InvokeResponseBody>>>,
    pub(crate) screen_decode: AtomicBool,
}

//ONE LINE OF THE CHAT PANE. EVERY EVENT THAT HAS SOMETHING TO SAY BECOMES ONE OF THESE, SO THE
//FRONTEND RENDERS THROUGH A SINGLE PATH AND kind IS ALL IT NEEDS TO STYLE IT

pub(crate) fn reset_session()
{
    options::set_seq(0);
    options::set_server_seq(0);
    options::set_login_state(LoginState::None);
    options::set_sending_messages(false);
    options::set_asking_password(false);
    options::set_channel(String::new());
    options::set_server_username("");

    //A HALF-FINISHED UPLOAD BELONGS TO THE SOCKET THAT IS GONE
    client::ACTIVE_UPLOADS.lock().unwrap().clear();

    //AND SO DOES THE CALL: THE VOICE CLIENT FOLLOWS THIS FLAG, SO A LOST SESSION TAKES ITS STREAMS WITH IT
    #[cfg(voice)]
    voice_options::set_use_voice(false);

    //AND ON A PHONE, WHAT WAS HOLDING THE PROCESS OPEN FOR THE WHOLE SESSION - THE NOTIFICATION IS THE
    //ONLY THING THE USER CAN SEE OF THE SERVICE, AND ONE LEFT STANDING OVER A DEAD SOCKET IS A LIE
    #[cfg(target_os = "android")]
    crate::android::release();

    //THE SHARE THE SAME WAY, AND THE MONITOR WITH IT - THE PICK LASTS EXACTLY AS LONG AS THE SHARE DOES,
    //SO THE NEXT SESSION'S FIRST BARE /screen STARTS ON THE DEFAULT MONITOR (tui/state.rs DOES THE SAME)
    #[cfg(screen)]
    {
        screen_options::set_use_screen(false);
        screen_options::set_attach_screen(false);
        screen_options::set_monitor(None);
    }
}
