# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WHY2 Desktop is a Tauri 2 desktop GUI for the WHY2 chat protocol. All protocol work (async TCP framing,
hybrid ECC+ML-KEM key exchange, TOFU key pinning, commands, roles, config) lives in the sibling `why2-chat`
crate, pulled in as a **path dependency**:

```toml
why2-chat = { path = "../../WHY2/chat", default-features = false, features = ["client_base", "client_voice"] }
```

That resolves to `/mnt/data/Rust/WHY2` relative to `src-tauri/`. **The sibling checkout must be present or the
Rust build fails.** `client_voice` pulls in `cpal`, `audiopus` and `nnnoiseless`, so the build also wants the
system's audio development libraries (opus, and PulseAudio/ALSA) — a missing one fails in a `*-sys` build
script, not in this code. When behaviour looks wrong, the cause is often in that crate, not here — read
`/mnt/data/Rust/WHY2/chat/src/` (`network/client.rs`, `network/codes.rs`, `command.rs`, `options.rs`) before
assuming a bug in this repo. This app is a thin presentation layer over it.

`chat/src/bin/client/` is the crate's own terminal client (ratatui). **It is the reference implementation for
everything this app does** — `tui/event.rs` maps every `ClientEvent` to UI state, `mod.rs::submit` handles every
line the user types, and `tui/state.rs::reset_session` lists the globals a session has to put back. When adding a
feature here, read how the TUI does it first: the two are deliberately kept in step about *behaviour* —
what a line does, what an event means, what a session has to reset. They no longer look alike, and are not
meant to (see **The window**).

Do not run cargo inside `/mnt/data/Rust/WHY2` — path dependencies build into *this* repo's `src-tauri/target`,
and that is the only reason the sibling checkout stays clean.

## Commands

```bash
npm run tauri dev      # full app (spawns vite on :1420 + cargo, hot reload on both sides)
npm run tauri build    # bundled release binary
npm run dev            # frontend only in a browser — Tauri `invoke`/`listen` are unavailable, so
                       # nothing past the server-select screen works. Rarely useful.
npm run build          # tsc typecheck + vite build (this is the only "lint": tsconfig has
                       # strict, noUnusedLocals, noUnusedParameters)
cargo check --manifest-path src-tauri/Cargo.toml   # fast Rust-only feedback
```

There is no test suite, no ESLint/Prettier, and no formatter config. Verification is `npm run build` +
`cargo check`, then running the app against a WHY2 server.

## Architecture

Three layers, and the boundary between them is deliberately narrow:

1. **`why2-chat` crate** — owns the socket, the protocol, and persistent config/TOFU state. Everything is
   `async` on tokio, and the crate spawns its own tasks (uploads, downloads), so every call into it must be
   made from inside the runtime.
2. **`src-tauri/src/lib.rs`** (single file) — the bridge. Holds `AppState`, exposes five `#[tauri::command]`s,
   and translates `ClientEvent`s into UI events.
3. **`src/App.tsx`** (single file) — the entire UI. One component, no router, no state library.

### The event bridge (the thing to understand first)

`connect_to_server` spawns two tasks: `client::listen_server` writes `ClientEvent`s into a tokio `mpsc`
channel, and `pump_events` drains it and re-emits to the webview as a **single Tauri event named
`why2-event`**. The payload is `UiEvent`, adjacently tagged by serde, so the frontend sees
`{ "event": "message", "data": { … } }` and switches on one field. `BridgeEvent` in `App.tsx` is the mirror of
that enum — **adding an event means adding a variant on both sides**, and the TS union is what makes a missed
case visible.

