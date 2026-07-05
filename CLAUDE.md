# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebScreen Serial IDE is a web-based integrated development environment for WebScreen ESP32-S3 devices. It provides serial communication, JavaScript code editing, and direct device interaction through a browser interface using the Web Serial API.

## Development Setup

This is a pure client-side static web application with no build process and no backend (no PHP):

```bash
# Serve the public/ docroot with any static server, e.g.:
python3 -m http.server -d public
# or simply open public/index.html in a supported browser
# Supported browsers: Chrome 89+, Edge 89+, Opera 75+ (Web Serial API required)
```

No package.json, build scripts, or Node.js dependencies exist - the application uses CDN-loaded resources. DDEV still works for local hosting, but PHP is no longer required.

## Architecture

### Core Components

All application files live in the `public/` docroot:

- **public/index.html**: Main application structure with CodeMirror editor integration
- **public/app.js**: `WebScreenIDE` class - main application controller managing UI, editor, and serial communication
- **public/serial.js**: `SerialManager` class - handles Web Serial API communication with WebScreen devices
- **public/style.css**: Complete styling with dual-theme (Retro/Focus) system

### Key Classes

#### SerialManager (`public/serial.js`)
- Manages Web Serial API connections (115200 baud, 8-N-1)
- Handles command execution and file transfers to WebScreen devices
- Provides command history and WebScreen-specific methods
- Methods include: `connect()`, `sendCommand()`, `sendFile()`, `uploadFile()`, `listFiles()`, `deleteFile()`, `loadScript(filename, setDefault)`, `captureScreenshot()`, `makeDirectory()`, `requestDownload()`, `factoryReset()`, etc.
- Internal `_lineListeners` Set: per-line listeners that can consume lines before they reach `onDataReceived` (used by `captureScreenshot()` to keep base64 out of the console and by `waitForUploadAck()`)
- `sendFile()`/`uploadFile()` wait for the firmware upload ACK after `END` (`[OK] File saved:` / `Script saved:` on success, `Upload failed`/`Upload aborted` throws; 8s timeout resolves success for old firmware without ACK)

#### WebScreenIDE (`public/app.js`)
- Main application controller coordinating all functionality
- Manages CodeMirror editor with JavaScript mode and Dracula theme
- Handles UI state, tab switching, and terminal output
- Key methods: `saveFile()` (resolves `true` once upload completes), `runScript(setDefault)`, `evalSelection()`, `captureScreenshot()`, `downloadLog()`, `toggleConnection()`
- Console output supports ANSI/SGR colors via `renderAnsiInto()` (16 basic fg/bg colors, bold, reset; plain lines take a `textContent` fast path; non-SGR CSI sequences are stripped). ANSI parsing adapted from ESPConnect (MIT, The Last Outpost Workshop)

### File Operations

The IDE communicates with WebScreen devices using serial commands:
- `/write filename` (legacy) or `/upload filename [base64]` followed by content lines and `END` to save files; the firmware acknowledges with `[OK] File saved: <name> (<size>)` (`Script saved:` for `/write`) or `[ERROR] Upload failed: <reason>` / `Upload aborted`
- `/download <file>` for binary-safe device-to-host download: `=== DOWNLOAD <path> SIZE <n> ===`, base64 lines, `=== DOWNLOAD END ===`
- `/screenshot` (alias `/ss`) captures the display: `=== SCREENSHOT <w>x<h> RGB565_SWAP ===`, base64 lines (76 chars each), `=== SCREENSHOT END ===` (536x240; `_SWAP` = each 16-bit RGB565 pixel is byte-swapped, high byte first)
- `/load filename` to execute JavaScript files on device; `/load filename save` also persists it as the boot default in `webscreen.json`
- `/eval <js-code>` to evaluate up to 255 chars inside the running app (replies prefixed `[EVAL]`)
- `/errors` to show the last JavaScript error and line number
- `/ls <path>` to list files (plain output ends with a `Total: N files, M directories` line; `/ls <path> json` returns a single-line JSON object `{"path":"/","entries":[...]}`), `/rm` to delete, `/cat` to read content, `/mkdir <path>` to create directories
- `/factory_reset confirm` deletes `/webscreen.json` and reboots
- Various device commands: `/stats`, `/info`, `/reboot`, `/config`, `/gc`, `/restart_app`, etc.

## Key Features

### Editor Integration
- CodeMirror 5.65.15 with JavaScript syntax highlighting
- Keyboard shortcuts: `Ctrl+S` (save), `F5` (run), `Ctrl+/` (comment)
- Auto-completion, bracket matching, and code folding enabled
- Default template includes WebScreen API examples
- Toolbar buttons: Save, Run, Run & Set as Default (`/load <file> save`), Eval (sends editor selection or current line via `/eval`, warns above 255 chars), Screenshot (camera icon: `/screenshot` capture rendered to a canvas modal with Download PNG; disabled while disconnected or a capture is in progress, 30s timeout)

### Serial Communication
- Web Serial API with 115200 baud rate
- Command history with up/down arrow navigation
- Tab-completion for the full firmware command set: `/help /stats /info /write /upload /config /ls /cat /rm /load /restart_app /eval /errors /gc /wget /ping /backup /monitor /brightness /time /settime /reboot /mkdir /download /screenshot /factory_reset`
- Real-time terminal output with message classification and ANSI/SGR color rendering (16 basic colors + bold)
- Quick command buttons for common operations, including an "Errors" button (`/errors`) to inspect the last JS error after a failed run

