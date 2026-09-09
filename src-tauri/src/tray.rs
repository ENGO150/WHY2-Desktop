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

//THE PROGRAM OUTLIVES ITS WINDOW. A CHAT CLIENT IS SOMETHING THAT IS RUNNING RATHER THAN SOMETHING THAT
//IS OPEN - THE SESSION, THE CALL AND THE SHARE ARE ALL STILL GOING WHEN NOBODY IS LOOKING AT THE GLASS -
//SO CLOSING THE WINDOW PUTS IT AWAY AND THE TRAY IS WHERE IT WENT. THIS IS A DESKTOP FILE: A PHONE HAS
//NO TRAY, AND IT ANSWERS THE SAME QUESTION ITS OWN WAY ALREADY, WITH A FOREGROUND SERVICE (SEE android.rs)

use std::sync::atomic::{ AtomicBool, Ordering };

use tauri::
{
    AppHandle,
    Manager,
    Runtime,
    Window,
    WindowEvent,
    menu::{ Menu, MenuItem },
    tray::{ MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent },
};

//THE KEYBOARD'S OWN WAY OUT, WHICH IS GTK'S AND NOT TAURI'S - SEE accelerator()
#[cfg(target_os = "linux")]
use gtk::prelude::*;

//THE ONE WAY OUT. EVERY CLOSE IS A HIDE, SO THE ONLY THING LEFT THAT CAN END THE PROGRAM IS THE MENU
//ITEM THAT SAYS SO - AND exit() TAKES THE WINDOW WITH IT, WHICH ARRIVES HERE AS ONE LAST CloseRequested
//THAT MUST NOT BE PREVENTED
static QUITTING: AtomicBool = AtomicBool::new(false);

//WHAT THE ICON SAYS IT IS WHEN SOMEBODY POINTS AT IT. IT IS THE PROJECT'S NAME AND NOT THE PRODUCT'S,
//BECAUSE A TRAY IS A DESKTOP'S AND THE BAR IT SITS IN IS FULL OF OTHER PROGRAMS - `WHY2` ALONE BESIDE
//THEM READS AS A FRAGMENT, WHILE THE WINDOW AND THE LAUNCHER, WHICH HAVE A MARK BESIDE THEM AND A PHONE
//TO WORRY ABOUT, KEEP THE PRODUCT NAME
const NAME: &str = "WHY2 Desktop";

//THE MENU IS TWO ITEMS, BECAUSE THERE ARE TWO THINGS TO DO WITH A PROGRAM THAT IS NOT ON SCREEN: LOOK AT
//IT, OR STOP IT. A LEFT CLICK IS THE FIRST OF THEM WITHOUT THE MENU - EXCEPT ON LINUX, WHERE THE
//INDICATOR REPORTS NO CLICKS AT ALL AND THE MENU IS THE WHOLE OF THE INTERFACE, WHICH IS WHY `Open` IS
//AN ITEM IN IT RATHER THAN SOMETHING ONLY A CLICK COULD REACH
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()>
{
    //WHAT THE BAR CALLS IT, WHICH ON LINUX IS NOT THE TOOLTIP BELOW: AN APPINDICATOR HAS NO TOOLTIP AT
    //ALL (tray-icon'S set_tooltip IS AN EMPTY FUNCTION THERE), AND WHAT A SHELL SHOWS ON HOVER IS THE
    //ITEM'S TITLE - WHICH libayatana TAKES FROM GLib'S APPLICATION NAME. NOBODY SETS THAT, SO IT FALLS
    //BACK TO THE PROGRAM NAME AND THE HOVER READS `why2-desktop`: THE FILE ON THE DISK, WHICH IS NAMED
    //THAT TO STAY OUT OF THE WAY OF THE TERMINAL CLIENT'S OWN why2 AND IS NOT WHAT THE PROGRAM IS CALLED
    #[cfg(target_os = "linux")]
    glib::set_application_name(NAME);

    let open = MenuItem::with_id(app, "open", "Open WHY2", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "quit", "Quit WHY2", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &stop])?;

    let mut tray = TrayIconBuilder::with_id("why2")
        .tooltip(NAME)
        .menu(&menu)

        //THE LEFT BUTTON OPENS THE WINDOW AND THE RIGHT ONE OPENS THE MENU, WHICH IS WHAT EVERY OTHER
        //TRAY ICON ON THE MACHINE DOES
        .show_menu_on_left_click(false)

        .on_menu_event(|app, event|
        {
            match event.id.as_ref()
            {
                "open" => show(app),
                "quit" => quit(app),

                _ => {}
            }
        })

        .on_tray_icon_event(|tray, event|
        {
            //THE PRESS IS ANSWERED ON THE WAY UP, THE WAY A BUTTON IS
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event
            {
                show(tray.app_handle());
            }
        });

    //THE MARK THE BUNDLE ALREADY CARRIES, RATHER THAN A SECOND COPY OF IT BESIDE THE FIRST
    if let Some(icon) = app.default_window_icon()
    {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    Ok(())
}

