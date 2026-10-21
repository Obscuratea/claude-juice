# Claude Juice

A little desktop widget: a PC case full of orange juice that drains as you use up your Claude usage limit.
Shake the window and the juice sloshes around.

- Shows the **5-hour** limit by default; right-click to switch to the **7-day** limit
- All vector graphics, so it scales cleanly to any window size
- Drag the case to move it, drag the corner grip to resize, double-click the glass to splash
- Runs on Linux, Windows and macOS (built with [Tauri](https://tauri.app))

> Unofficial fan project. Not affiliated with or endorsed by Anthropic. Claude and the Claude logo are trademarks of Anthropic.

## Install

Grab the installer for your system from [Releases](../../releases/latest):

| System  | File |
|---------|------|
| Windows | `.msi` or `-setup.exe` |
| macOS   | `.dmg` (universal: Apple Silicon and Intel) |
| Linux   | `.deb`, `.rpm` or `.AppImage` |

The builds aren't code-signed, so the first launch needs one extra step:

- **Windows:** SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.
- **macOS:** If it says the app can't be opened, run `xattr -dr com.apple.quarantine "/Applications/Claude Juice.app"` once, then open it normally.

## Connect it to Claude Code

Claude Juice reads your limits from Claude Code's [status line](https://code.claude.com/docs/en/statusline), which gets them from your Claude Pro or Max plan.
Point the status line at the app in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "<path to claude-juice> --statusline"
  }
}
```

Where the app lives (keep the single quotes, since the paths have spaces):

| System  | Path |
|---------|------|
| Windows | `'C:/Users/<you>/AppData/Local/Claude Juice/claude-juice.exe'` (`-setup.exe`) or `'C:/Program Files/Claude Juice/claude-juice.exe'` (`.msi`) |
| macOS   | `'/Applications/Claude Juice.app/Contents/MacOS/claude-juice'` |
| Linux   | `/usr/bin/claude-juice` (or the path to the `.AppImage`) |

Each time Claude Code refreshes its status line, the app saves the latest limits and the juice level follows.
The level only updates while Claude Code is running; the first reading arrives after your first message in a session.

If you already have a status line script, you can keep it: have it write the same JSON to the cache file instead.
The app reads `<cache dir>/claude-juice/usage.json`:

```json
{ "updated": 1792613373,
  "five_hour": { "used_percentage": 23.5, "resets_at": 1792626600 },
  "seven_day": { "used_percentage": 41.2, "resets_at": 1792857600 } }
```

## Linux notes

On Hyprland the app asks the compositor for its window position over IPC, so it runs as a native Wayland window.
On other Wayland desktops it runs through XWayland, because plain Wayland never tells a window where it is.

Hyprland users will want a float rule (Lua config):

```lua
hl.window_rule({ match = { class = "^([Cc]laude-juice)$" }, float = true, center = true, size = { 360, 360 }, border_size = 0, no_shadow = true, no_blur = true })
```

## Build from source

Needs Rust, Node.js and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```sh
npm install
npx tauri dev     # run it
npx tauri build   # make installers
```

Releases are built by GitHub Actions: push a tag like `v0.1.0` and installers for all three systems are attached to a new release.
