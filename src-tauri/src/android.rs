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
    sync::{ Once, OnceLock },
    time::Duration,
};

use jni::
{
    JavaVM,
    jni_sig,
    objects::{ JClass, JObject, JValue },
    refs::Global,
    strings::JNIString,
    sys::{ jint, JNI_VERSION_1_6 },
};

use tauri::AppHandle;

use crate::types::ChatMessage;
use crate::emit::say;

//THE CLASS THE KOTLIN HALF LIVES IN, AS A BINARY NAME (DOTS), WHICH IS THE IDENTIFIER FROM
//tauri.conf.json - build.rs READS IT THERE SO THE TWO CANNOT DRIFT, SINCE A WRONG NAME HERE IS A RUNTIME
//NOTHING RATHER THAN A BUILD ERROR
const ACTIVITY: &str = env!("ANDROID_ACTIVITY_CLASS");

static ACTIVITY_CLASS: OnceLock<Global<JClass<'static>>> = OnceLock::new();
static APPLICATION: OnceLock<Global<JObject<'static>>> = OnceLock::new();
static VM: OnceLock<JavaVM> = OnceLock::new();
static CONTEXT: Once = Once::new();
static PREPARED: OnceLock<()> = OnceLock::new();

//THE PERMISSION ITSELF, WHICH IS ASKED ABOUT FROM BOTH SIDES: THE ACTIVITY ASKS FOR IT, AND THE
//APPLICATION IS ENOUGH TO SEE WHETHER IT IS ALREADY THERE
const RECORD_AUDIO: &str = "android.permission.RECORD_AUDIO";

//WHAT PackageManager.PERMISSION_GRANTED IS. IT IS A CONSTANT ON A CLASS NOBODY WOULD OTHERWISE LOAD
const GRANTED: i32 = 0;

const TAG: &str = "WHY2";

//HOW LONG THE CALL WAITS ON THE PERMISSION DIALOG BEFORE GIVING UP ON IT. THE ANSWER IS A TAP AWAY, AND
//A USER WHO WALKED OFF INSTEAD IS ONE WHO DID NOT WANT A CALL
const PROMPT_WAIT: Duration = Duration::from_secs(60);
const PROMPT_POLL: Duration = Duration::from_millis(200);

//THE RUNTIME CALLS THIS THE MOMENT Rust.kt'S System.loadLibrary RUNS, AND IT IS THE ONE PLACE THE JavaVM
//IS HANDED TO US - SO THE POINTER IS TAKEN AND **NOTHING ELSE HAPPENS HERE**, WHICH IS THE WHOLE POINT:
//THIS RUNS INSIDE THE CLASS INITIALIZER OF wry'S OWN Rust OBJECT, SO A CLASS LOADED FROM HERE IS LOADED
//IN THE MIDDLE OF THE ACTIVITY CLASSES INITIALIZING THEMSELVES - WHICH JAVA PERMITS ON THE SAME THREAD
//AND THEN HANDS BACK A HALF-BUILT CLASS. EVERYTHING THAT TOUCHES JAVA WAITS FOR prepare()
#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _reserved: *mut c_void) -> jint
{
    let _ = VM.set(unsafe { JavaVM::from_raw(vm) });

    JNI_VERSION_1_6
}

//WHAT JNI_OnLoad IS NOT ALLOWED TO DO, DONE ONCE THE APP IS STANDING: run()'s setup CALLS THIS, WHICH IS
//AFTER THE ACTIVITY EXISTS AND OUTSIDE ANYBODY'S CLASS INITIALIZER. IT IS ALSO CALLED IN FRONT OF EVERY
//QUESTION BELOW, SINCE A CALL THAT ARRIVES FIRST SHOULD NOT DEPEND ON WHERE ELSE IT WAS ASKED FROM
pub(crate) fn prepare()
{
    if PREPARED.get().is_some() { return }

    //AND IT IS *NOT* REMEMBERED AS DONE UNLESS IT WAS: A LOOKUP THAT FAILED ONCE - BECAUSE IT WAS ASKED
    //TOO EARLY, OR FROM A THREAD THAT COULD NOT ATTACH - IS A MICROPHONE THAT NEVER OPENS AGAIN, WHICH IS
    //TOO MUCH TO HANG ON ONE ATTEMPT. EVERY STEP INSIDE IS A OnceLock OR A Once, SO A SECOND RUN IS FREE
    if ready().is_some() { let _ = PREPARED.set(()); }
}

