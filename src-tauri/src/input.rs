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
    fs::File,
    time::Instant,
    io::Read,
    path::Path,
    sync::{ Arc, atomic::Ordering },
};

use tokio::{ task, net::tcp::OwnedWriteHalf, sync::Mutex as MutexAsync };

use sha2::{ Sha256, Digest };

use tauri::{ AppHandle, State };

use why2_chat::
{
    consts,
    role::Role,
    options::{ self, LoginState },
    command::{ self, Command, Subcommand },
    network::{ client, codes::PacketCode },
};

use crate::types::*;
use crate::state::*;
use crate::emit::*;
use crate::color::{ color_handler, get_colors };
use crate::net::send_packet;

#[cfg(screen)]
use why2_chat::network::screen::client::capture as screen_capture;

//THE PICKER ON ANDROID ANSWERS WITH A content:// URI: A HANDLE ON SOMEBODY ELSE'S FILE, GRANTED TO THIS
//PROCESS, AND NOT A PLACE ON THE DISK. NEITHER File::open NOR THE CRATE'S UPLOAD TASK - WHICH REOPENS THE
//PATH BY ITSELF WHEN THE SERVER APPROVES - CAN TAKE ONE, SO THE CONTENT RESOLVER READS IT ONCE AND THE
//COPY GOES IN OUR OWN CACHE, WHICH IS A REAL PATH AND STAYS PUT FOR AS LONG AS THE UPLOAD NEEDS IT.
//THE CACHE IS THE SYSTEM'S TO RECLAIM, WHICH IS THE RIGHT PLACE FOR A COPY NOBODY ASKED TO KEEP
#[cfg(target_os = "android")]
fn stage_content_uri(app: &AppHandle, path: &str) -> Result<Option<String>, &'static str>
{
    use std::os::fd::AsRawFd;
    use tauri::Manager;
    use tauri_plugin_fs::{ FsExt, FilePath, OpenOptions };

    if !path.starts_with("content://") { return Ok(None) }

    //THE PARSE ITSELF CANNOT FAIL: WHAT IS NOT A URL COMES BACK AS A PATH, AND THIS ONE IS A URL
    let uri = path.parse::<FilePath>().unwrap();

    let mut options = OpenOptions::new();
    options.read(true);

    let Ok(mut source) = app.fs().open(uri, options) else { return Err("File not found!") };

    //WHAT TO CALL THE COPY, WHICH IS THE NAME EVERYBODY ELSE WILL SEE. THE DESCRIPTOR THE RESOLVER HANDED
    //US POINTS AT THE REAL FILE WHEREVER THE PROVIDER IS BACKED BY ONE, AND ITS NAME IS THE HONEST ANSWER;
    //ONE THAT IS NOT - A MEDIA PICK, A PIPE - LEAVES THE URI'S OWN LAST SEGMENT TO GO ON
    let name = std::fs::read_link(format!("/proc/self/fd/{}", source.as_raw_fd()))
        .ok()
        .filter(|real| real.is_absolute())
        .and_then(|real| real.file_name().and_then(|name| name.to_str()).map(str::to_owned))
        .or_else(|| uri_name(path))
        .unwrap_or_else(|| String::from("upload"));

    let Ok(cache) = app.path().app_cache_dir() else { return Err("File not found!") };

    let directory = cache.join("uploads");

    if std::fs::create_dir_all(&directory).is_err() { return Err("Error reading file!") }

    let destination = directory.join(name);

    //THE SAME FILE PICKED TWICE IS THE SAME COPY WRITTEN AGAIN, WHICH IS WHAT SHOULD HAPPEN: THE ONE ON
    //THE PHONE MAY HAVE CHANGED SINCE, AND THE HASH IS TAKEN OVER WHAT WE ACTUALLY SEND
    let Ok(mut copy) = File::create(&destination) else { return Err("Error reading file!") };

    if std::io::copy(&mut source, &mut copy).is_err() { return Err("Error reading file!") }

    Ok(Some(destination.to_string_lossy().into_owned()))
}

