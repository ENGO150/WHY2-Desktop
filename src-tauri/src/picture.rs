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

use std::io::Cursor;

use tokio::task;

use tauri::AppHandle;

use base64::prelude::{ Engine, BASE64_STANDARD };

use image::
{
    DynamicImage,
    ImageFormat,
    codecs::jpeg::JpegEncoder,
};

use crate::types::{ MessageImage, PictureActions };

//CONSTS
const JPEG_QUALITY: u8 = 88; //WHAT A PHOTOGRAPH SURVIVES WITHOUT ANYBODY LOOKING FOR THE DIFFERENCE

//FUNCTIONS
//A CONTENT HASH AS THE PROTOCOL WRITES IT DOWN. IT IS THE HISTORY'S NAME FOR A PICTURE AND THE ONLY
//THING PacketCode::ImageData TAKES, SO IT TRAVELS TO THE WINDOW AND BACK AS TEXT
pub(crate) fn hex(bytes: &[u8; 32]) -> String
{
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub(crate) fn unhex(text: &str) -> Option<[u8; 32]>
{
    if text.len() != 64 { return None }

    let mut bytes = [0u8; 32];

    for (index, byte) in bytes.iter_mut().enumerate()
    {
        *byte = u8::from_str_radix(text.get(index * 2..index * 2 + 2)?, 16).ok()?;
    }

    Some(bytes)
}

//THE PICTURE AS THE WEBVIEW TAKES IT. THE CRATE DECODES WHAT ARRIVES AND HANDS OVER A DynamicImage
//RATHER THAN THE FILE IT CAME AS, SO THERE IS NOTHING TO FORWARD AND THE COPY IS ENCODED HERE: PNG WHERE
//THERE IS AN ALPHA CHANNEL TO KEEP, AND JPEG EVERYWHERE ELSE - A PHOTOGRAPH AS PNG IS SEVERAL TIMES THE
//BYTES OF ONE NOBODY CAN TELL APART, AND A PICTURE WITH A HOLE IN IT AS JPEG IS A BLACK RECTANGLE
fn write(image: &DynamicImage) -> Option<(&'static str, Vec<u8>)>
{
    let mut bytes = Cursor::new(Vec::new());

    match image.color().has_alpha()
    {
        true =>
        {
            image.write_to(&mut bytes, ImageFormat::Png).ok()?;

            Some(("image/png", bytes.into_inner()))
        },

        //THE ENCODER TAKES THREE CHANNELS AND NOTHING ELSE, SO ANYTHING ELSE IS CONVERTED RATHER THAN
        //REFUSED - A GREYSCALE PICTURE IS STILL A PICTURE
        false =>
        {
            let rgb = image.to_rgb8();

            JpegEncoder::new_with_quality(&mut bytes, JPEG_QUALITY)
                .encode(&rgb, rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8).ok()?;

            Some(("image/jpeg", bytes.into_inner()))
        },
    }
}

//ENCODING IS UNBROKEN CPU OVER THE WHOLE PICTURE - KEEP IT OFF THE RUNTIME, THE WAY EVERY HASH HERE IS.
//A PICTURE THAT WILL NOT ENCODE IS None, WHICH THE CALLER SAYS OUT LOUD RATHER THAN DROPPING QUIETLY
pub(crate) async fn encode(image: DynamicImage, filename: String, hash: Option<[u8; 32]>) -> Option<MessageImage>
{
    let width = image.width();
    let height = image.height();

    let encoded = task::spawn_blocking(move || write(&image)).await.ok()??;

    Some(MessageImage
    {
        filename,
        hash: hash.as_ref().map(hex),
        source: Some(format!("data:{};base64,{}", encoded.0, BASE64_STANDARD.encode(encoded.1))),
        pending: false,
        width,
        height,
    })
}

//WHAT A data: URL IS CARRYING. THE WINDOW HOLDS THE PICTURE AND THE DISK DOES NOT - WHAT IT WAS SENT IS
//THE COPY encode MADE, SO IT COMES BACK THE WAY IT WENT OUT AND IS UNWRAPPED HERE RATHER THAN BEING KEPT
//A SECOND TIME ON THIS SIDE FOR THE ONE PRESS IN A THOUSAND THAT ASKS TO KEEP IT
fn decode(source: &str) -> Option<(String, Vec<u8>)>
{
    let (head, payload) = source.strip_prefix("data:")?.split_once(',')?;
    let mime = head.strip_suffix(";base64")?;

    Some((mime.to_owned(), BASE64_STANDARD.decode(payload).ok()?))
}

//THE TWO THINGS ABOUT KEEPING A PICTURE THAT THE PLATFORM ANSWERS AND NOT THE PROTOCOL, ASKED ONCE AND
//BEFORE THE MENU IS DRAWN - THE WAY THE PALETTE ASKS get_commands WHETHER THIS BUILD HAS A CALL IN IT.
//A PHONE HAS NEITHER: ITS CLIPBOARD TAKES TEXT AND A URI AND NOT PIXELS, AND IT HAS NO FILE DIALOG TO
//ASK "WHERE" WITH - WHICH IS WHY A PICTURE THERE IS SAVED, TO THE ONE PLACE A PHONE KEEPS PICTURES
#[tauri::command]
pub(crate) fn picture_actions() -> PictureActions
{
    PictureActions
    {
        copy: cfg!(not(target_os = "android")),
        ask: cfg!(not(target_os = "android")),
    }
}

//THE PICTURE ONTO THE CLIPBOARD. IT GOES AS PIXELS AND NOT AS A FILE, WHICH IS WHAT EVERY OTHER PROGRAM
//EXPECTS TO FIND THERE - SO WHAT WAS ENCODED FOR THE WINDOW IS DECODED AGAIN, WHICH IS UNBROKEN CPU OVER
//THE WHOLE PICTURE AND THEREFORE spawn_blocking'S, LIKE EVERY OTHER PASS HERE
#[tauri::command]
pub(crate) async fn copy_image(source: String, app: AppHandle) -> Result<(), String>
{
    #[cfg(target_os = "android")]
    {
        let _ = (source, app);

        Err(String::from("This system has no picture clipboard."))
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_clipboard_manager::ClipboardExt;

        let Some((_, bytes)) = decode(&source) else { return Err(String::from("That is not a picture.")) };

        //THE DECODE IS UNBROKEN CPU OVER THE WHOLE PICTURE, AND THE WRITE IS A BLOCKING CALL INTO THE
        //SYSTEM'S OWN CLIPBOARD THAT DOES NOT COME BACK UNTIL IT HAS TAKEN THE PICTURE OVER - NEITHER
        //BELONGS ON A RUNTIME THREAD, SO BOTH GO TO THE BLOCKING POOL TOGETHER
        task::spawn_blocking(move ||
        {
            let Ok(image) = image::load_from_memory(&bytes) else
            {
                return Err(String::from("The picture could not be decoded."));
            };

            let rgba = image.to_rgba8();
            let (width, height) = (rgba.width(), rgba.height());

            app.clipboard().write_image(&tauri::image::Image::new_owned(rgba.into_raw(), width, height))
                .map_err(|error| error.to_string())
        }).await.map_err(|_| String::from("Copying the picture panicked."))?
    }
}

//AND ONTO THE DISK. THE TWO PLATFORMS ANSWER "WHERE" DIFFERENTLY AND NOTHING ELSE ABOUT IT DIFFERS: A
//DESKTOP HAS A FILE DIALOG, SO THE ANSWER IS THE PATH IT CAME BACK WITH, WHILE A PHONE HAS NO SUCH THING
//AND THE ANSWER IS THE GALLERY (SEE android.rs). WHAT COMES BACK IS WHERE IT LANDED, WHICH IS THE ONLY
//PART OF THIS THE USER HAS ANY WAY OF CHECKING
#[tauri::command]
pub(crate) async fn save_image(source: String, path: Option<String>, filename: String) -> Result<String, String>
{
    let Some((mime, bytes)) = decode(&source) else { return Err(String::from("That is not a picture.")) };

    #[cfg(not(target_os = "android"))]
    {
        let _ = (mime, filename);

        let Some(path) = path else { return Err(String::from("Nowhere to save it.")) };

        let written = path.clone();

        task::spawn_blocking(move || std::fs::write(&written, &bytes))
            .await.map_err(|_| String::from("Writing the picture panicked."))?
            .map_err(|error| error.to_string())?;

        Ok(path)
    }

    #[cfg(target_os = "android")]
    {
        let _ = path;

        //JNI ATTACHES WHATEVER THREAD IT IS CALLED ON, AND THE WRITE ITSELF IS THE WHOLE PICTURE THROUGH
        //A CONTENT RESOLVER - NEITHER BELONGS ON THE RUNTIME
        task::spawn_blocking(move || crate::android::save_picture(&filename, &mime, &bytes))
            .await.map_err(|_| String::from("Saving the picture panicked."))?
    }
}
