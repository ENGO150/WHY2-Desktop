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

use base64::prelude::{ Engine, BASE64_STANDARD };

use image::
{
    DynamicImage,
    ImageFormat,
    codecs::jpeg::JpegEncoder,
};

use crate::types::MessageImage;

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
        width,
        height,
    })
}
