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

//THE THREE THINGS A CALL NEEDS FROM THE PLATFORM ITSELF, AND THE ONLY PLACE IN THIS APP THAT SPEAKS JNI.
//THE DESKTOP HAS NONE OF THE THREE PROBLEMS: A DEVICE IS A DEVICE, NOBODY IS ASKED FOR PERMISSION TO OPEN
//ONE, AND A WINDOW THAT IS NOT ON SCREEN IS STILL A PROGRAM THAT IS RUNNING

use std::
{
    ffi::c_void,
    sync::
    {
        Mutex, Once, OnceLock,
        atomic::{ AtomicBool, AtomicU8, Ordering },
    },
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

use why2_chat::
{
    config,
    network::voice::client::options as voice_options,
};

use crate::types::ChatMessage;
use crate::emit::say;

//THE THREE CLASSES THE KOTLIN HALF LIVES IN, AS BINARY NAMES (DOTS), WHICH ARE THE IDENTIFIER FROM
//tauri.conf.json - build.rs READS IT THERE SO THEY CANNOT DRIFT, SINCE A WRONG NAME HERE IS A RUNTIME
//NOTHING RATHER THAN A BUILD ERROR. THE ACTIVITY ASKS FOR THE MICROPHONE; THE SERVICE IS WHAT KEEPS THE
//SESSION - SOCKET AND CALL BOTH - ALIVE ONCE THE WINDOW IS GONE; AND THE ROUTE IS WHICH OF THE PHONE'S
//TWO SPEAKERS THE CALL COMES OUT OF
const ACTIVITY: &str = env!("ANDROID_ACTIVITY_CLASS");
const SERVICE: &str = env!("ANDROID_SERVICE_CLASS");
const ROUTE: &str = env!("ANDROID_ROUTE_CLASS");

static ACTIVITY_CLASS: OnceLock<Global<JClass<'static>>> = OnceLock::new();
static SERVICE_CLASS: OnceLock<Global<JClass<'static>>> = OnceLock::new();
static ROUTE_CLASS: OnceLock<Global<JClass<'static>>> = OnceLock::new();
static APPLICATION: OnceLock<Global<JObject<'static>>> = OnceLock::new();
static VM: OnceLock<JavaVM> = OnceLock::new();
static CONTEXT: Once = Once::new();
static PREPARED: OnceLock<()> = OnceLock::new();

//THE TWO THINGS WORTH HOLDING THE PROCESS OPEN FOR, KEPT APART BECAUSE THEY ARE SET FROM TWO PLACES AND
//OUTLIVE EACH OTHER IN BOTH DIRECTIONS: A SESSION WITHOUT A CALL IS THE ORDINARY CASE, AND A CALL IS
//ALWAYS INSIDE ONE. WHAT ANDROID ACTUALLY HAS IS HELD, WHICH IS NOT THE SAME THING AS WHAT WE ASKED FOR
static SESSION: AtomicBool = AtomicBool::new(false);
static CALL: AtomicBool = AtomicBool::new(false);

static HELD: AtomicU8 = AtomicU8::new(DOWN);

const DOWN: u8 = 0;
const HOLDING: u8 = 1;
const CALLING: u8 = 2;

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

        //AND OUR OWN CLASSES THROUGH THE APP'S OWN CLASS LOADER RATHER THAN THROUGH FindClass: A TOKIO
        //WORKER IS ATTACHED WITH THE SYSTEM LOADER, WHICH KNOWS NOTHING THIS APP WROTE
        let loader = env.call_method(&**application, JNIString::new("getClassLoader"),
            jni_sig!("()Ljava/lang/ClassLoader;"), &[])?.l()?;

        for (name, cell) in [(ACTIVITY, &ACTIVITY_CLASS), (SERVICE, &SERVICE_CLASS), (ROUTE, &ROUTE_CLASS)]
        {
            let name = env.new_string(name)?;

            let class = env.call_method(&loader, JNIString::new("loadClass"),
                jni_sig!("(Ljava/lang/String;)Ljava/lang/Class;"), &[JValue::Object(&name)])?.l()?;

            let class = unsafe { JClass::from_raw(env, class.into_raw()) };

            let _ = cell.set(env.new_global_ref(&class)?);
        }

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

//ONE STATIC CALL INTO THE SERVICE, WHICH TAKES THE CONTEXT RATHER THAN HOLDING ONE: THE APPLICATION IS
//WHAT WE HAVE, AND IT IS ALSO THE CONTEXT THAT IS STILL STANDING WHEN THE ACTIVITY IS NOT - WHICH IS
//EXACTLY THE MOMENT THE SERVICE MATTERS
fn service(method: &str, call: Option<bool>) -> Option<bool>
{
    prepare();

    let vm = VM.get()?;
    let class = SERVICE_CLASS.get()?;
    let application = APPLICATION.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<bool>
    {
        let context = JValue::Object(&**application);

        match call
        {
            Some(call) => env.call_static_method(&**class, JNIString::new(method),
                jni_sig!("(Landroid/content/Context;Z)Z"), &[context, JValue::Bool(call.into())])?.z(),

            None => env.call_static_method(&**class, JNIString::new(method),
                jni_sig!("(Landroid/content/Context;)Z"), &[context])?.z(),
        }
    }).ok()
}

