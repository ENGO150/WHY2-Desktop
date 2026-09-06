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

//THE ONE WAY OUT. EVERY CLOSE IS A HIDE, SO THE ONLY THING LEFT THAT CAN END THE PROGRAM IS THE MENU
//ITEM THAT SAYS SO - AND exit() TAKES THE WINDOW WITH IT, WHICH ARRIVES HERE AS ONE LAST CloseRequested
//THAT MUST NOT BE PREVENTED
static QUITTING: AtomicBool = AtomicBool::new(false);

//THE MENU IS TWO ITEMS, BECAUSE THERE ARE TWO THINGS TO DO WITH A PROGRAM THAT IS NOT ON SCREEN: LOOK AT
//IT, OR STOP IT. A LEFT CLICK IS THE FIRST OF THEM WITHOUT THE MENU - EXCEPT ON LINUX, WHERE THE
//INDICATOR REPORTS NO CLICKS AT ALL AND THE MENU IS THE WHOLE OF THE INTERFACE, WHICH IS WHY `Open` IS
//AN ITEM IN IT RATHER THAN SOMETHING ONLY A CLICK COULD REACH
pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()>
{
    let open = MenuItem::with_id(app, "open", "Open WHY2", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "quit", "Quit WHY2", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &stop])?;

    let mut tray = TrayIconBuilder::with_id("why2")
        .tooltip("WHY2")
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
