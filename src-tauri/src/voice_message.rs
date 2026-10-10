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
    time::Duration,
    collections::{ HashMap, HashSet },
    sync::
    {
        Arc,
        Mutex,
        LazyLock,
        atomic::{ AtomicBool, AtomicUsize, Ordering },
    },
};

use tokio::
{
    task,
    net::tcp::OwnedWriteHalf,
    sync::{ Mutex as MutexAsync, mpsc::Sender },
};

use sha2::{ Sha256, Digest };

use tauri::{ async_runtime, AppHandle, Manager, State };

use audiopus::{ Channels, SampleRate, coder::Decoder };

use why2_chat::
{
    misc,
    cache,
    network::
    {
        client::{ self, ClientEvent },
        codes::PacketCode,
        voice::
        {
            consts as voice_consts,
            message::Clip,
            client::message as recorder,
        },
    },
};

use crate::tr;
use crate::types::*;
use crate::state::*;
use crate::emit::*;
use crate::net::{ send_packet, request_picture };
use crate::picture::{ hex, unhex };

//CONSTS
const POINTS: usize = 256;                         //WAVEFORM RESOLUTION
const TICK: Duration = Duration::from_millis(100); //PLAYER AND RECORDER POLL

//STRUCTS
struct Playing //THE CLIP WE ASKED FOR
{
    hash: [u8; 32],
    started: bool,
    ms: u32,
    offset: u32, //WHERE IN THE CLIP IT STARTS
}

//GLOBAL VARIABLES
static PLAYING: Mutex<Option<Playing>> = Mutex::new(None);
static GENERATION: AtomicUsize = AtomicUsize::new(0); //THE CRATE'S PLAY_GENERATION, COUNTED ALONG
static PLAY_WATCH: AtomicBool = AtomicBool::new(false);
static RECORD_WATCH: AtomicBool = AtomicBool::new(false);
static WAVEFORMS: LazyLock<Mutex<HashMap<[u8; 32], Vec<u8>>>> = LazyLock::new(|| Mutex::new(HashMap::new())); //BY CLIP
static WANTED: LazyLock<Mutex<HashSet<[u8; 32]>>> = LazyLock::new(|| Mutex::new(HashSet::new()));             //FETCHED FOR A WAVEFORM

//PRIVATE
fn start(hash: [u8; 32], events: Sender<ClientEvent>) //PLAY FROM THE TOP
{
    GENERATION.fetch_add(1, Ordering::Relaxed);
    recorder::play(hash, events);
}

fn halt() -> usize //STOP, AND THE NEW GENERATION
{
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    recorder::stop();

    generation
}

fn peaks(data: &[u8]) -> Option<Vec<u8>> //LEVELS, 0-255
{
    let clip = Clip::decode(data)?;
    let channels = clip.channels as usize;

    let layout = if channels == 1 { Channels::Mono } else { Channels::Stereo };
    let mut decoder = Decoder::new(SampleRate::Hz48000, layout).ok()?;
    let mut buffer = vec![0f32; voice_consts::FRAME_SIZE * channels];

    //RMS PER FRAME
    let levels: Vec<f32> = clip.frames.iter().map(|packet|
    {
        let decoded = decoder.decode_float(Some(&packet[..]), &mut buffer[..], false).unwrap_or(0) * channels;
        let power = buffer[..decoded].iter().map(|sample| sample * sample).sum::<f32>() / decoded.max(1) as f32;

        power.sqrt()
    }).collect();

    //LOUDEST FRAME PER POINT
    let total = levels.len();
    let bars: Vec<f32> = (0..POINTS).map(|point|
    {
        let start = (point * total / POINTS).min(total - 1);
        let end = ((point + 1) * total / POINTS).clamp(start + 1, total);

        levels[start..end].iter().copied().fold(0., f32::max)
    }).collect();

    let loudest = bars.iter().copied().fold(0., f32::max);

    if loudest < 1e-4 { return Some(vec![0; POINTS]); }

    Some(bars.iter().map(|level| ((level / loudest).sqrt() * 255.).round() as u8).collect())
}

pub(crate) async fn shape(app: &AppHandle, hash: [u8; 32]) -> Option<bool> //SEND A CACHED CLIP'S WAVEFORM (None = NOT CACHED)
{
    let known = WAVEFORMS.lock().unwrap().get(&hash).cloned();

    let waveform = match known
    {
        Some(waveform) => Some(waveform),

        None =>
        {
            let data = cache::load(&hash).await?;
            let waveform = task::spawn_blocking(move || peaks(&data)).await.ok().flatten();

            if let Some(waveform) = &waveform { WAVEFORMS.lock().unwrap().insert(hash, waveform.clone()); }

            waveform
        },
    };

    let found = waveform.is_some();

    emit(app, UiEvent::VoiceWaveform { hash: hex(&hash), waveform });

    Some(found)
}

