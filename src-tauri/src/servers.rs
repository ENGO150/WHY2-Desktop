/*
This is part of WHY2
Copyright (C) 2026 Václav Šmejkal

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

use std::fs;

use serde::{ Serialize, Deserialize };

use why2_chat::misc;

//THE SERVERS THIS WINDOW KNOWS ABOUT. THE TUI ASKS FOR AN ADDRESS AND AN IDENTITY EVERY TIME IT STARTS,
//BECAUSE A TERMINAL CLIENT IS RUN AT A SERVER; A WINDOW IS LEFT OPEN, AND THE ONE QUESTION IT SHOULD NOT
//BE ASKING AGAIN IS THE ONE IT WAS ALREADY ANSWERED. THIS IS OURS AND NOT THE CRATE'S - client.toml IS
//SHARED WITH THE TERMINAL CLIENT, WHICH HAS NO SERVER LIST AND NO USE FOR ONE
const SERVERS_FILE: &str = "/desktop_servers.toml";

//WHAT IS KEPT PER SERVER, AND NOTHING ELSE: A KEY WRITTEN DOWN THAT NOTHING EVER READS BACK IS A FILE
//SAYING MORE ABOUT SOMEBODY THAN IT HAS TO, WHICH IS WHAT A last_used HERE WAS. AN OLDER LIST THAT STILL
//CARRIES ONE IS NOT AN ERROR - SERDE IGNORES WHAT IT DOES NOT KNOW, AND THE NEXT WRITE LEAVES IT OUT.
//THE PASSWORD IS THE WHOLE REASON THIS FILE IS 0600: THERE IS NO KEY TO ENCRYPT IT WITH THAT THE PROGRAM
//WOULD NOT HAVE TO KEEP BESIDE IT, AND ASKING FOR A SECOND PASSWORD TO UNLOCK THE FIRST IS THE COMFORT
//THE WHOLE LIST EXISTS TO BUY. IT IS OPTIONAL, AND A SERVER SAVED WITHOUT ONE SIMPLY ASKS AT EVERY
//CONNECT.
//THE id IS OURS AND IS THE ROW'S IDENTITY - SAVE AND FORGET BOTH MATCH ON IT, AND THE RAIL KEYS ON IT -
//BECAUSE THE SAME ADDRESS TWICE IS TWO ACCOUNTS ON ONE SERVER AND NOT ONE ROW WRITTEN DOWN TWICE
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct StoredServer
{
    pub(crate) id: String,                //OURS, AND ONLY EVER COMPARED WITH ITSELF
    pub(crate) address: String,           //AS IT WAS TYPED - THE PORT IS FILLED IN AT DIAL TIME
    #[serde(default)]
    pub(crate) username: String,          //WHO WE ARE THERE
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) password: Option<String>,  //None IS "ASK ME"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,      //WHAT THE SERVER LAST CALLED ITSELF
}

//THE FILE IS AN ARRAY OF TABLES AND NOT A BARE ARRAY, BECAUSE TOML HAS NO TOP-LEVEL ARRAY TO BE.
//auto_connect IS THE ONE THING IN HERE THAT IS NOT A SERVER: WHICH OF THEM THE WINDOW DIALS BY ITSELF AT
//STARTUP, KEPT AS THE ROW'S OWN id AND None FOR "ASK ME, THE WAY IT ALWAYS DID". IT LIVES BESIDE THE LIST
//AND NOT IN client.toml, BECAUSE client.toml IS SHARED WITH THE TERMINAL CLIENT, WHICH HAS NO LIST TO
//POINT AT - AND THE KEY IS WRITTEN AHEAD OF THE ARRAY, SINCE A BARE KEY AFTER AN [[server]] TABLE WOULD
//BELONG TO THAT TABLE
#[derive(Serialize, Deserialize, Default)]
struct ServerFile
{
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auto_connect: Option<String>,

    #[serde(default)]
    server: Vec<StoredServer>,
}

fn path() -> String
{
    misc::get_why2_dir() + SERVERS_FILE
}

//A LIST NOBODY HAS WRITTEN YET IS AN EMPTY ONE, AND SO IS ONE THAT CAME BACK UNREADABLE: THE WINDOW'S
//ANSWER TO EITHER IS THE SAME SCREEN THAT ASKS FOR THE FIRST SERVER
fn read_file() -> ServerFile
{
    let Ok(text) = fs::read_to_string(path()) else { return ServerFile::default() };

    toml::from_str::<ServerFile>(&text).unwrap_or_default()
}

pub(crate) fn load() -> Vec<StoredServer>
{
    read_file().server
}

//NOBODY BUT THIS USER READS THIS FILE. THE MODE IS SET ON THE FILE THAT IS ALREADY THERE AS WELL AS ON
//THE ONE BEING MADE, SO A LIST WRITTEN BEFORE A PASSWORD WAS EVER PUT IN IT IS TIGHTENED THE SAME WAY
#[cfg(unix)]
fn protect(path: &str)
{
    use std::os::unix::fs::PermissionsExt;

    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

//WINDOWS HAS NO MODE TO SET - THE FILE LANDS IN THE USER'S OWN PROFILE AND INHERITS ITS ACL
#[cfg(not(unix))]
fn protect(_path: &str) {}

fn store(file: &ServerFile) -> Result<(), String>
{
    let path = path();

    let text = toml::to_string_pretty(file).map_err(|error| error.to_string())?;

    //THE MODE IS SET BEFORE THE PASSWORDS GO IN, SO THERE IS NO MOMENT WHERE THEY ARE WORLD-READABLE
    if !std::path::Path::new(&path).exists()
    {
        fs::write(&path, "").map_err(|error| error.to_string())?;
    }

    protect(&path);

    fs::write(&path, text).map_err(|error| error.to_string())?;

    Ok(())
}

//PUBLIC
#[tauri::command]
pub(crate) fn get_servers() -> Vec<StoredServer>
{
    load()
}

//ONE ENTRY, IN OR OUT. THE id IS THE WINDOW'S OWN AND THE ONLY THING MATCHED ON: THE SAME ADDRESS TWICE
//IS TWO ACCOUNTS ON ONE SERVER, WHICH IS A THING PEOPLE DO
#[tauri::command]
pub(crate) fn save_server(server: StoredServer) -> Result<Vec<StoredServer>, String>
{
    let mut file = read_file();

    match file.server.iter_mut().find(|stored| stored.id == server.id)
    {
        Some(stored) => *stored = server,
        None => file.server.push(server),
    }

    store(&file)?;

    Ok(file.server)
}

#[tauri::command]
pub(crate) fn remove_server(id: String) -> Result<Vec<StoredServer>, String>
{
    let mut file = read_file();

    file.server.retain(|stored| stored.id != id);

    //A SERVER THAT IS GONE IS NOT ONE TO OPEN ON: FORGETTING THE ROW THE WINDOW DIALS BY ITSELF PUTS THE
    //ANSWER BACK TO None RATHER THAN LEAVING AN id BEHIND THAT MATCHES NOTHING
    if file.auto_connect.as_deref() == Some(id.as_str()) { file.auto_connect = None }

    store(&file)?;

    Ok(file.server)
}

//WHICH ROW THE WINDOW OPENS ON, AND None WHERE THERE IS NONE OR WHERE THE ONE WRITTEN DOWN HAS SINCE BEEN
//FORGOTTEN - AN id THAT MATCHES NOTHING IS THE SAME ANSWER AS NO id AT ALL, AND SAYING SO HERE KEEPS THE
//SETTINGS ROW AND THE STARTUP FROM DISAGREEING ABOUT IT
pub(crate) fn auto_connect() -> Option<String>
{
    let file = read_file();
    let wanted = file.auto_connect?;

    file.server.iter().any(|stored| stored.id == wanted).then_some(wanted)
}

#[tauri::command]
pub(crate) fn get_auto_connect() -> Option<String>
{
    auto_connect()
}

//AN EMPTY id IS None, WHICH IS THE ROW'S FIRST ENTRY AND WHAT THE PROGRAM SHIPS WITH: OPENING ON THE LIST
//AND DIALLING NOTHING. IT IS NOT A COMMAND OF ITS OWN - THE WINDOW ASKS FOR IT THROUGH THE SETTINGS ROW
//IT IS DRAWN AS (settings.rs::set_client_choice), WHICH IS THE ONE PLACE THAT KNOWS THE KEY
pub(crate) fn set_auto_connect(id: String) -> Result<(), String>
{
    let mut file = read_file();

    file.auto_connect = file.server.iter().any(|stored| stored.id == id).then_some(id);

    store(&file)
}
