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
    thread,
    net::TcpStream,
    sync::
    {
        Arc,
        Mutex,
        mpsc,
    },
};

use tauri::
{
    AppHandle,
    Emitter,
    State,
    Manager,
};

use why2_chat::
{
    options,
    command::{ self, Command },
    config::{ self, TofuCode },
    network::
    {
        self,
        MessagePacket,
        MessageColors,
        client::{ self, ClientEvent },
    },
};

//STRUCTS
struct AppState
{
    write_stream: Mutex<Option<Arc<Mutex<TcpStream>>>>,
}

#[derive(serde::Serialize)]
struct CommandArgInfo
{
    name: String,     //ARGUMENT NAME
    required: bool,   //IS REQUIRED
}

#[derive(serde::Serialize)]
struct CommandInfo
{
    name: String,              //COMMAND NAME
    description: String,       //COMMAND DESCRIPTION
    args: Vec<CommandArgInfo>, //COMMAND ARGUMENTS
}

//FUNCTIONS

//PRIVATE
fn to_color(color: &str) -> Result<(u8, String), ()> //PARSE COLOR NAME/NUMBER TO CODE
{
    let mut formatted_color = color.replace(" ", "_").to_lowercase();
    if formatted_color.starts_with("dark") && !formatted_color.starts_with("dark_")
    {
        formatted_color = formatted_color.replacen("dark", "dark_", 1);
    }

    let code = match formatted_color.as_str()
    {
        "black"                    => Some(0),
        "dark_red"                 => Some(1),
        "dark_green"               => Some(2),
        "dark_yellow"              => Some(3),
        "dark_blue"                => Some(4),
        "dark_magenta"             => Some(5),
        "dark_cyan"                => Some(6),
        "grey" | "gray"            => Some(7),
        "dark_grey" | "dark_gray"  => Some(8),
        "red"                      => Some(9),
        "green"                    => Some(10),
        "yellow"                   => Some(11),
        "blue"                     => Some(12),
        "magenta"                  => Some(13),
        "cyan"                     => Some(14),
        "white"                    => Some(15),
        _ => if let Ok(c) = color.parse::<u8>()
        {
             if c <= 15 { Some(c) } else { None }
        } else
        {
            None
        }
    };

    if let Some(c) = code
    {
        let name = match c
        {
            0 => "black",
            1 => "dark_red",
            2 => "dark_green",
            3 => "dark_yellow",
            4 => "dark_blue",
            5 => "dark_magenta",
            6 => "dark_cyan",
            7 => "grey",
            8 => "dark_grey",
            9 => "red",
            10 => "green",
            11 => "yellow",
            12 => "blue",
            13 => "magenta",
            14 => "cyan",
            15 => "white",
            _ => "white",
        };
        Ok((c, name.to_string()))
    } else
    {
        Err(())
    }
}

fn upload_file_logic(path_str: &str, stream: &mut std::net::TcpStream) -> Result<(), String> //UPLOAD FILE TO SERVER
{
    let path = std::path::Path::new(path_str.trim());
    if let Ok(mut file) = std::fs::File::open(path)
    {
        if path.metadata().map(|m| m.is_file()).unwrap_or(false) && path.file_name().and_then(|n| n.to_str()).is_some()
        {
            use sha2::{ Sha256, Digest };
            use std::io::Read;
            let mut hasher = Sha256::new();
            let mut buffer = vec![0; 1024 * 1024];

            let success = loop
            {
                match file.read(&mut buffer)
                {
                    Ok(0) => break true,
                    Ok(bytes) => hasher.update(&buffer[..bytes]),
                    Err(_) => break false,
                }
            };

            if success
            {
                let hash: [u8; 32] = hasher.finalize().into();
                why2_chat::network::client::ACTIVE_UPLOADS.lock().unwrap().insert(hash.clone(), path.canonicalize().map_err(|e| e.to_string())?);

                network::send(stream, MessagePacket
                {
                    code: Command::Upload.to_code(),
                    text: Some(serde_json::to_string(&hash).unwrap()),
                    ..Default::default()
                }, options::get_keys().as_ref());

                return Ok(());
            } else
            {
                return Err("Error reading file!".to_string());
            }
        }
    }
    Err("File not found!".to_string())
}

