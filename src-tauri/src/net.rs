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
    time::Instant,
    sync::{ Arc, atomic::Ordering },
};

use tokio::
{
    time,
    net::tcp::OwnedWriteHalf,
    sync::{ Mutex as MutexAsync, mpsc },
};

use tauri::{ Manager, AppHandle, State, async_runtime };

use why2_chat::
{
    misc,
    consts,
    config,
    options,
    role::Role,
    network::
    {
        self,
        client::{ self, ClientEvent },
        codes::PacketCode,
    },
};

use crate::state::*;
use crate::emit::*;
use crate::events::pump_events;

pub(crate) async fn send_packet(state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>, code: PacketCode)
{
    network::send(&mut *write_stream.lock().await, code, options::get_keys().as_ref()).await;

    *state.last_sent.lock().unwrap() = Instant::now();
}

//ASK FOR THE ROSTER - EVENTUALLY. THE ROSTER IS ALSO THE CHANNEL LIST, SO IT HAS TO FOLLOW EVERY JOIN,
//AND JOINS ARRIVE IN CLUMPS: LOGGING IN ALONE BRINGS Accept AND OUR OWN Join ONE AFTER THE OTHER, WHICH
//AS TWO SEPARATE List PACKETS IS EXACTLY WHAT THE SERVER CALLS SPAM. ONE REQUEST ANSWERS THE WHOLE
//CLUMP, AND IT WAITS OUT WHATEVER WE LAST SENT BEFORE GOING OUT
pub(crate) fn refresh_online(app: &AppHandle, session: u64)
{
    //THE FIRST CALLER QUEUES IT; EVERY OTHER ONE UNTIL IT GOES OUT *IS* THAT SAME REQUEST
    if app.state::<AppState>().roster_queued.swap(true, Ordering::Relaxed) { return }

    let app = app.clone();

    async_runtime::spawn(async move
    {
        time::sleep(ROSTER_COALESCE).await;

        //NOBODY IS WAITING ON A ROSTER, SO IT GIVES WAY TO ANYTHING THE USER ACTUALLY TYPED
        loop
        {
            let waited = app.state::<AppState>().last_sent.lock().unwrap().elapsed();

            if waited >= ROSTER_GAP { break }

            time::sleep(ROSTER_GAP - waited).await;
        }

        let state = app.state::<AppState>();

        //THE SESSION IT WAS QUEUED FOR IS GONE, AND SO IS THE POINT OF ASKING
        if state.session.load(Ordering::Relaxed) != session { return }

        state.roster_queued.store(false, Ordering::Relaxed);

        let Some(write_stream) = state.write_stream.lock().await.clone() else { return };

        send_packet(&state, &write_stream, PacketCode::List { users: None }).await;
    });
}

