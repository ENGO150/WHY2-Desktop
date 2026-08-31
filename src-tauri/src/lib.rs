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
    time::{ Duration, Instant },
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
    time,
    net::tcp::OwnedWriteHalf,
    sync::
    {
        oneshot,
        Mutex as MutexAsync,
        mpsc::{ self, Receiver },
    },
};

use sha2::{ Sha256, Digest };

use openh264::{ decoder::Decoder, formats::YUVSource };

use jpeg_encoder::{ Encoder as JpegEncoder, ColorType };

use serde::{ Serialize, Deserialize };

use tauri::
{
    Emitter,
    Manager,
    AppHandle,
    State,
    async_runtime,
    ipc::{ Channel, InvokeResponseBody },
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
        ArgValues,
    },
    network::
    {
        self,
        voice::client::{ self as voice, options as voice_options },
        screen::client::{ self as screen, capture as screen_capture, options as screen_options },
        client::{ self, ClientEvent, VoiceUser },
        codes::
        {
            PacketCode,
            MessageColors,
            BanEntry,
            OnlineUser,
            UserScreen,
            ServerSetting,
            SettingValue,
            StoredMessage,
        },
    },
};

//CONSTS
const EVENT: &str = "why2-event"; //THE ONE EVENT THE WEBVIEW LISTENS ON

//THE SERVER'S DEFAULT min_message_delay. IT COUNTS EVERY PACKET, NOT ONLY THE ONES THE USER TYPED, AND
//IT IS NEVER SENT TO US - SO THE ONLY THING A CLIENT CAN DO IS KEEP ITS OWN CHATTER THIS FAR APART
const ROSTER_GAP: Duration = Duration::from_millis(750);

//WHAT A DECODED FRAME IS RE-ENCODED AT WHEN THE WEBVIEW HAS NO DECODER OF ITS OWN. IT IS A SCREEN, NOT A
//PHOTOGRAPH: TEXT HAS TO SURVIVE IT, AND THE BYTES ONLY TRAVEL AS FAR AS THE CANVAS IN THE SAME PROCESS
const JPEG_QUALITY: u8 = 80;

//LOGGING IN BRINGS Accept AND OUR OWN Join BACK TO BACK, AND A BURST OF JOINS ARRIVES THE SAME WAY.
//ONE ROSTER ANSWERS ALL OF THEM, SO THE FIRST REQUEST WAITS THIS LONG FOR THE REST TO CATCH UP
const ROSTER_COALESCE: Duration = Duration::from_millis(50);

//THE WHOLE VOCABULARY OF /color AND /ucolor, IN CODE ORDER - THE POSITION IN THIS TABLE IS WHAT THE WIRE
//CARRIES, SO IT IS THE crossterm ORDER THE TUI'S OWN colors::COLORS IS IN AND NOT ONE TO SORT
const COLORS: [&str; 16] =
[
    "black",
    "dark_red",
    "dark_green",
    "dark_yellow",
    "dark_blue",
    "dark_magenta",
    "dark_cyan",
    "grey",
    "dark_grey",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
];

const BRIGHT: usize = 8; //WHERE THE BRIGHT HALF OF THE CODE TABLE STARTS

//THE client.toml ROWS THE SETTINGS BOX SHOWS, AS tui/settings.rs OPENS THEM: THE HEADING THEY SIT UNDER,
//THE LABEL, THE KEY, AND WHAT KIND OF ANSWER THE KEY TAKES. THE KEY IS THE TRUTH AND THE LABEL IS WHAT IT
//MEANS - disable_colors HELD IS "Message colors" TURNED OFF, WHICH IS WHY A TOGGLE CARRIES invert
const CLIENT_SETTINGS: [(&str, &str, &str, ClientKind); 8] =
[
    ("Audio", "Input device",      "input_device",      ClientKind::Device { input: true }),
    ("Audio", "Output device",     "output_device",     ClientKind::Device { input: false }),
    ("Audio", "Input volume",      "input_volume",      ClientKind::Volume),
    ("Audio", "Output volume",     "output_volume",     ClientKind::Volume),
    ("Audio", "Noise suppression", "noise_suppression", ClientKind::Toggle { invert: false }),
    ("Audio", "Automatic gain",    "automatic_gain",    ClientKind::Toggle { invert: false }),

    ("Interface", "Message colors",  "disable_colors", ClientKind::Toggle { invert: true }),
    ("Interface", "Show client IDs", "show_id",        ClientKind::Toggle { invert: false }),
];

//CELLS OF VOLUME BAR AND THE STEP EITHER ARROW MOVES IT BY, BOTH AS tui/settings.rs HAS THEM. THE BAR IS
//DRAWN IN THE WINDOW, SO ONLY THE STEP IS OURS - THE CEILING IS THE VOICE CLIENT'S OWN
const VOLUME_STEP: u32 = 5;

//STRUCTS
struct AppState
{
    write_stream: MutexAsync<Option<Arc<MutexAsync<OwnedWriteHalf>>>>, //WRITE HALF OF THE LIVE SESSION
    tofu_reply: Mutex<Option<oneshot::Sender<bool>>>,                  //THE HANDSHAKE IS PARKED ON THIS
    role: Mutex<Role>,                                                 //WHAT THIS SERVER GRANTED US
    session: AtomicU64,                                                //ONLY THE NEWEST SESSION COUNTS
    last_sent: Mutex<Instant>,                                         //WHEN WE LAST PUT SOMETHING ON THE WIRE
    roster_queued: AtomicBool,                                         //A ROSTER REFRESH IS ALREADY ON ITS WAY
    leaving: AtomicBool,                                               //THE DISCONNECT WAS ASKED FOR
    list_requested: AtomicBool,                                        //THE NEXT ROSTER OPENS A MODAL
    version_checked: AtomicBool,                                       //crates.io IS ASKED ONCE PER PROCESS
    voice_enabled: AtomicBool,                                         //THE SERVER LET US INTO THE CALL

