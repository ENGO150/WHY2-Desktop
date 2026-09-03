# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WHY2 Desktop is a Tauri 2 GUI for the WHY2 chat protocol — a desktop program on Linux/macOS/Windows and an
Android app from the same source. All protocol work (async TCP framing, hybrid ECC+ML-KEM key exchange, TOFU
key pinning, commands, roles, config) lives in the `why2-chat` crate, pulled in as a **git dependency on the
`development` branch**, with a **different feature set per target** (see **Android**):

```toml
[target.'cfg(not(target_os = "android"))'.dependencies]
why2-chat = { git = "https://github.com/ENGO150/WHY2", branch = "development", default-features = false, features = ["client_base", "client_voice", "client_screen"] }

[target.'cfg(target_os = "android")'.dependencies]
why2-chat = { git = "https://github.com/ENGO150/WHY2", branch = "development", default-features = false, features = ["client_base", "client_voice"] }
```

The branch is not a preference: **crates.io stops at `why2-chat` 2.0.0, which has no `SCREEN_FRAME_SINK`** —
see **Screen sharing** — so the published crate does not compile this app's desktop half. Move to a version
dependency once that change is released. `Cargo.lock` pins the commit, so `cargo update -p why2-chat` is what
takes newer `development` work.

To read the crate against local edits instead, patch it rather than editing the dependency line:

```toml
[patch."https://github.com/ENGO150/WHY2"]
why2-chat = { path = "../../WHY2/chat" }
```

`client_voice` pulls in `cpal`, `audiopus` and `nnnoiseless`, so the build also wants the
system's audio development libraries (opus, and PulseAudio/ALSA) — a missing one fails in a `*-sys` build
script, not in this code. It is on for **both** targets; what a phone does about the opus it cannot find is
in **Android**. `client_screen` adds `xcap`/`libwayshot` (capture), `openh264` (which builds its
own C library in a build script) and `winit`/`wgpu`, which this app never runs — see **Screen sharing**,
which also documents the one change this app needs in that crate. When behaviour looks wrong, the cause is often in that crate, not here — read
its `chat/src/` (`network/client.rs`, `network/codes.rs`, `command.rs`, `options.rs`) before
assuming a bug in this repo — in the checkout at `/mnt/data/Rust/WHY2` if there is one, otherwise in the copy
cargo fetched under `~/.cargo/git`. This app is a thin presentation layer over it.

`chat/src/bin/client/` is the crate's own terminal client (ratatui). **It is the reference implementation for
everything this app does** — `tui/event.rs` maps every `ClientEvent` to UI state, `mod.rs::submit` handles every
line the user types, and `tui/state.rs::reset_session` lists the globals a session has to put back. When adding a
feature here, read how the TUI does it first: the two are deliberately kept in step about *behaviour* —
what a line does, what an event means, what a session has to reset. They no longer look alike, and are not
meant to (see **The window**).

Do not run cargo inside `/mnt/data/Rust/WHY2` — nothing here builds from it any more, and a target directory
in there is a checkout dirtied for nothing.

## Commands

```bash
npm run tauri dev      # full app (spawns vite on :1420 + cargo, hot reload on both sides)
npm run tauri build    # bundled release binary
npm run android:init   # generates src-tauri/gen/android — run once, and again after an identifier change
npm run android        # the app on a connected device/emulator (same vite server, hot reload both sides)
npm run android:build  # the APK/AAB
npm run dev            # frontend only in a browser — Tauri `invoke`/`listen` are unavailable, so
                       # nothing past the server-select screen works. Rarely useful.
npm run build          # tsc typecheck + vite build (this is the only "lint": tsconfig has
                       # strict, noUnusedLocals, noUnusedParameters)
npm run icons          # every icon in the project, out of src-tauri/icons/why2.svg - by hand, when the
                       # mark changes, and what it writes is committed (see **The name and the mark**)
cargo check --manifest-path src-tauri/Cargo.toml   # fast Rust-only feedback
```

There is no test suite, no ESLint/Prettier, and no formatter config. Verification is `npm run build` +
`cargo check`, then running the app against a WHY2 server.

