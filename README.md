# WHY2 Desktop

**A window on the WHY2 chat protocol — chat, voice calls and screen sharing, on Linux, macOS, Windows
and Android from one source tree.**

WHY2 Desktop is a [Tauri 2](https://tauri.app) GUI over the
[`why2-chat`](https://crates.io/crates/why2-chat) crate: a React frontend, a thin Rust bridge, and the
protocol itself living entirely in the crate. It is the same program the terminal client is, drawn the way
every other chat program is drawn — a server rail, a channel sidebar, a message pane and a member column,
rather than a scrollback and a prompt.

---

## Features

Everything the protocol does, the terminal client does, and this window does it too — the two are
deliberately kept in step about *behaviour*.

### Security
- **REX encryption** on everything, before it reaches the socket
- **Hybrid key exchange**: ECC + ML-KEM post-quantum key encapsulation
- **TOFU key pinning**, answered in-band: a first key is accepted from the window, a *changed* key has to
  be typed out
- **Automatic rekeying**, and the identity check runs again each time
- **Muting is local**: a muted user's audio *and* messages are dropped by the crate, not by the server

### Communication
- **Text chat** with per-channel history kept locally, grouped by speaker
- **Direct messages** as real conversations with panes of their own, not lines in whatever channel was open
- **Channels**, which exist for exactly as long as somebody is standing in one
- **Voice calls** — Opus, noise suppression, voice activity, input and output volume, per-user mute —
  with the channel's whole voice roster shown whether or not you are in the call
- **Screen sharing**, both directions: share a monitor, or watch somebody else's full-window
- **File transfer**, with a drawer that lists what everybody on the server is offering
- **Server list**: the addresses and identities you use, remembered, so the window stops asking

### The window
- **Our own title bar** on Linux and Windows, the system's traffic lights on macOS
- **A phone layout** under 820px — sidebars become swipeable drawers, the back gesture closes what is in
  front, dialogs take the whole screen
- **Both settings dialogs** — `client.toml` written as you flip a row, `server.toml` edited, marked and
  saved in one go — with real switches, sliders and device pickers
- **The command palette** from the terminal client, filtered by the role the server actually granted you
- Nearly monochrome on purpose: the only saturated thing in the window is what somebody said

### Platform support

| Platform | Chat | Voice | Screen sharing | Watching a screen |
|----------|------|-------|----------------|-------------------|
| Linux    | ✅ | ✅ | ✅ | ✅ |
| macOS    | ✅ | ✅ | ✅ | ✅ |
| Windows  | ✅ | ✅ | ✅ | ✅ |
| Android  | ✅ | ✅ | ❌ | ❌ |

Android is built without the `client_screen` feature: capture there means `MediaProjection`, which the
crate does not have yet.

---

## Building from source

### Prerequisites

Node 22+, a Rust toolchain, and the system libraries Tauri and the voice codec want.

#### Linux
```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf file \
  libayatana-appindicator3-dev libxdo-dev libssl-dev \
  pkg-config libasound2-dev libopus-dev libpipewire-0.3-dev libegl-dev \
  clang libclang-dev libgbm-dev nasm
```

#### macOS
```bash
brew update && brew install opus pkg-config nasm
```

#### Windows
```powershell
choco install nasm
```

### Commands

```bash
npm install

npm run tauri dev      # the app, with hot reload on both sides
npm run tauri build    # the bundled release binary

npm run build          # tsc typecheck + vite build — this is the only "lint"
cargo check --manifest-path src-tauri/Cargo.toml   # fast Rust-only feedback

npm run icons          # regenerate every icon from src-tauri/icons/why2.svg (by hand, when the mark changes)
```

There is no test suite and no formatter config. Verification is `npm run build` + `cargo check`, then
running the app against a WHY2 server. **Do not run `cargo fmt`** — this codebase is Allman-braced and
rustfmt would reformat all of it.

### Android

Wants the Android SDK, the NDK and a **JDK 17 or 21** (the Android Gradle Plugin refuses anything newer),
with `ANDROID_HOME` / `NDK_HOME` / `JAVA_HOME` pointing at them, plus the four Rust Android targets.

```bash
npm run android:init   # generates src-tauri/gen/android — once, and again after an identifier change
npm run android        # on a connected device or emulator
npm run android:build  # the APK/AAB
```

`gen/android` is generated and not tracked. All three commands are wrapped: they cross-compile libopus
per ABI (`scripts/opus-android.sh`) and patch the generated project with the permissions, the foreground
service, the audio routing and the launcher icons it does not know it needs (`scripts/android-patch.sh`).

### The crate dependency

`why2-chat` is pulled in as a **git dependency on the `development` branch**, because the published 2.0.0
lacks the frame sink this app watches a screen through. `Cargo.lock` pins the commit; `cargo update -p
why2-chat` takes newer work. To build against a local checkout instead, patch it rather than editing the
dependency line:

```toml
[patch."https://github.com/ENGO150/WHY2"]
why2-chat = { path = "../WHY2/chat" }
```

---

## Architecture

Three layers, and the boundary between them is deliberately narrow:

1. **`why2-chat`** — owns the socket, the protocol, the crypto and the persistent config. Async on tokio.
2. **`src-tauri/src/`** — the bridge: `AppState`, the `#[tauri::command]`s, and a translation of the
   crate's `ClientEvent`s into a single Tauri event, `why2-event`, carrying a serde-tagged `UiEvent`.
3. **`src/`** — the UI. One stateful component with views drawn around it. No router, no state library.

Almost everything the interface does goes back through **one function**, `send_input`, which mirrors the
terminal client's `submit`: clicking a channel sends `/channel <name>`, the headset sends `/voice`, a file
row sends `/download`, the gear sends `/settings`. New behaviour belongs on that path rather than in a new
IPC command.

`CLAUDE.md` in the repository root is the long version of all of this, and is the file to read before
changing anything.

---

## Configuration

The window shares `client.toml`, `server.toml` and the TOFU pins with the terminal client, in
`~/.config/WHY2/` (on Android, the app's own data directory). What it adds is its own
**`desktop_servers.toml`**: the server list, which the terminal client has no use for.

A stored password is kept **in plain text in a file chmodded 0600** — there is no key to encrypt it with
that the program would not have to keep beside it, and a second password to unlock the first is exactly
the comfort the list exists to buy. It is optional per row; a row without one asks at every connect.

---

## Security notice

**WHY2 is experimental and has not undergone a formal security audit.** The limitations are the crate's
and are listed in [its README](https://github.com/ENGO150/WHY2/blob/development/chat/README.md): no
perfect forward secrecy between rekeys, TOFU's reliance on a trustworthy first connection, and a cipher
that lacks peer review.

To that, this repository adds two of its own:

- **The client code here is machine-generated** (see the top of this file). It is reviewed, but it is not
  the same thing as hand-written code, and it is not what you should be trusting. The crate is.
- **The server list stores passwords in plain text**, protected by file permissions alone.

---

## How this project was written, and by whom

**Most of the code in this repository was generated by large language models.** The React frontend, the
Tauri bridge, the build scripts and the Android glue were written that way, under review, and the
`CLAUDE.md` in the repository root is the document that steers it.

**The security is not.** Everything this app relies on for its security — the WHY2 cipher, the hybrid
ECC + ML-KEM key exchange, the HMAC authentication, the sequence numbering, the TOFU key pinning, the
password hashing, the socket and the framing on it — lives in the **`why2-chat` crate and the `why2`
crate under it, which are human-written**. This repository contains **no cryptography
and no protocol**: it opens a window, draws what the crate tells it, and hands back what the user typed.

That boundary is deliberate and it is worth checking rather than believing. If you are auditing WHY2,
audit [the crate](https://git.satan.red/ENGO150/WHY2) — that is where the security is. What is here is
presentation, and it is machine-written presentation.

---

## Getting help

- **Issues**: [GitLab Issues](https://git.satan.red/ENGO150/WHY2/-/issues)
- **Discord**: DM [engo150](https://discord.com/users/634385503956893737)
- **Email**: engo@satan.red

---

## License

GNU GPLv3, like the rest of WHY2. Every source file in this repository carries the header block. See
[LICENSE](LICENSE), or <https://www.gnu.org/licenses/>.