    //WHO WAS IN IT WHEN WE LAST HEARD. VoiceActivity ARRIVES ONLY WHILE THERE IS AUDIO TO ARRIVE WITH, SO
    //A MUTE TOGGLED IN A SILENT CALL HAS NOTHING TO REDRAW IT - THE ROSTER IS KEPT HERE AND SENT AGAIN
    voice_users: Mutex<Vec<VoiceUserInfo>>,

    //WHERE AN ATTACHED SHARE'S FRAMES GO. THE CRATE HANDS THEM OVER AS H.264 ACCESS UNITS AND THE PICTURE
    //LANDS IN THE CHAT WINDOW RATHER THAN IN A WINDOW OF THE CRATE'S OWN - EITHER DECODED BY THE WEBVIEW,
    //OR, WHERE IT HAS NO DECODER, DECODED HERE AND SENT ON AS JPEG
    screen_channel: Mutex<Option<Channel<InvokeResponseBody>>>,
    screen_decode: AtomicBool,
}

//ONE LINE OF THE CHAT PANE. EVERY EVENT THAT HAS SOMETHING TO SAY BECOMES ONE OF THESE, SO THE
//FRONTEND RENDERS THROUGH A SINGLE PATH AND kind IS ALL IT NEEDS TO STYLE IT
#[derive(Serialize, Clone)]
struct ChatMessage
{
    kind: MessageKind,
    prefix: Option<String>, //THE DIM "[server]" THE TUI PUTS IN FRONT OF ITS OWN NARRATION
    username: String,
    text: String,
    id: Option<usize>,
    username_color: Option<u8>,
    message_color: Option<u8>,
}

//ONE ROW OF A LIST BLOCK. THE TUI PRINTS /list AND THE BAN LIST INTO THE PANE AS TREES RATHER THAN INTO
//A WINDOW OF THEIR OWN, SO THE ROWS ARRIVE FLAT AND THE BRANCH GLYPHS ARE DRAWN FROM depth
#[derive(Serialize, Clone)]
struct BlockRow
{
    depth: u8,
    id: Option<usize>,
    text: String,
    note: Option<String>,             //A DIM TRAILING COLUMN - A CHANNEL, A DESCRIPTION
    accent: bool,
}

//OUR OWN SHARE AS IT STANDS. THE MONITOR IS PICKED ON THIS MACHINE AND NEVER LEAVES IT - THE SERVER ONLY
//EVER KNOWS *THAT* WE ARE SHARING, SO THE NAME IS WORTH SAYING BACK TO THE ONE PERSON WHO CAN SEE IT
#[derive(Serialize, Clone)]
struct ScreenState
{
    sharing: bool,
    monitor: Option<String>,
}

//ONE USER WHOSE SCREEN IS UP. THE LIST IS ASKED FOR AND NEVER PUSHED - THE SERVER ANSWERS /screens AND
//SAYS NOTHING WHEN SOMEBODY STARTS, SO IT IS A PHOTOGRAPH THE WAY THE FILE LIST IS
#[derive(Serialize, Clone)]
struct ScreenUserInfo
{
    id: usize,
    username: String,
}

//ONE FILE SOMEBODY HAS UP, AND EVERYTHING /download NEEDS TO FETCH IT. THE PROTOCOL CARRIES NOTHING ELSE
//ABOUT A FILE - NO SIZE, NO TIME - SO THE NAME IS THE WHOLE OF WHAT THERE IS TO SHOW
#[derive(Serialize, Clone)]
struct FileInfo
{
    id: usize,
    name: String,
}

//THE FILES OF ONE USER. THE TUI PRINTS THIS AS A TREE BECAUSE A TERMINAL HAS GLYPHS AND NOT ROWS; HERE
//THE OWNER IS A HEADING AND THEIR FILES ARE A LIST UNDER IT
#[derive(Serialize, Clone)]
struct FileOwnerInfo
{
    id: usize,
    username: String,
    files: Vec<FileInfo>,
}

#[derive(Serialize, Clone)]
struct OnlineUserInfo
{
    username: String,
    id: usize,
    channel: Option<String>,
}

#[derive(Serialize, Clone)]
struct ClientConfig
{
    show_id: bool,
    disable_colors: bool,
}

#[derive(Serialize, Clone)]
struct CommandArgInfo
{
    name: String,
    description: String,
    required: bool,

    //THE NAME OF THE SET THIS PARAMETER ACCEPTS, WHERE IT HAS A CLOSED ONE - THE PALETTE ASKS FOR THE
    //ANSWERS THEMSELVES SEPARATELY, BECAUSE SOME OF THEM ARE ONLY KNOWN AT THE MOMENT THEY ARE NEEDED
    values: String,
}

#[derive(Serialize, Clone)]
struct SubcommandInfo
{
    name: String,
    triggers: Vec<String>,
    description: String,
    args: Vec<CommandArgInfo>,
}

#[derive(Serialize, Clone)]
struct CommandInfo
{
    name: String,
    triggers: Vec<String>, //EVERY WORD THAT GETS HERE - THE PALETTE MATCHES ON ALL OF THEM, THE WAY THE TUI DOES
    description: String,
    args: Vec<CommandArgInfo>,
    subcommands: Vec<SubcommandInfo>, //EMPTY UNLESS THE COMMAND IS A DOORWAY TO ACTIONS
}

//ONE ROW OF client.toml THE BOX LETS THE USER TURN OVER. EVERY ONE OF THEM IS A TOGGLE HERE, AND EVERY
//ONE IS WRITTEN THROUGH THE MOMENT IT IS FLIPPED - THIS CONFIG IS OURS, UNLIKE THE SERVER'S
#[derive(Serialize, Clone)]
struct ClientSetting
{
    label: String,
    key: String,
    section: String,
    value: ClientValue,
}