The Android commands want the SDK, the NDK and a JDK, with `ANDROID_HOME`/`NDK_HOME`/`JAVA_HOME` pointing at
them, plus the four Rust targets (`aarch64-`, `armv7-`, `i686-`, `x86_64-linux-android`). Two things bite
before any code does: the **JDK must be 17 or 21** — the Android Gradle Plugin refuses a newer one, so a
system default of 25 needs `JAVA_HOME` pointed elsewhere for these commands — and **`android:init` shells out
to `rustup target add`** before it generates anything, which fails outright on a toolchain installed any other
way. `npm run android:init -- --skip-targets-install` is the way past that once the targets are in the
sysroot; it is also what CI uses. `gen/android` is generated and **not** tracked (its `jniLibs` are absolute
symlinks into this machine's `target/`), so it is made rather than cloned. **`cargo check` alone only
ever checks the desktop half** — the Android half is a different feature set and a different cfg, and the
cheap way to compile it without an NDK in reach is to point the target sections at the host and turn the
`screen` cfg off in `build.rs` by hand.

All three commands are wrapped: `android` and `android:build` run inside `scripts/android-env.sh`, and
`android:init` is `scripts/android-init.sh`. That is where **libopus** is built for the ABIs and where the
generated project is **patched** — see **Android**. Nothing else about them changed, `--` arguments
included; running `tauri android build` by hand still works, and builds an app whose call cannot link.

## Architecture

Three layers, and the boundary between them is deliberately narrow:

1. **`why2-chat` crate** — owns the socket, the protocol, and persistent config/TOFU state. Everything is
   `async` on tokio, and the crate spawns its own tasks (uploads, downloads), so every call into it must be
   made from inside the runtime.
2. **`src-tauri/src/`** — the bridge. Holds `AppState`, exposes the `#[tauri::command]`s, and translates
   `ClientEvent`s into UI events. Everything that needs the call is behind the `voice` cfg and everything
   that needs the screen share behind the `screen` one, both set by `build.rs` — see **Android**.
3. **`src/`** — the UI. One stateful component with the view drawn by components around it, no router, no
   state library.

### Where things are

Neither half is one file any more, and the split is by *what a thing is*, not by how big it got.

**`src-tauri/src/`** — `lib.rs` is only the module list and `run()`. Under it: `types.rs` (everything the
wire and the webview both speak, `UiEvent` included), `state.rs` (`AppState`, the session counter,
`reset_session`), `emit.rs` (everything that pushes at the window — `say`, `block`, `emit_voice`,
`emit_screen`), then the paths that do something: `net.rs` (the socket, the roster clock, `connect_to_server`),
`input.rs` (`send_input` — the command path, mirroring the TUI's `submit`), `events.rs` (`handle_event` and
`pump_events`), `screen.rs` (the frame sink, the JPEG fallback, `watch_frames`), plus `settings.rs`,
`palette.rs`, `color.rs` and `servers.rs` for the four things that are their own vocabulary.

**`src/`** — `App.tsx` still owns all the state, every effect and every handler, and that is deliberate: the
event listener, the channel routing and the palette all read each other, and prop-drilling them apart would
buy nothing. What moved out is what does not need the state: `types.ts` (the mirror of `UiEvent`, and
`LOBBY`), `theme.ts` (the two ANSI tables), `format.ts`, `icons.tsx`, `components.tsx` (`Avatar`, `Switch`,
`SectionLabel`), `video.ts` (the H.264 probe and `isKeyFrame`), `palette.ts` (`analyze`, the TS rewrite of
`palette::update`), `settings.ts` (the row model), `history.ts`, `narrow.ts` — and the views that take props
and draw: `sidebar.tsx`, `members.tsx`, `messages.tsx`, `settings-dialog.tsx`, `files.tsx`, `screens.tsx`,
`servers.tsx`, `login.tsx`, `tofu.tsx`.

**`index.html`** carries the one piece of styling that is not in `src/`: the page's own background and the
mark that stands on it until the window is ready. Everything else arrives with the bundle, and on a phone that
is several seconds of black to sit and look at — so the surface is painted from the first frame and
`public/why2.svg` (the same icon, copied there by `npm run icons`) breathes in the middle of it. `#boot` is a
sibling of `#root` and stands **over** it rather than inside it, because a desktop has the bundle in a few
milliseconds: left in the container it was cleared by the first render too quickly to be anything but a
flicker. `main.tsx` takes it down itself, no earlier than `BOOT_MS` after the page's own start
(`performance.now()` is measured from exactly that) and by the fade `#boot.gone` names — a floor a phone has
already passed and pays nothing for, and the whole of what makes a desktop open on the mark at all. On Android the same picture stands one layer further out as the
activity's `windowBackground`, so the launcher, the system splash and the page are one continuous thing with
nothing black in between — see **The name and the mark** and `scripts/android/res/drawable/why2_splash.xml`.

**`src/index.css`** is the fonts and the Tailwind import and nothing else; the palette is in `theme.css`, the
pieces the window is built from in `widgets.css`, and what only a phone needs in `mobile.css`.

Two things the compiler will not catch when moving view code out of `App.tsx`. A prop named `screen`,
`history`, `name`, `status` or `location` collides with a **DOM global**, so a component that forgot to
declare it still compiles against `window.screen` — it is caught only because the *shape* is wrong, and it
would not be if the shapes happened to match. And a `#[cfg(screen)]` or a CSS comment sitting at the seam of
a cut belongs to what follows it: a stray one silently made a `#[tauri::command]` desktop-only
once, which compiled on both targets and only failed at the Android link.

### The event bridge (the thing to understand first)

`connect_to_server` spawns two tasks: `client::listen_server` writes `ClientEvent`s into a tokio `mpsc`
channel, and `pump_events` drains it and re-emits to the webview as a **single Tauri event named
`why2-event`**. The payload is `UiEvent`, adjacently tagged by serde, so the frontend sees
`{ "event": "message", "data": { … } }` and switches on one field. `BridgeEvent` in `types.ts` is the mirror of
that enum — **adding an event means adding a variant on both sides**, and the TS union is what makes a missed
case visible.

Chat lines all arrive as one `message` event carrying a `ChatMessage` whose `kind` (`user`, `private`,
`system`, `notice`, `ok`, `error`) is what the frontend styles on — joins, uploads and server notices are not a
separate channel, they are messages nobody said. A `private` line is the one kind that is not for the pane it
landed in: it carries `direct` — the **other** person's id and name, plus which way it went — and the window
files it into that conversation instead (see **Direct messages**). `/list` and the ban list arrive as a `block` event (a flat
`Vec<BlockRow>` carrying a `depth`) and are appended to the same scrollback, because that is where the TUI
prints them — the frontend draws them as a card in the stream, keeping the `├─`/`╰─` glyphs it builds from
the depths, since what they are is a tree.

`/files` used to be one of those and is not any more: it arrives as its own `files` event carrying
`FileOwnerInfo { id, username, files }`, because a file list is not a tree and it is not something anybody
said — it is a drawer. `filesBox` is a window like the settings dialog: the owner is a heading, their files
are rows (the kind the extension says it is, the name, the file's id, the button that fetches it), there is
a search over both the file names and the owners, and a `Refresh` that sends `/files` again, since the list
is a photograph of the moment it was asked for. Clicking a row sends the same `/download <user> <file>`
typing it out would have. It takes the keyboard while it is up and closes on esc, the X, or a press outside
it; the header's folder toggles it rather than asking twice. An **empty** answer opens it anyway, saying so
— where the TUI prints a line, a window that refused to open would look like a button that does nothing.
Nothing else carries a download, so `BlockRow` no longer has that field.

### The name and the mark

The product is **WHY2** and the project is WHY2 Desktop — `productName` in `tauri.conf.json` is the first,
because that is the string a launcher, a dock and a title bar print, and "Desktop" on a phone is a lie.
`mainBinaryName` is `why2-desktop`, which keeps the file out of the way of the terminal client's own `why2`
on a `PATH` that has both. Everything else a bundle carries — publisher, homepage, copyright, licence,
category, the two descriptions — is in `bundle`, and the same facts are in `src-tauri/Cargo.toml`'s
`[package]` and in `package.json`, because three different tools read three different files and none of them
reads the others.

The mark is the terminal client's own: `chat/assets/why2.ico`, a white wolf's head on nothing, traced to a
path and kept as `src-tauri/icons/why2.svg`. What this app adds to it is the **plate** — a rounded square in
`--deep` (`#050405`, `src/theme.css`), the window's own deepest surface — because the mark is white on
transparency, and an icon that is white on transparency is an icon that vanishes on half the home screens it
lands on. The mark is the middle 66% of it, which is what survives every launcher's mask.

`npm run icons` is the whole pipeline and it is **run by hand**, not by a build: it wants `rsvg-convert` and
Pillow, which nothing else here does, and `tauri icon` puts a timestamp in the `.icns`, so a build that ran
it would dirty the tree every time. What it writes is committed, and it goes to two places:

- **`src-tauri/icons/`** — the desktop set, which is where `bundle.icon` points. It is `tauri icon`'s own
  output, generated into a scratch directory and copied in, since left alone that command also writes an iOS
  set this project has no target for and reaches into `gen/android`.
- **`public/why2.svg`** — the same file under a URL, which is what `index.html` shows while the bundle is
  still on its way (see **Where things are**).
- **`scripts/android/res/`** — the launcher, which is ours because **`tauri android init` writes Tauri's own
  template icons and knows nothing of `src-tauri/icons`**. `android-patch.sh` copies it over the generated
  `res/` after every init, and drops the template droid it replaces. It is the legacy icon, the round one,
  and the **adaptive** layers with the plate colour as `@color/ic_launcher_background` — an adaptive icon
  draws its own background, so `#050405` has to be said in `values/` as well as in the SVG. The foreground is
  the mark alone on the 108dp canvas at 58dp, and the same layer serves as the `monochrome` one 13 tints
  itself — and as the middle of `drawable/why2_splash.xml`, the **window background**, which is hand-written
  rather than generated because all it does is point at the layers under it. `android-patch.sh` puts that
  drawable into the generated theme (`android:windowBackground`, plus `windowSplashScreenBackground` for 12's
  own splash, which cannot read a layer-list and needs the colour said again) — two lines inside the room the
  template leaves for them, rather than a theme of our own, since the theme's name is derived from the
  identifier and is not ours to write down. The mark-only SVG is **cut out of `why2.svg`** rather than kept beside it, so the foreground cannot
  drift from the icon it is the inside of.

### Sessions

Two things make session lifetime subtle:

- The crate keeps session state in **process-wide globals** (`options::`): sequence counters, login state,
  the active channel, the shared keys. `reset_session()` in `state.rs` mirrors the TUI's function of the same
  name and must run on every connect and teardown — a second connection that kept the first one's sequence
  numbers has every packet it sends refused.
- `AppState::session` is a counter bumped on every connect. An old `pump_events` can outlive its socket (a
  half-finished upload still holds a `Sender`), so it checks the counter and goes quiet rather than letting
  its last events — or its cleanup — land on the connection that replaced it.

### The server list

The TUI asks for an address and an identity every time it starts, because a terminal client is *run at* a
server. A window is left open, and the one question it should not be asking again is the one it was already
answered — so this app keeps a list, the way every other chat program does.

`servers.rs` is the whole of it: `desktop_servers.toml` beside the crate's own config (`misc::get_why2_dir()`,
which on Android is the app data dir `run()` points `HOME` at), an array of `[[server]]` tables, and three
commands — `get_servers`, `save_server`, `remove_server`. It is **ours and not the crate's**: `client.toml` is
shared with the terminal client, which has no list and no use for one. A file that is missing, empty or
unreadable is an empty list, since the window's answer to all three is the same screen that asks for the first
server.

A row holds an address, a username, an optional password, the name the server last called itself, and an
`id` — and **nothing else**. The `id` is the window's own and is the row's identity: `save_server` and
`remove_server` both match on it, the rail keys on it, and it is what says which row is the one we are
standing in, because the same address twice is two accounts on one server rather than one row written down
twice. There is no `last_used` any more: the program opens on the list and dials nothing, so the timestamp
that was there to open the newest one was a fact about somebody written into a file that nothing read back.
An older list that still carries it is not an error — serde ignores what it does not know, and the next write
leaves it out.

**The password is kept in plain text in a file chmodded 0600** (and on Windows, in the user's own profile with
its ACL). There is no key to encrypt it with that the program would not have to keep beside it, and asking for
a second password to unlock the first is exactly the comfort the list exists to buy. The mode is set on the
file *before* the passwords go into it, and on one that is already there, so a list written before a password
was ever stored is tightened the same way. It is optional per row: an entry with no password simply asks at
every connect, which is what the connect form's empty field means.

Nothing about the login path changed — that is the point. A stored credential is put where the identity steps
will find it (`credsRef` in `App.tsx`) and sent back down `send_input`, the same path a typed one takes; it is
**consumed as it is sent**, so a credential the server refuses is asked for rather than sent again in a loop.
What actually got the session in (`typedRef`, whichever of the two it came from) is what `rememberServer`
writes when `authenticated` arrives — which is also why a server typed into the form is **not** written down
until it works: a typo is a failed connect rather than a row to be forgotten again.

`dial` is the one way in. It is called by `goTo` — which is what the list's rows, the rail's tiles and the
form all come back to — and by the `disconnected` event when a switch is parked. Picking a server while
another one is up is a **switch and not a second session**: the one in front is asked to leave with `/exit`,
`switchRef` parks where we are going, and the disconnect dials it.

**The program opens on the list and dials nothing.** A window that reconnected to whatever was used last
would be a session nobody asked for, to be left again by hand; which server this is going to be is the one
question a list cannot answer by itself. The startup read of `get_servers` therefore only fills the list —
an empty one is the single case anything is asked, and what it asks is the form that adds the first server.

`LoginScreen` is one screen with three things to ask, and `mode` says which: the **prompt** (one field) while
the server has an identity step pending that nothing was stored for, the **form** that adds a server (address,
username, password — and an empty list has nothing else), or the **list** itself waiting to be picked from.
The list is **only** the list: it has no address field, because a row and a field beside it are the same
question asked twice, and it has no form in front of it — the only two modes that draw one are the two with
something to ask. A server not in the list is added through `Add another server`, which is the same form,
and typing an address that is already a row dials *that* row rather than adding a second one beside it. Two
rows for one address are two accounts, which is why the username counts when one is given.

Forgetting a server is asked for the same way in both lists: a **right-click, or a hold on a phone**, opens
one menu item and nothing else — it is the only destructive thing here, and a button sitting in the row would
be brushed by accident. `useHoldMenu` and `ForgetMenu` in `servers.tsx` are that gesture and that menu,
written once for the rail and the selection screen. The menu goes through a **portal**: both lists live in
boxes that would swallow it, since a list that scrolls clips whatever leaves it (`.scroller` is
`overflow-y: auto`, which makes the other axis clip too) and a drawer is translated, which is enough to make
`position: fixed` mean "inside the drawer". It is placed against the element that was held and kept inside
the window, and the click that ends a hold is swallowed (`held()`) so the press that opened the menu does not
also pick the server under it.

The selection screen has no form to carry the status line, so it carries **its own, as a box**: a bare
sentence between a heading and a list reads as neither, and the one that lands there is usually an error the
form has already been dismissed from. It is drawn only when it says something.

The rail is **not** drawn on this screen: the selection screen already is the list, in whole names rather
than one letter each. It keeps its `+` for the other side of that — while there is a session, the selection
screen is not up, so the `+` is the way to the form from in there. `AddServerDialog` is that form as a window
over the chat (`addBox`), and `AddServerFields` is the three fields written once for both homes. It closes
the way every other menu here does — esc, the X, a press outside, the back gesture (it is in `__why2Back`) —
and submitting it is a switch like any other, so the session in front is left first.

A stored answer is not a question, which is what keeps the identity steps from **flashing**: `request_username`
and `request_password` look for the credential *before* they touch `uiState`, and where there is one the screen
stays on `Connecting…` while it goes back down `send_input`. Drawing the prompt and answering it a frame later
is what put a password box on screen for an instant on every connect. None of this is on Android's side of a
cfg: it is the same file, the same commands and the same 0600.

### The window

The app used to be the terminal client redrawn cell for cell. It is not any more: the layout is the one every
chat program has settled on, because that is the one a user already knows how to read.

Three columns, and a screen in front of them while there is no session — this is the wide shape, and the
narrow one (a phone, or a window dragged down to one) turns the outer two into drawers over the middle; see
**Android**:

- **The rail**, at the far left of the left column: one tile per server in the list, the one we are in marked
  with a pill against the edge, and a `+` that adds another. It is drawn inside the left column's `aside` (so
  a phone slides one drawer and not two) and only while there is a session, since the screen that stands in
  place of one is the same list already, written out in full. On a phone it is only as **tall** as the part
  of the column that scrolls, and the row with the person using the program runs under it across the whole
  drawer — the drawer is 86% of the glass, the rail takes 68 of it, and with an avatar and three
  fingertip-wide buttons that left the name and the role about forty pixels between them. That row is the one
  thing in the column with nothing to scroll, so it is the one that can have the width. A right-click, or a long press on a phone,
  opens the tile's one menu item: forgetting the server, which is for good, and which is also leaving it when
  it is the one we are standing in.