### File Management
- Upload JavaScript and binary files directly to WebScreen device (drag & drop or file picker)
- File listing, load-into-editor, and delete (`deleteSelectedFile()` in app.js, `deleteFile()` in serial.js)
- Terminal log export via `downloadLog()` (Export button)
- Save-and-run workflow: `runScript()` awaits `saveFile()` completion before sending `/load` (no arbitrary delays); uploads are verified against the firmware ACK, and a failed upload aborts the `/load`

## Development Notes

### Browser Compatibility
- **Required**: Chrome 89+, Edge 89+, or Opera 75+ for Web Serial API
- **Not supported**: Firefox, Safari (no Web Serial API support)

### WebScreen Device Commands
The application supports all WebScreen serial commands:
- Core: `/help`, `/stats`, `/info`, `/reboot`, `/brightness`, `/time`, `/settime`, `/screenshot` (alias `/ss`), `/factory_reset confirm`
- Files: `/write`, `/upload`, `/download`, `/ls` (optional `json` argument; plain output ends with `Total: N files, M directories`), `/cat`, `/rm`, `/mkdir`, `/load` (optional `save` argument persists as boot default)
- Script/runtime: `/eval` (max 255 chars, `[EVAL]`-prefixed replies), `/errors`, `/restart_app`, `/gc`
- Network: `/wget` (alias `fetch`, previously `download`), `/ping`
- Config: `/config get/set`, `/backup`
- Monitoring: `/monitor cpu/mem/net`

### Code Conventions
- Vanilla JavaScript ES6+ classes
- Async/await for serial operations
- Event-driven architecture with callback patterns
- Error handling with try/catch and user feedback
- 115200 baud rate for WebScreen compatibility

### Testing
No automated testing framework is present. Testing is performed manually by:
1. Opening public/index.html in supported browser (or serving public/ with a static server)
2. Connecting to WebScreen device via USB
3. Testing code editor, serial commands, and file operations

## Common Tasks

### Adding New Commands
Add methods to `SerialManager` class and corresponding UI buttons:
```javascript
async newCommand(params) {
    await this.sendCommand(`/newcmd ${params}`);
}
```

### Modifying Editor Behavior
Update CodeMirror configuration in `WebScreenIDE.initEditor()`:
```javascript
extraKeys: {
    'Ctrl-NewKey': () => this.newFunction()
}
```

### Extending Serial Protocol
Modify `sendFile()` method in `SerialManager` for different file transfer protocols or add new device-specific communication patterns.

## File Structure Context

```
WebScreen-Serial-IDE/
├── public/             # Static docroot (serve this directory)
│   ├── index.html      # Main HTML with CodeMirror CDN imports
│   ├── app.js          # WebScreenIDE class - main controller
│   ├── serial.js       # SerialManager class - serial communication
│   ├── style.css       # Dual-theme styling (Retro/Focus)
│   └── assets/         # Logo, favicon, animation
└── README.md           # Comprehensive documentation
```

The codebase is intentionally simple and self-contained for easy modification and deployment.

## WebScreen Firmware Reference

### LVGL Configuration
The IDE helps write JavaScript for WebScreen devices running LVGL with these constraints:

**Available Fonts (Montserrat):**
- Sizes: 14 (default), 20, 28, 34, 40, 44, 48
- Other sizes (8, 10, 12, 16, 18, 22, 24, 26, 30, 32, etc.) are NOT enabled

**Enabled Widgets:**
- Core: Label, Image, Arc, Line, Button, Button Matrix, Canvas
- Extra: Chart, Meter, Message Box, Span (rich text)

**Supported Image Formats:**
- PNG ✅, GIF ✅, SJPG ✅, BMP ❌

**Display Control:**
- `set_brightness(value)` - Set display brightness (0-255)
- `get_brightness()` - Get current display brightness

**HTTP Functions:**
All HTTP functions support custom ports:
```javascript
http_get("http://192.168.1.20:2000/api")
http_post("http://localhost:3000/api", '{"key":"value"}')
```

**Memory Limits:**
- Elk JS heap: 256KB (PSRAM)
- Keep scripts under 3KB
- Limit to 5 styles, 10 labels per app

## Code Search

Use ken as the first attempt for codebase questions. Prefer ken MCP tools before
broad text search or reading many files:

- Start with `ken_rank` for the current task, or pass a query when the question
  needs a focused search.
- Use `ken_search_files` to find files by intent, feature, behavior, or concept.
- Use `ken_search_symbols` to find functions, classes, methods, APIs, and other
  named code objects.
- Use `ken_file_outline`, `ken_file_symbols`, and `ken_file_snippets` to inspect
  surfaced files precisely before opening larger chunks of code.
- Use `ken_file_neighbors`, `ken_module_graph`, and `ken_find_tests` to follow
  imports, related modules, and source/test pairs.
- Use `ken_changed_context` when working from an existing diff or local edits.
- Use `ken_project_overview` for a compact map of an unfamiliar project area.
- Use `ken_recall` and `ken_findings` for saved project knowledge, and
  `ken_remember` when a durable finding should help future sessions.
- Use `ken_explain_rank` when rankings look surprising or an expected file is
  missing.
- Use `ken_dismiss` when ken surfaces a file that is clearly not relevant, so
  future similar tasks get better results.

After ken narrows the search space, read the relevant files directly. Fall back
to `rg` when ken is insufficient, when an exact literal search is required, or
when verifying a specific string occurrence.
