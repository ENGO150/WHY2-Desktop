use tauri::AppHandle;

use std::
{
    thread,
    time::Duration,
    net::TcpStream,
    sync::mpsc,
};

use why2::chat::
{
    config,
    network::client::{ self, ClientEvent },
};

use crate::ui;

#[tauri::command]
pub fn try_connect(app: AppHandle, mut address: String) -> Result<(), String>
{
    //ADD PORT TO IP IF MISSING
    if !address.contains(':')
    {
        //APPEND DEFAULT PORT TO connecting_ip
        address.push_str(&format!(":{}", config::client_config::<u16>("default_port")));
    }

    //CONNECT
    let mut stream = TcpStream::connect_timeout
    (
        &address.parse().map_err(|e| format!("Invalid address: {e}"))?,
        Duration::from_secs(5),
    ).map_err(|e| format!("Failed: {e}"))?;

    //ENABLE TCP_NODELAY
    stream.set_nodelay(true).map_err(|e| e.to_string())?;

    //CREATE CHANNEL
    let (tx, rx) = mpsc::channel::<ClientEvent>();

    //SPAWN LISTENER THREAD
    thread::spawn(move ||
    {
        client::listen_server(&mut stream, tx);
    });

    //SPAWN READER THREAD
    thread::spawn(move || ui::handle_client_events(rx, app));

    Ok(())
}
