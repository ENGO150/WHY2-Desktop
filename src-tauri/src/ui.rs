use tauri::
{
    State,
    Emitter,
    AppHandle,
};

use std::sync::mpsc::Receiver;

use serde::Serialize;

use why2::chat:
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

// STRUCTS
#[derive(Clone, Serialize)]
struct FrontendPayload
{
    event_type: String,         // "status", "info", "ui_control", "message"
    content: String,            // Text content
    username: Option<String>,   // For chat messages
    extra: Option<String>,      // For header status or input type
    state_bool: Option<bool>,   // For showing/hiding UI elements
}

// COMMANDS
#[tauri::command]
pub fn send_input(state: State<'_, AppState>, text: String) -> Result<(), String>
{
    let mut stream_guard = state.stream.lock().map_err(|_| "Failed to lock stream")?;

    if let Some(stream) = stream_guard.as_mut()
    {
        let packet = MessagePacket
        {
            text: Some(text),
            // Default colors (server will handle logic if these are None/Default)
            colors: MessageColors { username_color: None, message_color: None },
            ..Default::default()
        };

        // USE GLOBAL KEYS
        // The library handles encryption automatically using these keys
        network::send(stream, packet, options::get_keys().as_ref());
        Ok(())
    } else {
        Err("Not connected".to_string())
    }
}

// FUNCTIONS
pub fn handle_client_events(rx: Receiver<ClientEvent>, app: AppHandle)
{
    while let Ok(event) = rx.recv()
    {
        // CHECK GLOBAL STATE
        let can_chat = options::get_sending_messages();
        let asking_pass = options::get_asking_password();

        match event
        {
            ClientEvent::Connected(server_name) =>
            {
                // 1. UPDATE HEADER
                let _ = app.emit("server-payload", FrontendPayload
                {
                    event_type: "status".into(),
                    content: "".into(),
                    username: None,
                    extra: Some(server_name.clone()),
                    state_bool: None,
                });

                // 2. LOG SUCCESS
                let _ = app.emit("server-payload", FrontendPayload
                {
                    event_type: "info".into(),
                    content: format!("Successfully connected to {}.\n", server_name),
                    username: None,
                    extra: None,
                    state_bool: None,
                });

                // 3. INITIAL USERNAME PROMPT
                let _ = app.emit("server-payload", FrontendPayload
                {
                    event_type: "ui_control".into(),
                    content: "Enter username:".into(),
                    extra: Some("text".into()),
                    username: None,
                    state_bool: Some(true),
                });
            },

            ClientEvent::Info(text, _, _) =>
            {
                if can_chat
                {
                    // LOGIN SUCCESSFUL / CHAT MODE
                    let _ = app.emit("server-payload", FrontendPayload
                    {
                        event_type: "ui_control".into(),
                        content: "chat_input".into(), // Special ID for chat bar
                        extra: None,
                        username: None,
                        state_bool: Some(true), // Enable
                    });

                    // 2. Forward the info log (e.g. "Login successful", "User joined")
                    let _ = app.emit("server-payload", FrontendPayload
                    {
                        event_type: "info".into(),
                        content: text,
                        username: None,
                        extra: None,
                        state_bool: None,
                    });
                }
                else
                {
                    // AUTHENTICATION MODE (Suppress logs, show modals)

                    if asking_pass
                    {
                        // Trigger Password Modal
                        let _ = app.emit("server-payload", FrontendPayload
                        {
                            event_type: "ui_control".into(),
                            content: "Enter password:".into(),
                            extra: Some("password".into()),
                            username: None,
                            state_bool: Some(true),
                        });
                    }
                    else
                    {
                        // Trigger Username Modal (Retry)
                        let _ = app.emit("server-payload", FrontendPayload
                        {
                            event_type: "ui_control".into(),
                            content: "Enter username:".into(),
                            extra: Some("text".into()),
                            username: None,
                            state_bool: Some(true),
                        });
                    }
                }
            },

            ClientEvent::Message(packet) =>
            {
                // Only show messages if we are actually allowed to chat
                if can_chat
                {
                    let _ = app.emit("server-payload", FrontendPayload
                    {
                        event_type: "message".into(),
                        content: packet.text.unwrap_or_default(),
                        username: packet.username,
                        extra: None,
                        state_bool: None,
                    });
                }
            },

            ClientEvent::Quit =>
            {
                let _ = app.emit("server-payload", FrontendPayload
                {
                    event_type: "error".into(),
                    content: "Disconnected.".into(),
                    username: None,
                    extra: None,
                    state_bool: None,
                });
                break;
            },

            _ => {}
        }
    }
}