//WHAT THE SERVICE SHOULD BE DOING, PUT TO ANDROID ONLY WHEN IT IS NOT DOING IT ALREADY. THE FLAG FOLLOWS
//ANDROID AND NOT US, SO A START THAT DID NOT TAKE - THE ONE WAY THIS FAILS IS A FOREGROUND SERVICE ASKED
//FOR FROM THE BACKGROUND, WHICH 14 REFUSES - IS ASKED FOR AGAIN AT THE NEXT EVENT RATHER THAN BEING
//REMEMBERED AS DONE
fn apply()
{
    let want = if CALL.load(Ordering::Relaxed) { CALLING }
        else if SESSION.load(Ordering::Relaxed) { HOLDING }
        else { DOWN };

    if HELD.load(Ordering::Relaxed) == want { return }

    let done = match want
    {
        DOWN => service("stop", None),
        _ => service("start", Some(want == CALLING)),
    };

    if done == Some(true) { HELD.store(want, Ordering::Relaxed); }
    else { warn(&format!("the session service would not go to state {want}")); }
}

//THE SESSION, HELD OPEN BEHIND THE HOME BUTTON. AN APP THAT IS NOT ON SCREEN IS A PROCESS ANDROID FREEZES
//AND THEN KILLS, WHICH IS WHAT USED TO END THE SOCKET THE MOMENT THE WINDOW WENT AWAY - A FOREGROUND
//SERVICE IS THE ONLY THING THAT SAYS OTHERWISE. IT IS SET WHERE THE SOCKET IS, AND reset_session TAKES IT
//DOWN WITH EVERYTHING ELSE THE SESSION OWNED
pub(crate) fn hold_session(on: bool)
{
    SESSION.store(on, Ordering::Relaxed);

    apply();
}

//AND THE CALL INSIDE IT, WHICH IS THE SAME HOLD SAYING A SECOND THING: SINCE 9 A BACKGROUND PROCESS IS
//ONE THE MICROPHONE IS CUT OFF FROM UNLESS THE SERVICE IS TYPED FOR IT.
//IT IS DRIVEN FROM emit_voice, WHICH IS THE ONE PLACE THAT ALREADY KNOWS WHETHER THERE IS A CALL - AND
//THAT RUNS ON EVERY VOICE PACKET, WHICH IS WHY apply() ASKS ANDROID FOR NOTHING WHEN NOTHING CHANGED
pub(crate) fn hold_call(on: bool)
{
    CALL.store(on, Ordering::Relaxed);

    apply();
}

