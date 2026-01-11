// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Builder;

use why2_desktop_lib::network;

fn main()
{
    Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![network::try_connect])
        .run(tauri::generate_context!())
        .expect("Failed to run app");
}
