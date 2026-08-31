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
    io::Read,
    path::Path,
    sync::
    {
        Arc,
        Mutex,
        atomic::{ AtomicBool, AtomicU64, Ordering },
    },
};

use tokio::
{
    task,
    net::tcp::OwnedWriteHalf,
    sync::
    {
        oneshot,
        Mutex as MutexAsync,
        mpsc::{ self, Receiver },
    },
};

use sha2::{ Sha256, Digest };

use serde::Serialize;

use tauri::
{
    Emitter,
    Manager,
    AppHandle,
    State,
    async_runtime,
};

use why2_chat::
{
    misc,
    consts,
    config,
    role::Role,
    options::{ self, LoginState },
    command::
    {
        self,
        Command,
        Subcommand,
    },
    network::
    {
        self,
        client::{ self, ClientEvent },
        codes::
        {
            PacketCode,
            MessageColors,
            BanEntry,
            OnlineUser,
            ServerSetting,
            SettingValue,
            StoredMessage,
            UserFile,
        },
    },
};

//CONSTS
const EVENT: &str = "why2-event"; //THE ONE EVENT THE WEBVIEW LISTENS ON

//STRUCTS
struct AppState
{
    write_stream: MutexAsync<Option<Arc<MutexAsync<OwnedWriteHalf>>>>, //WRITE HALF OF THE LIVE SESSION
    tofu_reply: Mutex<Option<oneshot::Sender<bool>>>,                  //THE HANDSHAKE IS PARKED ON THIS
    role: Mutex<Role>,                                                 //WHAT THIS SERVER GRANTED US
    session: AtomicU64,                                                //ONLY THE NEWEST SESSION COUNTS
    leaving: AtomicBool,                                               //THE DISCONNECT WAS ASKED FOR
    list_requested: AtomicBool,                                        //THE NEXT ROSTER OPENS A MODAL
    version_checked: AtomicBool,                                       //crates.io IS ASKED ONCE PER PROCESS
}

//ONE LINE OF THE CHAT PANE. EVERY EVENT THAT HAS SOMETHING TO SAY BECOMES ONE OF THESE, SO THE
//FRONTEND RENDERS THROUGH A SINGLE PATH AND kind IS ALL IT NEEDS TO STYLE IT
#[derive(Serialize, Clone)]
struct ChatMessage
{
    kind: MessageKind,
    username: String,
    text: String,
    id: Option<usize>,
    username_color: Option<u8>,
    message_color: Option<u8>,
}

#[derive(Serialize, Clone)]
struct OnlineUserInfo
{
    username: String,
    id: usize,
    channel: Option<String>,
}

#[derive(Serialize, Clone)]
struct UserFileInfo
{
    username: String,
    id: usize,
    uploads: Vec<FileInfo>,
}

#[derive(Serialize, Clone)]
struct FileInfo
{
    filename: String,
    id: usize,
}

#[derive(Serialize, Clone)]
struct BanInfo
{
    id: usize,
    subject: String,
}

#[derive(Serialize, Clone)]
struct SettingInfo
{
    key: String,
    value: String,
    section: String,
    description: String,
    restart: bool,
}

#[derive(Serialize, Clone)]
struct CommandArgInfo
{
    name: String,
    description: String,
    required: bool,
}

#[derive(Serialize, Clone)]
struct SubcommandInfo
{
    name: String,
    description: String,
    args: Vec<CommandArgInfo>,
}

#[derive(Serialize, Clone)]
struct CommandInfo
{
    name: String,
    description: String,
    args: Vec<CommandArgInfo>,
    subcommands: Vec<SubcommandInfo>, //EMPTY UNLESS THE COMMAND IS A DOORWAY TO ACTIONS
}

//ENUMS
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum MessageKind
{
    User,    //SOMEBODY SAID SOMETHING
    Private, //A PRIVATE MESSAGE, EITHER WAY
    System,  //THE SERVER NARRATING ITSELF (JOINS, LEAVES, UPLOADS)
    Notice,  //SOMETHING WORTH READING TWICE
    Error,   //SOMETHING WENT WRONG
}

