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
use std::sync::atomic::Ordering;

//WHERE THE MARK A DESKTOP NOTIFICATION IS DRAWN WITH IS PUT, AND THE ONCE THAT PUTS IT THERE
#[cfg(desktop)]
use std::{ path::PathBuf, sync::OnceLock };

use tauri::{ Emitter, AppHandle, Manager };

#[cfg(voice)]
use why2_chat::options;

//THE CALL AND THE SCREEN SHARE, WHICH THE ANDROID BUILD HAS THE FIRST OF AND NOT THE SECOND - why2-chat
//IS PULLED IN THERE WITHOUT client_screen, SO THAT MODULE DOES NOT EXIST TO BE NAMED
#[cfg(voice)]
use why2_chat::network::
{
    client::VoiceUser,
    voice::client::options as voice_options,
};

use crate::types::*;
use crate::state::{ AppState, EVENT };
#[cfg(screen)]
use why2_chat::network::screen::client::
{
    options as screen_options,
    capture as screen_capture,
};

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
#[cfg(voice)]
pub(crate) fn emit_voice(app: &AppHandle)
{
    let state = app.state::<AppState>();

    let enabled = state.voice_enabled.load(Ordering::Relaxed);

    //A PHONE ALSO HAS TO BE TOLD, BECAUSE A CALL IS THE ONE THING HERE THAT HAS TO GO ON WHILE THE
    //WINDOW IS AWAY - AND THIS IS THE ONE PLACE THAT ALWAYS KNOWS WHETHER THERE IS ONE. WHERE THE SOUND
    //COMES OUT IS THE SAME QUESTION ASKED OF THE SAME ANSWER: THE ROUTE AND THE AUDIO MODE ARE TAKEN FOR
    //EXACTLY AS LONG AS THE CALL LASTS
    #[cfg(target_os = "android")]
    {
        crate::android::hold_call(enabled);
        crate::android::route_call(enabled);
    }

    emit(app, UiEvent::Voice
    {
        voice: VoiceState
        {
            enabled,
            mic: !options::is_muted(None) && voice_options::get_input_volume() > 0,
            users: voice_rows(&state, enabled),
            speaker: speaker(),
        },
    });
}

//THE PANEL AS IT STANDS: THE SERVER'S ROSTER, DRESSED WITH WHATEVER THE LOCAL CALL KNOWS ABOUT IT. THE
//TWO ARE MERGED HERE AND NOWHERE ELSE, THE WAY tui/state.rs::rebuild_voice DOES IT - AN ACTIVITY THAT
//REPLACED THE PANEL WHOLESALE, AS IT USED TO, WOULD DROP EVERY ROSTER ENTRY WE HAVE NO STREAM FOR
fn voice_rows(state: &AppState, enabled: bool) -> Vec<VoiceUserInfo>
{
    let roster = state.voice_roster.lock().unwrap();
    let activity = state.voice_activity.lock().unwrap();

    let mut users = Vec::with_capacity(roster.len() + 1);

    //US - THE ROSTER NEVER NAMES US, AND ONLY THE CALL ITSELF KNOWS WHETHER WE ARE SPEAKING
    if enabled
    {
        let username = state.username.lock().unwrap().clone();

        users.push(match activity.iter().find(|user| user.local)
        {
            Some(local) => VoiceUserInfo { username, muted: muted(None, enabled), ..local.clone() },

            //THE FIRST ACTIVITY TICK IS UP TO 100 ms AWAY - DO NOT BLINK OUT OF OUR OWN PANEL UNTIL THEN
            None => VoiceUserInfo
            {
                id: 0,
                username,
                speaking: false,
                latency: None,
                local: true,
                muted: muted(None, enabled),
            },
        });
    }

    //EVERYBODY ELSE, IN ID ORDER (BTreeMap). A ROSTER ENTRY WE HAVE NO STREAM FOR IS STILL IN VOICE - IT
    //IS US WHO CANNOT HEAR THEM, SO IT IS DRAWN WITHOUT A PING RATHER THAN LEFT OUT
    for (id, username) in roster.iter()
    {
        let heard = activity.iter().find(|user| !user.local && user.id == *id);

        users.push(VoiceUserInfo
        {
            id: *id,
            username: username.clone(),
            speaking: heard.is_some_and(|user| user.speaking),
            latency: heard.and_then(|user| user.latency),
            local: false,
            muted: muted(Some(*id), enabled),
        });
    }

    users
}

