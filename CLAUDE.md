# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WHY2 Desktop is a Tauri 2 desktop GUI for the WHY2 chat protocol. All protocol work (TCP framing, crypto,
TOFU key pinning, commands, config) lives in the sibling `why2-chat` crate, pulled in as a **path dependency**:

```toml
why2-chat = { path = "../../WHY2/chat", default-features = false, features = ["client_base"] }
```

That resolves to `/mnt/data/Rust/WHY2` relative to `src-tauri/`. **The sibling checkout must be present or the
Rust build fails.** When behavior looks wrong, the cause is often in that crate, not here — read
`/mnt/data/Rust/WHY2/chat/src/` (`network/client.rs`, `command.rs`, `config/`, `options.rs`) before assuming a bug
in this repo. This app is a thin presentation layer over it.

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

1. **`why2-chat` crate** — owns the socket, the protocol, and persistent config/TOFU state.
2. **`src-tauri/src/lib.rs`** (single file, ~600 lines) — the bridge. Holds `AppState { write_stream }`, exposes
   five `#[tauri::command]`s, and translates `ClientEvent`s into UI events.
3. **`src/App.tsx`** (single file, ~770 lines) — the entire UI. One component, no router, no state library.

### The event bridge (the thing to understand first)

`connect_to_server` spawns two threads: one runs `client::listen_server` writing `ClientEvent`s into an
`mpsc` channel, the other drains that channel and re-emits everything to the webview as a **single Tauri event
named `why2-event` whose payload is a `String`**. There is no typed IPC event surface — the payload is a
tag-prefixed string:

- Bare tags: `Register`, `Login`, `Authenticated`, `Quit`, `UsernameRejected`, `TofuMismatch`
- `Tag:value` — `Connected:<name>`, `PasswordRejected:<min>`, `RequestUsername:<bool>`,
  `ChannelCreated:<ch>`, `ChannelDestroyed:<ch>`, `ChannelChanged:<ch>`, `Popup:<text>`
- `Tag:<json>` — `Message:{...}`, `UserList:[...]`, `Modal:Files:[...]`, `TofuUnknown:<hash>:<ip>`

`App.tsx` decodes these in one long `if/else if` chain inside a single `useEffect`. **Adding a server-side
feature means touching both ends of this string protocol**: emit the new prefix in `lib.rs`, parse it in that
chain. Note the parsing is prefix-based and some values are rejoined with `:` (IPs, JSON) — keep that in mind
when choosing a tag.

### The command path

Everything the user does flows through `send_input(input: String)` — free text is sent as a message, and
anything starting with `COMMAND_PREFIX` (`/`) goes to `command::get_command`. `send_command_code` handles most
commands generically inside `why2-chat`; `lib.rs` only special-cases `Exit`, `Upload`, `UsernameColor`,
`MessageColor`, and blocks `Help`/`Info` (they are terminal-oriented and also filtered out of `get_commands`).
Unhandled commands emit a "not fully supported in desktop UI yet" popup.

The UI deliberately drives itself through this same path rather than adding new IPC commands: clicking a channel
invokes `send_input("/channel <name>")`, the disconnect button sends `/exit`, the files modal sends
`/download <user_id> <file_id>`. Prefer extending the command path over adding a `#[tauri::command]`.

The slash-command autocomplete in the chat box is populated by `get_commands`, which reflects
`why2_chat::command::COMMAND_LIST` — commands appear in the UI automatically when added to the crate.

### Channels and message routing

Messages carry no channel field. `App.tsx` keeps `messagesByChannel: Record<string, ChatMessage[]>` and files
each incoming `Message:` into **whatever channel is current at the time it arrives**, read via
`currentChannelRef` (a ref, not state — the listener closure is registered once with `[]` deps and would
otherwise capture a stale channel). The lobby is the empty string `""`. `ClientEvent::Clear(1)` from the crate
is what signals a channel switch; it becomes `ChannelChanged`. `UserList` doubles as channel discovery and prunes
history for channels that no longer exist.

### Colors

The protocol speaks 16 ANSI color codes. `to_color` in `lib.rs` parses names/numbers → code and canonical name
(persisted to config); `getAnsiColor` in `App.tsx` maps code → hex for rendering. Both tables must stay in sync.

### Adding a Tauri plugin

Three places, all required: `src-tauri/Cargo.toml`, the `.plugin(...)` chain in `run()`, and the `permissions`
array in `src-tauri/capabilities/default.json`. Missing the capability entry fails only at runtime.

## Conventions

- **Every source file** (`.rs`, `.ts`, `.tsx`, `.css`, `.html`, `.toml`) carries the GPLv3 header block naming
  Václav Šmejkal. Copy it into any new file.
- Rust uses **Allman braces** — opening brace on its own line, including for `match` arms, closures, `if`, and
  struct literals. This is not rustfmt default; do not run `cargo fmt`, it will reformat the whole codebase.
  TS/TSX follows the same brace style with 4-space indent.
- Comments in Rust are `//ALL CAPS`, no space after the slashes, usually trailing on the item they describe.
- Styling is Tailwind v4 (`@import "tailwindcss"` in `src/index.css`, configured via CSS `@theme`/custom
  properties in an `@theme inline` block — there is no `tailwind.config.js`). Use the semantic tokens
  (`bg-card`, `text-muted-foreground`, `border-border`), not raw colors. The app is hardcoded dark via a
  `dark` class on the root `<main>`. `src/App.css` is leftover scaffolding — nothing imports it.