//WHAT THE BRIDGE TELLS THE WEBVIEW. SERDE TAGS IT ADJACENTLY, SO EVERY PAYLOAD ARRIVES AS
//{ "event": "<name>", "data": { .. } } AND THE FRONTEND SWITCHES ON ONE FIELD INSTEAD OF
//PICKING TAGGED STRINGS APART - THE OLD "Tag:value" ENCODING BROKE ON EVERY COLON IT MET
#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
enum UiEvent
{
    Connected { server: String },                                 //THE HANDSHAKE IS DONE
    RequestUsername { registration: bool, min: u64, max: u64 },   //PICK A USERNAME
    RequestPassword { register: bool },                           //LOG IN OR REGISTER
    UsernameRejected,                                             //TRY ANOTHER ONE
    PasswordRejected { min: u64 },                                //TRY A LONGER ONE
    Authenticated { role: String },                               //WE ARE IN
    Role { role: String, username: Option<String> },              //A ROLE WAS SET (None IS OURS)
    Message { message: ChatMessage },                             //ONE LINE FOR THE PANE
    History { messages: Vec<ChatMessage> },                       //THE LOBBY'S STORED MESSAGES
    Popup { text: String },                                       //A TOAST, GONE IN A MOMENT
    TofuPrompt                                                    //THE SESSION IS PARKED ON THIS ANSWER
    {
        host: String,
        hash: String,
        pinned: Option<String>,
        mismatch: bool,
    },
    Users { users: Vec<OnlineUserInfo>, requested: bool },        //THE ROSTER, AND WHETHER /list ASKED
    UserLeft { id: usize },                                       //DROP ONE ROW WITHOUT ASKING AGAIN
    Files { users: Vec<UserFileInfo> },                           //WHAT CAN BE DOWNLOADED
    Bans { users: Vec<BanInfo>, ips: Vec<BanInfo> },              //server_bans.toml
    ServerSettings { settings: Vec<SettingInfo>, saved: bool },   //server.toml
    ChannelChanged { channel: Option<String> },                   //WE SWITCHED CHANNEL
    ChannelCreated { name: String },                              //SOMEBODY OPENED ONE
    ChannelDestroyed { name: String },                            //THE LAST ONE LEFT IT
    Disconnected { reason: Option<String> },                      //THE SOCKET IS GONE
}

//IMPLEMENTATIONS
impl ChatMessage
{
    fn new(kind: MessageKind, username: impl Into<String>, text: impl Into<String>) -> Self
    {
        Self
        {
            kind,
            username: username.into(),
            text: text.into(),
            id: None,
            username_color: None,
            message_color: None,
        }
    }

    //A LINE NOBODY SAID - THE SERVER NARRATING, OR US NARRATING THE SERVER
    fn system(text: impl Into<String>) -> Self { Self::new(MessageKind::System, "", text) }

    fn notice(text: impl Into<String>) -> Self { Self::new(MessageKind::Notice, "", text) }

    fn error(text: impl Into<String>) -> Self { Self::new(MessageKind::Error, "", text) }

    fn colored(mut self, colors: MessageColors) -> Self
    {
        self.username_color = colors.username_color;
        self.message_color = colors.message_color;
        self
    }

    fn with_id(mut self, id: usize) -> Self
    {
        self.id = Some(id);
        self
    }
}

//FUNCTIONS
//PRIVATE
fn emit(app: &AppHandle, event: UiEvent) //HAND ONE EVENT TO THE WEBVIEW
{
    app.emit(EVENT, event).ok();
}

fn say(app: &AppHandle, message: ChatMessage) //PUSH ONE LINE INTO THE PANE
{
    emit(app, UiEvent::Message { message });
}

fn popup(app: &AppHandle, text: impl Into<String>) //PUSH ONE TOAST
{
    emit(app, UiEvent::Popup { text: text.into() });
}

