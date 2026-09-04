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

use serde::{ Serialize, Deserialize };

use why2_chat::
{
    options,
    network::codes::MessageColors,
};


pub(crate) type SettingsKey = (&'static str, &'static str, &'static str, ClientKind);


#[derive(Serialize, Clone)]
pub(crate) struct ChatMessage
{
    pub(crate) kind: MessageKind,
    pub(crate) prefix: Option<String>, //THE DIM "[server]" THE TUI PUTS IN FRONT OF ITS OWN NARRATION
    pub(crate) username: String,
    pub(crate) text: String,
    pub(crate) id: Option<usize>,
    pub(crate) username_color: Option<u8>,
    pub(crate) message_color: Option<u8>,
    pub(crate) direct: Option<DirectPeer>, //SET ON A PRIVATE MESSAGE, AND ON NOTHING ELSE
}

//WHO A PRIVATE MESSAGE IS *WITH*, WHICH IS THE OTHER PERSON WHICHEVER WAY IT WENT: THE SERVER NAMES THE
//SENDER ON ONE THAT ARRIVED AND THE RECIPIENT ON THE ECHO OF ONE WE SENT. A PM IS NOT A LINE OF WHATEVER
//CHANNEL HAPPENED TO BE OPEN WHEN IT LANDED - IT IS A CONVERSATION, AND THIS IS WHICH ONE
#[derive(Serialize, Clone)]
pub(crate) struct DirectPeer
{
    pub(crate) id: usize,
    pub(crate) username: String,
    pub(crate) outgoing: bool, //OURS TO THEM RATHER THAN THEIRS TO US - THE ECHO NAMES NOBODY BUT THE OTHER END
}

//ONE ROW OF A LIST BLOCK. THE TUI PRINTS /list AND THE BAN LIST INTO THE PANE AS TREES RATHER THAN INTO
//A WINDOW OF THEIR OWN, SO THE ROWS ARRIVE FLAT AND THE BRANCH GLYPHS ARE DRAWN FROM depth
#[derive(Serialize, Clone)]
pub(crate) struct BlockRow
{
    pub(crate) depth: u8,
    pub(crate) id: Option<usize>,
    pub(crate) text: String,
    pub(crate) note: Option<String>,             //A DIM TRAILING COLUMN - A CHANNEL, A DESCRIPTION
    pub(crate) accent: bool,
}

//OUR OWN SHARE AS IT STANDS. THE MONITOR IS PICKED ON THIS MACHINE AND NEVER LEAVES IT - THE SERVER ONLY
//EVER KNOWS *THAT* WE ARE SHARING, SO THE NAME IS WORTH SAYING BACK TO THE ONE PERSON WHO CAN SEE IT
#[derive(Serialize, Clone)]
pub(crate) struct ScreenState
{
    pub(crate) sharing: bool,
    pub(crate) monitor: Option<String>,
}

//ONE USER WHOSE SCREEN IS UP. THE LIST IS ASKED FOR AND NEVER PUSHED - THE SERVER ANSWERS /screens AND
//SAYS NOTHING WHEN SOMEBODY STARTS, SO IT IS A PHOTOGRAPH THE WAY THE FILE LIST IS
#[derive(Serialize, Clone)]
pub(crate) struct ScreenUserInfo
{
    pub(crate) id: usize,
    pub(crate) username: String,
}

//ONE FILE SOMEBODY HAS UP, AND EVERYTHING /download NEEDS TO FETCH IT. THE PROTOCOL CARRIES NOTHING ELSE
//ABOUT A FILE - NO SIZE, NO TIME - SO THE NAME IS THE WHOLE OF WHAT THERE IS TO SHOW
#[derive(Serialize, Clone)]
pub(crate) struct FileInfo
{
    pub(crate) id: usize,
    pub(crate) name: String,
}

//THE FILES OF ONE USER. THE TUI PRINTS THIS AS A TREE BECAUSE A TERMINAL HAS GLYPHS AND NOT ROWS; HERE
//THE OWNER IS A HEADING AND THEIR FILES ARE A LIST UNDER IT
#[derive(Serialize, Clone)]
pub(crate) struct FileOwnerInfo
{
    pub(crate) id: usize,
    pub(crate) username: String,
    pub(crate) files: Vec<FileInfo>,
}

#[derive(Serialize, Clone)]
pub(crate) struct OnlineUserInfo
{
    pub(crate) username: String,
    pub(crate) id: usize,
    pub(crate) channel: Option<String>,
}

#[derive(Serialize, Clone)]
pub(crate) struct ClientConfig
{
    pub(crate) show_id: bool,
    pub(crate) disable_colors: bool,
}

#[derive(Serialize, Clone)]
pub(crate) struct CommandArgInfo
{
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) required: bool,

    //THE NAME OF THE SET THIS PARAMETER ACCEPTS, WHERE IT HAS A CLOSED ONE - THE PALETTE ASKS FOR THE
    //ANSWERS THEMSELVES SEPARATELY, BECAUSE SOME OF THEM ARE ONLY KNOWN AT THE MOMENT THEY ARE NEEDED
    pub(crate) values: String,
}

