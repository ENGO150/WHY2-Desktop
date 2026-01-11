use tauri::
{
    State,
    Emitter,
    AppHandle,
};

use std::sync::mpsc::Receiver;

use serde::Serialize;

use why2::chat::
{
    options,
    network::
    {
        self,
        MessagePacket,
        MessageColors,
        client::ClientEvent,
    },
};

use crate::AppState;

//STRUCTS
#[derive(Clone, Serialize)]
struct FrontendPayload
{
    event_type: String,
    content: String,
    username: Option<String>,
    extra: Option<String>,
    clear_count: Option<usize>,
    state_bool: Option<bool>,
}

//COMMANDS
#[tauri::command]
pub fn send_input(state: State<'_, AppState>, text: String) -> Result<(), String>
{
    let mut stream_guard = state.stream.lock().map_err(|_| "Failed to lock stream")?;

    if let Some(stream) = stream_guard.as_mut()
    {
        let packet = MessagePacket
        {
            text: Some(text),
            colors: MessageColors { username_color: None, message_color: None }, //TODO: Implement
            ..Default::default()
        };

        //USE GLOBAL KEYS
        network::send(stream, packet, options::get_keys().as_ref());
        Ok(())
    } else {
        Err("Not connected".to_string())
    }
}

//FUNCTIONS
pub fn handle_client_events(rx: Receiver<ClientEvent>, app: AppHandle)
{
    while let Ok(ref event) = rx.recv()
    {
        let mut payload = match event
        {
            ClientEvent::Connected(server_name) =>
            {
                //UPDATE HEADER
                let _ = app.emit("server-payload", FrontendPayload
                {
                    event_type: "status".into(),
                    content: "".into(),
                    username: None,
                    extra: Some(server_name.clone()), //HEADER
                    clear_count: None,
                    state_bool: None,
                });

                //PRINT LOG
                Some(FrontendPayload
                {
                    event_type: "info".into(),
                    content: format!("Successfully connected to {}.\n", server_name),
                    username: None,
                    extra: None,
                    clear_count: None,
                    state_bool: None,
                })
            },

            _ => None,
        };

        //ENTER USERNAME AFTER CONNECTION
        if let ClientEvent::Connected(_) = event
        {
            if let Some(p) = &mut payload
            {
                p.event_type = "ui_control".into();
                p.content = "Enter username:".into();
                p.extra = Some("text".into());
                p.state_bool = Some(true);
            }
        }

        //EMIT
        if let Some(payload) = payload
        {
            let _ = app.emit("server-payload", payload);
        }
    }
}