//A MUTE IS OURS AND NOT THE SERVER'S, AND IT ONLY MEANS ANYTHING WHILE WE ARE THE ONE LISTENING - A ROW
//OF THE ROSTER WE ARE NOT IN IS SOMEBODY IN VOICE, NOT SOMEBODY WE ARE DROPPING (tui/draw.rs AGREES).
//IT IS ANSWERED HERE, AT THE MOMENT THE PANEL IS BUILT, SO A /mute HAS NOTHING TO GO BACK AND PATCH
fn muted(id: Option<usize>, enabled: bool) -> bool
{
    #[cfg(voice)]
    { enabled && options::is_muted(id) }

    #[cfg(not(voice))]
    { let _ = (id, enabled); false }
}

//OUR SHARE AS IT STANDS. BOTH HALVES OF IT LIVE IN THE CRATE'S GLOBALS AND MOVE WITHOUT US - THE SERVER
//TOGGLES THE SHARE, THE COMMAND SWAPS THE MONITOR - SO THEY ARE READ HERE RATHER THAN KEPT
#[cfg(screen)]
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

//THE SAME TWO QUESTIONS IN A BUILD THAT HAS NOTHING TO ANSWER THEM WITH, WHERE THE ANSWER IS THE SAME
//EVERY TIME - WHICH IS WHAT THE WINDOW DRAWS ITS (ABSENT) HEADSET AND MONITOR BUTTONS FROM. THE TWO ARE
//SEPARATE CFGS BECAUSE ANDROID TAKES THIS ONE AND THE REAL emit_voice ABOVE
#[cfg(not(voice))]
pub(crate) fn emit_voice(app: &AppHandle)
{
    //THERE IS NO CALL TO BE IN, BUT THE ROSTER IS THE SERVER'S AND ARRIVES REGARDLESS - SO THE PANEL STILL
    //SAYS WHO IS IN VOICE, IT SIMPLY KNOWS NOTHING ABOUT SOUND
    let state = app.state::<AppState>();

    emit(app, UiEvent::Voice
    {
        voice: VoiceState { enabled: false, mic: false, users: voice_rows(&state, false), speaker: None },
    });
}

//WHICH OF THE PHONE'S TWO SPEAKERS THE CALL IS ON, AND None EVERYWHERE THAT IS NOT A PHONE - A DESKTOP
//HAS ONE PAIR AND THE SETTINGS DIALOG'S DEVICE ROW FOR ANYTHING ELSE, SO THERE IS NO BUTTON TO DRAW
pub(crate) fn speaker() -> Option<bool>
{
    #[cfg(target_os = "android")]
    { Some(crate::android::speaker()) }

    #[cfg(not(target_os = "android"))]
    { None }
}

#[cfg(not(screen))]
pub(crate) fn emit_screen(app: &AppHandle)
{
    emit(app, UiEvent::Screen { screen: ScreenState { sharing: false, monitor: None } });
}

//THE MARK BESIDE THE LINE, AND THE ONE THING A DESKTOP NOTIFICATION NEEDS SAYING ABOUT. A LINUX
//NOTIFICATION SERVER LOOKS AN ICON UP **BY NAME** IN THE ICON THEME, WHICH IS SOMETHING ONLY AN INSTALLED
//APP HAS - AND THE PLUGIN'S DEFAULT (auto_icon) ASKS FOR THE **BINARY'S** NAME, `why2-desktop`, WHICH IS
//NOT WHAT ANY THEME CALLS THIS OR ANYTHING ELSE. WHAT COMES BACK IS THE BROKEN-IMAGE GLYPH. A **PATH** IS
//THE ANSWER ALL THREE TAKE, SO THE MARK IS CARRIED IN THE BINARY AND LAID DOWN IN THE APP'S OWN CACHE THE
//FIRST TIME THERE IS A LINE TO PUT IT BESIDE - WRITTEN RATHER THAN LOOKED FOR, SINCE A COPY LEFT BY AN
//OLDER BUILD IS AN OLD MARK, AND ONCE PER PROCESS, SINCE THAT IS AS OFTEN AS IT CAN CHANGE
#[cfg(desktop)]
fn notify_icon(app: &AppHandle) -> Option<PathBuf>
{
    static ICON: OnceLock<Option<PathBuf>> = OnceLock::new();

    ICON.get_or_init(||
    {
        let path = app.path().app_cache_dir().ok()?.join("why2.png");

        std::fs::create_dir_all(path.parent()?).ok()?;
        std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;

        Some(path)
    })
    .clone()
}