#[derive(Serialize, Clone)]
pub(crate) struct SubcommandInfo
{
    pub(crate) name: String,
    pub(crate) triggers: Vec<String>,
    pub(crate) description: String,
    pub(crate) args: Vec<CommandArgInfo>,
}

#[derive(Serialize, Clone)]
pub(crate) struct CommandInfo
{
    pub(crate) name: String,
    pub(crate) triggers: Vec<String>, //EVERY WORD THAT GETS HERE - THE PALETTE MATCHES ON ALL OF THEM, THE WAY THE TUI DOES
    pub(crate) description: String,
    pub(crate) args: Vec<CommandArgInfo>,
    pub(crate) subcommands: Vec<SubcommandInfo>, //EMPTY UNLESS THE COMMAND IS A DOORWAY TO ACTIONS
}

//ONE ROW OF client.toml THE BOX LETS THE USER TURN OVER. EVERY ONE OF THEM IS A TOGGLE HERE, AND EVERY
//ONE IS WRITTEN THROUGH THE MOMENT IT IS FLIPPED - THIS CONFIG IS OURS, UNLIKE THE SERVER'S
#[derive(Serialize, Clone)]
pub(crate) struct ClientSetting
{
    pub(crate) label: String,
    pub(crate) key: String,
    pub(crate) section: String,
    pub(crate) value: ClientValue,
}

//ONE USER OF THE CALL, AS THE Voice PANEL DRAWS THEM. muted IS OURS AND NOT THE SERVER'S - THE CRATE
//KEEPS THE MUTED SET IN ITS OWN GLOBALS, AND IS ALSO WHERE A MUTED USER'S AUDIO IS DROPPED
#[derive(Serialize, Clone)]
pub(crate) struct VoiceUserInfo
{
    pub(crate) id: usize,
    pub(crate) username: String,
    pub(crate) speaking: bool,

    //THEIR PING, AND None WHILE WE ARE NOT RECEIVING THEM - A ROSTER ENTRY WE HAVE NO STREAM FOR IS IN
    //VOICE ALL THE SAME, WE SIMPLY HAVE NO PING FOR THEM, AND 0ms WOULD BE A LIE RATHER THAN A BLANK
    pub(crate) latency: Option<u128>,
    pub(crate) local: bool, //US - THE ONE ROW WITH NO LATENCY TO SHOW, AND THE ONE /mute TAKES NO ID FOR
    pub(crate) muted: bool,
}

//THE WHOLE OF WHAT THE WINDOW KNOWS ABOUT THE CALL, SENT AS ONE - THE ROSTER, THE MICROPHONE AND WHETHER
//THERE IS A CALL AT ALL MOVE INDEPENDENTLY, AND A PANEL DRAWN FROM HALF OF THEM WOULD LIE ABOUT THE REST
#[derive(Serialize, Clone)]
pub(crate) struct VoiceState
{
    pub(crate) enabled: bool,
    pub(crate) mic: bool, //THE CAPTURE CALLBACK TREATS 0% AS OFF, SO THE STATUS ROW HAD BETTER AGREE
    pub(crate) users: Vec<VoiceUserInfo>,

    //WHETHER THE CALL IS ON THE LOUD SPEAKER OR ON THE QUIET ONE, AND None WHERE THERE IS NO SUCH
    //QUESTION - A MACHINE WITH ONE PAIR OF SPEAKERS HAS NOTHING TO PICK BETWEEN, AND DRAWS NO BUTTON
    pub(crate) speaker: Option<bool>,
}