//ONE USER OF THE CALL, AS THE Voice PANEL DRAWS THEM. muted IS OURS AND NOT THE SERVER'S - THE CRATE
//KEEPS THE MUTED SET IN ITS OWN GLOBALS, AND IS ALSO WHERE A MUTED USER'S AUDIO IS DROPPED
#[derive(Serialize, Clone)]
struct VoiceUserInfo
{
    id: usize,
    username: String,
    speaking: bool,
    latency: u128,
    local: bool, //US - THE ONE ROW WITH NO LATENCY TO SHOW, AND THE ONE /mute TAKES NO ID FOR
    muted: bool,
}

//THE WHOLE OF WHAT THE WINDOW KNOWS ABOUT THE CALL, SENT AS ONE - THE ROSTER, THE MICROPHONE AND WHETHER
//THERE IS A CALL AT ALL MOVE INDEPENDENTLY, AND A PANEL DRAWN FROM HALF OF THEM WOULD LIE ABOUT THE REST
#[derive(Serialize, Clone)]
struct VoiceState
{
    enabled: bool,
    mic: bool, //THE CAPTURE CALLBACK TREATS 0% AS OFF, SO THE STATUS ROW HAD BETTER AGREE
    users: Vec<VoiceUserInfo>,
}

//ONE DEVICE AS THE PICKER SHOWS IT. THE id IS WHAT client.toml HOLDS AND WHAT THE VOICE CLIENT OPENS -
//THE label IS DISPLAY ONLY, AND IS NOT UNIQUE (ALSA HANDS OUT THE SAME DESCRIPTION TO SEVERAL PCMs)
#[derive(Serialize, Clone)]
struct AudioDeviceInfo
{
    id: String,
    label: String,
}

#[derive(Serialize, Clone, Default)]
struct AudioDevices
{
    input: Vec<AudioDeviceInfo>,
    output: Vec<AudioDeviceInfo>,
}

//ONE ROW OF server.toml, BOTH WAYS: THE SERVER SENDS ITS WHOLE CONFIG THIS WAY, AND A SAVE SENDS BACK
//THE ONES THAT WERE EDITED. NOTHING HERE NAMES A KEY - A KEY ADDED TO server.toml NEEDS NO CHANGE HERE
#[derive(Serialize, Deserialize, Clone)]
struct SettingRow
{
    key: String,
    value: SettingValueInfo,
    section: String,     //THE '# Network' HEADING THE KEY SITS UNDER
    description: String, //THE TRAILING COMMENT ON THE KEY'S OWN LINE
    restart: bool,       //STORED LIKE ANY OTHER, BUT THE RUNNING SERVER KEEPS USING WHAT IT READ AT STARTUP
}

//THE THREE DATATYPES THE SERVER'S CONFIG UNDERSTANDS, TAGGED THE WAY EVERY OTHER ENUM HERE IS
#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
enum SettingValueInfo
{
    Toggle(bool),
    Number(i64),
    Text(String),
}

//ONE ANSWER A PARAMETER ACCEPTS. A COLOR CARRIES ITS OWN CODE ALONG, SO THE ROW CAN BE PAINTED IN IT -
//A NAME OUT OF A VOCABULARY NOBODY HAS SEEN IS STILL A GUESS
#[derive(Serialize, Clone)]
struct VocabularyValue
{
    value: String,
    color: Option<u8>,
}

//ENUMS
//WHAT KIND OF ANSWER ONE OF OUR OWN KEYS TAKES. THIS IS THE TABLE'S SIDE OF IT - THE VALUE THE KEY
//ACTUALLY HOLDS IS READ OUT OF THE CONFIG AND HANDED OVER AS A ClientValue
#[derive(Clone, Copy)]
enum ClientKind
{
    Toggle { invert: bool }, //invert IS FOR A KEY PHRASED AS A NEGATIVE - disable_colors
    Volume,
    Device { input: bool },
}

//AND WHAT IT HOLDS RIGHT NOW. A VOLUME CARRIES THE RANGE IT LIVES IN ALONG WITH IT, SO THE BAR IN THE
//WINDOW IS DRAWN AGAINST THE VOICE CLIENT'S OWN CEILING RATHER THAN A NUMBER COPIED OVER THERE
#[derive(Serialize, Clone)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
enum ClientValue
{
    Toggle(bool), //WHAT THE ROW SAYS, WHICH IS NOT ALWAYS WHAT THE KEY HOLDS
    Volume { percent: u32, max: u32, step: u32 },
    Device { id: String, input: bool }, //EMPTY ID = WHATEVER THE SYSTEM PICKS
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum MessageKind
{
    User,    //SOMEBODY SAID SOMETHING
    Private, //A PRIVATE MESSAGE, EITHER WAY
    System,  //THE SERVER NARRATING ITSELF (JOINS, LEAVES, UPLOADS)
    Notice,  //SOMETHING WORTH READING TWICE
    Ok,      //SOMETHING WENT RIGHT
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
    Users { users: Vec<OnlineUserInfo> },                         //THE ROSTER BEHIND THE SIDEBAR
    UserLeft { id: usize },                                       //DROP ONE ROW WITHOUT ASKING AGAIN
    Block { title: String, rows: Vec<BlockRow> },                 //A TREE FOR THE PANE - /list, BANS
    Files { owners: Vec<FileOwnerInfo> },                         //WHAT IS UP FOR DOWNLOAD, AS A LIST
    Screen { screen: ScreenState },                               //OUR OWN SHARE, WHOLE
    Screens { users: Vec<ScreenUserInfo> },                       //WHO ELSE IS SHARING, AS OF WHEN IT WAS ASKED
    Watching { username: Option<String> },                        //WHOSE SCREEN THE PANE IS DRAWING, IF ANY
    OpenSettings,                                                 //  /settings - OUR OWN CONFIG, NOT THE SERVER'S
    ClientSettings { settings: Vec<ClientSetting> },              //OUR OWN ROWS AGAIN, WHEN SOMETHING ELSE MOVED THEM
    Voice { voice: VoiceState },                                  //THE CALL, WHOLE - THE PANEL DRAWS ITSELF FROM IT
    ServerSettings { settings: Vec<SettingRow>, saved: bool },     //server.toml, EITHER ASKED FOR OR JUST STORED
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
            prefix: None,
            username: username.into(),
            text: text.into(),
            id: None,
            username_color: None,
            message_color: None,
        }
    }

    //A LINE NOBODY SAID - THE SERVER NARRATING, OR US NARRATING THE SERVER
    fn system(text: impl Into<String>) -> Self
    {
        Self::new(MessageKind::System, "", text).from_server()
    }

    fn notice(text: impl Into<String>) -> Self { Self::new(MessageKind::Notice, "", text) }

    fn ok(text: impl Into<String>) -> Self { Self::new(MessageKind::Ok, "", text) }

    fn error(text: impl Into<String>) -> Self { Self::new(MessageKind::Error, "", text) }

    //THE SERVER'S OWN NAME IN FRONT OF THE LINE, THE WAY THE TUI STAMPS EVERYTHING IT SAYS FOR ITSELF
    fn from_server(mut self) -> Self
    {
        self.prefix = Some(format!("[{}]", options::get_server_username()));
        self
    }

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