//BOTH AT ONCE, WHICH IS WHAT THE END OF A SESSION IS: THE NOTIFICATION IS THE ONLY THING THE USER CAN SEE
//OF THE SERVICE, AND ONE LEFT STANDING OVER A DEAD SOCKET IS A LIE
pub(crate) fn release()
{
    SESSION.store(false, Ordering::Relaxed);
    CALL.store(false, Ordering::Relaxed);

    apply();

    //THE ROUTE GOES WITH THEM. IT IS NORMALLY GIVEN BACK BY emit_voice THE MOMENT THE CALL ENDS, BUT A
    //SESSION CAN END WITHOUT ONE - AND AN AUDIO MODE LEFT IN COMMUNICATION IS THE WHOLE PHONE'S PROBLEM
    route_call(false);
}

//WHERE THE CALL COMES OUT, WHICH ON A PHONE IS A QUESTION AND NOT A FACT: THERE IS THE LOUD SPEAKER ON
//THE BACK AND THE QUIET ONE HELD TO AN EAR, AND A CALL IS SOMETIMES ONE AND SOMETIMES THE OTHER. IT IS
//THE SPEAKER TO BEGIN WITH, WHICH IS WHERE A PHONE PUTS EVERYTHING NOBODY HAS SAID OTHERWISE ABOUT - AND
//ALSO THE ONE ANSWER THAT NEEDS NOTHING DONE, SO A CALL NOBODY TOUCHES IS THE CALL AS IT ALWAYS WAS
static SPEAKER: AtomicBool = AtomicBool::new(true);

//WHETHER THE BUTTON HAS EVER BEEN PRESSED. UNTIL IT HAS, NOTHING HERE TOUCHES THE CALL AT ALL: A PHONE
//WITH A HEADSET ON IT IS ALREADY PLAYING WHERE IT SHOULD, AND A DEFAULT THAT FORCED THE BUILT-IN SPEAKER
//WOULD BE THIS APP TAKING THE CALL OFF THE HEADSET FOR NOBODY. ONCE IT IS PRESSED IT IS A PREFERENCE, AND
//THE NEXT CALL OPENS ON IT
static PICKED: AtomicBool = AtomicBool::new(false);

//WHETHER ANDROID IS CURRENTLY HOLDING A ROUTE OF OURS. THE AUDIO MODE IS THE WHOLE PHONE'S AND NOT OURS,
//SO IT IS TAKEN FOR EXACTLY AS LONG AS THERE IS A CALL TO HOLD IT FOR AND GIVEN BACK WITH THE CALL
static ROUTED: AtomicBool = AtomicBool::new(false);

//AND WHETHER THERE IS A CALL AT ALL, SINCE THE BUTTON ANSWERS BETWEEN CALLS TOO AND THERE IS NOTHING TO
//MOVE THEN - THE PICK SIMPLY WAITS FOR THE NEXT ONE
static IN_CALL: AtomicBool = AtomicBool::new(false);

//WHAT THE OUTPUT DEVICE KEY HELD BEFORE THE CALL TOOK IT OVER, AND WHAT THE CALL PUT THERE. BOTH, BECAUSE
//PUTTING THE FIRST BACK IS ONLY RIGHT WHILE THE SECOND IS STILL STANDING - THE CRATE POINTS THE KEY AT
//WHATEVER IS ACTUALLY PLAYING WHEN A DEVICE REFUSES TO OPEN, AND THAT ANSWER IS BETTER THAN OURS
static OUTPUT: Mutex<Option<(String, String)>> = Mutex::new(None);

const INPUT_DEVICE: &str = "input_device";
const OUTPUT_DEVICE: &str = "output_device";

//WHAT A cpal DEVICE ID LOOKS LIKE ON A PHONE: THE HOST, AND THEN THE NUMBER AAudio HANDED OUT FOR THIS
//BOOT - WHICH IS THE WHOLE OF WHY forget_devices() EXISTS
const AAUDIO: &str = "aaudio:";

pub(crate) fn speaker() -> bool
{
    SPEAKER.load(Ordering::Relaxed)
}