- **Left** — the server (name over the address as it was typed) and, where our role has one, the door to
  *its* config; the channel list with a `+` that makes one; the conversations, while there are any; then the
  call: the voice roster while there is
  one, the `Voice connected` strip with the button that hangs up, the `Sharing your screen` strip beside it,
  and at the bottom the person using the program — face, name, role, microphone, **our own** settings, and the way out. The two gears are two
  different configs and sit with what they belong to: the server's by the server's name, ours by ours.
- **Middle** — the channel header (`#name`, how many are online, and the buttons for files, screen sharing,
  voice and the member column), the messages, and the composer, whose `+` is the one upload button. The command palette
  floats on the composer.
- **Right** — everybody on the server, with the channel each of them is sitting in, toggled by the header's
  own button. A row is a button, and it opens the conversation with that person — see **Direct messages**.

A line that has a link in it gets one: `linkParts` in `format.ts` finds the `http://` and `https://` in the
text — those two and nothing else, since a line is written by a stranger on a server and `file://` is not
something to hand the system — walking the trailing punctuation back off, so a URL at the end of a sentence
keeps the full stop and the link does not. `linked` in `messages.tsx` draws the pieces, and a click goes to
`openUrl` rather than to the `href`: this window is a chat client, and a page that navigated it away would
take the session with it. The opener's scope is what actually allows the two schemes, so the capability
carries an `opener:allow-open-url` entry beside `opener:default` — **a glob there is `http://**`, not
`http://*`, which stops at the first slash**.

Messages are grouped: a run of lines by one person carries one avatar and one name, and every line after the
first is just text under it. `paneNodes` decides that, and **anything that is not somebody talking breaks the
run** — a system line, a notice, a `/list` card. A line nobody said keeps the avatar column but puts an icon
in it, so the text of the whole pane stays under one edge. Private messages take an accent rule down their
left side and a `private` badge. There are no avatars in this protocol, so a face is the first letter of the
name over the color the user picked — or, where they picked none, the one `avatarColor` always hashes it to.

`↑`/`↓` still walk what was typed before, the palette still answers `/`, and every button still goes through
`send_input`. What changed is what it looks like, not what it does.

There is no command for creating a channel, because there is nothing to create — a channel is wherever
somebody is standing. The `+` opens a row that takes a name and sends the same `/channel` the list itself
sends; leaving it alone puts it away.

Every menu closes by being clicked out of: the settings dialog, the device picker inside it and the command
palette all watch for a press that landed outside them. It is `onMouseDown` and not a click, so a selection
dragged out of a dialog does not dismiss it on letting go — and the palette's dismissal is undone by the next
keystroke in the line, because `writeInput` clears the flag.

Two things the layout depends on:

- **A column that scrolls must be `min-h-0`.** A flex child's default `min-height: auto` refuses to shrink
  below its content, and a scroll container inside one silently grows the page instead of scrolling.
