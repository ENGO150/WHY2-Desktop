use std::
{
    time::Duration,
    net::TcpStream
};

use why2::chat::config;

#[tauri::command]
pub fn try_connect(mut address: String) -> Result<(), String>
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