//EVERY PIECE OF SESSION STATE THAT LIVES IN THE CRATE'S GLOBALS. THE NEXT HANDSHAKE HAS TO START FROM
//THE SAME PLACE THE FIRST ONE DID - THE SEQUENCE NUMBERS ESPECIALLY, SINCE A SECOND CONNECTION THAT
//KEPT THE FIRST ONE'S COUNTERS WOULD HAVE EVERY PACKET IT SENDS REFUSED
fn reset_session()
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
}

fn to_color(color: &str) -> Result<(u8, String), ()> //PARSE A COLOR NAME/NUMBER INTO THE CODE THE WIRE CARRIES
{
    let mut formatted_color = color.replace(' ', "_").to_lowercase();
    if formatted_color.starts_with("dark") && !formatted_color.starts_with("dark_")
    {
        formatted_color = formatted_color.replacen("dark", "dark_", 1);
    }

    let code = match formatted_color.as_str()
    {
        "black"                   => Some(0),
        "dark_red"                => Some(1),
        "dark_green"              => Some(2),
        "dark_yellow"             => Some(3),
        "dark_blue"               => Some(4),
        "dark_magenta"            => Some(5),
        "dark_cyan"               => Some(6),
        "grey" | "gray"           => Some(7),
        "dark_grey" | "dark_gray" => Some(8),
        "red"                     => Some(9),
        "green"                   => Some(10),
        "yellow"                  => Some(11),
        "blue"                    => Some(12),
        "magenta"                 => Some(13),
        "cyan"                    => Some(14),
        "white"                   => Some(15),

        //A BARE NUMBER IS THE CODE ITSELF, AND ONLY THE SIXTEEN THE PROTOCOL KNOWS ABOUT EXIST
        _ => color.trim().parse::<u8>().ok().filter(|code| *code <= 15),
    };

    let code = code.ok_or(())?;

    //STORED BACK UNDER THE CANONICAL NAME, SO THE CONFIG READS THE SAME WAY IT WAS TYPED
    let name = match code
    {
        0  => "black",
        1  => "dark_red",
        2  => "dark_green",
        3  => "dark_yellow",
        4  => "dark_blue",
        5  => "dark_magenta",
        6  => "dark_cyan",
        7  => "grey",
        8  => "dark_grey",
        9  => "red",
        10 => "green",
        11 => "yellow",
        12 => "blue",
        13 => "magenta",
        14 => "cyan",
        _  => "white",
    };

    Ok((code, name.to_string()))
}

fn get_colors() -> MessageColors //READ THE CONFIGURED COLORS
{
    MessageColors
    {
        username_color: to_color(&config::read_config::<String>("username_color")).ok().map(|(code, _)| code),
        message_color: to_color(&config::read_config::<String>("message_color")).ok().map(|(code, _)| code),
    }
}

fn color_handler(app: &AppHandle, key: &str, parameters: Option<String>) //SAVE A COLOR TO client.toml
{
    let Some(parameters) = parameters else { return popup(app, "Invalid usage!") };

    match to_color(&parameters)
    {
        Ok((_, name)) =>
        {
            config::client_write(key, &name);
            popup(app, "Color set successfully.");
        },

        Err(()) => popup(app, "Invalid color!"),
    }
}

