use tauri::Builder;

use std::
{
    sync::Mutex,
    net::TcpStream,
};

//STRUCTS
pub struct AppState
{
    pub stream: Mutex<Option<TcpStream>>,
}

//MODULES
pub mod network;
pub mod ui;

//FUNCTIONS
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run()
{
    Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { stream: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler!
        [
            network::try_connect,
            ui::send_input,
            ui::disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
