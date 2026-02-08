use tauri::{ AppHandle, State };

use std::
{
    thread,
    time::Duration,
    net::{TcpStream, Shutdown},
    sync::mpsc,
};

use why2_chat::
{
    config,
    options, // ADDED: Import options to access state setters
    network::client::{ self, ClientEvent },
};

use crate::{ ui, AppState };

#[tauri::command]
pub fn try_connect(app: AppHandle, state: State<'_, AppState>, mut address: String) -> Result<(), String>
{
    //ADD PORT TO IP IF MISSING
    if !address.contains(':')
    {
        //APPEND DEFAULT PORT TO connecting_ip
        address.push_str(&format!(":{}", config::read_config::<u16>("default_port")));
    }

    // SHUTDOWN EXISTING STREAM IF ANY
    {
        let mut stream_guard = state.stream.lock().map_err(|_| "Lock error")?;
        if let Some(old_stream) = stream_guard.take() {
            // Ignore error on shutdown as connection might already be dead
            let _ = old_stream.shutdown(Shutdown::Both);
        }
    }

    // RESET GLOBAL STATE
    // Crucial: Reset the chat flags so the UI knows we are not authenticated yet.
    // This fixes the issue where reconnecting immediately shows the chat input.
    options::set_sending_messages(false);
    options::set_asking_password(false);

    //CONNECT
    let stream = TcpStream::connect_timeout
    (
        &address.parse().map_err(|e| format!("Invalid address: {e}"))?,
        Duration::from_secs(5),
    ).map_err(|e| format!("Failed: {e}"))?;

    //ENABLE TCP_NODELAY
    stream.set_nodelay(true).map_err(|e| e.to_string())?;

    //CLONE STREAM
    let mut stream_listener = stream.try_clone().map_err(|e| e.to_string())?;

    //SAVE TO STATE
    *state.stream.lock().map_err(|_| "Lock error")? = Some(stream);

    //CREATE CHANNEL
    let (tx, rx) = mpsc::channel::<ClientEvent>();

    //SPAWN LISTENER THREAD
    thread::spawn(move ||
    {
        client::listen_server(&mut stream_listener, tx);
    });

    //SPAWN READER THREAD
    thread::spawn(move || ui::handle_client_events(rx, app));

    Ok(())
}