fn ready() -> Option<()>
{
    let vm = VM.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<()>
    {
        //cpal ASKS ndk_context FOR THE CONTEXT WHENEVER IT ENUMERATES DEVICES, AND PANICS WHERE NOBODY
        //SET ONE - TAURI DOES NOT, SINCE ITS ANDROID SIDE IS KOTLIN AND HAS NO USE FOR IT. THE
        //APPLICATION OBJECT IS REACHED WITHOUT AN ACTIVITY IN HAND, WHICH IS WHY IT IS THIS ONE
        let thread = env.find_class(JNIString::new("android/app/ActivityThread"))?;

        let application = env.call_static_method(&thread, JNIString::new("currentApplication"),
            jni_sig!("()Landroid/app/Application;"), &[])?.l()?;

        //THE CONTEXT OUTLIVES EVERYTHING THAT READS IT - cpal ASKS FOR IT ON EVERY ENUMERATION, AND THE
        //PERMISSION CHECK BELOW IS A METHOD ON IT - SO THE REFERENCE IS KEPT FOR THE LIFE OF THE PROCESS
        let application = APPLICATION.get_or_init(|| env.new_global_ref(&application)
            .expect("the application object could not be kept"));

        CONTEXT.call_once(||
        {
            unsafe { ndk_context::initialize_android_context(vm.get_raw().cast(), application.as_raw().cast()) };
        });

        //AND THE ACTIVITY THROUGH THE APP'S OWN CLASS LOADER RATHER THAN THROUGH FindClass: A TOKIO
        //WORKER IS ATTACHED WITH THE SYSTEM LOADER, WHICH KNOWS NOTHING THIS APP WROTE
        let loader = env.call_method(&**application, JNIString::new("getClassLoader"),
            jni_sig!("()Ljava/lang/ClassLoader;"), &[])?.l()?;

        let name = env.new_string(ACTIVITY)?;

        let activity = env.call_method(&loader, JNIString::new("loadClass"),
            jni_sig!("(Ljava/lang/String;)Ljava/lang/Class;"), &[JValue::Object(&name)])?.l()?;

        let activity = unsafe { JClass::from_raw(env, activity.into_raw()) };

        let _ = ACTIVITY_CLASS.set(env.new_global_ref(&activity)?);

        Ok(())
    }).ok()
}

//WHAT WENT WRONG, WHERE A USER CANNOT BE SHOWN IT: EVERY ANSWER HERE IS A JAVA CALL THAT EITHER WORKED OR
//DID NOT, AND `adb logcat -s WHY2` IS THE ONLY PLACE THAT DIFFERENCE IS VISIBLE FROM THE OUTSIDE
fn warn(message: &str)
{
    let Some(vm) = VM.get() else { return };

    let _ = vm.attach_current_thread(|env| -> jni::errors::Result<()>
    {
        let class = env.find_class(JNIString::new("android/util/Log"))?;

        let tag = env.new_string(TAG)?;
        let text = env.new_string(message)?;

        env.call_static_method(&class, JNIString::new("w"),
            jni_sig!("(Ljava/lang/String;Ljava/lang/String;)I"),
            &[JValue::Object(&tag), JValue::Object(&text)])?;

        Ok(())
    });
}