- **The composer and the header do not scroll** (`shrink-0`), and the pane between them is the only thing
  that does. The palette is absolutely positioned against the composer's wrapper (`bottom-full`), so it grows
  upwards off a fixed edge rather than pushing the input around.

The window is nearly monochrome on purpose. The surfaces are a near-black stack (`deep` → `sidebar` →
`chat` → `raised` → `overlay`) with a trace of rose in every one of them, and the accents are still
`tui/theme.rs`'s meanings — the active thing, a notice, what went right, an error, presence — pulled most of
the way towards grey, so **the only saturated thing in the window is what somebody said**: the sixteen
protocol colors in `ANSI`. `theme.css` holds the whole palette as CSS custom properties, mapped to Tailwind
tokens in one `@theme inline` block beside them.

The interface font is proportional (Inter). **The monospace is kept for what is actually measured in
characters**: the fingerprints, the list-block rows and their branch glyphs, the palette's command
signatures, IDs and latencies. A file name is **not** one of those — it is a name, and it is set in the
interface face like every other name.

There is no ASCII logo anywhere — the terminal client's watermark was the last thing in here drawn in
characters, and a window has a title and a name to say what it is. `disable_logo` is therefore neither in
`ClientConfig` nor in `CLIENT_SETTINGS`; `get_client_config` hands over the two `client.toml` keys that still
change how the pane looks (`show_id`, `disable_colors`), which the TUI re-reads on every redraw.

### The command path

Everything the user types goes through `send_input`, which mirrors `submit` in the TUI:

- Before authentication, `options::get_sending_messages()` is false and **every line is an answer to the
  identity step the server is waiting on** — `options::get_login_state()` decides whether it becomes a
  `Username`, `PasswordL` or `PasswordR` packet. Commands do not exist yet.
- After it, a line starting with `/` goes to `command::get_command`, then `command::send_command_code`, which
  returns `Some(true)` (sent), `Some(false)` (invalid usage) or `None` (ours to run: `/upload`, `/server`,
  `/ucolor`, `/color`, `/mute`).

The UI drives itself through this same path rather than adding IPC commands: clicking a channel invokes
`send_input("/channel <name>")` and the sidebar's `+` sends the same thing with a name nobody is in yet; its
header gear sends `/server settings` (drawn only when `get_commands` says our role has that action) while the
gear by our own name sends `/settings` and the door sends `/exit`; the channel header's folder sends `/files`
and its headset `/voice`; the monitor button opens the Screens window, whose rows send `/screen <name>`, `/attach <id>` and
`/deattach`;
the microphone button sends `/mute`; a row of the file list sends
`/download <user_id> <file_id>`, and a row of the voice roster sends `/mute <id>` — or `/mute` on our own
row, the one the command takes no ID for. Prefer extending the command path over adding a
`#[tauri::command]`.

`get_commands` reflects `command::COMMAND_LIST` filtered by the role the server granted us
(`CommandInfo::available`), so the palette follows a promotion without a reconnect — the frontend re-invokes it
whenever a `role` event names no user (that one is ours). Hiding a command is cosmetic; the server checks every
privileged packet itself.

### The palette

`analyze` in `palette.ts` is `palette::update` rewritten in TypeScript, and the four states are the TUI's
`PaletteMode`: a **menu** of commands (or, once `/server ` has its space, of *its actions* — a command that is
a doorway is one row until then, never nine), the **values** a parameter accepts, the **signature** hint for
one that accepts anything, or hidden. The matching is on `triggers`, not on the canonical name, so `/stfu`
finds `/server mute` the same way it does in the terminal. ⇥ completes whatever is highlighted; ⏎ completes
only what is not spelled out already, and otherwise sends the line.

The vocabularies are not shipped with the command list: `get_vocabulary` is invoked when the caret lands on a
parameter that has one and dropped when it leaves, because a monitor plugged in mid-session is supposed to
show up. Colors carry their own code so the row can be painted in it. `/screen` is the only user of
`ArgValues::Monitors`, and the names come from the crate's own `screen_capture::monitor_names()` rather than
Tauri's `available_monitors()` — these are what `/screen` resolves against, and a window manager's idea of
what a monitor is called is not always the capture backend's.

### Settings

`/settings` and `/server settings` open the same dialog, which is `tui/settings.rs` with real controls in it:
section headings with a rule out to the edge, a switch for a toggle, a slider for a volume, a button that
opens a list for a device, `edited`/`restart` badges on the rows that earned them, and the server's own
comment on a key printed under it rather than in a foot. The `Save` and `Restart server` rows are still rows
as far as the keyboard is concerned — they are simply drawn as buttons in the footer, index and all. It owns
the keyboard while it is up — the focus moves into it, so nothing typed reaches the composer behind it — and
the selection skips headings the way the TUI's does.

The two halves are not symmetrical, and that is the whole shape of it. **`client.toml` is ours**: a row is
written through the moment it is flipped (`set_client_setting`, which hands back the config so the pane
redraws at once), and the `invert` flag lives in `CLIENT_SETTINGS` in `settings.rs` because the key is the truth
and the label is what it means — `disable_colors` held is "Message colors" turned off. **`server.toml` is
not**: rows are edited locally, marked, and sent in one go by `save_server_settings`, and what comes back is
the config *as it actually stands*, so a row the server refused snaps back instead of sitting there looking
applied. Nothing on this side names a server key — the rows, the headings and the hints are all whatever
`server.toml` turned out to hold, so a key added there needs no client change at all.

On a phone the row turns: a 220px control and a 24px gap leave a setting's *name* about three letters and an
ellipsis, so under `narrow` everything but a switch goes **under** the label and takes the width, and the
label itself wraps rather than being cut — a setting's name is a phrase and not something measured in
characters. A switch stays where every other settings screen puts it, on the right of the thing it turns off.

`restart_server` is the one button that ends the session for everybody, so it is armed by one press and fired
by the next, and is dead while there are unsaved rows in the box.