//THE BUTTON IN THE CALL STRIP. IT IS ANSWERED WHETHER OR NOT THERE IS A CALL TO MOVE, SINCE THE PANEL
//DRAWS ITSELF FROM THIS AND NOT FROM ANDROID - AND A ROUTE PICKED BETWEEN CALLS IS THE ONE THE NEXT CALL
//OPENS ON
pub(crate) fn set_speaker(on: bool)
{
    SPEAKER.store(on, Ordering::Relaxed);
    PICKED.store(true, Ordering::Relaxed);

    if IN_CALL.load(Ordering::Relaxed) { apply_route(); }
}

//THE CALL COMING AND GOING, OUT OF emit_voice LIKE hold_call - THE ONE PLACE THAT ALWAYS KNOWS WHETHER
//THERE IS ONE. IT RUNS ON EVERY VOICE PACKET, SO NOTHING IS ASKED OF ANDROID WHERE NOTHING CHANGED
pub(crate) fn route_call(on: bool)
{
    if on == IN_CALL.swap(on, Ordering::Relaxed) { return }

    //A CALL NOBODY HAS EVER MOVED IS THE CALL AS IT ALWAYS WAS - NOT AN AUDIO MODE TAKEN, NOT A DEVICE
    //NAMED, NOTHING TO GIVE BACK AFTERWARDS
    if on
    {
        if PICKED.load(Ordering::Relaxed) { apply_route(); }

        return;
    }

    if !ROUTED.swap(false, Ordering::Relaxed) { return }

    //THE CONFIG GOES BACK FIRST AND THE PHONE SECOND: THE KEY IS WHAT THE NEXT CALL READS, AND THE MODE
    //IS WHAT EVERY OTHER APP ON THE PHONE IS WAITING FOR
    restore_output();

    if route_class("clear") != Some(true) { warn("the audio mode would not go back to normal"); }
}

//A DEVICE THE VOICE CLIENT COULD NOT OPEN, WHICH ON A PHONE IS ALMOST ALWAYS THE EARPIECE REFUSING A
//STREAM THAT IS NOT A CALL AS FAR AS ANDROID IS CONCERNED. THE CRATE HAS ALREADY PUT THE SOUND BACK ON
//WHAT WAS PLAYING AND POINTED THE KEY AT IT, SO THE ONLY THING LEFT WRONG IS OURS: THE FLAG SAYS ONE
//SPEAKER AND THE CALL IS COMING OUT OF THE OTHER
pub(crate) fn route_failed()
{
    if !ROUTED.load(Ordering::Relaxed) { return }

    let back = !SPEAKER.load(Ordering::Relaxed);

    SPEAKER.store(back, Ordering::Relaxed);

    //THE PHONE IS TOLD AS WELL, SINCE ITS OWN ROUTING IS STILL POINTED WHERE THE STREAM COULD NOT GO -
    //BUT THE CONFIG IS LEFT ALONE, BECAUSE WHAT IS IN IT NOW IS THE DEVICE THAT IS ACTUALLY PLAYING
    route_class_id("route", back);
}

//AND WHAT IS LEFT OF A ROUTE BY A PROCESS THAT DIED IN THE MIDDLE OF A CALL. AN AAudio DEVICE ID IS
//HANDED OUT FOR ONE BOOT AND MEANS NOTHING IN THE NEXT, AND A DEVICE KEY THAT MATCHES NOTHING IS NOT A
//CALL ON THE DEFAULT DEVICE - IT IS A CALL WITH NO STREAMS AT ALL, SINCE THE VOICE CLIENT OPENS WHAT THE
//CONFIG NAMES OR NOTHING. SO THE PAIR IS FORGOTTEN AT EVERY LAUNCH, WHICH IS ALSO ALL A DEVICE PICKED IN
///settings COULD HONESTLY BE WORTH ON A PHONE
pub(crate) fn forget_devices()
{
    for key in [INPUT_DEVICE, OUTPUT_DEVICE]
    {
        if config::read_config::<String>(key).starts_with(AAUDIO) { config::client_write(key, ""); }
    }
}

