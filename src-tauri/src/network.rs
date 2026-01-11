use tauri::{ AppHandle, Emitter };

use std::
{
    thread,
    time::Duration,
    net::TcpStream,
    sync::mpsc::{ self, Receiver },
};

use serde::Serialize;

use why2::chat::
{
    config,
    network::client::{ self, ClientEvent },
};

//STRUCTS
#[derive(Clone, Serialize)]
struct FrontendPayload
{
    event_type: String,
    content: String,
    username: Option<String>,
    extra: Option<String>,
    clear_count: Option<usize>,
}

//PRIVATE
fn handle_client_events(rx: Receiver<ClientEvent>, app: AppHandle)
{
    while let Ok(event) = rx.recv()
    {
        let payload = match event
        {
            ClientEvent::Connected(server_name) =>
            {
                //UPDATE HEADER
                let _ = app.emit("server-payload", FrontendPayload
                {
                    event_type: "status".into(),
                    content: "".into(),
                    username: None,
                    extra: Some(server_name.clone()), // This string goes to Header
                    clear_count: None,
                });

                //PRINT LOG
                FrontendPayload
                {
                    event_type: "info".into(),
                    content: format!("Successfully connected to {}.\n", server_name),
                    username: None,
                    extra: None,
                    clear_count: None,
                }
            },

            _ => continue
        };

        let _ = app.emit("server-payload", payload);
    }
}

//PUBLIC
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
    thread::spawn(move || handle_client_events(rx, app));

    Ok(())
}