//THE SAME, FOR THE ONE QUESTION THE SERVER NEVER ANSWERS UNASKED: WHO IS SHARING A SCREEN. THE WINDOW ASKS
//IT ON A CLOCK AND NOT BECAUSE ANYBODY TYPED ANYTHING, SO IT GIVES WAY TO EVERYTHING THAT DID - A Screens
//PACKET ON THE HEELS OF AN Attach IS EXACTLY WHAT THE SERVER CALLS SPAM
#[tauri::command]
pub(crate) fn refresh_screens(app: AppHandle, state: State<'_, AppState>)
{
    if state.screens_queued.swap(true, Ordering::Relaxed) { return }

    let session = state.session.load(Ordering::Relaxed);
    let app = app.clone();

    async_runtime::spawn(async move
    {
        loop
        {
            let waited = app.state::<AppState>().last_sent.lock().unwrap().elapsed();

            if waited >= ROSTER_GAP { break }

            time::sleep(ROSTER_GAP - waited).await;
        }

        let state = app.state::<AppState>();

        //THE SESSION IT WAS QUEUED FOR IS GONE, AND SO IS THE POINT OF ASKING
        if state.session.load(Ordering::Relaxed) != session { return }

        state.screens_queued.store(false, Ordering::Relaxed);

        let Some(write_stream) = state.write_stream.lock().await.clone() else { return };

        send_packet(&state, &write_stream, PacketCode::Screens { users: None }).await;
    });
}

//UPLOAD ONE FILE. THE SERVER IS ASKED FIRST AND ANSWERS WITH A TOKEN, WHICH IS WHAT THE CRATE'S UPLOAD
//TASK DIALS THE SIDE CHANNEL WITH - ALL WE DO HERE IS NAME THE FILE BY ITS HASH AND ASK

#[tauri::command]
pub(crate) async fn connect_to_server(address: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let mut connecting_addr = address.trim().to_owned();

    //THE ADDRESS IS TAKEN AS TYPED, AND ONLY THE PORT IS FILLED IN WHEN IT IS MISSING
    if !connecting_addr.contains(':')
    {
        connecting_addr.push_str(&format!(":{}", config::read_config::<u16>("default_port")));
    }

    //A NEW CONNECTION COUNTS FROM ZERO ON BOTH SIDES - THE PREVIOUS SESSION LEFT ITS OWN NUMBERS BEHIND
    reset_session();

    //WHATEVER THE LAST CALL LEFT BEHIND IS NOT THIS ONE'S - A pump_events THAT OUTLIVED ITS SOCKET
    //DOES NOT CLEAN UP AFTER THE SESSION THAT REPLACED IT
    state.voice_enabled.store(false, Ordering::Relaxed);
    state.voice_roster.lock().unwrap().clear();
    state.voice_activity.lock().unwrap().clear();
    state.username.lock().unwrap().clear();
    state.screen_channel.lock().unwrap().take();

    //THE MUTED SET OUTLIVES A SESSION, AND THE WINDOW HAS NOTHING TO DRAW THE MICROPHONE FROM UNTIL THE
    //FIRST VOICE EVENT - WHICH IN A CALL NOBODY HAS STARTED NEVER ARRIVES, SO THE FIRST /mute WOULD LOOK
    //LIKE IT DID NOTHING. THE CALL AS IT ACTUALLY STANDS GOES OUT WITH THE CONNECTION
    emit_voice(&app);
    emit_screen(&app);

    //THE RECONNECT AFTER PINNING A SERVER KEY DIALS THIS, SO IT HAS TO BE THE RESOLVED ADDRESS
    options::set_server_address(&connecting_addr);

    let (mut read_half, write_half) = client::connect(connecting_addr).await.map_err(|error| error.to_string())?;

    //WHATEVER IS LEFT OF THE PREVIOUS SESSION STOPS BEING LISTENED TO THE MOMENT THIS ONE EXISTS
    let session = state.session.fetch_add(1, Ordering::Relaxed) + 1;

    let write_stream = Arc::new(MutexAsync::new(write_half));

    *state.write_stream.lock().await = Some(write_stream.clone());
    *state.role.lock().unwrap() = Role::default();
    state.leaving.store(false, Ordering::Relaxed);
    state.list_requested.store(false, Ordering::Relaxed);
    state.roster_queued.store(false, Ordering::Relaxed);
    state.screens_queued.store(false, Ordering::Relaxed);
    *state.last_sent.lock().unwrap() = Instant::now();

    //THERE IS A SOCKET NOW, AND ON A PHONE THAT IS SOMETHING TO KEEP THE PROCESS AWAKE FOR - IT IS ASKED
    //FOR HERE BECAUSE THIS IS WHERE THE WINDOW STILL HAS THE SCREEN: 14 REFUSES A FOREGROUND SERVICE
    //STARTED FROM THE BACKGROUND, WHICH IS EXACTLY WHERE ASKING ANY LATER WOULD BE FROM
    #[cfg(target_os = "android")]
    crate::android::hold_session(true);

    let (tx, rx) = mpsc::channel::<ClientEvent>(consts::EVENT_CHANNEL_BOUND);

    //CHECK THE PACKAGE VERSION ONCE PER PROCESS - IT REPORTS THROUGH tx LIKE ANYTHING ELSE, SO IT MUST
    //NOT HOLD UP THE HANDSHAKE
    if !state.version_checked.swap(true, Ordering::Relaxed)
    {
        let version_tx = tx.clone();
        async_runtime::spawn(async move { misc::check_version(&version_tx).await; });
    }

    //THE HANDSHAKE (AND THE TOFU PROMPT INSIDE IT) RUNS FROM HERE ON, WITH THE WINDOW ALREADY UP
    async_runtime::spawn(async move
    {
        client::listen_server(&mut (&mut read_half, write_stream), tx).await;
    });

    async_runtime::spawn(pump_events(app, rx, session));

    Ok(())
}

#[tauri::command]
pub(crate) fn answer_tofu(accept: bool, state: State<'_, AppState>) -> Result<(), String> //ANSWER THE IDENTITY PROMPT
{
    let Some(reply) = state.tofu_reply.lock().unwrap().take() else { return Err(String::from("Nothing to answer")) };

    //THE LISTENING TASK EITHER PINS THE KEY AND RECONNECTS ON ITS OWN, OR DISCONNECTS AND REPORTS TofuError
    reply.send(accept).map_err(|_| String::from("The session is already gone"))
}
