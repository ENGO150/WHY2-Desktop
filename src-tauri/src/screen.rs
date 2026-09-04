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

use std::sync::atomic::Ordering;

#[cfg(screen)]
use tokio::sync::mpsc;

use tauri::{ State, ipc::{ Channel, InvokeResponseBody } };

#[cfg(screen)]
use tauri::{ Manager, AppHandle };

#[cfg(screen)]
use openh264::{ decoder::Decoder, formats::YUVSource };

#[cfg(screen)]
use jpeg_encoder::{ Encoder as JpegEncoder, ColorType, SamplingFactor };

use crate::state::AppState;

#[cfg(screen)]
use crate::types::*;

#[cfg(screen)]
use crate::emit::say;

#[cfg(screen)]
pub(crate) const JPEG_QUALITY: u8 = 88;

//AND HOW WIDE IT IS DRAWN AT. THE PANE IS A FRACTION OF THE SCREEN BEING SHARED, AND EVERY PIXEL PAST THIS
//IS PAID FOR THREE TIMES OVER - THE CONVERSION, THE ENCODE, AND THE TRIP ACROSS THE BRIDGE. TAKING A 4K
//SHARE DOWN BY HALF IS THE WHOLE DIFFERENCE BETWEEN A PICTURE AND A SLIDESHOW. ANYTHING UP TO A 1080p
//SCREEN IS SENT AS IT IS, BECAUSE THE PANE IS THE WHOLE WINDOW NOW AND HALVING THAT IS VISIBLE
#[cfg(screen)]
pub(crate) const JPEG_WIDTH: usize = 1920;

//LOGGING IN BRINGS Accept AND OUR OWN Join BACK TO BACK, AND A BURST OF JOINS ARRIVES THE SAME WAY.
//ONE ROSTER ANSWERS ALL OF THEM, SO THE FIRST REQUEST WAITS THIS LONG FOR THE REST TO CATCH UP

//I420 TO RGB, step PIXELS AT A TIME. THE BLOCK IS *AVERAGED* AND NOT SAMPLED: PICKING EVERY step-TH PIXEL
//IS THE ALIASING THE TUI NEVER SHOWS, BECAUSE IT HANDS THE PLANES TO THE GPU AND LETS A LINEAR SAMPLER
//SCALE THEM - AND FOR A WHOLE-NUMBER FACTOR, AVERAGING THE BLOCK IS THAT, DONE ON THE CPU. THE MATH IS THE
//USUAL BT.601 LIMITED-RANGE ONE, WHICH IS WHAT THE CAPTURE ENCODED WITH
#[cfg(screen)]
pub(crate) fn write_rgb(yuv: &openh264::decoder::DecodedYUV, step: usize, rgb: &mut Vec<u8>) -> (usize, usize)
{
    let (width, height) = yuv.dimensions();
    let (y_stride, u_stride, v_stride) = yuv.strides();

    let (out_width, out_height) = (width / step, height / step);

    rgb.clear();
    rgb.reserve(out_width * out_height * 3);

    let (luma, blue, red) = (yuv.y(), yuv.u(), yuv.v());

    //THE CHROMA PLANES ARE ALREADY HALF THE SIZE, SO THEY ARE AVERAGED OVER HALF THE BLOCK
    let chroma_step = (step / 2).max(1);

    let luma_pixels = (step * step) as u32;
    let chroma_pixels = (chroma_step * chroma_step) as u32;

    for row in 0..out_height
    {
        let line = row * step;
        let chroma_line = line / 2;

        for column in 0..out_width
        {
            let pixel = column * step;
            let chroma_pixel = pixel / 2;

            let mut y = 0u32;

            for down in 0..step
            {
                let start = (line + down) * y_stride + pixel;

                for right in 0..step { y += luma[start + right] as u32 }
            }

            let mut u = 0u32;
            let mut v = 0u32;

            for down in 0..chroma_step
            {
                let u_start = (chroma_line + down) * u_stride + chroma_pixel;
                let v_start = (chroma_line + down) * v_stride + chroma_pixel;

                for right in 0..chroma_step
                {
                    u += blue[u_start + right] as u32;
                    v += red[v_start + right] as u32;
                }
            }

            let y = (y / luma_pixels) as i32 - 16;
            let u = (u / chroma_pixels) as i32 - 128;
            let v = (v / chroma_pixels) as i32 - 128;

            let r = (298 * y + 409 * v + 128) >> 8;
            let g = (298 * y - 100 * u - 208 * v + 128) >> 8;
            let b = (298 * y + 516 * u + 128) >> 8;

            rgb.push(r.clamp(0, 255) as u8);
            rgb.push(g.clamp(0, 255) as u8);
            rgb.push(b.clamp(0, 255) as u8);
        }
    }

    (out_width, out_height)
}