//A LINE PUT WHERE SOMEBODY WILL SEE IT, ASKED FOR BY THE WINDOW. **WHETHER** IT IS WORTH ONE IS THE
//WINDOW'S QUESTION AND ONLY THE WINDOW'S: WHICH CHANNEL A LINE WAS FILED INTO, WHICH CONVERSATION IS OPEN
//AND WHETHER ANYBODY IS LOOKING AT THE GLASS ARE ALL THINGS THIS SIDE HAS NEVER KNOWN (SEE **Channels and
//message routing**). SO THIS IS THE ASKING AND NOTHING ELSE, AND EACH PLATFORM POSTS IT ITS OWN WAY: A
//PHONE THROUGH Notifier.kt, WHICH FILES IT UNDER THE KEY SO ONE CONVERSATION IS ONE LINE IN THE SHADE AND
//A TAP OPENS THAT PANE, AND A DESKTOP THROUGH THE SYSTEM'S NOTIFICATION SERVER, WHICH TAKES A TITLE AND A
//BODY AND NOTHING ELSE - THE KEY IS UNUSED THERE, SINCE THE PLUGIN HANDS BACK NO HANDLE TO REPLACE A LINE
//WITH AND REPORTS NO CLICK. IT IS NOT A DESKTOP'S TO SKIP: THE WINDOW GOES TO THE TRAY RATHER THAN QUIT
//(tray.rs), WHICH IS EXACTLY A SESSION RUNNING WITH NOBODY LOOKING AT IT
#[tauri::command]
pub(crate) fn notify_message(app: AppHandle, key: String, title: String, body: String)
{
    #[cfg(target_os = "android")]
    {
        let _ = &app;

        crate::android::notify(&key, &title, &body);
    }

    //A NOTIFICATION THAT WILL NOT POST IS THE LINE IN THE SHADE AND NOTHING ELSE - IT IS NOT WORTH A TOAST
    //OVER THE CONVERSATION IT WOULD BE ABOUT, WHICH IS THE ONE PLACE THE USER IS ALREADY LOOKING
    #[cfg(desktop)]
    {
        use tauri_plugin_notification::NotificationExt;

        let _ = key;

        let mut line = app.notification().builder().title(title).body(body);

        //AND WITHOUT ONE IT IS STILL A LINE WORTH SAYING - THE PLUGIN THEN ASKS FOR THE NAME NOBODY HAS
        if let Some(icon) = notify_icon(&app) { line = line.icon(icon.to_string_lossy()); }

        line.show().ok();
    }
}

//AND THE OTHER HALF OF THAT LINE: WHERE IT POINTED. A TAP BRINGS THE ACTIVITY BACK WITH THE KEY THE
//NOTIFICATION WAS FILED UNDER ON IT, WHICH IS WHAT THE WINDOW OPENS ON - IT IS ASKED FOR RATHER THAN
//PUSHED BECAUSE THE ACTIVITY IS ALREADY BACK BY THE TIME THE PAGE IS AWAKE TO HEAR ABOUT IT
#[tauri::command]
pub(crate) fn notification_target() -> Option<String>
{
    #[cfg(target_os = "android")]
    { crate::android::notification_target() }

    #[cfg(not(target_os = "android"))]
    { None }
}

//ONE ROW OF THE ACTIVITY - WHO WE ARE HEARING, WHICH IS HALF OF WHAT THE PANEL IS BUILT FROM. THE MUTE
//IS FILLED IN BY voice_rows AT THE MOMENT IT DRAWS, SINCE THAT IS THE ONE THAT KNOWS WHETHER WE ARE IN
//THE CALL AT ALL - AND IT IS ALSO WHAT KEEPS A MUTE FROM HAVING TO REACH BACK INTO WHAT IS STORED HERE
#[cfg(voice)]
pub(crate) fn voice_user(user: VoiceUser) -> VoiceUserInfo
{
    VoiceUserInfo
    {
        muted: false,
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