fn block(app: &AppHandle, title: String, rows: Vec<BlockRow>) //PUSH ONE TREE INTO THE PANE
{
    emit(app, UiEvent::Block { title, rows });
}

//THE CALL AS IT STANDS. EVERYTHING THAT TOUCHES ANY PART OF IT ENDS HERE - THE ROSTER ARRIVING, THE
//SERVER LETTING US IN OR PUTTING US OUT, A MUTE TOGGLED, A VOLUME SLID - BECAUSE THE PANEL AND THE
//MICROPHONE READING ARE ONE PICTURE AND HALF OF IT IS ALWAYS WRONG
fn emit_voice(app: &AppHandle)
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
fn emit_screen(app: &AppHandle)
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

//ONE USER OF THE CALL, WITH THE MUTE READ OFF THE CRATE'S GLOBALS THE WAY tui/draw.rs READS IT: OUR OWN
//ROW ASKS ABOUT THE MICROPHONE, EVERYBODY ELSE'S ABOUT THEIR ID
fn voice_user(user: VoiceUser) -> VoiceUserInfo
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

    //AND SO DOES THE CALL: THE VOICE CLIENT FOLLOWS THIS FLAG, SO A LOST SESSION TAKES ITS STREAMS WITH IT
    voice_options::set_use_voice(false);

    //THE SHARE THE SAME WAY, AND THE MONITOR WITH IT - THE PICK LASTS EXACTLY AS LONG AS THE SHARE DOES,
    //SO THE NEXT SESSION'S FIRST BARE /screen STARTS ON THE DEFAULT MONITOR (tui/state.rs DOES THE SAME)
    screen_options::set_use_screen(false);
    screen_options::set_attach_screen(false);
    screen_options::set_monitor(None);
}

fn to_color(color: &str) -> Result<(u8, String), ()> //PARSE A COLOR NAME/NUMBER INTO THE CODE THE WIRE CARRIES
{
    let mut formatted_color = color.replace(' ', "_").to_lowercase();

    if formatted_color.starts_with("dark") && !formatted_color.starts_with("dark_")
    {
        formatted_color = formatted_color.replacen("dark", "dark_", 1);
    }

    //gray IS THE SAME COLOR SPELLED THE OTHER WAY - THE TABLE ONLY KNOWS ONE OF THE TWO
    formatted_color = formatted_color.replace("gray", "grey");

    let code = match COLORS.iter().position(|name| *name == formatted_color)
    {
        Some(index) => Some(index as u8),

        //A BARE NUMBER IS THE CODE ITSELF, AND ONLY THE SIXTEEN THE PROTOCOL KNOWS ABOUT EXIST
        None => color.trim().parse::<u8>().ok().filter(|code| (*code as usize) < COLORS.len()),
    };

    let code = code.ok_or(())?;

    //STORED BACK UNDER THE CANONICAL NAME, SO THE CONFIG READS THE SAME WAY IT WAS TYPED
    Ok((code, COLORS[code as usize].to_string()))
}

//THE ORDER TO OFFER THE COLORS IN, AS THE TUI OFFERS THEM: THE BRIGHT HALF FIRST, THEN THE DARK ONE, EACH
//ALPHABETICAL. PICKING A COLOR IS A DIFFERENT QUESTION FROM SENDING ONE, SO IT GETS ITS OWN ORDER RATHER
//THAN INHERITING THE CODE TABLE'S - AND EACH HALF IS EXACTLY ONE POPUP TALL
fn offered_colors() -> Vec<VocabularyValue>
{
    let mut bright = COLORS.iter().enumerate().skip(BRIGHT).collect::<Vec<(usize, &&str)>>();
    let mut dark = COLORS.iter().enumerate().take(BRIGHT).collect::<Vec<(usize, &&str)>>();

    bright.sort_unstable_by_key(|(_, name)| **name);
    dark.sort_unstable_by_key(|(_, name)| **name);

    bright.extend(dark);

    bright.into_iter().map(|(code, name)| VocabularyValue { value: name.to_string(), color: Some(code as u8) }).collect()
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
        values: match arg.values
        {
            ArgValues::Free => "free",
            ArgValues::Colors => "colors",
            ArgValues::Monitors => "monitors",
            ArgValues::Roles => "roles",
        }.to_string(),
    }).collect()
}

//EVERY PACKET THIS SIDE ORIGINATES GOES THROUGH HERE, BECAUSE THE SPAM COUNTER ON THE SERVER IS ABOUT
//PACKETS AND NOT ABOUT MESSAGES - A ROSTER REFRESH TUCKED IN BEHIND A CHAT LINE COUNTS AGAINST BOTH
async fn send_packet(state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>, code: PacketCode)
{
    network::send(&mut *write_stream.lock().await, code, options::get_keys().as_ref()).await;

    *state.last_sent.lock().unwrap() = Instant::now();
}