fn emit_playback(app: &AppHandle, hash: Option<[u8; 32]>, ms: u32, loading: bool)
{
    emit(app, UiEvent::Playback { hash: hash.as_ref().map(hex), ms, loading });
}

fn step_playback(app: &AppHandle) -> bool //FOLLOW THE PLAYER ONE TICK (false = NOTHING LEFT)
{
    let mut guard = PLAYING.lock().unwrap();
    let Some(playing) = guard.as_mut() else { return false };

    //READ UNDER THE LOCK A SEEK TAKES
    match recorder::playing()
    {
        Some((hash, ms)) if hash == playing.hash =>
        {
            let ms = playing.offset + ms;
            let first = !playing.started;
            let moved = first || ms != playing.ms;

            playing.started = true;
            playing.ms = ms;

            drop(guard);

            if moved { emit_playback(app, Some(hash), ms, false); }

            //IN THE CACHE NOW
            if first
            {
                let app = app.clone();
                async_runtime::spawn(async move { shape(&app, hash).await; });
            }
        },

        //FINISHED
        _ if playing.started =>
        {
            guard.take();
            drop(guard);

            emit_playback(app, None, 0, false);
        },

        //STILL LOADING
        _ => {},
    }

    true
}

fn watch_playback(app: AppHandle) //POLL THE PLAYER WHILE THERE IS ONE
{
    if PLAY_WATCH.swap(true, Ordering::Relaxed) { return }

    async_runtime::spawn(async move
    {
        loop
        {
            tokio::time::sleep(TICK).await;

            if step_playback(&app) { continue }

            PLAY_WATCH.store(false, Ordering::Relaxed);

            //A PLAY THAT CAME IN MEANWHILE
            if PLAYING.lock().unwrap().is_none() || PLAY_WATCH.swap(true, Ordering::Relaxed) { return }
        }
    });
}

fn start_recording(app: &AppHandle, state: &AppState)
{
    let Some(events) = state.events.lock().unwrap().clone() else { return };

    if !recorder::start_recording(events) { return popup(app, tr!("voice_message.busy")) }

    emit(app, UiEvent::Recording { ms: Some(0) });

    watch_recording(app.clone());
}

async fn finish_recording(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>)
{
    emit(app, UiEvent::Recording { ms: None });

    match recorder::finish_recording()
    {
        Some(clip) => send_clip(app, state, write_stream, clip).await,
        None => popup(app, tr!("voice_message.too_short")),
    }
}

async fn send_clip(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>, clip: Vec<u8>)
{
    let hash: [u8; 32] = Sha256::digest(&clip).into();
    let path = misc::voice_temp(&hash);

    let written =
    {
        let path = path.clone();
        task::spawn_blocking(move || std::fs::write(path, clip)).await.is_ok_and(|result| result.is_ok())
    };

    if !written { return popup(app, tr!("upload.read_failed")) }

    //THE UPLOAD TASK FINDS IT BY HASH
    client::ACTIVE_UPLOADS.lock().unwrap().insert(hash, path);

    send_packet(state, write_stream, PacketCode::VoiceMessageRequest { hash }).await;
}

fn watch_recording(app: AppHandle) //POLL THE RECORDER WHILE IT RUNS
{
    if RECORD_WATCH.swap(true, Ordering::Relaxed) { return }

    async_runtime::spawn(async move
    {
        let mut shown = 0;

        loop
        {
            tokio::time::sleep(TICK).await;

            match recorder::recording()
            {
                Some((ms, false)) =>
                {
                    if ms / 1000 != shown
                    {
                        shown = ms / 1000;
                        emit(&app, UiEvent::Recording { ms: Some(ms) });
                    }

                    continue;
                },

                //OUT OF ROOM, OR THE CALL IT TAPPED ENDED
                Some((_, true)) =>
                {
                    popup(&app, tr!("voice_message.full"));

                    let state = app.state::<AppState>();
                    let write_stream = state.write_stream.lock().await.clone();

                    match write_stream
                    {
                        Some(write_stream) => finish_recording(&app, &state, &write_stream).await,
                        None => recorder::cancel_recording(),
                    }
                },

                //ENDED, OR GAVE UP
                None => emit(&app, UiEvent::Recording { ms: None }),
            }

            RECORD_WATCH.store(false, Ordering::Relaxed);

            //A RECORDING THAT STARTED MEANWHILE
            if recorder::recording().is_none() || RECORD_WATCH.swap(true, Ordering::Relaxed) { return }

            shown = 0;
        }
    });
}

//PUBLIC
pub(crate) async fn fetched(app: &AppHandle, hash: [u8; 32]) -> bool //ImageData FOR A WAVEFORM
{
    if !WANTED.lock().unwrap().remove(&hash) { return false }

    if shape(app, hash).await.is_none() { emit(app, UiEvent::VoiceWaveform { hash: hex(&hash), waveform: None }); }

    true
}

