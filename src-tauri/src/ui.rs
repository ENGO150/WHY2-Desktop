use tauri::{ AppHandle, Emitter };

use std::sync::mpsc::Receiver;

use serde::Serialize;

use why2::chat::network::client::ClientEvent;

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
pub fn handle_client_events(rx: Receiver<ClientEvent>, app: AppHandle)
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
