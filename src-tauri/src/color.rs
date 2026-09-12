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

use std::sync::Arc;

use tauri::AppHandle;

use tokio::{ net::tcp::OwnedWriteHalf, sync::Mutex as MutexAsync };

use why2_chat::
{
    colors::COLORS,
    network::codes::PacketCode,
};

use crate::types::*;
use crate::state::AppState;
use crate::emit::popup;
use crate::net::send_packet;

pub(crate) const BRIGHT: usize = 8; //WHERE THE BRIGHT HALF OF THE CODE TABLE STARTS

pub(crate) fn to_color(color: &str) -> Result<(u8, String), ()> //PARSE A COLOR NAME/NUMBER INTO THE CODE THE WIRE CARRIES
{
    let mut formatted_color = color.replace(' ', "_").to_lowercase();

    if formatted_color.starts_with("dark") && !formatted_color.starts_with("dark_")
    {
        formatted_color = formatted_color.replacen("dark", "dark_", 1);
    }

    //gray IS THE SAME COLOR SPELLED THE OTHER WAY - THE TABLE ONLY KNOWS ONE OF THE TWO
    formatted_color = formatted_color.replace("gray", "grey");

    let code = match COLORS.iter().position(|name| *name == formatted_color)
    {
        Some(index) => Some(index as u8),

        //A BARE NUMBER IS THE CODE ITSELF, AND ONLY THE SIXTEEN THE PROTOCOL KNOWS ABOUT EXIST
        None => color.trim().parse::<u8>().ok().filter(|code| (*code as usize) < COLORS.len()),
    };

    let code = code.ok_or(())?;

    //STORED BACK UNDER THE CANONICAL NAME, SO THE CONFIG READS THE SAME WAY IT WAS TYPED
    Ok((code, COLORS[code as usize].to_string()))
}

//THE ORDER TO OFFER THE COLORS IN, AS THE TUI OFFERS THEM: THE BRIGHT HALF FIRST, THEN THE DARK ONE, EACH
//ALPHABETICAL. PICKING A COLOR IS A DIFFERENT QUESTION FROM SENDING ONE, SO IT GETS ITS OWN ORDER RATHER
//THAN INHERITING THE CODE TABLE'S - AND EACH HALF IS EXACTLY ONE POPUP TALL
pub(crate) fn offered_colors() -> Vec<VocabularyValue>
{
    let mut bright = COLORS.iter().enumerate().skip(BRIGHT).collect::<Vec<(usize, &&str)>>();
    let mut dark = COLORS.iter().enumerate().take(BRIGHT).collect::<Vec<(usize, &&str)>>();

    bright.sort_unstable_by_key(|(_, name)| **name);
    dark.sort_unstable_by_key(|(_, name)| **name);

    bright.extend(dark);

    bright.into_iter().map(|(code, name)| VocabularyValue { value: name.to_string(), color: Some(code as u8) }).collect()
}

//THE SERVER KEEPS THE COLORS AND PAINTS EVERY LINE WITH THEM, SO ALL THIS DOES IS ASK - THERE IS NOTHING
//TO STORE AND NOTHING TO READ BACK. THE NAME IS STILL CHECKED HERE, SO A COLOR NO CODE CAN CARRY GETS ITS
//ANSWER WITHOUT A ROUND TRIP, AND THE "Color set successfully." IS THE SERVER'S OWN PACKET COMING BACK
pub(crate) async fn color_handler(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>,
    username: bool, parameters: Option<String>)
{
    let Some(parameters) = parameters else { return popup(app, "Invalid usage!") };

    let Ok((color, _)) = to_color(&parameters) else { return popup(app, "Invalid color!") };

    send_packet(state, write_stream, PacketCode::Colors { username, color }).await;
}