//ONE DEVICE AS THE PICKER SHOWS IT. THE id IS WHAT client.toml HOLDS AND WHAT THE VOICE CLIENT OPENS -
//THE label IS DISPLAY ONLY, AND IS NOT UNIQUE (ALSA HANDS OUT THE SAME DESCRIPTION TO SEVERAL PCMs)
#[derive(Serialize, Clone)]
pub(crate) struct AudioDeviceInfo
{
    pub(crate) id: String,
    pub(crate) label: String,
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct AudioDevices
{
    pub(crate) input: Vec<AudioDeviceInfo>,
    pub(crate) output: Vec<AudioDeviceInfo>,
}

//ONE ROW OF server.toml, BOTH WAYS: THE SERVER SENDS ITS WHOLE CONFIG THIS WAY, AND A SAVE SENDS BACK
//THE ONES THAT WERE EDITED. NOTHING HERE NAMES A KEY - A KEY ADDED TO server.toml NEEDS NO CHANGE HERE
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct SettingRow
{
    pub(crate) key: String,
    pub(crate) value: SettingValueInfo,
    pub(crate) section: String,     //THE '# Network' HEADING THE KEY SITS UNDER
    pub(crate) description: String, //THE TRAILING COMMENT ON THE KEY'S OWN LINE
    pub(crate) restart: bool,       //STORED LIKE ANY OTHER, BUT THE RUNNING SERVER KEEPS USING WHAT IT READ AT STARTUP
}

//THE THREE DATATYPES THE SERVER'S CONFIG UNDERSTANDS, TAGGED THE WAY EVERY OTHER ENUM HERE IS
#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub(crate) enum SettingValueInfo
{
    Toggle(bool),
    Number(i64),
    Text(String),
}

//ONE ANSWER A PARAMETER ACCEPTS. A COLOR CARRIES ITS OWN CODE ALONG, SO THE ROW CAN BE PAINTED IN IT -
//A NAME OUT OF A VOCABULARY NOBODY HAS SEEN IS STILL A GUESS
#[derive(Serialize, Clone)]
pub(crate) struct VocabularyValue
{
    pub(crate) value: String,
    pub(crate) color: Option<u8>,
}

//ENUMS
//WHAT KIND OF ANSWER ONE OF OUR OWN KEYS TAKES. THIS IS THE TABLE'S SIDE OF IT - THE VALUE THE KEY
//ACTUALLY HOLDS IS READ OUT OF THE CONFIG AND HANDED OVER AS A ClientValue
#[derive(Clone, Copy)]
pub(crate) enum ClientKind
{
    Toggle { invert: bool }, //invert IS FOR A KEY PHRASED AS A NEGATIVE - disable_colors
    #[cfg(voice)] Volume,
    #[cfg(voice)] Device { input: bool },
}

//AND WHAT IT HOLDS RIGHT NOW. A VOLUME CARRIES THE RANGE IT LIVES IN ALONG WITH IT, SO THE BAR IN THE
//WINDOW IS DRAWN AGAINST THE VOICE CLIENT'S OWN CEILING RATHER THAN A NUMBER COPIED OVER THERE
#[derive(Serialize, Clone)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub(crate) enum ClientValue
{
    Toggle(bool), //WHAT THE ROW SAYS, WHICH IS NOT ALWAYS WHAT THE KEY HOLDS
    #[cfg(voice)] Volume { percent: u32, max: u32, step: u32 },
    #[cfg(voice)] Device { id: String, input: bool }, //EMPTY ID = WHATEVER THE SYSTEM PICKS
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MessageKind
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
pub(crate) enum UiEvent
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
    pub(crate) fn new(kind: MessageKind, username: impl Into<String>, text: impl Into<String>) -> Self
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
            direct: None,
        }
    }

    //A LINE NOBODY SAID - THE SERVER NARRATING, OR US NARRATING THE SERVER
    pub(crate) fn system(text: impl Into<String>) -> Self
    {
        Self::new(MessageKind::System, "", text).from_server()
    }

    //A LINE THE CLIENT WROTE ABOUT SOMETHING THE SERVER TOLD US ALONE - THE TUI'S push_text, WHICH PUTS
    //NOTHING IN FRONT OF IT: THE [SERVER] STAMP IS FOR WHAT THE SERVER SAID TO THE WHOLE ROOM
    pub(crate) fn plain(text: impl Into<String>) -> Self { Self::new(MessageKind::System, "", text) }

    pub(crate) fn notice(text: impl Into<String>) -> Self { Self::new(MessageKind::Notice, "", text) }

    pub(crate) fn ok(text: impl Into<String>) -> Self { Self::new(MessageKind::Ok, "", text) }

    pub(crate) fn error(text: impl Into<String>) -> Self { Self::new(MessageKind::Error, "", text) }

    //THE SERVER'S OWN NAME IN FRONT OF THE LINE, THE WAY THE TUI STAMPS EVERYTHING IT SAYS FOR ITSELF
    pub(crate) fn from_server(mut self) -> Self
    {
        self.prefix = Some(format!("[{}]", options::get_server_username()));
        self
    }

    pub(crate) fn colored(mut self, colors: MessageColors) -> Self
    {
        self.username_color = colors.username_color;
        self.message_color = colors.message_color;
        self
    }

    pub(crate) fn direct(mut self, peer: DirectPeer) -> Self
    {
        self.direct = Some(peer);
        self
    }

    pub(crate) fn with_id(mut self, id: usize) -> Self
    {
        self.id = Some(id);
        self
    }
}

//FUNCTIONS
