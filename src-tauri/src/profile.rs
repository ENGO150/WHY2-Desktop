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

use std::
{
    io::Read,
    path::PathBuf,
    time::Duration,
    sync::atomic::Ordering,
};

use tokio::{ task, time };

use sha2::{ Sha256, Digest };

use tauri::{ AppHandle, Manager, State, async_runtime };

use why2_chat::
{
    misc,
    consts,
    network::
    {
        client::{ self, image as client_image },
        codes::{ PacketCode, UserProfile },
    },
};

use crate::tr;
use crate::types::ProfileInfo;
use crate::state::AppState;
use crate::net::send_packet;
use crate::input::open_upload;

//SPACING OF THE QUIET PROFILE REQUESTS
const PROFILE_GAP: Duration = Duration::from_millis(150);

//ASK FOR PROFILES WITHOUT OPENING THEM
#[tauri::command]
pub(crate) fn request_profiles(usernames: Vec<String>, first: bool, app: AppHandle, state: State<'_, AppState>)
{
    if state.profiles_off.load(Ordering::Relaxed) { return }

    {
        let mut queue = state.profile_queue.lock().unwrap();

        for username in usernames
        {
            if username.is_empty() { continue }

            //A CLICK JUMPS THE QUEUE
            if first
            {
                queue.retain(|queued| *queued != username);
                queue.push_front(username);
            }
            else if !queue.contains(&username) { queue.push_back(username); }
        }
    }

    if state.profiles_pumping.swap(true, Ordering::Relaxed) { return }

    let session = state.session.load(Ordering::Relaxed);

    async_runtime::spawn(async move
    {
        let state = app.state::<AppState>();

        loop
        {
            if state.session.load(Ordering::Relaxed) != session { break }

            let Some(username) = state.profile_queue.lock().unwrap().pop_front() else { break };

            let Some(write_stream) = state.write_stream.lock().await.clone() else { break };

            state.profile_quiet.lock().unwrap().push(username.clone());

            send_packet(&state, &write_stream, PacketCode::ProfileRequest { target: Some(username) }).await;

            time::sleep(PROFILE_GAP).await;
        }

        state.profiles_pumping.store(false, Ordering::Relaxed);
    });
}

//WRITE OUR OWN PROFILE - THE PICTURE GOES BY set_avatar
#[tauri::command]
pub(crate) async fn save_profile(profile: ProfileInfo, state: State<'_, AppState>) -> Result<(), String>
{
    let website = profile.website.trim();

    //REFUSED HERE, NOT AFTER THE SERVER SAW IT
    if !website.is_empty() && !misc::is_web_url(website)
    {
        return Err(tr!("profile.bad_website"));
    }

    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(tr!("bridge.not_connected")) };

    send_packet(&state, &write_stream, PacketCode::ProfileSave
    {
        profile: UserProfile
        {
            bio: profile.bio,
            pronouns: profile.pronouns,
            website: website.to_string(),
            status: profile.status,
            ..UserProfile::default()
        },
    }).await;

    Ok(())
}

//CUT A PICTURE TO ITS SQUARE AND PARK IT FOR THE UPLOAD (tui/../client/mod.rs::cut_avatar)
pub(crate) async fn cut_square(app: &AppHandle, path: &str) -> Result<([u8; 32], PathBuf), String>
{
    let (mut file, _) = open_upload(app, path, true).await?;

    //BLOCKING I/O + CPU
    let (hash, cut) = task::spawn_blocking(move ||
    {
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(|_| tr!("upload.read_failed"))?;

        let (avatar, extension) = client_image::make_avatar(&data).ok_or_else(|| tr!("upload.unreadable_image"))?;

        if avatar.len() > consts::MAX_AVATAR_SIZE
        {
            return Err(tr!("upload.avatar_too_large", limit = consts::MAX_AVATAR_SIZE / consts::MEGABYTE));
        }

        let hash: [u8; 32] = Sha256::digest(&avatar).into();
        let cut = misc::avatar_temp(&hash, extension);

        std::fs::write(&cut, &avatar).map_err(|_| tr!("upload.avatar_write_failed"))?;

        Ok((hash, cut))
    }).await.map_err(|_| tr!("upload.read_failed"))??;

    //THE UPLOAD TASK LOOKS THE PATH UP BY HASH
    client::ACTIVE_UPLOADS.lock().unwrap().insert(hash, cut.clone());

    Ok((hash, cut))
}

//SET OUR PICTURE, OR DROP IT (tui/../client/mod.rs::upload WITH Upload::Avatar)
#[tauri::command]
pub(crate) async fn set_avatar(path: Option<String>, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(write_stream) = state.write_stream.lock().await.clone() else { return Err(tr!("bridge.not_connected")) };

    let hash = match path
    {
        Some(path) => Some(cut_square(&app, &path).await?.0),
        None => None,
    };

    send_packet(&state, &write_stream, PacketCode::AvatarRequest { hash }).await;

    Ok(())
}