//AND THE OTHER WAY OUT, WHICH IS THE ONE A DESKTOP ALREADY HAS A KEY FOR. A WINDOW MANAGER'S CLOSE
//(Super+Q ON HYPRLAND, ALT+F4 ELSEWHERE) IS THE SAME CloseRequested THE X IS, SO IT PUTS THE PROGRAM IN
//THE TRAY - AND THE KEY FOR ENDING SOMETHING THAT GOES ON RUNNING BEHIND ITS WINDOW IS Ctrl+Q, WHICH
//EVERY OTHER PROGRAM ON A LINUX DESKTOP ANSWERS. IT IS THE APPLICATION'S SHORTCUT AND NOT THE
//COMPOSITOR'S, SO NOTHING SENDS IT TO US: A PROGRAM THAT DOES NOT CLAIM IT DOES NOTHING WHEN IT IS
//PRESSED, WHICH IS EXACTLY WHAT THIS WINDOW DID.
//
//IT IS CLAIMED WHERE EVERY GTK PROGRAM CLAIMS ONE - AN ACCEL GROUP ON THE WINDOW ITSELF - AND NOT BY
//WATCHING FOR THE KEYSTROKE IN THE PAGE: GTK ANSWERS ACCELERATORS IN gtk_window_key_press_event BEFORE
//IT HANDS THE KEY TO WHATEVER HAS THE FOCUS, SO THE PRESS IS THE TOOLKIT'S TO ACT ON WHEREVER IT LANDS,
//THE WEBVIEW INCLUDED, AND NOTHING IN THE WEBVIEW HAS TO BE LISTENING FOR IT.
//
//IT IS **NOT** A HIDDEN MENU WITH AN ACCELERATOR ON IT, WHICH IS THE OTHER WAY AND IS TAURI'S OWN:
//set_menu ON THIS WINDOW PACKS A GtkMenuBar INTO THE BOX THE WEBVIEW IS ALREADY IN AND RECURSES ITSELF
//TO DEATH INSIDE GTK - THE WINDOW IS UNDECORATED AND HAS NO MENU BAR IN IT BY DESIGN (SEE **The
//window**), AND THIS WAY THERE IS NO BAR TO HIDE IN THE FIRST PLACE.
//
//LINUX ALONE, BECAUSE THE CONVENTION IS: MACOS HAS Cmd+Q IN THE APPLICATION MENU IT ALREADY CARRIES,
//AND WINDOWS ENDS A PROGRAM WITH Alt+F4 - WHICH IS A CLOSE, AND A CLOSE HERE IS THE TRAY
#[cfg(target_os = "linux")]
pub fn accelerator<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()>
{
    let Some(window) = app.get_webview_window("main") else { return Ok(()); };

    //THE SAME SPELLING A .ui FILE WOULD USE, PARSED BY GTK RATHER THAN A KEYVAL WRITTEN OUT HERE - A
    //KEY OF 0 IS GTK SAYING IT DID NOT UNDERSTAND IT, WHICH IS NOT WORTH A GROUP ON THE WINDOW
    let (key, mods) = gtk::accelerator_parse("<Control>q");

    if key == 0 { return Ok(()); }

    let group = gtk::AccelGroup::new();
    let handle = app.clone();

    //true IS "THIS PRESS WAS MINE", WHICH IS WHAT KEEPS IT FROM GOING ON TO THE PAGE AS WELL
    group.connect_accel_group(key, mods, gtk::AccelFlags::VISIBLE, move |_, _, _, _|
    {
        quit(&handle);

        true
    });

    //THE WINDOW TAKES A REFERENCE OF ITS OWN, SO THE GROUP OUTLIVES THIS FUNCTION
    window.gtk_window()?.add_accel_group(&group);

    Ok(())
}

//A CLOSE IS A HIDE. THE X IN OUR OWN TITLE BAR, THE MAC'S RED LIGHT AND THE WINDOW MANAGER'S OWN
//SHORTCUT ALL ARRIVE HERE AS THE SAME EVENT, SO THERE IS ONE ANSWER TO IT AND NOT THREE
pub fn window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent)
{
    if let WindowEvent::CloseRequested { api, .. } = event
    {
        if QUITTING.load(Ordering::SeqCst) { return; }

        api.prevent_close();

        let _ = window.hide();
    }
}

//BACK ON SCREEN, FROM WHEREVER IT WAS PUT: HIDDEN IS NOT MINIMIZED, AND A WINDOW THAT IS BOTH NEEDS BOTH
//TAKING BACK BEFORE THE FOCUS MEANS ANYTHING
fn show<R: Runtime>(app: &AppHandle<R>)
{
    if let Some(window) = app.get_webview_window("main")
    {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit<R: Runtime>(app: &AppHandle<R>)
{
    QUITTING.store(true, Ordering::SeqCst);

    app.exit(0);
}