//THE NAME OUT OF THE URI ITSELF. THE LAST SEGMENT IS THE PROVIDER'S DOCUMENT ID, WHICH IS OFTEN A PATH
//WITH THE FILE AT THE END OF IT (primary%3ADownload%2Fnotes.txt), SO IT IS DECODED AND CUT DOWN TO THAT
#[cfg(target_os = "android")]
fn uri_name(path: &str) -> Option<String>
{
    let decoded = percent_decode(path.rsplit('/').next()?);
    let name = decoded.rsplit(['/', ':']).next()?.trim();

    //A NAME IS ONE COMPONENT AND NOT A WAY OUT OF THE DIRECTORY IT IS WRITTEN IN
    match name.is_empty() || name == "." || name == ".."
    {
        true => None,
        false => Some(name.to_owned()),
    }
}

//%XX IS A BYTE AND EVERYTHING ELSE IS ITSELF. THE PAIR IS ASCII WHERE IT IS A PAIR AT ALL, SO A get IS
//WHAT KEEPS A MULTIBYTE CHARACTER FROM BEING SLICED THROUGH THE MIDDLE
#[cfg(target_os = "android")]
fn percent_decode(text: &str) -> String
{
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len()
    {
        if bytes[index] == b'%'
        {
            if let Some(byte) = text.get(index + 1..index + 3).and_then(|pair| u8::from_str_radix(pair, 16).ok())
            {
                decoded.push(byte);
                index += 3;

                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

pub(crate) async fn upload_file(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>, path: &str)
{
    //COPYING THE WHOLE FILE IS BLOCKING I/O - KEEP IT OFF THE RUNTIME, THE WAY THE HASH BELOW IS
    #[cfg(target_os = "android")]
    let staged =
    {
        let app_handle = app.clone();
        let picked = path.trim().to_owned();

        match task::spawn_blocking(move || stage_content_uri(&app_handle, &picked)).await
        {
            Ok(Ok(staged)) => staged,
            Ok(Err(message)) => return popup(app, message),
            Err(_) => return popup(app, "Error reading file!"),
        }
    };

    #[cfg(target_os = "android")]
    let path = staged.as_deref().unwrap_or(path);

    let path = Path::new(path.trim());

    let Ok(mut file) = File::open(path) else { return popup(app, "File not found!") };

    if !path.is_file() || path.file_name().and_then(|name| name.to_str()).is_none()
    {
        return popup(app, "File not found!");
    }

    let Ok(path) = path.canonicalize() else { return popup(app, "File not found!") };

    //SHA256 OVER THE WHOLE FILE - BLOCKING I/O AND CPU, KEEP IT OFF THE RUNTIME
    let hash = task::spawn_blocking(move || -> Option<[u8; 32]>
    {
        let mut hasher = Sha256::new();
        let mut buffer = vec![0; consts::UPLOAD_CHUNK_SIZE];

        loop
        {
            match file.read(&mut buffer)
            {
                Ok(0) => break Some(hasher.finalize().into()),
                Ok(bytes) => hasher.update(&buffer[..bytes]),
                Err(_) => break None,
            }
        }
    }).await.unwrap_or(None);

    let Some(hash) = hash else { return popup(app, "Error reading file!") };

    //THE UPLOAD TASK LOOKS THE PATH UP BY HASH WHEN THE APPROVAL COMES BACK
    client::ACTIVE_UPLOADS.lock().unwrap().insert(hash, path);

    send_packet(state, write_stream, PacketCode::Upload { hash, token: None, uid: None }).await;
}

//MODERATION ACTIONS - /server <action> [parameters]
pub(crate) async fn server_command(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>,
    parameters: Option<String>)
{
    let role = *state.role.lock().unwrap();

    let Some(info) = command::COMMAND_LIST.iter().find(|info| info.command == Command::Server) else { return };

    //HIDING THE COMMAND DOES NOT STOP ANYBODY TYPING IT OUT, AND REFUSING IT WOULD CONFIRM IT EXISTS -
    //TO A ROLE THAT MAY NOT RUN IT, IT IS SIMPLY NOT A COMMAND
    if !info.available(role) { return popup(app, "Invalid command!") }

    let Some(parameters) = parameters else { return popup(app, "Invalid usage!") };

    //THE ACTION IS THE FIRST WORD, WHATEVER IT TAKES FOLLOWS IT
    let (action, tail) = match parameters.split_once(char::is_whitespace)
    {
        Some((action, tail)) => (action, tail.trim()),
        None => (parameters.as_str(), ""),
    };

    //AN ACTION ABOVE OUR ROLE IS UNKNOWN FOR THE SAME REASON THE COMMAND IS
    let Some(sub) = info.action(action).filter(|sub| sub.available(role)) else { return popup(app, "Invalid action!") };

    //AN ACTION THAT TAKES A PARAMETER NEEDS ONE, WHATEVER IT IS
    if !sub.args.is_empty() && tail.is_empty() { return popup(app, "Invalid usage!") }

    //MOST ACTIONS ARE AIMED AT A USER AND TAKE AN ID - THE REST READ THE TAIL AS TEXT
    let id = match sub.takes_id()
    {
        true => match tail.parse::<usize>()
        {
            Ok(id) => Some(id),
            Err(_) => return popup(app, "Invalid usage!"),
        },

        false => None,
    };

    let code = match sub.subcommand
    {
        Subcommand::Mute      => PacketCode::ServerMute { id: id.unwrap() },
        Subcommand::Kick      => PacketCode::ServerKick { id: id.unwrap() },
        Subcommand::Ban       => PacketCode::ServerBan { id: id.unwrap() },
        Subcommand::BanIp     => PacketCode::ServerBanIp { id: id.unwrap() },
        Subcommand::Pardon    => PacketCode::ServerPardon { id: id.unwrap() },
        Subcommand::PardonIp  => PacketCode::ServerPardonIp { id: id.unwrap() },
        Subcommand::Bans      => PacketCode::ServerBans { users: None, ips: None },
        Subcommand::Say       => PacketCode::ServerSay { message: tail.to_owned() },
        Subcommand::Settings  => PacketCode::ServerSettings { settings: None, save: false },

        //THE ONE ACTION THAT AIMS AT A USER AND STILL TAKES SOMETHING ELSE - THE ROLE IS RESOLVED HERE,
        //SO A NAME NOBODY KNOWS IS INVALID USAGE ON THE SPOT RATHER THAN A PACKET THE SERVER REFUSES
        Subcommand::Role =>
        {
            let Some((target, role)) = tail.split_once(char::is_whitespace) else { return popup(app, "Invalid usage!") };

            let Ok(id) = target.parse::<usize>() else { return popup(app, "Invalid usage!") };
            let Ok(role) = role.trim().parse::<Role>() else { return popup(app, "Invalid role!") };

            PacketCode::ServerRole { id, role, username: None }
        },
    };

    send_packet(state, write_stream, code).await;
}

//TRANSLATES ONE EVENT OF THE SESSION INTO SOMETHING THE WEBVIEW CAN RENDER

#[tauri::command]
pub(crate) async fn upload_file_from_path(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(String::from("Not connected")) };

    upload_file(&app, &state, &write_stream, &path).await;

    Ok(())
}

#[tauri::command]
pub(crate) async fn send_input(input: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(String::from("Not connected")) };

    //A PASSWORD IS WHATEVER WAS TYPED, SPACES INCLUDED
    let input = match options::get_asking_password()
    {
        true => input,
        false => input.trim().to_string(),
    };

    //COMMANDS ONLY EXIST ONCE THE SERVER IS LISTENING TO US - BEFORE THAT EVERY LINE IS AN ANSWER
    //TO THE IDENTITY STEP THE SERVER IS WAITING ON
    if options::get_sending_messages()
    {
        if input.is_empty() { return Ok(()) } //DO NOT FORWARD EMPTY MESSAGES

        if let (Some(command), parameters) = command::get_command(&input)
        {
            //A PHONE ASKS BEFORE IT RECORDS, AND IT ASKS HERE - WHEN THE CALL IS STARTED AND NOT AT LAUNCH.
            //THE PACKET IS HELD BACK UNTIL THE ANSWER IS IN, SO SAYING YES TO THE DIALOG IS ALSO JOINING
            #[cfg(target_os = "android")]
            if matches!(command, Command::Voice) && !crate::android::ensure_microphone(&app).await
            {
                return Ok(());
            }

            //SEND THE CODE ON A SIMPLE COMMAND, HANDLE IT HERE OTHERWISE
            let sent = command::send_command_code(&mut *write_stream.lock().await, &command, &parameters).await;

            //THE CRATE PUT IT ON THE WIRE FOR US, SO THE CLOCK IS OURS TO KEEP
            if sent == Some(true) { *state.last_sent.lock().unwrap() = Instant::now(); }

            //A REQUEST/RESPONSE COMMAND THE USER TYPED WANTS ITS ANSWER PUT ON SCREEN
            if sent == Some(true)
            {
                match command
                {
                    Command::List => state.list_requested.store(true, Ordering::Relaxed),

                    //THE DISCONNECT THAT COMES BACK IS ONE THE USER ASKED FOR, SO IT IS NOT AN ERROR
                    Command::Exit | Command::Logout => state.leaving.store(true, Ordering::Relaxed),

                    _ => {},
                }
            }

            match sent
            {
                Some(true) => {},                          //COMMAND SENT
                Some(false) => popup(&app, "Invalid usage!"),

                //NOTHING WENT TO THE SERVER BECAUSE THE COMMAND IS OURS TO RUN
                None => match command
                {
                    Command::Upload => match parameters
                    {
                        Some(path) => upload_file(&app, &state, &write_stream, &path).await,
                        None => popup(&app, "Usage: /upload <PATH>"),
                    },

                    Command::Server => server_command(&app, &state, &write_stream, parameters).await,

                    //MUTING IS ENTIRELY OURS: THE CRATE KEEPS THE SET AND DROPS THE AUDIO (AND THE
                    //MESSAGES) OF ANYBODY IN IT, AND THE SERVER IS NEVER TOLD WHO WE ARE NOT LISTENING TO
                    //NO PARAMETER IS OUR OWN MICROPHONE, WHICH IS ALSO THE ONLY ROW OF THE PANEL WITH NO ID
                    #[cfg(voice)]
                    Command::Mute => match parameters.as_deref().map(|id| id.trim().parse::<usize>())
                    {
                        Some(Err(_)) => popup(&app, "Usage: /mute [ID]"),

                        parsed =>
                        {
                            let id = parsed.map(|parsed| parsed.unwrap_or_default());
                            let muted = options::toggle_mute(id);

                            say(&app, ChatMessage::ok(format!("Successfully {}muted{}.",
                                if muted { "" } else { "un" },
                                id.map(|id| format!(" ID {id}")).unwrap_or_default())));

                            //THE PANEL AND THE MICROPHONE READING BOTH DRAW THIS, AND A SILENT CALL SENDS
                            //NOTHING OF ITS OWN TO REDRAW THEM WITH
                            {
                                let mut users = state.voice_users.lock().unwrap();

                                for user in users.iter_mut()
                                {
                                    let this = match id
                                    {
                                        Some(id) => !user.local && user.id == id,
                                        None => user.local,
                                    };

                                    if this { user.muted = muted; }
                                }
                            }

                            emit_voice(&app);
                        },
                    },

                    Command::UsernameColor => color_handler(&app, "username_color", parameters),
                    Command::MessageColor => color_handler(&app, "message_color", parameters),

                    //NOTHING WENT TO THE SERVER BECAUSE NOTHING HAD TO: THE SHARE IS ALREADY UP AND ONLY
                    //THE MONITOR UNDER IT CHANGED, WHICH THE RUNNING CAPTURE PICKS UP ON ITS OWN
                    #[cfg(screen)]
                    Command::Screen =>
                    {
                        say(&app, ChatMessage::ok(match screen_capture::current_monitor()
                        {
                            Some(monitor) => format!("Sharing {monitor} now."),
                            None => String::from("Swapped the shared monitor."),
                        }));

                        emit_screen(&app);
                    },

                    //OUR OWN CONFIG, IN A BOX OF ITS OWN - THE TUI'S OVERLAY, WITH THE AUDIO ROWS THIS
                    //BUILD HAS NO FEATURE FOR LEFT OUT
                    Command::Settings => emit(&app, UiEvent::OpenSettings),

                    Command::Invalid => popup(&app, "Invalid command!"),

                    //Help AND Info ARE FILTERED OUT OF THE PALETTE, BUT NOTHING STOPS THEM BEING TYPED OUT
                    _ => popup(&app, format!("{command} is not available in the desktop app.")),
                },
            }

            return Ok(());
        }
    }

    //DISABLE THE PASSWORD ECHO GUARD BEFORE THE NEXT LINE ARRIVES
    options::set_asking_password(false);

    //WHAT THE LINE MEANS DEPENDS ENTIRELY ON WHAT THE SERVER LAST ASKED FOR
    let code = match options::get_login_state()
    {
        LoginState::Username => PacketCode::Username { username: Some(input) },
        LoginState::PasswordLogin => PacketCode::PasswordL { password: Some(input) },
        LoginState::PasswordRegister => PacketCode::PasswordR { password: Some(input) },
        LoginState::None => PacketCode::Message { text: input, colors: get_colors(), username: None, id: None },
    };

    send_packet(&state, &write_stream, code).await;

    Ok(())
}
