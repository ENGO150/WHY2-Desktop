// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Builder;

use std::
{
    time::Duration,
    net::TcpStream
};

#[tauri::command]
fn try_connect(address: String) -> Result<(), String>
{
    let stream = TcpStream::connect_timeout
    (
        &address.parse().map_err(|e| format!("Invalid address: {e}"))?,
        Duration::from_secs(5),
    ).map_err(|e| format!("Failed: {e}"))?;

    Ok(())
}

fn main()
{
    Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![try_connect])
        .run(tauri::generate_context!())
        .expect("Failed to run app");
}
