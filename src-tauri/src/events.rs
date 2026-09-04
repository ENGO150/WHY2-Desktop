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
    sync::atomic::Ordering,
};

use tokio::sync::mpsc::Receiver;

use tauri::{ Manager, AppHandle };

use why2_chat::
{
    role::Role,
    options,
    network::
    {
        client::{ self, ClientEvent },
        codes::
        {
            SettingValue,
            BanEntry,
            OnlineUser,
            UserScreen,
            ServerSetting,
            StoredMessage,
        },
    },
};

use crate::types::*;
use crate::state::*;
use crate::emit::*;
use crate::net::refresh_online;
use crate::settings::client_settings;

pub(crate) async fn handle_event(app: &AppHandle, event: ClientEvent, session: u64)
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

        //THE LINE CARRIES WHO IT IS WITH RATHER THAN SAYING SO IN ITS OWN TEXT: THE WINDOW FILES IT INTO
        //THAT PERSON'S CONVERSATION, WHERE "TO" AND "FROM" ARE WHICH SIDE THE LINE IS ON
        ClientEvent::PrivateMessageRecv(from, id, text) =>
        {
            let peer = DirectPeer { id, username: from.clone(), outgoing: false };

            say(app, ChatMessage::new(MessageKind::Private, from, text).with_id(id).direct(peer));
        },

        //THE ECHO OF ONE WE SENT NAMES THE RECIPIENT, SO IT CARRIES NO AUTHOR AT ALL - THE AUTHOR IS US,
        //AND THIS SIDE OF THE BRIDGE IS THE ONE PLACE THAT NEVER LEARNS OUR OWN NAME
        ClientEvent::PrivateMessageSent(to, id, text) =>
        {
            let peer = DirectPeer { id, username: to, outgoing: true };

            say(app, ChatMessage::new(MessageKind::Private, "", text).direct(peer));
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

            //Leave IS BROADCAST TO EVERY CHANNEL AND NAMES THE ID, SO IT IS ALSO THE ONLY THING THAT
            //RETIRES A VOICE ROW FOR SOMEBODY WHO DROPPED - THE SERVER SENDS NO VoiceLeave FOR ONE
            let was_in_voice = state.voice_roster.lock().unwrap().remove(&id).is_some();

            if was_in_voice { emit_voice(app); }
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
        ClientEvent::ChannelChanged(channel) =>
        {
            emit(app, UiEvent::ChannelChanged { channel });

            //THE VOICE ROSTER IS PER CHANNEL, AND THE NEW ONE'S ARRIVES UNASKED RIGHT BEHIND THIS PACKET
            state.voice_roster.lock().unwrap().clear();
            state.voice_activity.lock().unwrap().clear();

            emit_voice(app);
        },
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
        //A BUILD WITHOUT THE CALL NEVER RECEIVES ONE OF THESE, BUT THE EVENT IT ARRIVES AS IS THE SAME
        //ENUM EITHER WAY - SO THE ARM STANDS AND ONLY THE ROSTER IT BUILDS IS THE VOICE CLIENT'S
        ClientEvent::VoiceActivity(users) =>
        {
            #[cfg(voice)]
            { *state.voice_activity.lock().unwrap() = users.into_iter().map(voice_user).collect(); }

            #[cfg(not(voice))]
            let _ = users;

            emit_voice(app);
        },

        //THE CHANNEL'S WHOLE VOICE ROSTER, US EXCLUDED - IT ARRIVES AT LOGIN, ON A CHANNEL SWITCH AND ON
        //JOINING THE CALL, SO THE PANEL SAYS WHO IS IN VOICE WHETHER OR NOT WE EVER JOIN IT OURSELVES.
        //IT IS THE TRUTH AND NOT AN ADDITION: WHAT IT CARRIES REPLACES WHAT WE HELD
        ClientEvent::VoiceRoster(clients) =>
        {
            *state.voice_roster.lock().unwrap() = clients.into_iter().collect();

            emit_voice(app);
        },

        ClientEvent::VoiceJoin(id, username) =>
        {
            state.voice_roster.lock().unwrap().insert(id, username);

            emit_voice(app);
        },

        ClientEvent::VoiceLeave(id) =>
        {
            state.voice_roster.lock().unwrap().remove(&id);

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

            //ONLY OUR OWN HALF OF THE PANEL GOES - THE OTHERS ARE STILL IN VOICE, WE JUST STOPPED HEARING THEM
            state.voice_activity.lock().unwrap().clear();

            say(app, ChatMessage::system("Voice disabled."));
            emit_voice(app);
        },

        //THE VOICE CLIENT POINTED THE CONFIG BACK AT THE DEVICE THAT IS ACTUALLY PLAYING, SO THE ROWS IN
        //THE BOX ARE NOW BEHIND WHAT client.toml HOLDS - THEY ARE SENT AGAIN RATHER THAN LEFT LYING
        ClientEvent::VoiceDeviceFailed =>
        {
            say(app, ChatMessage::error("Switching the audio device failed - the previous one is still in use."));

            //ON A PHONE THE DEVICE THAT REFUSED IS USUALLY THE ONE THE ROUTE BUTTON JUST ASKED FOR, AND
            //THE CALL IS STILL COMING OUT OF THE OTHER SPEAKER - SO THE BUTTON GOES BACK TO SAYING SO
            #[cfg(target_os = "android")]
            crate::android::route_failed();

            emit(app, UiEvent::ClientSettings { settings: client_settings() });

            //AND THE STRIP REDRAWS WITH IT, SINCE WHERE THE CALL IS PLAYING IS PART OF THAT PICTURE
            emit_voice(app);
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
        //TOGGLE. ALL THAT IS LEFT HERE IS TO SAY WHETHER IT IS RUNNING - WHICH MONITOR IT IS POINTED AT
        //IS THE Screens WINDOW'S TO BADGE, AND THE TUI SAYS NO MORE THAN THIS EITHER
        ClientEvent::Screen(enabled) =>
        {
            say(app, ChatMessage::ok(format!("{} screen sharing.", match enabled
            {
                true => "Started",
                false => "Stopped",
            })));

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
            say(app, ChatMessage::system(format!("Attached {username}'s screen sharing.")));

            emit(app, UiEvent::Watching { username: Some(username) });
        },

        //EITHER WE STOPPED WATCHING OR THE SHARE DID - EITHER WAY THERE IS NOTHING LEFT TO DRAW
        ClientEvent::Deattach(username) =>
        {
            state.screen_channel.lock().unwrap().take();

            say(app, ChatMessage::system(format!("Deattached {username}'s screen sharing.")));

            emit(app, UiEvent::Watching { username: None });
        },

        //BROADCAST TO EVERYBODY, US INCLUDED - ClientEvent::Screen ALREADY SAID IT ON THIS END, WHICH IS
        //WHY OUR OWN NAME IS THE ONE THING THESE TWO ARE FILTERED ON. THEY ARE THE SERVER TALKING TO THE
        //WHOLE ROOM, SO THEY CARRY ITS NAME IN FRONT THE WAY THE TUI'S DO
        ClientEvent::Screenshare(username) =>
        {
            if !is_us(&state, &username)
            {
                say(app, ChatMessage::notice(format!("[{}] {username} started screen sharing.",
                    options::get_server_username())));
            }
        },

        ClientEvent::ScreenshareEnd(username) =>
        {
            if !is_us(&state, &username)
            {
                say(app, ChatMessage::system(format!("[{}] {username} stopped screen sharing.",
                    options::get_server_username())));
            }
        },

        //THE OTHER DIRECTION: SOMEBODY IS WATCHING WHAT WE ARE SHARING. THE SERVER SENDS THESE TO THE
        //SHARER ALONE AND TO NOBODY ELSE, SO THERE IS NOBODY TO FILTER OUT - AND NO [SERVER] IN FRONT,
        //SINCE THIS IS NOT AN ANNOUNCEMENT TO A ROOM
        ClientEvent::Attached(username) =>
        {
            say(app, ChatMessage::system(format!("{username} attached your screen sharing.")));
        },

        ClientEvent::Deattached(username) =>
        {
            say(app, ChatMessage::system(format!("{username} deattached your screen sharing.")));
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
pub(crate) async fn pump_events(app: AppHandle, mut rx: Receiver<ClientEvent>, session: u64)
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
    state.voice_roster.lock().unwrap().clear();
    state.voice_activity.lock().unwrap().clear();
    state.screen_channel.lock().unwrap().take();

    reset_session();
}

//WHETHER A NAME THE SERVER BROADCAST IS OUR OWN. THE SHARE NOTIFICATIONS GO TO THE WHOLE SERVER, AND
//WHAT WE DID OURSELVES WAS ALREADY SAID BY THE EVENT THAT ANSWERED THE COMMAND - SO OUR OWN NAME IS
//WHAT THEY ARE FILTERED ON, EXACTLY AS tui/event.rs FILTERS THEM
fn is_us(state: &AppState, username: &str) -> bool
{
    *state.username.lock().unwrap() == username
}

//PUBLIC
//THE client.toml KEYS THAT CHANGE HOW THE PANE LOOKS. THE TUI READS THEM ON EVERY REDRAW; HERE
//THEY ARE HANDED OVER ONCE, WHICH IS AS OFTEN AS THEY CAN CHANGE WITHOUT A COMMAND OF OUR OWN