pub(crate) fn delivered(app: &AppHandle, hash: [u8; 32], valid: bool) //A CLIP ASKED FOR TO PLAY
{
    WANTED.lock().unwrap().remove(&hash);

    if valid { return }

    //THE SERVER HAS IT NO MORE
    emit(app, UiEvent::VoiceWaveform { hash: hex(&hash), waveform: None });
    failed(app);
}

pub(crate) fn failed(app: &AppHandle) //A PLAY THAT NEVER STARTED
{
    let mut guard = PLAYING.lock().unwrap();

    if guard.as_ref().is_some_and(|playing| !playing.started)
    {
        guard.take();
        drop(guard);

        emit_playback(app, None, 0, false);
    }
}

pub(crate) fn stop(app: &AppHandle) //STOP PLAYBACK
{
    let playing =
    {
        let mut guard = PLAYING.lock().unwrap();
        halt();

        guard.take()
    };

    if playing.is_some() { emit_playback(app, None, 0, false); }
}

pub(crate) async fn record(app: &AppHandle, state: &AppState, write_stream: &Arc<MutexAsync<OwnedWriteHalf>>) //START OR SEND
{
    match recorder::recording()
    {
        Some(_) => finish_recording(app, state, write_stream).await,
        None => start_recording(app, state),
    }
}

#[cfg(target_os = "android")]
pub(crate) fn recording() -> bool //A RECORDING IS RUNNING
{
    recorder::recording().is_some()
}

pub(crate) fn reset() //THE SESSION ENDED
{
    recorder::cancel_recording();
    halt();

    PLAYING.lock().unwrap().take();
    WANTED.lock().unwrap().clear();
}

//COMMANDS
#[tauri::command]
pub(crate) async fn voice_waveform(hash: String, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(hash) = unhex(&hash) else { return Err(tr!("bridge.invalid_image")) };

    if shape(&app, hash).await.is_some() { return Ok(()) }

    if state.write_stream.lock().await.is_none() { return Err(tr!("bridge.not_connected")) }

    //ASKED FOR LIKE A PICTURE
    WANTED.lock().unwrap().insert(hash);
    request_picture(&state, hash).await;

    Ok(())
}

#[tauri::command]
pub(crate) async fn play_voice(hash: Option<String>, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(hash) = hash else
    {
        stop(&app);
        return Ok(());
    };

    let Some(hash) = unhex(&hash) else { return Err(tr!("bridge.invalid_image")) };
    let Some(events) = state.events.lock().unwrap().clone() else { return Err(tr!("bridge.not_connected")) };

    play_from_top(&app, hash, events);

    Ok(())
}

fn play_from_top(app: &AppHandle, hash: [u8; 32], events: Sender<ClientEvent>)
{
    {
        let mut guard = PLAYING.lock().unwrap();

        //ALREADY ON ITS WAY
        if guard.as_ref().is_some_and(|playing| playing.hash == hash && !playing.started) { return }

        *guard = Some(Playing { hash, started: false, ms: 0, offset: 0 });
        start(hash, events);
    }

    emit_playback(app, Some(hash), 0, true);
    watch_playback(app.clone());
}

//PLAY FROM ms IN: THE CRATE'S PLAYER, HANDED THE CLIP FROM THAT FRAME ON
#[tauri::command]
pub(crate) async fn seek_voice(hash: String, ms: u32, app: AppHandle, state: State<'_, AppState>) -> Result<(), String>
{
    let Some(hash) = unhex(&hash) else { return Err(tr!("bridge.invalid_image")) };
    let Some(events) = state.events.lock().unwrap().clone() else { return Err(tr!("bridge.not_connected")) };

    //NOT CACHED, SO FETCHED AND PLAYED FROM THE TOP
    let Some(data) = cache::load(&hash).await else
    {
        play_from_top(&app, hash, events);
        return Ok(());
    };

    let Some(mut clip) = Clip::decode(&data) else { return Err(tr!("voice_message.unreadable")) };

    let first = ((ms / voice_consts::FRAME_MS) as usize).min(clip.frames.len() - 1);
    let offset = first as u32 * voice_consts::FRAME_MS;
    let trimmed = Clip { channels: clip.channels, frames: clip.frames.split_off(first) }.encode();

    let generation =
    {
        let mut guard = PLAYING.lock().unwrap();

        *guard = Some(Playing { hash, started: false, ms: offset, offset });
        halt()
    };

    emit_playback(&app, Some(hash), offset, true);
    watch_playback(app);

    async_runtime::spawn(recorder::play_data(hash, trimmed, generation, events));

    Ok(())
}

#[tauri::command]
pub(crate) fn discard_recording(app: AppHandle)
{
    if recorder::recording().is_none() { return }

    recorder::cancel_recording();

    emit(&app, UiEvent::Recording { ms: None });
    popup(&app, tr!("voice_message.discarded"));
}
