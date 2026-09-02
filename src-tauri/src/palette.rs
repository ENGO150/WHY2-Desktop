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

use tauri::State;

use why2_chat::
{
    role::Role,
    command::{ self, Command, ArgValues },
};

use crate::types::*;
use crate::state::AppState;
use crate::color::offered_colors;

#[cfg(media)]
use why2_chat::network::screen::client::capture as screen_capture;

pub(crate) fn command_args(args: &'static [command::CommandArg]) -> Vec<CommandArgInfo> //DESCRIBE ONE COMMAND'S PARAMETERS
{
    args.iter().map(|arg| CommandArgInfo
    {
        name: arg.name.to_string(),
        description: arg.description.to_string(),
        required: arg.required,
        values: match arg.values
        {
            ArgValues::Free => "free",
            ArgValues::Colors => "colors",
            ArgValues::Monitors => "monitors",
            ArgValues::Roles => "roles",
        }.to_string(),
    }).collect()
}

//EVERY PACKET THIS SIDE ORIGINATES GOES THROUGH HERE, BECAUSE THE SPAM COUNTER ON THE SERVER IS ABOUT
//PACKETS AND NOT ABOUT MESSAGES - A ROSTER REFRESH TUCKED IN BEHIND A CHAT LINE COUNTS AGAINST BOTH

#[tauri::command]
pub(crate) fn get_commands(state: State<'_, AppState>) -> Vec<CommandInfo> //THE COMMANDS OUR ROLE MAY RUN
{
    let role = *state.role.lock().unwrap();

    command::COMMAND_LIST.iter()
        //THE TWO THE TUI PRINTS INTO ITS OWN PANE HAVE NOWHERE TO GO HERE - THE PALETTE IS THE HELP,
        //AND IT SAYS WHAT EVERY COMMAND AND EVERY PARAMETER OF ONE IS FOR WHILE IT IS BEING TYPED
        .filter(|info| !matches!(info.command, Command::Help | Command::Info))
        .filter(|info| info.available(role))
        .map(|info| CommandInfo
        {
            name: info.triggers[0].to_lowercase(),
            triggers: info.triggers.iter().map(|trigger| trigger.to_lowercase()).collect(),
            description: info.description.to_string(),
            args: command_args(info.args),
            subcommands: info.actions(role).map(|sub| SubcommandInfo
            {
                name: sub.triggers[0].to_lowercase(),
                triggers: sub.triggers.iter().map(|trigger| trigger.to_lowercase()).collect(),
                description: sub.description.to_string(),
                args: command_args(sub.args),
            }).collect(),
        })
        .collect()
}

//ONE ROW'S KIND, OR NOTHING WHEN THE KEY IS NOT ONE THE BOX OFFERS - A KEY ARRIVING FROM ANYWHERE ELSE
//IS NOT OURS TO WRITE, WHATEVER client.toml HAPPENS TO HOLD UNDER IT

#[tauri::command]
pub(crate) fn get_vocabulary(values: String) -> Vec<VocabularyValue>
{
    match values.as_str()
    {
        "colors" => offered_colors(),

        //THE ROLES ARE THE ONE VOCABULARY THAT IS ALSO A PROTOCOL VALUE - THE SERVER STORES THE POSITION IN
        //THIS LIST, SO OFFERING THE NAMES IS THE ONLY WAY THE TWO CANNOT DRIFT
        "roles" => Role::ALL.iter().map(|role| VocabularyValue { value: role.to_string(), color: None }).collect(),

        //THE CRATE'S OWN LIST AND NOT TAURI'S: THESE ARE THE NAMES /screen RESOLVES AGAINST, AND A WINDOW
        //MANAGER'S IDEA OF WHAT A MONITOR IS CALLED IS NOT ALWAYS THE CAPTURE BACKEND'S
        #[cfg(media)]
        "monitors" => screen_capture::monitor_names().into_iter()
            .map(|name| VocabularyValue { value: name, color: None })
            .collect(),

        _ => Vec::new(),
    }
}