fn command_args(args: &'static [command::CommandArg]) -> Vec<CommandArgInfo> //DESCRIBE ONE COMMAND'S PARAMETERS
{
    args.iter().map(|arg| CommandArgInfo
    {
        name: arg.name.to_string(),
        description: arg.description.to_string(),
        required: arg.required,
    }).collect()
}

//UPLOAD ONE FILE. THE SERVER IS ASKED FIRST AND ANSWERS WITH A TOKEN, WHICH IS WHAT THE CRATE'S UPLOAD
//TASK DIALS THE SIDE CHANNEL WITH - ALL WE DO HERE IS NAME THE FILE BY ITS HASH AND ASK
async fn upload_file(app: &AppHandle, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>, path: &str)
{
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

    network::send(&mut *write_stream.lock().await,
        PacketCode::Upload { hash, token: None, uid: None }, options::get_keys().as_ref()).await;
}

//MODERATION ACTIONS - /server <action> [parameters]
async fn server_command(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>,
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

    network::send(&mut *write_stream.lock().await, code, options::get_keys().as_ref()).await;
}

//TRANSLATES ONE EVENT OF THE SESSION INTO SOMETHING THE WEBVIEW CAN RENDER
async fn handle_event(app: &AppHandle, event: ClientEvent)
{
    let state = app.state::<AppState>();

    match event
    {
        //THE IDENTITY STEPS - THE CONNECT BOX IS STILL UP, ASKING FOR THE NEXT THING
        ClientEvent::Username(disabled_registration, min, max) =>
        {
            emit(app, UiEvent::RequestUsername { registration: !disabled_registration, min, max });
        },

        ClientEvent::Register => emit(app, UiEvent::RequestPassword { register: true }),
        ClientEvent::Login => emit(app, UiEvent::RequestPassword { register: false }),
        ClientEvent::UsernameRejected => emit(app, UiEvent::UsernameRejected),
        ClientEvent::PasswordRejected(min) => emit(app, UiEvent::PasswordRejected { min }),

        ClientEvent::Connected(server) => emit(app, UiEvent::Connected { server }),

        ClientEvent::FirstUser =>
        {
            say(app, ChatMessage::notice("You are the first user to register, owner role has been granted to you."));
        },

        ClientEvent::Authenticated(role) =>
        {
            *state.role.lock().unwrap() = role;
            emit(app, UiEvent::Authenticated { role: role.to_string() });

            //THE ROSTER IS ALSO WHERE THE CHANNEL LIST COMES FROM, SO IT IS ASKED FOR RIGHT AWAY
            if let Some(write_stream) = state.write_stream.lock().await.as_ref()
            {
                network::send(&mut *write_stream.lock().await,
                    PacketCode::List { users: None }, options::get_keys().as_ref()).await;
            }
        },

        //A ROLE WAS SET. THE SERVER NAMES THE USER WHEN IT IS SOMEBODY ELSE, SO THE ONE WITHOUT A NAME
        //IS OURS - AND THAT ONE DECIDES WHICH COMMANDS THE PALETTE IS ALLOWED TO OFFER
        ClientEvent::Role(role, username) =>
        {
            if username.is_none() { *state.role.lock().unwrap() = role; }

            emit(app, UiEvent::Role { role: role.to_string(), username });
        },

        ClientEvent::Message(text, username, id, colors) =>
        {
            say(app, ChatMessage::new(MessageKind::User, username, text).with_id(id).colored(colors));
        },

        ClientEvent::PrivateMessageRecv(from, id, text) =>
        {
            say(app, ChatMessage::new(MessageKind::Private, format!("{from} (PM)"), text).with_id(id));
        },

        ClientEvent::PrivateMessageSent(to, id, text) =>
        {
            say(app, ChatMessage::new(MessageKind::Private, format!("To {to} (PM)"), text).with_id(id));
        },

        //THE LOBBY'S STORED MESSAGES, SENT ONCE AT LOGIN
        ClientEvent::History(messages) =>
        {
            let messages = messages.into_iter().map(|StoredMessage { username, text, colors }|
            {
                ChatMessage::new(MessageKind::User, username, text).colored(colors)
            }).collect();

            emit(app, UiEvent::History { messages });
        },

        ClientEvent::ServerSay(message) =>
        {
            say(app, ChatMessage::notice(format!("[{}] {message}", options::get_server_username())));
        },

        ClientEvent::Join(username) =>
        {
            say(app, ChatMessage::system(format!("{username} connected.")));

            //A NEW USER MEANS A NEW ROW, AND POSSIBLY A CHANNEL NOBODY WAS IN BEFORE
            if let Some(write_stream) = state.write_stream.lock().await.as_ref()
            {
                network::send(&mut *write_stream.lock().await,
                    PacketCode::List { users: None }, options::get_keys().as_ref()).await;
            }
        },

        //NO PacketCode::List HERE: A KICK WOULD PUT ONE RIGHT BEHIND THE ServerKick PACKET AND EARN A
        //SpamWarning. THE Leave PACKET NAMES THE USER, SO THE ROSTER CAN DROP THEM ITSELF
        ClientEvent::Leave(username, id) =>
        {
            say(app, ChatMessage::system(format!("{username} disconnected.")));
            emit(app, UiEvent::UserLeft { id });
        },

        ClientEvent::List(users) =>
        {
            let users = users.into_iter().map(|OnlineUser { username, id, channel }|
            {
                OnlineUserInfo { username, id, channel }
            }).collect();

            emit(app, UiEvent::Users { users, requested: state.list_requested.swap(false, Ordering::Relaxed) });
        },

        ClientEvent::Files(users) =>
        {
            let users = users.into_iter().map(|UserFile { username, id, upload }| UserFileInfo
            {
                username,
                id,
                uploads: upload.into_iter().map(|(filename, id)| FileInfo { filename, id }).collect(),
            }).collect();

            emit(app, UiEvent::Files { users });
        },

        //ASKED FOR BY /server bans, AND SENT AGAIN AFTER EVERY PARDON - THE IDS RENUMBER WHEN ONE IS
        //LIFTED, SO THE ANSWER TO A PARDON IS THE NEW LIST RATHER THAN AN 'OK' OVER A STALE ONE
        ClientEvent::ServerBans(users, ips) =>
        {
            let ban = |BanEntry { id, subject }| BanInfo { id, subject };

            emit(app, UiEvent::Bans
            {
                users: users.into_iter().map(ban).collect(),
                ips: ips.into_iter().map(ban).collect(),
            });
        },

        ClientEvent::ServerSettings(settings, saved) =>
        {
            let settings = settings.into_iter().map(|ServerSetting { key, value, section, description, restart }|
            {
                SettingInfo
                {
                    key,
                    value: match value
                    {
                        SettingValue::Toggle(value) => value.to_string(),
                        SettingValue::Number(value) => value.to_string(),
                        SettingValue::Text(value) => value,
                    },
                    section,
                    description,
                    restart,
                }
            }).collect();

            emit(app, UiEvent::ServerSettings { settings, saved });
        },

        //SIDEBAR-ONLY - THE SERVER BROADCASTS THESE TO EVERYONE, WHICH IS ALREADY THE WHOLE TRUTH ABOUT
        //WHICH CHANNELS EXIST: ONE LIVES EXACTLY AS LONG AS SOMEBODY SITS IN IT
        ClientEvent::ChannelChanged(channel) => emit(app, UiEvent::ChannelChanged { channel }),
        ClientEvent::ChannelCreated(name) => emit(app, UiEvent::ChannelCreated { name }),
        ClientEvent::ChannelDestroyed(name) => emit(app, UiEvent::ChannelDestroyed { name }),

        //THE SESSION IS PARKED ON THE ANSWER - THE REPLY CHANNEL IS PUT ASIDE FOR answer_tofu()
        ClientEvent::TofuPrompt(request) =>
        {
            let client::TofuRequest { host, hash, mismatch, pinned, reply } = request;

            *state.tofu_reply.lock().unwrap() = Some(reply);

            emit(app, UiEvent::TofuPrompt { host, hash, pinned, mismatch });
        },

        //REFUSING THE CHECK JUST ENDS THE SESSION
        ClientEvent::TofuError =>
        {
            emit(app, UiEvent::Disconnected { reason: Some(String::from("Server identity rejected.")) });
        },

        //THE SERVER WENT AWAY BETWEEN THE TWO CONNECTIONS - THE KEY IS PINNED NOW, THE SOCKET IS NOT
        ClientEvent::ReconnectFailed =>
        {
            emit(app, UiEvent::Disconnected { reason: Some(String::from("Reconnecting to the server failed.")) });
        },

        //UNLIKE TofuError THERE WAS NO PROMPT TO EXPLAIN ITSELF, SO THE REASON GOES BACK WITH THE BOX
        ClientEvent::HandshakeFailed(reason) => emit(app, UiEvent::Disconnected { reason: Some(reason) }),

        ClientEvent::TofuSkip(hash) =>
        {
            say(app, ChatMessage::error("SECURITY WARNING: UNKNOWN SERVER IDENTITY"));
            say(app, ChatMessage::notice("The server's identity key cannot be verified due to disabled ToFU \
                verification. If you don't recognize the identity key below, disconnect immediately!"));
            say(app, ChatMessage::notice(hash));
        },

        ClientEvent::Upload(filename) => popup(app, format!("Uploading {filename}...")),
        ClientEvent::Download(filename) => popup(app, format!("Downloading {filename}...")),
        ClientEvent::Downloaded(filename) => popup(app, format!("Downloaded {filename} successfully!")),
        ClientEvent::DownloadFailed(filename) => popup(app, format!("Downloading {filename} failed!")),
        ClientEvent::UploadLimit => popup(app, "Maximum concurrent uploads reached!"),

        ClientEvent::Uploaded(username, filename) =>
        {
            say(app, ChatMessage::system(format!("{username} uploaded file \"{filename}\".")));
        },

        ClientEvent::Muted => say(app, ChatMessage::notice("You have been muted by a moderator.")),
        ClientEvent::SpamWarning => popup(app, "Slow down! You're sending messages too quickly."),
        ClientEvent::InvalidUsage => popup(app, "Invalid command usage!"),
        ClientEvent::DisabledFeature => popup(app, "Server has disabled the feature you requested."),

        ClientEvent::IncompatibleVersion(version, server_version) =>
        {
            say(app, ChatMessage::error(format!("Incompatible version! ({version}/{server_version})")));
        },

        ClientEvent::VersionMismatch(version, server_version) =>
        {
            say(app, ChatMessage::notice(format!("Version mismatch - some features may not work \
                ({version}/{server_version})")));
        },

        ClientEvent::UnsafeVersion(newer_versions, version, newest_version) =>
        {
            say(app, ChatMessage::notice(format!("This release could be unsafe! You are {newer_versions} \
                versions behind! ({version}/{newest_version})")));
        },

        ClientEvent::VersionFailed =>
        {
            say(app, ChatMessage::notice("Fetching versions failed, this release could be unsafe!"));
        },

        //THE SOCKET IS GONE, BUT THE APP IS NOT: THE CONNECT BOX COMES BACK SO ANOTHER SERVER (OR THE
        //SAME ONE AGAIN) IS ONE ENTER AWAY. A DISCONNECT THE USER ASKED FOR ARRIVES WITHOUT A REASON,
        //SO THE BOX COMES BACK WITHOUT AN ERROR OVER IT
        ClientEvent::Quit =>
        {
            emit(app, UiEvent::Disconnected
            {
                reason: match state.leaving.load(Ordering::Relaxed)
                {
                    true => None,
                    false => Some(String::from("Server quit communication.")),
                },
            });
        },

        //VOICE AND SCREEN SHARING ARE NOT COMPILED IN, SO NOTHING EVER SENDS THE REST
        _ => {},
    }
}

//DRAINS ONE SESSION'S EVENTS. THE LOOP ENDS WHEN THE LISTENING TASK DROPS ITS SENDER, WHICH IS ALSO
//WHERE THE WRITE HALF STOPS BEING WORTH KEEPING AROUND.
//A SESSION THAT HAS BEEN REPLACED GOES QUIET INSTEAD OF FINISHING: ITS LAST EVENTS (AND ITS CLEANUP)
//WOULD OTHERWISE LAND ON THE CONNECTION THAT TOOK ITS PLACE - AN UPLOAD STILL HOLDING A SENDER IS
//ENOUGH TO KEEP AN OLD PUMP RUNNING WELL PAST THE SOCKET IT BELONGED TO
async fn pump_events(app: AppHandle, mut rx: Receiver<ClientEvent>, session: u64)
{
    while let Some(event) = rx.recv().await
    {
        if app.state::<AppState>().session.load(Ordering::Relaxed) != session { return }

        handle_event(&app, event).await;
    }

    let state = app.state::<AppState>();

    if state.session.load(Ordering::Relaxed) != session { return }

    *state.write_stream.lock().await = None;
    *state.role.lock().unwrap() = Role::default();
    state.tofu_reply.lock().unwrap().take();

    reset_session();
}

//PUBLIC
#[tauri::command]
fn get_commands(state: State<'_, AppState>) -> Vec<CommandInfo> //THE COMMANDS OUR ROLE MAY RUN
{
    let role = *state.role.lock().unwrap();

    command::COMMAND_LIST.iter()
        //THE TWO THE TUI PRINTS INTO ITS OWN PANE HAVE NOWHERE TO GO HERE, AND THE SETTINGS OVERLAY
        //IS A TERMINAL WIDGET - THE DESKTOP APP HAS ITS OWN WINDOW FOR ALL THREE
        .filter(|info| !matches!(info.command, Command::Help | Command::Info | Command::Settings))
        .filter(|info| info.available(role))
        .map(|info| CommandInfo
        {
            name: info.triggers[0].to_lowercase(),
            description: info.description.to_string(),
            args: command_args(info.args),
            subcommands: info.actions(role).map(|sub| SubcommandInfo
            {
                name: sub.triggers[0].to_lowercase(),
                description: sub.description.to_string(),
                args: command_args(sub.args),
            }).collect(),
        })
        .collect()
}

#[tauri::command]
async fn connect_to_server(address: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let mut connecting_addr = address.trim().to_owned();

    //THE ADDRESS IS TAKEN AS TYPED, AND ONLY THE PORT IS FILLED IN WHEN IT IS MISSING
    if !connecting_addr.contains(':')
    {
        connecting_addr.push_str(&format!(":{}", config::read_config::<u16>("default_port")));
    }

    //A NEW CONNECTION COUNTS FROM ZERO ON BOTH SIDES - THE PREVIOUS SESSION LEFT ITS OWN NUMBERS BEHIND
    reset_session();

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
fn answer_tofu(accept: bool, state: State<'_, AppState>) -> Result<(), String> //ANSWER THE IDENTITY PROMPT
{
    let Some(reply) = state.tofu_reply.lock().unwrap().take() else { return Err(String::from("Nothing to answer")) };

    //THE LISTENING TASK EITHER PINS THE KEY AND RECONNECTS ON ITS OWN, OR DISCONNECTS AND REPORTS TofuError
    reply.send(accept).map_err(|_| String::from("The session is already gone"))
}

#[tauri::command]
async fn upload_file_from_path(path: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(String::from("Not connected")) };

    upload_file(&app, &write_stream, &path).await;

    Ok(())
}

#[tauri::command]
async fn send_input(input: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
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
            //SEND THE CODE ON A SIMPLE COMMAND, HANDLE IT HERE OTHERWISE
            let sent = command::send_command_code(&mut *write_stream.lock().await, &command, &parameters).await;

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
                        Some(path) => upload_file(&app, &write_stream, &path).await,
                        None => popup(&app, "Usage: /upload <PATH>"),
                    },

                    Command::Server => server_command(&app, &state, &write_stream, parameters).await,

                    Command::UsernameColor => color_handler(&app, "username_color", parameters),
                    Command::MessageColor => color_handler(&app, "message_color", parameters),

                    Command::Invalid => popup(&app, "Invalid command!"),

                    //Help, Info AND Settings ARE FILTERED OUT OF THE PALETTE, BUT NOTHING STOPS THEM
                    //BEING TYPED OUT
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

    network::send(&mut *write_stream.lock().await, code, options::get_keys().as_ref()).await;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run()
{
    config::init_config();

    //EVERY DIAL GOES THROUGH THE PROXY WHEN THE CONFIG ASKS FOR IT
    if config::read_config("socks5_enabled") { options::enable_socks5(); }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState
        {
            write_stream: MutexAsync::new(None),
            tofu_reply: Mutex::new(None),
            role: Mutex::new(Role::default()),
            session: AtomicU64::new(0),
            leaving: AtomicBool::new(false),
            list_requested: AtomicBool::new(false),
            version_checked: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler!
        [
            connect_to_server,
            send_input,
            get_commands,
            answer_tofu,
            upload_file_from_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
