// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Builder;

use std::
{
    time::Duration,
    net::TcpStream
};

use why2::chat::config;

#[tauri::command]
fn try_connect(mut address: String) -> Result<(), String>
{
    //ADD PORT TO IP IF MISSING
    if !address.contains(':')
    {
        //APPEND DEFAULT PORT TO connecting_ip
        address.push_str(&format!(":{}", config::client_config::<u16>("default_port")));
    }

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
