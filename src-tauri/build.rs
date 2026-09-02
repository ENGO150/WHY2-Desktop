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
    //THE CALL AND THE SCREEN SHARE ARE DESKTOP-ONLY, AND NOT BECAUSE NOBODY WANTED THEM ON A PHONE: THE
    //CRATE CAPTURES A SCREEN THROUGH xcap/libwayshot AND OPENS AUDIO THROUGH cpal'S PULSEAUDIO BACKEND,
    //NEITHER OF WHICH EXISTS ON ANDROID. THE FEATURES why2-chat IS PULLED IN WITH ARE SPLIT THE SAME WAY
    //IN Cargo.toml, SO THIS CFG AND THAT TARGET CONDITION ARE ONE ANSWER SPELLED TWICE - KEEP THEM EQUAL
    println!("cargo::rustc-check-cfg=cfg(media)");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("android")
    {
        println!("cargo::rustc-cfg=media");
    }

    tauri_build::build()
}
