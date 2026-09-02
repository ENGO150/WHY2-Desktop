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

//THE TWO THINGS A CALL NEEDS FROM THE PLATFORM ITSELF, AND THE ONLY PLACE IN THIS APP THAT SPEAKS JNI.
//THE DESKTOP HAS NEITHER PROBLEM: A DEVICE IS A DEVICE, AND NOBODY IS ASKED FOR PERMISSION TO OPEN IT

use std::
{
    ffi::c_void,
    sync::OnceLock,
    time::Duration,
};

use jni::
{
    JavaVM,
    jni_sig,
    objects::JClass,
    refs::Global,
    strings::JNIString,
    sys::{ jint, JNI_VERSION_1_6 },
};

use tauri::AppHandle;

use crate::types::ChatMessage;
use crate::emit::say;

//THE CLASS THE KOTLIN HALF LIVES IN, WHICH IS THE IDENTIFIER FROM tauri.conf.json - build.rs READS IT
//THERE SO THE TWO CANNOT DRIFT, SINCE A WRONG NAME HERE IS A RUNTIME NOTHING RATHER THAN A BUILD ERROR
const ACTIVITY: &str = env!("ANDROID_ACTIVITY_CLASS");

static ACTIVITY_CLASS: OnceLock<Global<JClass<'static>>> = OnceLock::new();
static VM: OnceLock<JavaVM> = OnceLock::new();

//HOW LONG THE CALL WAITS ON THE PERMISSION DIALOG BEFORE GIVING UP ON IT. THE ANSWER IS A TAP AWAY, AND
//A USER WHO WALKED OFF INSTEAD IS ONE WHO DID NOT WANT A CALL
const PROMPT_WAIT: Duration = Duration::from_secs(60);
const PROMPT_POLL: Duration = Duration::from_millis(200);

//THE RUNTIME CALLS THIS THE MOMENT Rust.kt'S System.loadLibrary RUNS, WHICH IS THE ONE PLACE THE JavaVM
//IS HANDED TO US - AND IT RUNS ON THE THREAD THAT LOADED THE LIBRARY, WHOSE CLASS LOADER IS THE APP'S.
//A TOKIO WORKER LATER ON HAS ONLY THE SYSTEM LOADER AND WOULD NOT FIND OUR OWN ACTIVITY, SO IT IS
//LOOKED UP HERE AND KEPT
#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint
{
    let vm = unsafe { JavaVM::from_raw(vm) };

    let _ = vm.attach_current_thread(|env| -> jni::errors::Result<()>
    {
        //cpal ASKS ndk_context FOR THE CONTEXT WHENEVER IT ENUMERATES DEVICES, AND PANICS WHERE NOBODY
        //SET ONE - TAURI DOES NOT, SINCE ITS ANDROID SIDE IS KOTLIN AND HAS NO USE FOR IT. THE
        //APPLICATION OBJECT IS REACHED WITHOUT AN ACTIVITY IN HAND, WHICH IS WHY IT IS THIS ONE
        let thread = env.find_class(JNIString::new("android/app/ActivityThread"))?;

        let application = env.call_static_method(&thread, JNIString::new("currentApplication"),
            jni_sig!("()Landroid/app/Application;"), &[])?.l()?;

        let application = env.new_global_ref(&application)?;

        let activity = env.find_class(JNIString::new(ACTIVITY))?;
        let _ = ACTIVITY_CLASS.set(env.new_global_ref(&activity)?);

        //THE CONTEXT OUTLIVES EVERYTHING THAT READS IT, SO THE REFERENCE IS NEVER GIVEN BACK
        unsafe { ndk_context::initialize_android_context(vm.get_raw().cast(), application.as_raw().cast()) };

        std::mem::forget(application);

        Ok(())
    });

    let _ = VM.set(vm);

    JNI_VERSION_1_6
}

//ONE STATIC CALL INTO THE ACTIVITY. EVERYTHING IT ANSWERS IS ABOUT THE MICROPHONE, AND EVERY FAILURE -
//NO VM, NO CLASS, NO ACTIVITY ON SCREEN - MEANS THE SAME THING HERE: WE DO NOT HAVE THE PERMISSION
fn ask(method: &str) -> Option<bool>
{
    let vm = VM.get()?;
    let class = ACTIVITY_CLASS.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<bool>
    {
        env.call_static_method(&**class, JNIString::new(method), jni_sig!("()Z"), &[])?.z()
    }).ok()
}

pub(crate) fn microphone_granted() -> bool
{
    ask("microphoneGranted").unwrap_or(false)
}

//THE MICROPHONE IS ASKED FOR WHEN THE CALL IS AND NOT AT LAUNCH: A PERMISSION DIALOG IN FRONT OF A CHAT
//WINDOW IS A QUESTION ABOUT SOMETHING NOBODY HAS DONE YET. THE ANSWER COMES BACK TO THE ACTIVITY AND NOT
//TO US, SO IT IS WATCHED FOR RATHER THAN AWAITED - AND THE CALL GOES ON BY ITSELF THE MOMENT IT LANDS,
//SINCE PRESSING THE HEADSET AGAIN AFTER SAYING YES IS ASKING FOR THE SAME THING TWICE
pub(crate) async fn ensure_microphone(app: &AppHandle) -> bool
{
    if microphone_granted() { return true }

    //false HERE IS AN ACTIVITY THAT IS NOT ON SCREEN TO ASK FROM
    if ask("requestMicrophone") != Some(true)
    {
        say(app, ChatMessage::error("The microphone is off. Allow it for WHY2 in Android's app settings."));

        return false;
    }

    let deadline = std::time::Instant::now() + PROMPT_WAIT;

    while std::time::Instant::now() < deadline
    {
        tokio::time::sleep(PROMPT_POLL).await;

        if microphone_granted() { return true }

        //ANDROID ANSWERS FOR THE USER ONCE THEY HAVE SAID NO TWICE, AND IT ANSWERS INSTANTLY - SO THE
        //REFUSAL IS WATCHED FOR AS WELL, RATHER THAN SPENDING THE WHOLE MINUTE ON A DIALOG NOBODY SAW
        if ask("microphoneDenied") == Some(true)
        {
            say(app, ChatMessage::error("The microphone is off. Allow it for WHY2 in Android's app settings."));

            return false;
        }
    }

    say(app, ChatMessage::error("The call needs the microphone."));

    false
}