//PUBLIC
#[tauri::command]
fn get_commands() -> Vec<CommandInfo>
{
    why2_chat::command::COMMAND_LIST
        .iter()
        .filter(|info|
        {
            info.command != why2_chat::command::Command::Help && info.command != why2_chat::command::Command::Info
        })
        .map(|info|
        {
            CommandInfo
            {
                name: info.triggers[0].to_lowercase(),
                description: info.description.to_string(),
                args: info.args.iter().map(|arg|
                {
                    CommandArgInfo
                    {
                        name: arg.name.to_string(),
                        required: arg.required,
                    }
                }).collect(),
            }
        })
        .collect()
}

#[tauri::command]
fn connect_to_server(ip: String, app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let mut connecting_addr = ip.clone();

    //ADD PORT TO IP IF MISSING
    if !connecting_addr.contains(':')
    {
        connecting_addr.push_str(&format!(":{}", config::read_config::<u16>("default_port")));
    }

    options::set_server_address(&connecting_addr);

    //CONNECT TO SERVER
    let mut stream = client::connect(connecting_addr).map_err(|e| e.to_string())?;
    let write_stream = Arc::new(Mutex::new(stream.try_clone().map_err(|e| e.to_string())?));

    //SAVE WRITE STREAM TO STATE
    *state.write_stream.lock().unwrap() = Some(write_stream.clone());

    let write_stream_listen = write_stream.clone();
    let (tx, rx) = mpsc::channel::<ClientEvent>();

    let client_tx = tx.clone();
    thread::spawn(move ||
    {
        client::listen_server(&mut (&mut stream, write_stream_listen), client_tx);
    });

    //EVENT LISTENER THREAD
    thread::spawn(move ||
    {
        while let Ok(event) = rx.recv()
        {
            match event
            {
                ClientEvent::Register =>
                {
                    app_handle.emit("why2-event", "Register").unwrap();
                },

                ClientEvent::Login =>
                {
                    app_handle.emit("why2-event", "Login").unwrap();
                },

                ClientEvent::Authenticated =>
                {
                    app_handle.emit("why2-event", "Authenticated").unwrap();
                    if let Some(stream_arc) = app_handle.state::<AppState>().write_stream.lock().unwrap().as_ref()
                    {
                        let mut stream = stream_arc.lock().unwrap();
                        network::send(&mut *stream, MessagePacket
                        {
                            code: Command::List.to_code(),
                            text: None,
                            username: None,
                            id: None,
                            colors: MessageColors { username_color: None, message_color: None },
                            seq: 0,
                            token: None,
                        }, options::get_keys().as_ref());
                    }
                },

                ClientEvent::Connected(server_name) =>
                {
                    app_handle.emit("why2-event", format!("Connected:{}", server_name)).unwrap();
                },

                ClientEvent::UsernameRejected =>
                {
                    app_handle.emit("why2-event", "UsernameRejected").unwrap();
                },

                ClientEvent::PasswordRejected(min_pass) =>
                {
                    app_handle.emit("why2-event", format!("PasswordRejected:{}", min_pass)).unwrap();
                },

                ClientEvent::Message(msg) =>
                {
                    let payload = serde_json::json!(
                    {
                        "username": msg.username.unwrap_or_default(),
                        "text": msg.text.unwrap_or_default(),
                        "id": msg.id.unwrap_or_default(),
                        "username_color": msg.colors.username_color,
                        "message_color": msg.colors.message_color,
                    });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                },

                ClientEvent::Username(disabled_registration, _, _) =>
                {
                    app_handle.emit("why2-event", format!("RequestUsername:{}", disabled_registration)).unwrap();
                },

                ClientEvent::Quit =>
                {
                    app_handle.emit("why2-event", "Quit").unwrap();
                },

                ClientEvent::TofuError(TofuCode::Mismatch) =>
                {
                    app_handle.emit("why2-event", "TofuMismatch").unwrap();
                },

                ClientEvent::TofuError(TofuCode::Unknown(hash, ip)) =>
                {
                    app_handle.emit("why2-event", format!("TofuUnknown:{}:{}", hash, ip)).unwrap();
                },

                ClientEvent::TofuError(_) => {},

                ClientEvent::SpamWarning =>
                {
                    app_handle.emit("why2-event", "Popup:Please slow down. You are sending messages too fast.").unwrap();
                },

                ClientEvent::UploadLimit =>
                {
                    app_handle.emit("why2-event", "Popup:Upload limit reached!").unwrap();
                },

                ClientEvent::InvalidUsage =>
                {
                    app_handle.emit("why2-event", "Popup:Invalid command usage!").unwrap();
                },

                ClientEvent::DisabledFeature =>
                {
                    app_handle.emit("why2-event", "Popup:This feature is disabled on this server!").unwrap();
                },

                ClientEvent::Uploaded(user, file) =>
                {
                    let payload = serde_json::json!({ "username": "", "text": format!("{} uploaded file: {}", user, file), "id": 0 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                },

                ClientEvent::PrivateMessageRecv(user, id, text) =>
                {
                    let payload = serde_json::json!({ "username": format!("{} (PM)", user), "text": text, "id": id, "username_color": 13, "message_color": 13 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                },

                ClientEvent::PrivateMessageSent(user, id, text) =>
                {
                    let payload = serde_json::json!({ "username": format!("To {} (PM)", user), "text": text, "id": id, "username_color": 13, "message_color": 13 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                },

                ClientEvent::List(users_json) =>
                {
                    let json_str = serde_json::to_string(&users_json).unwrap_or_else(|_| "[]".to_string());
                    app_handle.emit("why2-event", format!("UserList:{}", json_str)).unwrap();
                },

                ClientEvent::Files(files_json) =>
                {
                    let json_str = serde_json::to_string(&files_json).unwrap_or_else(|_| "[]".to_string());
                    app_handle.emit("why2-event", format!("Modal:Files:{}", json_str)).unwrap();
                },

                ClientEvent::Download(filename) =>
                {
                    app_handle.emit("why2-event", format!("Popup:Downloading {}...", filename)).unwrap();
                },

                ClientEvent::Downloaded(filename) =>
                {
                    app_handle.emit("why2-event", format!("Popup:Downloaded {} successfully!", filename)).unwrap();
                },

                ClientEvent::DownloadFailed(filename) =>
                {
                    app_handle.emit("why2-event", format!("Popup:Failed to download {}!", filename)).unwrap();
                },

                ClientEvent::Join(user) =>
                {
                    let payload = serde_json::json!({ "username": "", "text": format!("{} joined the server", user), "id": 0 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                },

                ClientEvent::Leave(user) =>
                {
                    let payload = serde_json::json!({ "username": "", "text": format!("{} left the server", user), "id": 0 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                },

                ClientEvent::Clear(1) =>
                {
                    app_handle.emit("why2-event", format!("ChannelChanged:{}", why2_chat::options::get_channel())).unwrap();
                },

                ClientEvent::ChannelCreated(channel) =>
                {
                    app_handle.emit("why2-event", format!("ChannelCreated:{}", channel)).unwrap();
                },

                ClientEvent::ChannelDestroyed(channel) =>
                {
                    app_handle.emit("why2-event", format!("ChannelDestroyed:{}", channel)).unwrap();
                },

                _ => {}
            }
        }
        let _ = app_handle.emit("why2-event", "Quit");
    });

    Ok(())
}

#[tauri::command]
fn accept_tofu(ip: String, hash: String) -> Result<(), String> //ACCEPT TOFU KEY
{
    config::server_keys_save(&ip, &hash);
    Ok(())
}

#[tauri::command]
fn upload_file_from_path(path: String, state: State<'_, AppState>, app_handle: AppHandle) -> Result<(), String>
{
    if let Some(stream_arc) = state.write_stream.lock().unwrap().as_ref()
    {
        let mut stream = stream_arc.lock().unwrap();
        if let Err(e) = upload_file_logic(&path, &mut *stream)
        {
            app_handle.emit("why2-event", format!("Popup:{}", e)).unwrap();
            return Err(e);
        }
        Ok(())
    } else
    {
        Err("Not connected".to_string())
    }
}

#[tauri::command]
fn send_input(input: String, state: State<'_, AppState>, app_handle: AppHandle) -> Result<(), String>
{
    //HANDLE COMMANDS
    if input.starts_with(command::COMMAND_PREFIX)
    {
        let (cmd, parameters) = command::get_command(&input);
        if let Some(cmd) = cmd
        {
            if cmd == Command::Invalid
            {
                app_handle.emit("why2-event", "Popup:Invalid command!").unwrap();
                return Ok(());
            }

            if let Some(stream_arc) = state.write_stream.lock().unwrap().as_ref()
            {
                let mut stream = stream_arc.lock().unwrap();

                if command::send_command_code(&mut *stream, &cmd, &parameters)
                {
                    return Ok(());
                }

                match cmd
                {
                    Command::Exit =>
                    {
                        app_handle.emit("why2-event", "Quit").unwrap();
                    },

                    Command::Help | Command::Info =>
                    {
                        app_handle.emit("why2-event", "Popup:Invalid command!").unwrap();
                    },

                    Command::Upload =>
                    {
                        if let Some(path_str) = parameters
                        {
                            if let Err(e) = upload_file_logic(&path_str, &mut *stream)
                            {
                                app_handle.emit("why2-event", format!("Popup:{}", e)).unwrap();
                            } else
                            {
                                let filename = std::path::Path::new(&path_str)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or(&path_str);
                                app_handle.emit("why2-event", format!("Popup:Uploading {}...", filename)).unwrap();
                            }
                        } else
                        {
                            app_handle.emit("why2-event", "Popup:Usage: /upload <PATH>").unwrap();
                        }
                    },

                    Command::UsernameColor =>
                    {
                        if let Some(color_str) = parameters
                        {
                            if let Ok((_, formatted_name)) = to_color(&color_str)
                            {
                                config::client_write("username_color", &formatted_name);
                                app_handle.emit("why2-event", format!("Popup:Username color set successfully.")).unwrap();
                            } else
                            {
                                app_handle.emit("why2-event", "Popup:Invalid color").unwrap();
                            }
                        }
                    },

                    Command::MessageColor =>
                    {
                        if let Some(color_str) = parameters
                        {
                            if let Ok((_, formatted_name)) = to_color(&color_str)
                            {
                                config::client_write("message_color", &formatted_name);
                                app_handle.emit("why2-event", format!("Popup:Message color set successfully.")).unwrap();
                            } else
                            {
                                app_handle.emit("why2-event", "Popup:Invalid color").unwrap();
                            }
                        }
                    },

                    _ =>
                    {
                        app_handle.emit("why2-event", format!("Popup:Command '{}' not fully supported in desktop UI yet.", input)).unwrap();
                    },
                }
            }
        }
        return Ok(());
    }

    //SEND MESSAGE
    if let Some(stream_arc) = state.write_stream.lock().unwrap().as_ref()
    {
        let mut stream = stream_arc.lock().unwrap();

        let u_color = to_color(&config::read_config::<String>("username_color")).ok().map(|(c, _)| c);
        let m_color = to_color(&config::read_config::<String>("message_color")).ok().map(|(c, _)| c);

        network::send(&mut *stream, MessagePacket
        {
            text: Some(input),
            colors: MessageColors
            {
                username_color: u_color,
                message_color: m_color,
            },
            username: None,
            id: None,
            code: None,
            seq: 0,
            token: None,
        }, options::get_keys().as_ref());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run()
{
    config::init_config();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState
        {
            write_stream: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![connect_to_server, send_input, get_commands, accept_tofu, upload_file_from_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