//ASK FOR THE ROSTER - EVENTUALLY. THE ROSTER IS ALSO THE CHANNEL LIST, SO IT HAS TO FOLLOW EVERY JOIN,
//AND JOINS ARRIVE IN CLUMPS: LOGGING IN ALONE BRINGS Accept AND OUR OWN Join ONE AFTER THE OTHER, WHICH
//AS TWO SEPARATE List PACKETS IS EXACTLY WHAT THE SERVER CALLS SPAM. ONE REQUEST ANSWERS THE WHOLE
//CLUMP, AND IT WAITS OUT WHATEVER WE LAST SENT BEFORE GOING OUT
fn refresh_online(app: &AppHandle, session: u64)
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

//UPLOAD ONE FILE. THE SERVER IS ASKED FIRST AND ANSWERS WITH A TOKEN, WHICH IS WHAT THE CRATE'S UPLOAD
//TASK DIALS THE SIDE CHANNEL WITH - ALL WE DO HERE IS NAME THE FILE BY ITS HASH AND ASK
async fn upload_file(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>, path: &str)
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

    send_packet(state, write_stream, PacketCode::Upload { hash, token: None, uid: None }).await;
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

    send_packet(state, write_stream, code).await;
}

//TRANSLATES ONE EVENT OF THE SESSION INTO SOMETHING THE WEBVIEW CAN RENDER
async fn handle_event(app: &AppHandle, event: ClientEvent, session: u64)
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

        ClientEvent::Connected(server) =>
        {
            say(app, ChatMessage::ok(format!("Successfully connected to {server}.")));
            emit(app, UiEvent::Connected { server });
        },

        ClientEvent::FirstUser =>
        {
            say(app, ChatMessage::notice("You are the first user to register, owner role has been granted to you."));
        },

        ClientEvent::Authenticated(role) =>
        {
            *state.role.lock().unwrap() = role;

            emit(app, UiEvent::Authenticated { role: role.to_string() });
            say(app, ChatMessage::ok("Login successful. Type / for commands."));

            //THE SERVER BACKDATES ITS OWN CLOCK BY min_message_delay WHEN IT AUTHENTICATES SOMEBODY, SO
            //THE FIRST PACKET AFTER LOGIN IS FREE BY CONSTRUCTION - OURS IS BACKDATED TO MATCH, WHICH IS
            //WHAT LETS THE ROSTER LAND IMMEDIATELY INSTEAD OF A SECOND INTO THE SESSION
            *state.last_sent.lock().unwrap() = Instant::now() - ROSTER_GAP;

            //THE ROSTER IS ALSO WHERE THE CHANNEL LIST COMES FROM
            refresh_online(app, session);
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
            }).collect::<Vec<ChatMessage>>();

            say(app, ChatMessage::notice(format!("Message history ({}):", messages.len())));
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
            refresh_online(app, session);
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
            //THE ROSTER FEEDS THE SIDEBAR EITHER WAY; ONLY A /list THE USER TYPED ALSO ECHOES A BLOCK
            if state.list_requested.swap(false, Ordering::Relaxed)
            {
                let here = options::get_channel();

                block(app, format!("Online clients ({})", users.len()), users.iter().map(|user| BlockRow
                {
                    depth: 0,
                    id: Some(user.id),
                    text: user.username.clone(),
                    note: user.channel.clone().map(|channel| format!("#{channel}")),
                    accent: user.channel.clone().unwrap_or_default() == here,
                }).collect());
            }

            let users = users.into_iter().map(|OnlineUser { username, id, channel }|
            {
                OnlineUserInfo { username, id, channel }
            }).collect();

            emit(app, UiEvent::Users { users });
        },

        //NOT A TREE: THE OWNER IS A HEADING AND THEIR FILES ARE THE ROWS UNDER IT. THE TWO IDS TRAVEL
        //TOGETHER ALL THE WAY TO THE WINDOW, BECAUSE THEY ARE THE TWO ARGUMENTS TO /download. AN EMPTY
        //ANSWER OPENS THE WINDOW ALL THE SAME - THE TUI PRINTS A LINE SAYING SO, BUT A WINDOW THAT REFUSED
        //TO OPEN WOULD LOOK LIKE A BUTTON THAT DOES NOTHING
        ClientEvent::Files(users) =>
        {
            let owners = users.into_iter().map(|user| FileOwnerInfo
            {
                id: user.id,
                username: user.username,
                files: user.upload.into_iter().map(|(name, id)| FileInfo { id, name }).collect(),
            }).collect();

            emit(app, UiEvent::Files { owners });
        },

        //ASKED FOR BY /server bans, AND SENT AGAIN AFTER EVERY PARDON - THE IDS RENUMBER WHEN ONE IS
        //LIFTED, SO THE ANSWER TO A PARDON IS THE NEW LIST RATHER THAN AN 'OK' OVER A STALE ONE
        ClientEvent::ServerBans(users, ips) =>
        {
            if users.is_empty() && ips.is_empty() { return say(app, ChatMessage::notice("No bans.")) }

            let total = users.len() + ips.len();
            let mut rows = Vec::new();

            //TWO SECTIONS, EACH NUMBERED FROM ITS OWN ZERO - THE HEADING NAMES THE ACTION THAT LIFTS IT
            for (name, bans) in [("users", users), ("addresses", ips)]
            {
                if bans.is_empty() { continue }

                rows.push(BlockRow
                {
                    depth: 0,
                    id: None,
                    text: name.to_string(),
                    note: None,
                    accent: false,
                });

                rows.extend(bans.into_iter().map(|BanEntry { id, subject }| BlockRow
                {
                    depth: 1,
                    id: Some(id),
                    text: subject,
                    note: None,
                    accent: false,
                }));
            }

            block(app, format!("Bans ({total})"), rows);
        },

        //server.toml CAME BACK - EITHER THE COPY THE BOX ASKED FOR, OR THE ONE THE SERVER JUST STORED.
        //THE ANSWER TO A SAVE IS THE CONFIG AS IT ACTUALLY STANDS, SO A ROW IT REFUSED SNAPS BACK
        ClientEvent::ServerSettings(settings, saved) =>
        {
            if saved { say(app, ChatMessage::ok("Server settings saved.")) }

            let settings = settings.into_iter().map(|ServerSetting { key, value, section, description, restart }| SettingRow
            {
                key,
                value: match value
                {
                    SettingValue::Toggle(on) => SettingValueInfo::Toggle(on),
                    SettingValue::Number(number) => SettingValueInfo::Number(number),
                    SettingValue::Text(text) => SettingValueInfo::Text(text),
                },
                section,
                description,
                restart,
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

        //THE CALL. THE CRATE OWNS EVERY PART OF IT - THE UDP HANDSHAKE, THE DEVICES, THE MIXING - SO ALL
        //THAT IS LEFT HERE IS TO SAY WHO IS IN IT AND WHO IS TALKING
        ClientEvent::VoiceActivity(users) =>
        {
            *state.voice_users.lock().unwrap() = users.into_iter().map(voice_user).collect();

            emit_voice(app);
        },

        ClientEvent::VoiceEnabled =>
        {
            state.voice_enabled.store(true, Ordering::Relaxed);

            say(app, ChatMessage::ok("Voice enabled."));
            emit_voice(app);
        },

        ClientEvent::VoiceDisabled =>
        {
            state.voice_enabled.store(false, Ordering::Relaxed);
            state.voice_users.lock().unwrap().clear();

            say(app, ChatMessage::system("Voice disabled."));
            emit_voice(app);
        },

        //THE VOICE CLIENT POINTED THE CONFIG BACK AT THE DEVICE THAT IS ACTUALLY PLAYING, SO THE ROWS IN
        //THE BOX ARE NOW BEHIND WHAT client.toml HOLDS - THEY ARE SENT AGAIN RATHER THAN LEFT LYING
        ClientEvent::VoiceDeviceFailed =>
        {
            say(app, ChatMessage::error("Switching the audio device failed - the previous one is still in use."));

            emit(app, UiEvent::ClientSettings { settings: client_settings() });
        },

        ClientEvent::VoiceHandshakeFailed =>
        {
            say(app, ChatMessage::error("The server never answered the voice handshake - is UDP getting through?"));
        },

        ClientEvent::Socks5Voice =>
        {
            say(app, ChatMessage::error("Voice chat cannot be enabled while using SOCKS5."));
        },
        //THE SHARE ITSELF IS THE CRATE'S: IT CAPTURES, ENCODES AND SENDS, AND THE SERVER ANSWERS THE
        //TOGGLE. ALL THAT IS LEFT HERE IS TO SAY WHETHER IT IS RUNNING AND WHAT IT IS POINTED AT
        ClientEvent::Screen(enabled) =>
        {
            match enabled
            {
                true => say(app, ChatMessage::ok(match screen_capture::current_monitor()
                {
                    Some(monitor) => format!("Sharing {monitor}."),
                    None => String::from("Started screen sharing."),
                })),

                false => say(app, ChatMessage::system("Stopped screen sharing.")),
            }

            emit_screen(app);
        },

        ClientEvent::ScreenFailed(reason) =>
        {
            say(app, ChatMessage::error(format!("Screen sharing failed: {reason}.")));

            emit_screen(app);
        },

        //ASKED FOR AND NEVER PUSHED: THE SERVER ANSWERS /screens AND SAYS NOTHING WHEN SOMEBODY STARTS,
        //SO IT OPENS THE SAME WINDOW THE MONITORS ARE PICKED IN - THE TWO HALVES OF ONE SUBJECT
        ClientEvent::Screens(users) =>
        {
            emit(app, UiEvent::Screens
            {
                users: users.into_iter().map(|UserScreen { id, username }| ScreenUserInfo { id, username }).collect(),
            });
        },

        //THE FRAMES ARE ALREADY ON THEIR WAY TO THE SINK BY NOW - ALL THIS DOES IS TELL THE PANE WHOSE
        //PICTURE IT IS ABOUT TO BE DRAWING, SO IT CAN ASK FOR THE FRAMES AND MAKE ROOM FOR THEM
        ClientEvent::Attach(username) =>
        {
            say(app, ChatMessage::system(format!("Watching {username}'s screen.")));

            emit(app, UiEvent::Watching { username: Some(username) });
        },

        //EITHER WE STOPPED WATCHING OR THE SHARE DID - EITHER WAY THERE IS NOTHING LEFT TO DRAW
        ClientEvent::Deattach(username) =>
        {
            state.screen_channel.lock().unwrap().take();

            say(app, ChatMessage::system(format!("Stopped watching {username}'s screen.")));

            emit(app, UiEvent::Watching { username: None });
        },

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

        handle_event(&app, event, session).await;
    }

    let state = app.state::<AppState>();

    if state.session.load(Ordering::Relaxed) != session { return }

    *state.write_stream.lock().await = None;
    *state.role.lock().unwrap() = Role::default();
    state.tofu_reply.lock().unwrap().take();
    state.roster_queued.store(false, Ordering::Relaxed);
    state.voice_enabled.store(false, Ordering::Relaxed);
    state.voice_users.lock().unwrap().clear();
    state.screen_channel.lock().unwrap().take();

    reset_session();
}

//PUBLIC
//THE client.toml KEYS THAT CHANGE HOW THE PANE LOOKS. THE TUI READS THEM ON EVERY REDRAW; HERE
//THEY ARE HANDED OVER ONCE, WHICH IS AS OFTEN AS THEY CAN CHANGE WITHOUT A COMMAND OF OUR OWN
#[tauri::command]
fn get_client_config() -> ClientConfig
{
    ClientConfig
    {
        show_id: config::read_config("show_id"),
        disable_colors: config::read_config("disable_colors"),
    }
}

#[tauri::command]
fn get_commands(state: State<'_, AppState>) -> Vec<CommandInfo> //THE COMMANDS OUR ROLE MAY RUN
{
    let role = *state.role.lock().unwrap();

    command::COMMAND_LIST.iter()
        //THE TWO THE TUI PRINTS INTO ITS OWN PANE HAVE NOWHERE TO GO HERE - THE PALETTE IS THE HELP,
        //AND IT SAYS WHAT EVERY COMMAND AND EVERY PARAMETER OF ONE IS FOR WHILE IT IS BEING TYPED
        .filter(|info| !matches!(info.command, Command::Help | Command::Info))
        .filter(|info| info.available(role))
        .map(|info| CommandInfo
        {
            name: info.triggers[0].to_lowercase(),
            triggers: info.triggers.iter().map(|trigger| trigger.to_lowercase()).collect(),
            description: info.description.to_string(),
            args: command_args(info.args),
            subcommands: info.actions(role).map(|sub| SubcommandInfo
            {
                name: sub.triggers[0].to_lowercase(),
                triggers: sub.triggers.iter().map(|trigger| trigger.to_lowercase()).collect(),
                description: sub.description.to_string(),
                args: command_args(sub.args),
            }).collect(),
        })
        .collect()
}

//ONE ROW'S KIND, OR NOTHING WHEN THE KEY IS NOT ONE THE BOX OFFERS - A KEY ARRIVING FROM ANYWHERE ELSE
//IS NOT OURS TO WRITE, WHATEVER client.toml HAPPENS TO HOLD UNDER IT
fn client_kind(key: &str) -> Option<ClientKind>
{
    CLIENT_SETTINGS.iter().find(|(_, _, candidate, _)| *candidate == key).map(|(_, _, _, kind)| *kind)
}

//OUR OWN CONFIG, AS THE SETTINGS BOX SHOWS IT. THE TUI READS EVERY VALUE OUT OF THE CONFIG ONCE WHEN THE
//OVERLAY OPENS AND NEVER RE-READS IT WHILE DRAWING - SO DOES THIS
fn client_settings() -> Vec<ClientSetting>
{
    CLIENT_SETTINGS.iter().map(|(section, label, key, kind)| ClientSetting
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

            ClientKind::Volume => ClientValue::Volume
            {
                percent: voice_options::clamp_volume(config::read_config::<u32>(key)),
                max: voice_options::VOLUME_MAX,
                step: VOLUME_STEP,
            },

            ClientKind::Device { input } => ClientValue::Device
            {
                id: config::read_config::<String>(key),
                input: *input,
            },
        },
    }).collect()
}

