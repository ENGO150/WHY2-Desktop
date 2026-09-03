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

fn main()
{
    //THE CALL AND THE SCREEN SHARE ARE TWO ANSWERS AND NOT ONE, BECAUSE ANDROID HAS THE FIRST AND NOT THE
    //SECOND: cpal REACHES A PHONE'S DEVICES THROUGH AAudio AND libopus CROSS-COMPILES (SEE
    //scripts/opus-android.sh), WHILE THE CAPTURE IS xcap/libwayshot AND THE VIEWER winit/wgpu, NEITHER OF
    //WHICH EXISTS THERE - A PHONE SHARES ITS SCREEN THROUGH MediaProjection INSTEAD.
    //THE FEATURES why2-chat IS PULLED IN WITH ARE SPLIT THE SAME WAY IN Cargo.toml, SO THESE TWO CFGS AND
    //THOSE TWO TARGET SECTIONS ARE ONE ANSWER SPELLED TWICE - KEEP THEM EQUAL
    println!("cargo::rustc-check-cfg=cfg(voice)");
    println!("cargo::rustc-check-cfg=cfg(screen)");

    println!("cargo::rustc-cfg=voice");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("android")
    {
        println!("cargo::rustc-cfg=screen");
    }
    else
    {
        activity_class();
    }

    tauri_build::build()
}

//WHAT android.rs LOOKS THE TWO KOTLIN CLASSES UP BY: THE IDENTIFIER WITH ITS DASHES AS UNDERSCORES,
//WHICH IS THE PACKAGE TAURI GENERATES THEM INTO. THEY ARE BINARY NAMES AND KEEP THEIR DOTS, SINCE THE
//LOOKUP GOES THROUGH ClassLoader.loadClass AND NOT FindClass - AND A NAME THAT IS WRONG IS NOT A BUILD
//ERROR BUT A CALL THAT SILENTLY NEVER ASKS FOR THE MICROPHONE, SO IT IS READ FROM THE CONFIG RATHER
//THAN WRITTEN DOWN TWICE
fn activity_class()
{
    const CONFIG: &str = "tauri.conf.json";

    println!("cargo::rerun-if-changed={CONFIG}");

    let config = std::fs::read_to_string(CONFIG).expect("tauri.conf.json is not readable");

    //ONE KEY OUT OF ONE FILE IS NOT WORTH A JSON PARSER IN THE BUILD DEPENDENCIES
    let identifier = config.split("\"identifier\"").nth(1)
        .and_then(|rest| rest.split_once(':'))
        .and_then(|(_, rest)| rest.split('"').nth(1))
        .expect("tauri.conf.json has no identifier");

    let package = identifier.replace('-', "_");

    println!("cargo::rustc-env=ANDROID_ACTIVITY_CLASS={package}.MainActivity");
    println!("cargo::rustc-env=ANDROID_SERVICE_CLASS={package}.SessionService");
}
