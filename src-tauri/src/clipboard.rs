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

use tauri::AppHandle;

use tauri_plugin_clipboard_manager::ClipboardExt;

//A LINE OF TEXT ONTO THE SYSTEM CLIPBOARD - WHAT A MESSAGE'S COPY BUTTON ASKS FOR. IT IS A COMMAND OF
//OURS AND NOT THE PLUGIN'S OWN IPC BECAUSE THE PLUGIN'S IS BEHIND THE ACL AND THIS IS NOT: A COMMAND IN
//generate_handler! IS REACHABLE THE MOMENT IT EXISTS, WHILE A PLUGIN COMMAND NEEDS ITS PERMISSION SPELLED
//OUT IN capabilities/default.json AND FAILS AT RUNTIME WHERE IT IS NOT. IT IS ALSO THE SAME PATH THE
//PICTURE HALF ALREADY TAKES (picture.rs::copy_image), WHICH IS THE ONE THAT IS KNOWN TO WORK ON EVERY
//DESKTOP THIS RUNS ON - TEXT IS THE HALF EVERY PLATFORM HAS, ANDROID INCLUDED.
//AN EMPTY ERROR IS TURNED INTO A SENTENCE HERE RATHER THAN AT THE WINDOW: A FAILURE NOBODY CAN READ IS
//A BUTTON THAT DOES NOTHING, WHICH IS THE ONE THING A COPY BUTTON MUST NEVER LOOK LIKE
#[tauri::command]
pub(crate) fn copy_text(text: String, app: AppHandle) -> Result<(), String>
{
    app.clipboard().write_text(text).map_err(|error|
    {
        let error = error.to_string();

        match error.is_empty()
        {
            true => String::from("The clipboard refused the text."),
            false => error,
        }
    })
}