Chat lines all arrive as one `message` event carrying a `ChatMessage` whose `kind` (`user`, `private`,
`system`, `notice`, `ok`, `error`) is what the frontend styles on — joins, uploads and server notices are not a
separate channel, they are messages nobody said. `/list` and the ban list arrive as a `block` event (a flat
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

### Sessions

Two things make session lifetime subtle:

- The crate keeps session state in **process-wide globals** (`options::`): sequence counters, login state,
  the active channel, the shared keys. `reset_session()` in `lib.rs` mirrors the TUI's function of the same
  name and must run on every connect and teardown — a second connection that kept the first one's sequence
  numbers has every packet it sends refused.
- `AppState::session` is a counter bumped on every connect. An old `pump_events` can outlive its socket (a
  half-finished upload still holds a `Sender`), so it checks the counter and goes quiet rather than letting
  its last events — or its cleanup — land on the connection that replaced it.

### The window

The app used to be the terminal client redrawn cell for cell. It is not any more: the layout is the one every
chat program has settled on, because that is the one a user already knows how to read.

Three columns, and a screen in front of them while there is no session:

- **Left** — the server (name over the address as it was typed) and, where our role has one, the door to
  *its* config; the channel list with a `+` that makes one; then the call: the voice roster while there is
  one, the `Voice connected` strip with the button that hangs up, and at the bottom the person using the
  program — face, name, role, microphone, **our own** settings, and the way out. The two gears are two
  different configs and sit with what they belong to: the server's by the server's name, ours by ours.
- **Middle** — the channel header (`#name`, how many are online, and the buttons for files, voice and the
  member column), the messages, and the composer, whose `+` is the one upload button. The command palette
  floats on the composer.
- **Right** — everybody on the server, with the channel each of them is sitting in, toggled by the header's
  own button.

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
protocol colors in `ANSI`. `index.css` holds the whole palette as CSS custom properties, mapped to Tailwind
tokens in one `@theme inline` block.

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
and its headset `/voice`; the microphone button sends `/mute`; a row of the file list sends
`/download <user_id> <file_id>`, and a row of the voice roster sends `/mute <id>` — or `/mute` on our own
row, the one the command takes no ID for. Prefer extending the command path over adding a
`#[tauri::command]`.

`get_commands` reflects `command::COMMAND_LIST` filtered by the role the server granted us
(`CommandInfo::available`), so the palette follows a promotion without a reconnect — the frontend re-invokes it
whenever a `role` event names no user (that one is ours). Hiding a command is cosmetic; the server checks every
privileged packet itself.

### The palette

`analyze` in `App.tsx` is `palette::update` rewritten in TypeScript, and the four states are the TUI's
`PaletteMode`: a **menu** of commands (or, once `/server ` has its space, of *its actions* — a command that is
a doorway is one row until then, never nine), the **values** a parameter accepts, the **signature** hint for
one that accepts anything, or hidden. The matching is on `triggers`, not on the canonical name, so `/stfu`
finds `/server mute` the same way it does in the terminal. ⇥ completes whatever is highlighted; ⏎ completes
only what is not spelled out already, and otherwise sends the line.

The vocabularies are not shipped with the command list: `get_vocabulary` is invoked when the caret lands on a
parameter that has one and dropped when it leaves, because a monitor plugged in mid-session is supposed to
show up. Colors carry their own code so the row can be painted in it. `/screen` is the only user of
`ArgValues::Monitors` and lives behind `client_screen`, which this build does not enable — the monitors come
from Tauri's own `available_monitors()` rather than the crate, so the helper works the day the feature is on.

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
redraws at once), and the `invert` flag lives in `CLIENT_SETTINGS` in `lib.rs` because the key is the truth
and the label is what it means — `disable_colors` held is "Message colors" turned off. **`server.toml` is
not**: rows are edited locally, marked, and sent in one go by `save_server_settings`, and what comes back is
the config *as it actually stands*, so a row the server refused snaps back instead of sitting there looking
applied. Nothing on this side names a server key — the rows, the headings and the hints are all whatever
`server.toml` turned out to hold, so a key added there needs no client change at all.

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

`client_voice` is on, so the crate owns the whole call — the UDP handshake, the `cpal` streams, the Opus
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

### Input history

`↑`/`↓` on the input line are `InputBuffer`'s history from `tui/input.rs`, rewritten in `App.tsx`
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

### Roster refreshes

The server counts *packets*, not messages, against `min_message_delay`, and it broadcasts our own `Join` right
behind `Accept` — so the two events that both want a roster used to put two `List` packets on the wire a
millisecond apart and earn a spam warning. `refresh_online` coalesces them the way the TUI's `refresh_online`
flag does, then waits until our own last packet is `ROSTER_GAP` behind it. Never send a `List` (or anything
else unprompted) straight out of an event handler — go through `refresh_online`, and route anything you do send
through `send_packet` so the clock it reads stays honest.

### Colors

The protocol carries 16 ANSI color codes. `to_color` in `lib.rs` parses names/numbers → code plus canonical
name (persisted to `client.toml`); the `ANSI` table in `App.tsx` maps code → hex. Both must stay in sync, and
`disable_colors` turns the message colors off without touching the theme.

There are **two** tables: `ANSI` is the lifted set the names and the message text are painted in — these sit
on a near-black surface rather than in a terminal, and `black` on black is not a name anybody could read —
while `ANSI_TRUE` is the unmodified set, used for the swatch in the color palette, where the point is to show
which color is actually being picked.

### Adding a Tauri plugin

Three places, all required: `src-tauri/Cargo.toml`, the `.plugin(…)` chain in `run()`, and the `permissions`
array in `src-tauri/capabilities/default.json`. Missing the capability entry fails only at runtime.

## Conventions

- **Every source file** (`.rs`, `.ts`, `.tsx`, `.css`, `.html`, `.toml`) carries the GPLv3 header block naming
  Václav Šmejkal. Copy it into any new file.
- Rust uses **Allman braces** — opening brace on its own line, including for `match` arms, closures, `if`, and
  struct literals. This is not rustfmt default; do not run `cargo fmt`, it will reformat the whole codebase.
  TS/TSX and CSS follow the same brace style with 4-space indent.
- Comments in Rust are `//ALL CAPS`, no space after the slashes. The upstream crate writes them as short
  explanations of *why*, often several lines above a block; match that rather than narrating the code.
- Styling is Tailwind v4 (`@import "tailwindcss"` in `src/index.css`, configured with CSS custom properties in
  an `@theme inline` block — there is no `tailwind.config.js`). Use the semantic tokens — surfaces
  (`bg-deep`, `bg-sidebar`, `bg-chat`, `bg-raised`, `bg-overlay`, `bg-hover`, `bg-selected`, `bg-active`),
  text (`text-text`, `text-muted`, `text-faint`), meaning (`text-accent`, `text-brand`, `text-notice`,
  `text-ok`, `text-error`, `text-online`, `text-warning`), and `border-border` / `border-border-strong` —
  never raw colors. The app is dark only; there is no light theme to switch to.
- Icons are `Icon`/`IconButton` in `App.tsx`: one component over a table of 24×24 stroked paths. An icon set
  is not worth a dependency. Every `IconButton` carries a `label`, which is its tooltip and its accessible
  name both.
- Add `font-mono` deliberately, to the things that are measured in characters — the branch glyphs, the padded
  ID columns, fingerprints, command signatures. Everything else is the proportional face.
