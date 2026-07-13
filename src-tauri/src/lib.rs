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
                    app_handle.emit("why2-event", format!("Message:{}:{}", msg.username.unwrap_or_default(), msg.text.unwrap_or_default())).unwrap();
                }
                ClientEvent::Username(disabled_registration, _, _) => {
                    // Triggers when the server expects a username, though Register/Login are usually what prompts first.
                    app_handle.emit("why2-event", format!("RequestUsername:{}", disabled_registration)).unwrap();
                }
                ClientEvent::Quit => {
                    app_handle.emit("why2-event", "Quit").unwrap();
                }
                _ => {}
            }
        }
        let _ = app_handle.emit("why2-event", "Quit");
    });
    
    Ok(())
}

#[tauri::command]
fn send_input(input: String, state: State<'_, AppState>) -> Result<(), String> {
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
        .invoke_handler(tauri::generate_handler![connect_to_server, send_input])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