#[tauri::command]
fn get_client_settings() -> Vec<ClientSetting>
{
    client_settings()
}

//EVERY DEVICE THE VOICE CLIENT COULD OPEN. THE LIST COMES FROM THE VOICE CLIENT ITSELF, SO IT IS
//ENUMERATED IN THE SAME cpal HOST THAT LATER OPENS THE CHOSEN ONE (BLOCKING, HENCE spawn_blocking)
#[tauri::command]
async fn get_audio_devices() -> AudioDevices
{
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
fn set_client_setting(key: String, on: bool) -> Result<ClientConfig, String>
{
    let Some(ClientKind::Toggle { invert }) = client_kind(&key) else { return Err(String::from("Unknown setting!")) };

    config::client_write_bool(&key, if invert { !on } else { on });

    //THE TWO AUDIO TOGGLES ARE READ BY THE CAPTURE CALLBACK OUT OF ITS OWN GLOBALS, NOT OFF THE DISK
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
fn set_client_volume(key: String, percent: u32, app: AppHandle) -> Result<u32, String>
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

//POINT ONE OF THE TWO DEVICE KEYS SOMEWHERE ELSE. AN EMPTY ID IS "WHATEVER THE SYSTEM PICKS", WHICH IS
//WHAT THE CONFIG SHIPS WITH - AND A RUNNING CALL REBUILDS ITS STREAMS WITHOUT BEING DROPPED
#[tauri::command]
fn set_client_device(key: String, id: String) -> Result<(), String>
{
    let Some(ClientKind::Device { .. }) = client_kind(&key) else { return Err(String::from("Unknown setting!")) };

    config::client_write(&key, &id);
    voice_options::mark_devices_changed();

    Ok(())
}

//THE EDITED SERVER ROWS, IN ONE GO. THE BOX HOLDS THEM UNTIL THIS IS CALLED BECAUSE server.toml IS NOT
//OURS TO WRITE - THE ANSWER IS THE CONFIG AS IT ACTUALLY STANDS, WHICH IS WHAT REDRAWS THE ROWS
#[tauri::command]
async fn save_server_settings(settings: Vec<SettingRow>, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
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
async fn restart_server(app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
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
#[tauri::command]
fn get_vocabulary(values: String) -> Vec<VocabularyValue>
{
    match values.as_str()
    {
        "colors" => offered_colors(),

        //THE ROLES ARE THE ONE VOCABULARY THAT IS ALSO A PROTOCOL VALUE - THE SERVER STORES THE POSITION IN
        //THIS LIST, SO OFFERING THE NAMES IS THE ONLY WAY THE TWO CANNOT DRIFT
        "roles" => Role::ALL.iter().map(|role| VocabularyValue { value: role.to_string(), color: None }).collect(),

        //THE CRATE'S OWN LIST AND NOT TAURI'S: THESE ARE THE NAMES /screen RESOLVES AGAINST, AND A WINDOW
        //MANAGER'S IDEA OF WHAT A MONITOR IS CALLED IS NOT ALWAYS THE CAPTURE BACKEND'S
        "monitors" => screen_capture::monitor_names().into_iter()
            .map(|name| VocabularyValue { value: name, color: None })
            .collect(),

        _ => Vec::new(),
    }
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

    //WHATEVER THE LAST CALL LEFT BEHIND IS NOT THIS ONE'S - A pump_events THAT OUTLIVED ITS SOCKET
    //DOES NOT CLEAN UP AFTER THE SESSION THAT REPLACED IT
    state.voice_enabled.store(false, Ordering::Relaxed);
    state.voice_users.lock().unwrap().clear();
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
    *state.last_sent.lock().unwrap() = Instant::now();

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

//SOMEBODY ELSE'S SCREEN, ON ITS WAY TO THE PANE. THE FAST PATH HANDS THE H.264 STRAIGHT OVER AND THE
//WEBVIEW DECODES IT; WHERE THE WEBVIEW CANNOT (WebCodecs IS NOT EVERYWHERE, AND WHERE IT IS THE H.264
//DECODER BEHIND IT MAY NOT BE), THE FRAME IS DECODED HERE AND SENT ON AS A JPEG THE CANVAS CAN DRAW
fn screen_frames(app: &AppHandle, mut frames: mpsc::UnboundedReceiver<Vec<u8>>)
{
    let mut decoder: Option<Decoder> = None;
    let mut rgb: Vec<u8> = Vec::new();
    let mut said = false; //A DECODER THAT WILL NOT START IS WORTH SAYING ONCE, NOT THIRTY TIMES A SECOND

    while let Some(frame) = frames.blocking_recv()
    {
        let state = app.state::<AppState>();

        //NOBODY IS WATCHING (OR THE PANE HAS NOT ASKED FOR THE FRAMES YET) - THIS ONE IS DROPPED RATHER
        //THAN QUEUED, SINCE A PICTURE NOBODY SEES IS WORTH NOTHING A SECOND LATER
        let Some(channel) = state.screen_channel.lock().unwrap().clone() else
        {
            //AND THE NEXT WATCHER STARTS FROM THEIR OWN KEYFRAME, NOT HALFWAY THROUGH SOMEBODY ELSE'S
            decoder = None;
            continue;
        };

        if !state.screen_decode.load(Ordering::Relaxed)
        {
            channel.send(InvokeResponseBody::Raw(frame)).ok();
            continue;
        }

        //WHATEVER ELSE HAS PILED UP WHILE THE LAST ONE WAS BEING DECODED COMES ALONG NOW: EVERY FRAME HAS
        //TO BE DECODED (H.264 IS PREDICTED, AND SKIPPING ONE BREAKS THE ONES AFTER IT), BUT ONLY THE
        //NEWEST IS WORTH THE RE-ENCODE - THE OLDER ONES ARE ALREADY WRONG BY THE TIME THEY WOULD BE DRAWN
        let mut pending = vec![frame];

        while let Ok(next) = frames.try_recv() { pending.push(next); }

        let decoder = match decoder
        {
            Some(ref mut decoder) => decoder,
            None => match Decoder::new()
            {
                Ok(new) => { said = false; decoder.insert(new) },

                Err(error) =>
                {
                    if !said { say(app, ChatMessage::error(format!("Cannot decode the screen share: {error}."))) }

                    said = true;
                    continue;
                },
            },
        };

        let newest = pending.len() - 1;

        for (index, packet) in pending.iter().enumerate()
        {
            let Ok(Some(yuv)) = decoder.decode(packet) else { continue };

            if index != newest { continue }

            let (width, height) = yuv.dimensions();

            rgb.resize(width * height * 3, 0);
            yuv.write_rgb8(&mut rgb);

            let mut jpeg = Vec::with_capacity(rgb.len() / 8);

            if JpegEncoder::new(&mut jpeg, JPEG_QUALITY)
                .encode(&rgb, width as u16, height as u16, ColorType::Rgb).is_ok()
            {
                channel.send(InvokeResponseBody::Raw(jpeg)).ok();
            }
        }
    }
}

//THE PANE ASKS FOR THE PICTURE, AND HANDS OVER THE PIPE IT WANTS IT ON. A FRAME IS TENS OF KILOBYTES OF
//H.264 THIRTY TIMES A SECOND, WHICH IS NOTHING ON A BINARY CHANNEL AND HOPELESS AS A JSON ARRAY OF BYTES -
//decode IS THE PANE SAYING IT CANNOT DECODE H.264 ITSELF AND WANTS PICTURES INSTEAD OF A BITSTREAM
#[tauri::command]
fn watch_frames(channel: Channel<InvokeResponseBody>, decode: bool, state: State<'_, AppState>)
{
    state.screen_decode.store(decode, Ordering::Relaxed);

    *state.screen_channel.lock().unwrap() = Some(channel);
}

//AND SAYS SO WHEN IT HAS STOPPED LOOKING - THE FRAMES ARE DROPPED FROM THEN ON RATHER THAN QUEUED
#[tauri::command]
fn drop_frames(state: State<'_, AppState>)
{
    state.screen_channel.lock().unwrap().take();
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

    upload_file(&app, &state, &write_stream, &path).await;

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
            last_sent: Mutex::new(Instant::now()),
            roster_queued: AtomicBool::new(false),
            leaving: AtomicBool::new(false),
            list_requested: AtomicBool::new(false),
            version_checked: AtomicBool::new(false),
            voice_enabled: AtomicBool::new(false),
            voice_users: Mutex::new(Vec::new()),
            screen_channel: Mutex::new(None),
            screen_decode: AtomicBool::new(false),
        })
        //THE FRAMES OF A WATCHED SHARE ARE PULLED OUT OF THE CRATE ONCE, FOR THE LIFE OF THE PROCESS: THE
        //SINK IS WHAT KEEPS IT FROM OPENING A WINDOW OF ITS OWN, AND IT MUST BE SET BEFORE ANY ATTACH.
        //A THREAD AND NOT A TASK, BECAUSE DECODING ONE IS TENS OF MILLISECONDS OF UNBROKEN CPU
        .setup(|app|
        {
            let (frames_tx, frames_rx) = mpsc::unbounded_channel::<Vec<u8>>();

            *screen::SCREEN_FRAME_SINK.write().unwrap() = Some(frames_tx);

            let handle = app.handle().clone();

            std::thread::spawn(move || screen_frames(&handle, frames_rx));

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
            save_server_settings,
            restart_server,
            answer_tofu,
            upload_file_from_path,
            watch_frames,
            drop_frames,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