The `Audio` rows above them are the third kind. A **volume** carries the range it lives in along with it
(`ClientValue::Volume { percent, max, step }`), because the ceiling is `voice_options::VOLUME_MAX` and not a
number to copy into the window; `set_client_volume` clamps, writes and live-updates the running streams, and
hands back what it *stored*, so a row that asked for too much snaps down instead of drawing a bar past its own
end. A **device** row holds the `cpal` id `client.toml` holds — the label is looked up for display out of the
list `get_audio_devices` enumerated when the dialog opened, ⏎ (or a click on the row's button) opens that
list as a picker and ←→ cycles it without one, and `set_client_device` marks the generation so a running call rebuilds its streams instead of
being dropped. A device that is configured but currently unplugged still gets a row, and the empty id is
"whatever the system picks".

`ClientEvent::VoiceDeviceFailed` is the one thing that moves `client.toml` under the dialog: the voice client
points the key back at the device that is actually playing. It arrives as a `client_settings` event carrying
our rows again, which the dialog adopts if it is showing ours — the TUI calls that `refresh_devices`.

Side effects belong outside the state updaters: React runs them twice under `StrictMode`, and an updater that
writes `client.toml` or puts a packet on the wire would do it twice.

### Voice

`client_voice` is on **in both builds** — a phone calls too, and everything below is the same there (see
**Android** for the two things it needs of the platform) — so the crate owns the whole call — the UDP
handshake, the `cpal` streams, the Opus
codec, the denoiser, the mixing — and there is nothing left on this side but to draw it. `/voice` is a plain
packet the crate answers by spawning `listen_server_voice`; `/mute` never reaches the server at all, because
the muted set lives in `options::` and is where the crate drops both a muted user's audio and their messages.

The window learns about all of it through **one** event, `UiEvent::Voice`, carrying the whole `VoiceState`:
whether there is a call, whether the microphone is live, and who is in it. The three move independently and a
panel drawn from half of them lies about the rest, so everything that touches any part goes through
`emit_voice` — `VoiceActivity` arriving, the server letting us in or putting us out, a mute toggled, a volume
slid. `mic` is `!is_muted(None) && input_volume > 0`, because the capture callback treats 0% as off and the
microphone button had better agree.

`VoiceActivity` fires per voice packet, which means it stops entirely in a silent call — so the roster is
kept in `AppState::voice_users` and sent again after a mute, rather than waiting for somebody to speak. The
`connect_to_server` emits it once before anything else, because the muted set outlives a session and a call
nobody has started sends nothing of its own: without that, the microphone button would start out drawn as
muted, and the first press of it would look like it did nothing.

The `muted` flag on a row is ours and not the server's, and the roster only exists while the call does and
somebody is in it (`voice_visible` in the TUI) — the `Voice connected` strip stands on `enabled` alone, so a
call nobody else has joined yet still says so.

`reset_session` clears `voice_options::set_use_voice(false)`: the voice client follows that flag, so a lost
session takes its streams with it.

### Screen sharing

`client_screen` is on **in the desktop build** (see **Android**, which is compiled without it and draws no
monitor button), and both halves of it work in this window — but the watching half **depends on a
change in the sibling crate**, described below, without which this app will not compile.

**Sharing** needs no surface at all: capture, H.264 encode and upload happen inside the crate, so
`/screen [MONITOR]` behaves exactly as it does in the terminal. The monitor is picked on this machine and
never leaves it — the server only ever knows *that* we are sharing — so `emit_screen` reads both halves back
out of the crate's globals (`screen_options::get_use_screen`, `screen_capture::current_monitor`) rather than
keeping state of its own, and the window draws itself from one `UiEvent::Screen`. A bare `/screen` toggles; a
named monitor starts on it, or, **while a share is already running, swaps the capture over without telling
the server anything at all** — that is the one case where `send_command_code` returns `None` for this
command, and the pane's line comes from us.

**Watching** used to be impossible here: `screen::client::attach` handed its frames to a `winit` event loop
through `SCREEN_SHARE_PROXY`, and that loop has to own the main thread, which in this process is Tauri's.
The crate now carries a second way out —

```rust
//network/screen/client/mod.rs
pub static SCREEN_FRAME_SINK: RwLock<Option<UnboundedSender<Vec<u8>>>> = RwLock::new(None);
```

— which `attach` prefers over the proxy: with a sink set it hands over each H.264 access unit as it arrives
and opens no window. That is the whole crate-side change (three edits in one file: the static, the `Video`
branch, and an early return before `UserEvent::NewSession`); the TUI is untouched, because with no sink set
nothing about its path changes. **It lives on `development` and in no published version** — which is why the
dependency is a git one and not a crates.io one (see **What this is**).

This app sets the sink once in `run()`'s `setup`, for the life of the process, and forwards frames to
whatever `Channel<InvokeResponseBody>` the pane last handed it through `watch_frames` (`drop_frames` takes it
back). A frame is tens of kilobytes thirty times a second — nothing on Tauri's binary channel, hopeless as a
JSON array of bytes — and frames arriving while nobody is watching are **dropped rather than queued**, since
a picture nobody sees is worth nothing a second later.

**Who decodes depends on the webview**, and the pane decides before it asks for anything: `h264Codec` probes
`VideoDecoder.isConfigSupported` and `watch_frames(channel, decode)` carries the answer.

- **It can** (Chromium, and WebKitGTK with an H.264 decoder behind WebCodecs): the H.264 travels as it
  arrived and one `VideoDecoder` feeds the canvas. Four things that path insists on: a decoder cannot start
  anywhere but a **keyframe** (`isKeyFrame` reads the NAL type out of the low five bits after each Annex-B
  start code — an IDR slice, or the parameter sets in front of one); the **codec string's level only has to
  be at least the stream's**, so the highest supported of `avc1.42E034`/`42E028`/`42E01E` wins; the stream
  is Annex-B, which is why the config carries no `description`; and what is drawn is the frame's
  **`visibleRect`**, with the source rectangle named in the `drawImage` call, because H.264 codes whole
  macroblocks — a 900-row screen travels as 912 — and the padding is not picture. `h264Config` also asks for
  `prefer-software` before `no-preference`: everything else in this project decodes the same stream with
  `openh264` and draws it correctly, so a picture torn only here is the machine's video hardware rather than
  the stream.
- **It cannot** — the common case on WebKitGTK, where WebCodecs exists but the GStreamer H.264 decoder
  behind it often is not installed (`avdec_h264` from gst-libav, or `openh264dec`; without one,
  `isConfigSupported` says no to every spelling) — `screen_frames` decodes with `openh264` (the crate's own
  decoder) and sends JPEGs the canvas draws through `createImageBitmap`. That runs on a **thread and not a
  task**: decode plus re-encode is tens of milliseconds of unbroken CPU. Every frame is decoded, because
  H.264 is predicted and skipping one breaks the frames after it, but only the newest of whatever piled up
  is re-encoded — the older ones would be wrong by the time they were drawn. This is the path that has to be
  kept cheap without going soft, which is what `JPEG_WIDTH`, `JPEG_QUALITY` and the shape of `write_rgb`
  are for: anything up to 1080p is converted and sent as it is, and above that the block is **averaged**
  rather than sampled — picking every *step*-th pixel is exactly the aliasing the TUI never shows, since it
  hands the planes to the GPU and lets a linear sampler scale them, and for a whole-number factor averaging
  the block is that same thing done on the CPU. The JPEG keeps full-resolution color (`R_4_4_4`): a shared
  screen is mostly text, and text is where 4:2:0 turns a colored letter to mush. It is the same drain-the-backlog,
  draw-only-the-newest shape as the TUI's `display.rs`; what the TUI has and this cannot is the GPU, where
  the YUV planes go up as they are and a shader does the conversion.

Either way the picture lands in a `<canvas>` that **takes the whole window** (`theater`): a screen is
somebody's entire monitor, and every column left standing beside it is taken off the only thing anybody is
looking at — so while it is in front, the sidebar, the member column, the channel header and the composer
all stand down, and the picture's own footer bar carries the way back (`#channel`, or esc), who is being
watched, and `Stop watching`. Out of it, the head of the column is two tabs and `view` says which is in
front. The screen pane is **hidden and never unmounted** while it is being watched: a canvas that left the
page would take the decoder's target with it and come back black. A badge in the pane's footer says which of the two paths is live (`h.264` or `jpeg`),
which is the only way to tell from the outside — and on WebKitGTK the answer changes once `avdec_h264` is
installed **and the app is restarted**, since the GStreamer registry is read when the process starts.

`paint` draws the picture at **the size it is looked at**, and that is the whole of what keeps text readable.
A canvas whose backing store is bigger than its own box is scaled down by the compositor in a single bilinear
tap, which reads four pixels of every sixteen and drops the rest — a 1080p share in a pane a thousand pixels
wide comes out looking pixelated, and that is the one thing the TUI never shows, since its window is the size
of the share to begin with. So the canvas is sized to its own device-pixel box (a `ResizeObserver`, preferring
`devicePixelContentBoxSize`) with the share's aspect kept, which leaves the element's `object-contain` nothing
to do, and the way down is **halved** through a scratch canvas until the last step is inside 2:1 — the ratio a
bilinear tap averages exactly. It is never scaled *up* here: a pane bigger than the share is the one case the
compositor handles perfectly well. Resizing any canvas resets its context, so the smoothing hints are asked
for again on every one of them.

`/screens` is poll-only — the server answers it and never says that somebody started — and it is **asked
only when somebody wants to know**. There is no clock: a list that has to be kept fresh is a packet every
few seconds for an answer that is almost always the same one, so the question is asked when the **Screens**
window opens and when its `Refresh` is pressed, and the list is a photograph of that moment the way `/files`
is. The **member list** therefore carries no watch button — there would be nothing keeping it honest — and
watching starts in the window instead, which is the one door for both directions: everybody who is sharing
(whole rows, ours among them marked `you` and watchable like any other — seeing what everybody else is
seeing is the one thing the person sharing cannot otherwise check) over our own monitors, the live one
badged. The header's monitor button opens it, the sidebar's `Sharing your screen` strip reopens it to swap.
Its rows send `/attach <id>`, `/deattach` and `/screen <name>`.

The ask does **not** go through `send_input`: `refresh_screens` is the `refresh_online` of this question,
waiting out `ROSTER_GAP` since our own last packet, because a `Screens` on the heels of an `Attach` is
exactly what the server calls spam. And every answer opens the window, since nothing asks quietly any
more — a `screens` event is either the window's own ask or somebody typing `/screens`, and both of them
belong in it.

`reset_session` clears `set_use_screen`, `set_attach_screen` and `set_monitor(None)`, exactly what
`tui/state.rs::reset_session` clears: the pick lasts as long as the share does. The session teardown also
drops the frame channel, so a picture cannot outlive the socket it came from.

### Android

The same program, on a phone. Two things are different and nothing else is: **what the build contains**, and
**what the window looks like when it is the shape of a phone**. The two are decided independently — the
layout is a width and the feature set is a target — because a desktop window dragged narrow has exactly the
first problem and none of the second.

**What the build contains.** **Android is `client_base` + `client_voice`**: the chat, the channels, the
conversations, the files, TOFU, both configs — and the call. What it is *not* is `client_screen`, which
captures through `xcap`/`libwayshot` and draws through `winit`/`wgpu`, wanting the main thread Tauri already
owns; a phone shares its screen through `MediaProjection` anyway. `Cargo.toml` says that with two
`[target.'cfg(…)'.dependencies]` sections, and `build.rs` sets **two cfgs, `voice` and `screen`**, the second
off for that target — which is what every gate under `src-tauri/src/` is written against. **The features and
the cfgs are one answer spelled twice — change one and change the other.**

The call was left out for a long time on the grounds that none of it cross-compiles, and that turned out to
be one library rather than a wall:

- **`cpal` gates its PulseAudio dependency to Linux itself**, and on a phone its backend is **AAudio**
  through the `ndk` crate. Nothing in the crate's voice code is in the way either — every platform branch in
  it is `target_os = "linux"`, so the `default_host()` side is what Android takes.
- **`nnnoiseless`, `ringbuf` and `lewton` are pure Rust**, and `gag` only wants a unix.
- **`audiopus` is the one that does not build.** Its `audiopus_sys` compiles a vendored libopus with
  autotools and passes no `--host`, so `configure` runs *this* machine's tests against a cross compiler and
  stops. But it asks **pkg-config first and returns the moment that answers**, which is the whole way in:
  `scripts/opus-android.sh` builds libopus once per ABI from a pinned release tarball into
  `src-tauri/gen/opus/<target>/`, and `scripts/android-env.sh` — which every `android:*` npm script runs
  inside — points `PKG_CONFIG_PATH_<target>` at it. **Per target and not once**, because one
  `tauri android build` compiles all four ABIs in one process and a single path would hand the arm library
  to the x86 one. `LIBOPUS_STATIC` is set with it, since `audiopus_sys` decides static-or-shared from the
  machine it is *compiled on* and would otherwise link the phone against a `libopus.so` that is not there.

Three things the platform itself has to be asked for, and `src-tauri/src/android.rs` is the only place in
this app that speaks JNI:

- **A context.** `cpal` asks `ndk_context` for one whenever it enumerates devices and **panics** where
  nobody set one — Tauri's Android side is Kotlin and has no use for it, so nothing does. `JNI_OnLoad` is
  where the `JavaVM` is handed to us (it runs on `Rust.kt`'s `System.loadLibrary`), and the `Application` is
  reached from there through `ActivityThread.currentApplication()` — no activity needed. Without this the
  settings dialog's device rows abort the process.
- **The microphone.** `RECORD_AUDIO` is a runtime permission and only an `Activity` can ask for it, so
  `MainActivity` carries three statics (`microphoneGranted`, `requestMicrophone`, `microphoneDenied`) and
  `ensure_microphone` calls them. It is asked **when the call is started and not at launch** — `send_input`
  holds the `/voice` packet back until the answer is in, so saying yes to the dialog is also joining. The
  refusal is watched for beside the grant because Android answers for the user once they have said no twice,
  and answers instantly. `prepare()` is also where the activity's class is looked up, and it goes through the
  application's own class loader: a tokio worker is attached with the system one, which knows nothing this
  app wrote.
  Whether the permission is *already* there is asked of the **application** as well (`context_granted`,
  `Context.checkSelfPermission` on the object `ndk_context` was handed), because that one is always
  standing: a permission allowed in Android's own app settings is then seen even where the activity cannot
  be reached at all, which is the one answer a user who has already said yes must never get again. The two
  ways of failing to ask are kept apart — no activity on screen, and the Java side not reached at all —
  since the second is a bug here rather than something to send somebody to Settings for, and `warn` puts it
  in logcat under `WHY2` beside the line in the pane. `prepare()` is retried until it works for the same
  reason: one lookup that failed early used to be a microphone that never opened again.
- **The session, once the window is gone.** An app that is not on screen is a process Android is free to
  freeze and then kill — which is what used to end the socket the moment the window went away — and since 9
  it is also one the microphone is simply cut off from. A **foreground service** is the only answer to
  either, and the notification is the price of it rather than a feature.
  `scripts/android/SessionService.kt` is that service. It runs for **as long as there is a session**, call
  or no call, and says which of the two things it is holding: `specialUse` for the socket, and `microphone`
  beside it while there is a call. **`specialUse` and not `dataSync`** because 15 stops a `dataSync` service
  after six hours in a day, and a chat connection that dies at lunchtime is worse than one that never
  claimed to survive — the one cost is that publishing this on Play would put the manifest's
  `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` in front of a reviewer. Changing between the two is `startForeground`
  again on the same notification id with the other type, and a `microphone` the system refuses falls back to
  the half that is always allowed rather than taking the socket's hold down with it. `START_NOT_STICKY`,
  because a session is something somebody opened and a service Android brought back by itself would have no
  socket under it. Both statics take a `Context` rather than holding one — the application, which is the
  context still standing when the activity is not, and that is exactly the moment the service matters.
  Two flags, because the two are set from two places: `hold_session` from `connect_to_server`, the moment
  there is a socket **and while the window still has the screen** (14 refuses a foreground service started
  from the background, which is where asking any later would be from), and `hold_call` from **`emit_voice`**,
  the one place that already knows whether there is a call. `apply()` is what puts the pair to Android, and
  only when it is not already doing it — `emit_voice` runs on every voice packet. `release()` takes both
  down, out of `reset_session`, with everything else the session owned. `HELD` follows what Android *did*
  rather than what was asked, so a start that did not take is asked for again at the next event.
  A **refused notification** (`POST_NOTIFICATIONS`, 13+) costs the line in the shade and not the session,
  which is why it is asked for in the same dialog as the microphone rather than gating anything. Aggressive
  vendor battery managers — MIUI's among them — can still kill a held process; that is a setting on the
  phone and not something the app can ask for.

The class names come from `build.rs`, which reads the identifier out of `tauri.conf.json` — a name that is
wrong here is not a build error but a call that silently never asks. And **`minSdkVersion` is 26**, because
that is where AAudio starts.

The gating is arranged so that call sites do not move:

- `emit_voice` and `emit_screen` exist either way. Without the cfg they emit a call that is not running and a
  share that is not up, so the window draws its panels from an answer rather than from nothing. Android takes
  the real `emit_voice` and the empty `emit_screen`, which is why they are two cfgs and not one.
- `ClientEvent`'s variants are **not** behind the crate's features (only what they are answered *with* is), so
  every match arm in `handle_event` stands on both sides and only the bodies that reach into `voice_options`/
  `screen_capture` are cfg'd.
- `Command::Screen` is behind `screen`, so that arm of `send_input` is cfg'd out there; `Command::Mute` is
  behind `voice` and stands on both.
- `ClientKind`/`ClientValue` and `AUDIO_SETTINGS` follow `voice`, so a phone gets the whole `Audio` section —
  devices, volumes, the denoiser — with the device rows listing what AAudio actually reports.
- `get_audio_devices`, `set_client_volume` and `set_client_device` keep their names and lose their bodies
  where the cfg is off: `generate_handler!` is one list and not a place for a cfg.

**What the generated project does not know.** `gen/android` is made on every machine and in CI, and it has
no idea the app records audio, still less that it goes on doing so behind the home button.
`scripts/android-patch.sh` is what tells it: it inserts `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_SPECIAL_USE` and
`POST_NOTIFICATIONS` into the manifest (each only where it is missing, and in the order written there) along
with the `<service android:name=".SessionService">` element and its special-use subtype, writes
`MainActivity.kt` and `SessionService.kt` from `scripts/android/`, keeping the package line the generated
activity already had, copies the launcher out of `scripts/android/res/` over the template icons `init` put
there, and points the theme's `windowBackground` at the splash drawable that came with it (see **The name and
the mark**). It runs after every `init` and again in front of every build, and a **missing anchor
is an error and not a shrug** — Tauri changing its template should stop the build rather than quietly ship
an APK whose microphone never opens.
The service element is **rewritten and not skipped when present** (matched by class name, the old one
included), so a change here reaches a `gen/android` that was patched by an earlier version — the manifest is
then parsed back as XML before it is written, because a half-removed element fails several steps later, in
the manifest merger, saying nothing about where it came from.

**What the window knows about it.** Nothing on the frontend is told which platform it is on. The palette is
already `get_commands`, which is `COMMAND_LIST` filtered by role — and `/voice` and `/screens` are in
`COMMAND_LIST` only where their features are, so `hasVoice`/`hasScreens` in `App.tsx` are read straight off
that list. That is the one honest answer to "can this build do it", and it is the same question on either
platform: turning `client_voice` on for Android is the whole of what put the headset in the phone's channel
header — no frontend change went with it.

**What the window looks like.** Under `NARROW` (820px) `useNarrow` flips the layout to the one every phone
chat app has settled on:

- The two sidebars become **drawers** over the conversation — the same JSX, `position: fixed` and translated
  off-canvas. They are always rendered and never conditionally mounted, because a panel that is mounted when it
  opens has nowhere to slide from; `.drawer-shut` makes the parked one `visibility: hidden` so it is out of
  reach of a tap and of the tab key.
- The channel header gains the hamburger, and its members button toggles the right drawer instead of the
  column. Picking a channel, a conversation or a member closes the drawer it was picked in.
- A **sideways swipe** on the window opens and closes them, and the drawer follows the finger rather than
  appearing at the end of it (`onSwipeStart`/`onSwipeMove`/`onSwipeEnd`/`onSwipeCancel`). What the drag is
  about is decided once, after `SWIPE_SLOP`, and then kept: a drawer already open is the one being moved,
  otherwise the direction picks one — and a drag that is mostly vertical is somebody reading (`SWIPE_SLOPE`).
  Letting go commits the direction if it travelled `SWIPE`, and otherwise puts the drawer back where it came
  from. The position is written **straight onto the elements** (`panelRef` on both columns, `scrimEl` on the
  sheet) with the transition off, because a finger puts out sixty positions a second and React owns where a
  drawer *is* rather than where it is being dragged to; `settle` animates the last stretch and hands the
  inline styles back to the classes `DRAWER_MS` later, once the drawer has arrived. **What is written is
  `translate` and not `transform`** — that is the property Tailwind v4's `-translate-x-full` sets, and the
  two compose rather than replace each other: a `transform` on a shut drawer moves it relative to the 100%
  the class has already taken it off by, which is a drag nobody can see, and a transition naming `transform`
  watches a property that never changes, which is a drawer that snaps instead of sliding. The scrim is therefore
  mounted whenever a drawer could be — faded out and `pointer-events-none` while there is none — since a
  sheet mounted at the end of the drag would have nothing to darken from.
- The **back gesture** closes whatever is in front rather than the program. It is a press the *activity*
  gets, and `TauriActivity` overrides `WryActivity`'s handling of it to `false` — so nothing in the page ever
  sees one, and a history entry parked for a drawer is spent by nobody. `MainActivity` registers its own
  `OnBackPressedCallback` and asks the page: `window.__why2Back`, written by `App.tsx` on **every** render
  (it reads that render's state, so a dependency list would be the same list twice and the stale one would
  close nothing), closes whatever is on top and answers `true`. With nothing in front it answers `false`, the
  callback stands aside for one press, and back means what it always did.
- **The keyboard hints go**, since a soft keyboard has none of those keys on it: the palette's
  `↑↓ select · tab complete · esc dismiss` and the settings footer's `Arrows move and change, esc closes.`
  are both drawn only where `narrow` is false. The footer's other two lines are not hints and stay.
- Every dialog is the whole screen rather than a card in a darkened room (`dialogWrap`/`dialogCard`), the
  composer is a pill, and the composer does not take the focus on its own: a soft keyboard is half the screen,
  and it opens when the line is tapped. `showDirect`, `closeSettings` and `closeFiles` all check `narrow`
  before pulling the focus back.
- `index.html` asks for `viewport-fit=cover` **and** `interactive-widget=resizes-content` — the second is the
  whole difference between a composer above the keys and one pushed off the top of the screen. `<main>` is
  `h-dvh` for the same reason, and pays the safe-area insets back once (`.safe-top`/`.safe-bottom`) so every
  column inside is already clear of the notch. A `fixed` drawer is positioned against the viewport and not
  against `<main>`, so it pays its own.

**Where the config lives.** The crate expands `{HOME}` into every path it keeps `client.toml`, `server.toml`
and the TOFU pins in, through `dirs::home_dir()` — which is `None` on Android, because an app process has no
home directory, and the crate `expect`s its way out of that. So `run()` sets `HOME` to
`app.path().app_data_dir()` before anything reads it, and **that is why `config::init_config()` is called from
inside `.setup()` rather than ahead of the builder**: nothing knows the path until there is an `App` to ask.
Moving the config work back out breaks Android only, and breaks it as a `SIGABRT` at launch with no window
ever drawn. Everything lands in `/data/user/0/<identifier>/.config/WHY2/`.

**What an upload is on a phone.** The picker answers with a `content://` URI: a handle on somebody else's
file, granted to this process, and not a place on the disk. `File::open` cannot take one, and neither can the
crate's upload task, which reopens the path by itself when the server approves — so `stage_content_uri` in
`input.rs` reads it through the content resolver once and copies it into the app's own cache, which is a real
path. That resolver is reachable from Rust through **`tauri-plugin-fs`**, which is therefore an Android-only
dependency (`app.fs().open(FilePath::Url(…))` hands back a `std::fs::File` made from the provider's fd); the
generated Gradle project picks the plugin up from Cargo on the next build, with no `android:init` needed. The
copy is named after the file the descriptor actually points at (`/proc/self/fd/N`, which for a
provider backed by a real file is the real path), falling back to the URI's own last segment decoded — the
name is what everybody else on the server will see. The copy is blocking I/O over the whole file, so it is in
`spawn_blocking` like the hash.

Not yet done on Android: **screen sharing**, which wants a `MediaProjection` capture path in the crate.
Watching one wants a decoder here as well — the JPEG fallback is `openh264`, which is desktop-only for the
same build reasons `client_screen` is.

A session survives being backgrounded for as long as it lasts — see **The session, once the window is
gone** — so the one thing left here is that **nothing reconnects on resume**: a socket the network dropped
while the phone was asleep is a session to dial again by hand.

### Input history

`↑`/`↓` on the input line are `InputBuffer`'s history from `tui/input.rs`, rewritten in `history.ts`
(`historyUp`, `historyDown`, `pushHistory`). `pos` at the end of `entries` means "not searching"; the first
`↑` parks the half-written line in `stash` **and** locks the search to it as `prefix`, so `↑` walks what was
typed before rather than everything ever sent, and the last `↓` puts that line back. A line starting with `/`
never becomes the prefix — that one is the palette's search, not this one — and the same line twice in a row
is one entry.

The arrows only mean this while no palette menu is open; a menu takes them for its own selection, exactly as
the TUI does. The history is a **ref**: nothing is drawn from it, and it is read and written one keypress at
a time.

### TOFU

The identity check is answered **in-band**. The handshake parks on a `oneshot`, which arrives as
`ClientEvent::TofuPrompt`; the bridge stashes the sender in `AppState::tofu_reply` and `answer_tofu` sends the
verdict. On accept the crate pins the key and reconnects *itself* — the frontend must not dial again. A
mismatch has to be typed out (`yes`) rather than clicked, as in the TUI. The prompt can also appear mid-session,
because the periodic rekey runs the same check, which is why the overlay renders on both screens.

### Channels and message routing

Messages carry no channel field. `App.tsx` keeps `paneByChannel` and files each incoming entry into
**whatever channel is current at the time it arrives**, read via `currentChannelRef` (a ref, not state — the
listener is registered once with `[]` deps and would otherwise capture a stale channel). The lobby is the empty
string. The roster (`users` event) is authoritative for which channels exist — one lives exactly as long as
somebody sits in it — and history for a channel nobody is in any more is dropped.

Unlike the TUI, which clears the pane on every switch, this app keeps per-channel history locally. The server
only ever replays the lobby, once, at login (`history`).

### Direct messages

The TUI prints a PM into the scrollback as `[PM FROM] name (id): text`, which is the whole of what a terminal
can do with one. A window can do what every other chat program does, so a private message is **not** a line of
whatever channel happened to be open when it landed — it is a conversation, and it has a pane of its own.

The server knows nothing about any of this: it routes a `PrivateMessage` and keeps no history, so a
conversation exists because somebody opened it or because something arrived in it, and it lasts exactly as long
as the session does. `dms` is keyed by the **other** person's id, `openDm` is which one the middle column is
showing, and `openDmRef` is the ref version the listener reads — a line landing in the conversation being read
is not unread.

The routing hangs on one field. `ClientEvent::PrivateMessageRecv` names the sender and
`PrivateMessageSent` (the server's echo of one we sent) names the recipient, so **the id and name are the peer
either way** — that is what `DirectPeer { id, username, outgoing }` carries. The echo names nobody but the
recipient, so an outgoing line arrives with an empty `username` and `renderChat` puts ours in: this side of the
bridge is the one place that never learns our own name.

Everything else is the shape the window already has:

- Clicking somebody in the member column opens the conversation with them (our own row is not a button — the
  server refuses a PM to ourselves). The open conversations are a section in the left sidebar under the
  channels, with an unread count and an `×`; closing one is closing it **for good**, since nothing but this
  window ever held it.
- The composer sends through the command path like everything else: in a conversation a plain line becomes
  `/pm <id> <line>`, and a line that already starts with `/` is a command wherever it was typed. The history
  keeps what was typed, not what it turned into.
- Walking into a channel walks out of the conversation — the sidebar's channel rows and the `channel_changed`
  event both clear `openDm`, and a row for the channel we are already standing in is a way back rather than a
  packet.
- `columnLabel`/`columnIcon` are the same question asked in four places: the header, the screen tab, the way
  back out of a screen, and the composer's placeholder. `whisper` (the accent rule and the `private` badge) is
  drawn only **outside** a conversation, where a line being private is news.

### Roster refreshes

The server counts *packets*, not messages, against `min_message_delay`, and it broadcasts our own `Join` right
behind `Accept` — so the two events that both want a roster used to put two `List` packets on the wire a
millisecond apart and earn a spam warning. `refresh_online` coalesces them the way the TUI's `refresh_online`
flag does, then waits until our own last packet is `ROSTER_GAP` behind it. Never send a `List` (or anything
else unprompted) straight out of an event handler — go through `refresh_online`, and route anything you do send
through `send_packet` so the clock it reads stays honest.

### Colors

The protocol carries 16 ANSI color codes. `to_color` in `color.rs` parses names/numbers → code plus canonical
name (persisted to `client.toml`); the `ANSI` table in `theme.ts` maps code → hex. Both must stay in sync, and
`disable_colors` turns the message colors off without touching the theme.

There are **two** tables: `ANSI` is the lifted set the names and the message text are painted in — these sit
on a near-black surface rather than in a terminal, and `black` on black is not a name anybody could read —
while `ANSI_TRUE` is the unmodified set, used for the swatch in the color palette, where the point is to show
which color is actually being picked.

**Our own name is painted in our own color**, the same as everybody else's — `theme.rs::render` in the TUI
makes no exception for the person reading, and neither does `renderChat`. The accent is only what is left
where there is no color to use (nobody picked one, or `disable_colors` is on), which is what still says
"this one is you"; painting our own name accent regardless made `/ucolor` a command with no visible effect
in the window that ran it.

### Adding a Tauri plugin

Three places, all required: `src-tauri/Cargo.toml`, the `.plugin(…)` chain in `run()`, and the `permissions`
array in `src-tauri/capabilities/default.json`. Missing the capability entry fails only at runtime — and a
permission with a **scope** (`opener:allow-open-url` is one) needs the entry written as an object with its
`allow` list, since the bare identifier allows the command and no argument to it.

A plugin only one platform needs is a target-gated dependency and a gated `.plugin(…)`, which is why `run()`
builds the builder into a `let` rather than one chain: `tauri-plugin-fs` is Android's alone. Nothing has to be
regenerated for it — `gen/android/tauri.settings.gradle` is written from the Cargo dependencies on every
build.

### CI

`.github/workflows/build.yml` is one workflow with two jobs, and it is a plain single-repo checkout because
the crate arrives over git rather than off the disk beside it.

**`build-desktop`** is a four-way matrix — Linux, macOS on both architectures (`macos-latest` is Apple
silicon, `macos-13` is Intel), Windows — installing the same system libraries the local build wants, then
`npm run tauri build`. That runs `beforeBuildCommand` on the way in, so the tsc typecheck is part of it
rather than a job of its own. The bundles are uploaded per runner.

**`build-android`** installs JDK 21, the SDK, the NDK and the four targets, generates `gen/android` (it is
not tracked), and builds a **release** APK. The generated Gradle project carries **no `signingConfigs`**, so
that APK comes out unsigned and nothing will install it; a step gated on `secrets.ANDROID_KEYSTORE` aligns
and signs it with `zipalign`/`apksigner` out of build-tools, and is skipped when the secrets are absent, the
unsigned APK still being uploaded. It is done that way round — signing the finished file rather than teaching
the Gradle project to sign — because `app/build.gradle.kts` is generated by the job two steps earlier, and a
patch against it would rot silently the first time Tauri changes the template. The other secrets are
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.

Release is ~10 MB and debug is ~377 MB, which is the whole argument for building the release one.

## Conventions

- **Every source file** (`.rs`, `.ts`, `.tsx`, `.css`, `.html`, `.toml`) carries the GPLv3 header block naming
  Václav Šmejkal. Copy it into any new file — every module under `src/` and `src-tauri/src/` has one.
- Rust uses **Allman braces** — opening brace on its own line, including for `match` arms, closures, `if`, and
  struct literals. This is not rustfmt default; do not run `cargo fmt`, it will reformat the whole codebase.
  TS/TSX and CSS follow the same brace style with 4-space indent.
- Comments in Rust are `//ALL CAPS`, no space after the slashes. The upstream crate writes them as short
  explanations of *why*, often several lines above a block; match that rather than narrating the code.
- Styling is Tailwind v4 (`@import "tailwindcss"` in `src/index.css`, configured with CSS custom properties in
  the `@theme inline` block in `src/theme.css` — there is no `tailwind.config.js`). Use the semantic tokens — surfaces
  (`bg-deep`, `bg-sidebar`, `bg-chat`, `bg-raised`, `bg-overlay`, `bg-hover`, `bg-selected`, `bg-active`),
  text (`text-text`, `text-muted`, `text-faint`), meaning (`text-accent`, `text-brand`, `text-notice`,
  `text-ok`, `text-error`, `text-online`, `text-warning`), and `border-border` / `border-border-strong` —
  never raw colors. The app is dark only; there is no light theme to switch to.
- Icons are `Icon`/`IconButton` in `icons.tsx`: one component over a table of 24×24 stroked paths. An icon set
  is not worth a dependency. Every `IconButton` carries a `label`, which is its tooltip and its accessible
  name both.
- Add `font-mono` deliberately, to the things that are measured in characters — the branch glyphs, the padded
  ID columns, fingerprints, command signatures. Everything else is the proportional face.