//WHETHER THE PERMISSION IS THERE, ASKED OF THE APPLICATION AND NOT OF THE ACTIVITY. checkSelfPermission IS
//A METHOD ON ANY Context, AND THE APPLICATION IS THE ONE CONTEXT THAT IS ALWAYS STANDING - A PERMISSION
//GRANTED IN ANDROID'S OWN SETTINGS IS THEREFORE SEEN EVEN WHERE THE ACTIVITY CANNOT BE REACHED AT ALL,
//WHICH IS THE ONE ANSWER A USER WHO HAS ALREADY SAID YES SHOULD NEVER BE ASKED FOR AGAIN
fn context_granted() -> Option<bool>
{
    prepare();

    let vm = VM.get()?;
    let application = APPLICATION.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<bool>
    {
        let name = env.new_string(RECORD_AUDIO)?;

        let answer = env.call_method(&**application, JNIString::new("checkSelfPermission"),
            jni_sig!("(Ljava/lang/String;)I"), &[JValue::Object(&name)])?.i()?;

        Ok(answer == GRANTED)
    }).ok()
}

//ONE STATIC CALL INTO THE ACTIVITY. EVERYTHING IT ANSWERS IS ABOUT THE MICROPHONE, AND EVERY FAILURE -
//NO VM, NO CLASS, NO ACTIVITY ON SCREEN - MEANS THE SAME THING HERE: WE DO NOT HAVE THE PERMISSION
fn ask(method: &str) -> Option<bool>
{
    prepare();

    let vm = VM.get()?;
    let class = ACTIVITY_CLASS.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<bool>
    {
        env.call_static_method(&**class, JNIString::new(method), jni_sig!("()Z"), &[])?.z()
    }).ok()
}

//THE TWO WAYS OF ASKING THE SAME QUESTION, AND EITHER ONE SAYING YES IS YES: THE ACTIVITY IS THE FIRST
//BECAUSE IT IS THE THING THAT PUT THE DIALOG UP, AND THE APPLICATION IS THE ONE THAT ANSWERS WHEN THERE
//IS NO ACTIVITY TO REACH - A GRANT MADE IN ANDROID'S APP SETTINGS IS THE SAME GRANT EITHER WAY
pub(crate) fn microphone_granted() -> bool
{
    ask("microphoneGranted") == Some(true) || context_granted() == Some(true)
}

//THE MICROPHONE IS ASKED FOR WHEN THE CALL IS AND NOT AT LAUNCH: A PERMISSION DIALOG IN FRONT OF A CHAT
//WINDOW IS A QUESTION ABOUT SOMETHING NOBODY HAS DONE YET. THE ANSWER COMES BACK TO THE ACTIVITY AND NOT
//TO US, SO IT IS WATCHED FOR RATHER THAN AWAITED - AND THE CALL GOES ON BY ITSELF THE MOMENT IT LANDS,
//SINCE PRESSING THE HEADSET AGAIN AFTER SAYING YES IS ASKING FOR THE SAME THING TWICE
pub(crate) async fn ensure_microphone(app: &AppHandle) -> bool
{
    if microphone_granted() { return true }

    //THE TWO WAYS THIS FAILS ARE NOT THE SAME THING AND MUST NOT READ AS ONE: false IS AN ACTIVITY THAT
    //IS NOT ON SCREEN TO ASK FROM, AND None IS THE JAVA SIDE NOT REACHED AT ALL - THE SECOND IS A BUG IN
    //THIS APP, AND A USER TOLD TO GO AND ALLOW SOMETHING THEY HAVE ALREADY ALLOWED LEARNS NOTHING
    match ask("requestMicrophone")
    {
        Some(true) => {},

        Some(false) =>
        {
            warn("no activity to ask for the microphone from");

            say(app, ChatMessage::error("Android would not open the microphone dialog. Allow the microphone for WHY2 in Android's app settings."));

            return false;
        },

        None =>
        {
            warn(&format!("{ACTIVITY} could not be reached - the microphone cannot be asked for"));

            say(app, ChatMessage::error("WHY2 could not reach Android to ask for the microphone. Allow the microphone for WHY2 in Android's app settings."));

            return false;
        },
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
            say(app, ChatMessage::error("The microphone was refused. Allow it for WHY2 in Android's app settings."));

            return false;
        }
    }

    say(app, ChatMessage::error("The call needs the microphone."));

    false
}