//PUT THE ROUTE TO ANDROID, AND THEN TO THE STREAM ITSELF. THE SECOND HALF IS NOT BELT AND BRACES: cpal
//OPENS A PLAYBACK STREAM AS MEDIA AND HAS NO WAY TO ASK FOR ANYTHING ELSE, AND ANDROID MOVES MEDIA TO AN
//EARPIECE FOR NOBODY - WHAT IT DOES HONOUR IS A STREAM THAT NAMES THE DEVICE IT WANTS, WHICH IS WHAT THE
//ID COMING BACK FROM route() IS FOR
fn apply_route()
{
    ROUTED.store(true, Ordering::Relaxed);

    let device = route_class_id("route", SPEAKER.load(Ordering::Relaxed));

    if device.is_none() { warn("the call could not be routed - it stays where the system put it"); }

    point_output_at(device);
}

//POINT THE VOICE CLIENT'S OUTPUT AT ONE DEVICE, THROUGH THE SAME KEY AND THE SAME GENERATION BUMP
///settings USES - A RUNNING CALL REBUILDS ITS STREAMS ON IT WITHOUT BEING DROPPED. NO ID IS "WHATEVER
//THE SYSTEM PICKS", WHICH IS THE ONLY HONEST ANSWER WHERE ANDROID NAMED NO DEVICE
fn point_output_at(device: Option<i32>)
{
    let wanted = match device
    {
        Some(id) => format!("{AAUDIO}{id}"),
        None => String::new(),
    };

    let current = config::read_config::<String>(OUTPUT_DEVICE);

    {
        let mut output = OUTPUT.lock().unwrap();

        match output.as_mut()
        {
            //A SECOND TOGGLE INSIDE ONE CALL MOVES WHAT WE WROTE, NOT WHAT WAS THERE BEFORE US
            Some(kept) => kept.1 = wanted.clone(),
            None => *output = Some((current.clone(), wanted.clone())),
        }
    }

    if current == wanted { return }

    config::client_write(OUTPUT_DEVICE, &wanted);
    voice_options::mark_devices_changed();
}

fn restore_output()
{
    let Some((previous, written)) = OUTPUT.lock().unwrap().take() else { return };

    if previous == written { return }

    //ONLY WHERE THE KEY IS STILL WHAT THE CALL PUT THERE. A ROW MOVED IN /settings SINCE, OR A DEVICE THE
    //CRATE FELL BACK TO, IS A NEWER ANSWER THAN THE ONE WE ARE HOLDING
    if config::read_config::<String>(OUTPUT_DEVICE) != written { return }

    config::client_write(OUTPUT_DEVICE, &previous);
    voice_options::mark_devices_changed();
}

//ONE STATIC CALL INTO THE ROUTE CLASS, WHICH TAKES THE APPLICATION FOR THE SAME REASON THE SERVICE DOES:
//IT IS THE CONTEXT STILL STANDING WHEN THE WINDOW IS NOT, AND A CALL OUTLIVES THE WINDOW
fn route_class(method: &str) -> Option<bool>
{
    prepare();

    let vm = VM.get()?;
    let class = ROUTE_CLASS.get()?;
    let application = APPLICATION.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<bool>
    {
        env.call_static_method(&**class, JNIString::new(method),
            jni_sig!("(Landroid/content/Context;)Z"), &[JValue::Object(&**application)])?.z()
    }).ok()
}

//THE SAME, FOR THE ONE THAT ANSWERS WITH A DEVICE RATHER THAN WITH WHETHER IT WORKED. A NEGATIVE ID IS
//ANDROID SAYING IT HAS NO SUCH DEVICE, WHICH FOR US IS THE SAME ANSWER AS NOT HAVING BEEN REACHED AT ALL
fn route_class_id(method: &str, speaker: bool) -> Option<i32>
{
    prepare();

    let vm = VM.get()?;
    let class = ROUTE_CLASS.get()?;
    let application = APPLICATION.get()?;

    vm.attach_current_thread(|env| -> jni::errors::Result<i32>
    {
        env.call_static_method(&**class, JNIString::new(method), jni_sig!("(Landroid/content/Context;Z)I"),
            &[JValue::Object(&**application), JValue::Bool(speaker.into())])?.i()
    }).ok().filter(|id| *id >= 0)
}
