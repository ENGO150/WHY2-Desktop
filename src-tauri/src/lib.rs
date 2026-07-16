use std::sync::{Arc, Mutex};
use std::net::TcpStream;
use std::thread;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, State};

use why2_chat::network::{self, client::{self, ClientEvent}, MessagePacket};
use why2_chat::options;
use why2_chat::config;

struct AppState {
    write_stream: Mutex<Option<Arc<Mutex<TcpStream>>>>,
}

#[derive(serde::Serialize)]
struct CommandArgInfo {
    name: String,
    required: bool,
}

#[derive(serde::Serialize)]
struct CommandInfo {
    name: String,
    description: String,
    args: Vec<CommandArgInfo>,
}

#[tauri::command]
fn get_commands() -> Vec<CommandInfo> {
    why2_chat::command::COMMAND_LIST
        .iter()
        .map(|info| CommandInfo {
            name: info.triggers[0].to_lowercase(),
            description: info.description.to_string(),
            args: info.args.iter().map(|arg| CommandArgInfo {
                name: arg.name.to_string(),
                required: arg.required,
            }).collect(),
        })
        .collect()
}

#[tauri::command]
fn connect_to_server(ip: String, app_handle: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut connecting_addr = ip.clone();
    if !connecting_addr.contains(':') {
        connecting_addr.push_str(&format!(":{}", config::read_config::<u16>("default_port")));
    }
    
    options::set_server_address(&connecting_addr);
    
    // Connect to server
    let mut stream = client::connect(connecting_addr).map_err(|e| e.to_string())?;
    let write_stream = Arc::new(Mutex::new(stream.try_clone().map_err(|e| e.to_string())?));
    
    // Save write stream to state
    *state.write_stream.lock().unwrap() = Some(write_stream.clone());
    
    let write_stream_listen = write_stream.clone();
    let (tx, rx) = mpsc::channel::<ClientEvent>();
    
    let client_tx = tx.clone();
    thread::spawn(move || {
        client::listen_server(&mut (&mut stream, write_stream_listen), client_tx);
    });
    
    thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            match event {
                ClientEvent::Register => {
                    app_handle.emit("why2-event", "Register").unwrap();
                }
                ClientEvent::Login => {
                    app_handle.emit("why2-event", "Login").unwrap();
                }
                ClientEvent::Authenticated => {
                    app_handle.emit("why2-event", "Authenticated").unwrap();
                }
                ClientEvent::Connected(server_name) => {
                    app_handle.emit("why2-event", format!("Connected:{}", server_name)).unwrap();
                }
                ClientEvent::UsernameRejected => {
                    app_handle.emit("why2-event", "UsernameRejected").unwrap();
                }
                ClientEvent::PasswordRejected(min_pass) => {
                    app_handle.emit("why2-event", format!("PasswordRejected:{}", min_pass)).unwrap();
                }
                ClientEvent::Message(msg) => {
                    let payload = serde_json::json!({
                        "username": msg.username.unwrap_or_default(),
                        "text": msg.text.unwrap_or_default(),
                        "id": msg.id.unwrap_or_default(),
                    });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                }
                ClientEvent::Username(disabled_registration, _, _) => {
                    // Triggers when the server expects a username, though Register/Login are usually what prompts first.
                    app_handle.emit("why2-event", format!("RequestUsername:{}", disabled_registration)).unwrap();
                }
                ClientEvent::Quit => {
                    app_handle.emit("why2-event", "Quit").unwrap();
                }
                ClientEvent::SpamWarning => {
                    app_handle.emit("why2-event", "Popup:Please slow down. You are sending messages too fast.").unwrap();
                }
                ClientEvent::UploadLimit => {
                    app_handle.emit("why2-event", "Popup:Upload limit reached!").unwrap();
                }
                ClientEvent::InvalidUsage => {
                    app_handle.emit("why2-event", "Popup:Invalid command usage!").unwrap();
                }
                ClientEvent::DisabledFeature => {
                    app_handle.emit("why2-event", "Popup:This feature is disabled on this server!").unwrap();
                }
                ClientEvent::Join(user) => {
                    let payload = serde_json::json!({ "username": "", "text": format!("{} joined the server", user), "id": 0 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                }
                ClientEvent::Leave(user) => {
                    let payload = serde_json::json!({ "username": "", "text": format!("{} left the server", user), "id": 0 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                }
                ClientEvent::Uploaded(user, file) => {
                    let payload = serde_json::json!({ "username": "", "text": format!("{} uploaded file: {}", user, file), "id": 0 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                }
                ClientEvent::PrivateMessageRecv(user, id, text) => {
                    let payload = serde_json::json!({ "username": format!("{} (PM)", user), "text": text, "id": id, "username_color": 13, "message_color": 13 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                }
                ClientEvent::PrivateMessageSent(user, id, text) => {
                    let payload = serde_json::json!({ "username": format!("To {} (PM)", user), "text": text, "id": id, "username_color": 13, "message_color": 13 });
                    app_handle.emit("why2-event", format!("Message:{}", payload.to_string())).unwrap();
                }
                ClientEvent::List(users_json) => {
                    let json_str = serde_json::to_string(&users_json).unwrap_or_else(|_| "[]".to_string());
                    app_handle.emit("why2-event", format!("Modal:List:{}", json_str)).unwrap();
                }
                ClientEvent::Files(files_json) => {
                    let json_str = serde_json::to_string(&files_json).unwrap_or_else(|_| "[]".to_string());
                    app_handle.emit("why2-event", format!("Modal:Files:{}", json_str)).unwrap();
                }
                _ => {}
            }
        }
        let _ = app_handle.emit("why2-event", "Quit");
    });
    
    Ok(())
}

use why2_chat::command::{self, Command};

#[tauri::command]
fn send_input(input: String, state: State<'_, AppState>, app_handle: AppHandle) -> Result<(), String> {
    if input.starts_with(command::COMMAND_PREFIX) {
        let (cmd, parameters) = command::get_command(&input);
        if let Some(cmd) = cmd {
            if cmd == Command::Invalid {
                app_handle.emit("why2-event", "Popup:Invalid command!").unwrap();
                return Ok(());
            }
            
            if let Some(stream_arc) = state.write_stream.lock().unwrap().as_ref() {
                let mut stream = stream_arc.lock().unwrap();
                
                if command::send_command_code(&mut *stream, &cmd, &parameters) {
                    return Ok(());
                }
                
                match cmd {
                    Command::Exit => {
                        app_handle.emit("why2-event", "Quit").unwrap();
                    }
                    Command::Help => {
                        app_handle.emit("why2-event", "Popup:Start typing / to see available commands!").unwrap();
                    }
                    _ => {
                        app_handle.emit("why2-event", format!("Popup:Command '{}' not fully supported in desktop UI yet.", input)).unwrap();
                    }
                }
            }
        }
        return Ok(());
    }

    if let Some(stream_arc) = state.write_stream.lock().unwrap().as_ref() {
        let mut stream = stream_arc.lock().unwrap();
        
        network::send(&mut *stream, MessagePacket {
            text: Some(input),
            ..Default::default()
        }, options::get_keys().as_ref());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    config::init_config();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            write_stream: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![connect_to_server, send_input, get_commands])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
