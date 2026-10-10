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

//NO RECORDER AND NO PLAYER IN THIS BUILD
#[tauri::command]
pub(crate) async fn voice_waveform(hash: String) -> Result<(), String>
{
    let _ = hash;

    Ok(())
}

#[tauri::command]
pub(crate) async fn play_voice(hash: Option<String>) -> Result<(), String>
{
    let _ = hash;

    Ok(())
}

#[tauri::command]
pub(crate) fn discard_recording() {}