//SOMEBODY ELSE'S SCREEN, ON ITS WAY TO THE PANE. THE FAST PATH HANDS THE H.264 STRAIGHT OVER AND THE
//WEBVIEW DECODES IT; WHERE THE WEBVIEW CANNOT (WebCodecs IS NOT EVERYWHERE, AND WHERE IT IS THE H.264
//DECODER BEHIND IT MAY NOT BE), THE FRAME IS DECODED HERE AND SENT ON AS A JPEG THE CANVAS CAN DRAW
#[cfg(screen)]
pub(crate) fn screen_frames(app: &AppHandle, mut frames: mpsc::UnboundedReceiver<Vec<u8>>)
{
    let mut decoder: Option<Decoder> = None;
    let mut rgb: Vec<u8> = Vec::new();
    let mut said = false; //A DECODER THAT WILL NOT START IS WORTH SAYING ONCE, NOT THIRTY TIMES A SECOND

    while let Some(frame) = frames.blocking_recv()
    {
        let state = app.state::<AppState>();

        //NOBODY IS WATCHING (OR THE PANE HAS NOT ASKED FOR THE FRAMES YET) - THIS ONE IS DROPPED RATHER
        //THAN QUEUED, SINCE A PICTURE NOBODY SEES IS WORTH NOTHING A SECOND LATER
        let Some(channel) = state.screen_channel.lock().unwrap().clone() else
        {
            //AND THE NEXT WATCHER STARTS FROM THEIR OWN KEYFRAME, NOT HALFWAY THROUGH SOMEBODY ELSE'S
            decoder = None;
            continue;
        };

        if !state.screen_decode.load(Ordering::Relaxed)
        {
            channel.send(InvokeResponseBody::Raw(frame)).ok();
            continue;
        }

        //WHATEVER ELSE HAS PILED UP WHILE THE LAST ONE WAS BEING DECODED COMES ALONG NOW: EVERY FRAME HAS
        //TO BE DECODED (H.264 IS PREDICTED, AND SKIPPING ONE BREAKS THE ONES AFTER IT), BUT ONLY THE
        //NEWEST IS WORTH THE RE-ENCODE - THE OLDER ONES ARE ALREADY WRONG BY THE TIME THEY WOULD BE DRAWN
        let mut pending = vec![frame];

        while let Ok(next) = frames.try_recv() { pending.push(next); }

        let decoder = match decoder
        {
            Some(ref mut decoder) => decoder,
            None => match Decoder::new()
            {
                Ok(new) => { said = false; decoder.insert(new) },

                Err(error) =>
                {
                    if !said { say(app, ChatMessage::error(format!("Cannot decode the screen share: {error}."))) }

                    said = true;
                    continue;
                },
            },
        };

        let newest = pending.len() - 1;

        for (index, packet) in pending.iter().enumerate()
        {
            let Ok(Some(yuv)) = decoder.decode(packet) else { continue };

            if index != newest { continue }

            //A SHARE IS WHATEVER SIZE SOMEBODY ELSE'S MONITOR IS, AND THE PANE IS NOT THAT SIZE
            let step = yuv.dimensions().0.div_ceil(JPEG_WIDTH).max(1);
            let (width, height) = write_rgb(&yuv, step, &mut rgb);

            let mut jpeg = Vec::with_capacity(rgb.len() / 8);
            let mut encoder = JpegEncoder::new(&mut jpeg, JPEG_QUALITY);

            //A SHARED SCREEN IS MOSTLY TEXT, AND TEXT IS EXACTLY WHERE HALF-RESOLUTION COLOR SHOWS: A RED
            //LETTER ON GREY GOES TO MUSH AT 4:2:0 AND STAYS A LETTER AT 4:4:4
            encoder.set_sampling_factor(SamplingFactor::R_4_4_4);

            if encoder.encode(&rgb, width as u16, height as u16, ColorType::Rgb).is_ok()
            {
                channel.send(InvokeResponseBody::Raw(jpeg)).ok();
            }
        }
    }
}

//THE PANE ASKS FOR THE PICTURE, AND HANDS OVER THE PIPE IT WANTS IT ON. A FRAME IS TENS OF KILOBYTES OF
//H.264 THIRTY TIMES A SECOND, WHICH IS NOTHING ON A BINARY CHANNEL AND HOPELESS AS A JSON ARRAY OF BYTES -
//decode IS THE PANE SAYING IT CANNOT DECODE H.264 ITSELF AND WANTS PICTURES INSTEAD OF A BITSTREAM
#[tauri::command]
pub(crate) fn watch_frames(channel: Channel<InvokeResponseBody>, decode: bool, state: State<'_, AppState>)
{
    state.screen_decode.store(decode, Ordering::Relaxed);

    *state.screen_channel.lock().unwrap() = Some(channel);
}

//AND SAYS SO WHEN IT HAS STOPPED LOOKING - THE FRAMES ARE DROPPED FROM THEN ON RATHER THAN QUEUED
#[tauri::command]
pub(crate) fn drop_frames(state: State<'_, AppState>)
{
    state.screen_channel.lock().unwrap().take();
}
