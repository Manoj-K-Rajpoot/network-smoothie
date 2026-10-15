# COBO IDM
**Combined-Bandwidth Internet Download Manager (Multi-Network Channel Bonded)**

COBO IDM is a download accelerator that aggregates bandwidth across all active physical network adapters (Wi-Fi, Ethernet, Mobile USB 4G/5G Tethering) without requiring any paid subscription or remote VPN server.

---

## Key Features

1. **Mature Link-Based Download Configuration**:
   - **Real-Time Remote Probe**: Automatically queries remote server headers upon entering/pasting a URL to detect exact file size, filename (`Content-Disposition`), and HTTP 206 resumability.
   - **Customizable File Name & Categories**: Editable filename with automatic category routing (Compressed, Video, Audio, Program, Document, Other).
   - **Native Save Directory Picker**: Custom download folder selection with native Windows folder browse dialog (`select-folder`).
   - **Parallel Connection Stream Selector**: Adjustable connection pool slider (2, 4, 8, 16, 24, 32 parallel streams).
   - **Per-Adapter Hardware Checklist**: Selectively enable or bond specific hardware NICs (e.g., Ethernet + Wi-Fi + Mobile Tethering) for custom channel bonding.
   - **Advanced HTTP Headers**: Support for custom `Referer:`, `Cookie:` (for login-restricted links), and configurable `User-Agent` presets (Chrome, Firefox, Edge, IDM Default, or Custom).
   - **Speed Limiter & Queue Controls**: Configurable download speed throttling and one-click options to "Start Download" or "Add to Queue".
2. **Multi-Homed Socket Pooling**:
   - Discovers all physical network adapters on your system.
   - Binds chunk streams directly to specific hardware interfaces via `localAddress`.
3. **Dynamic Work-Stealing Chunk Engine**:
   - Divides downloads into parallel range requests.
   - If a fast connection finishes early, it automatically splits the remaining half of a slower connection's chunk to ensure 100% saturation.
4. **Zero-Copy File Pre-Allocation**:
   - Files are pre-allocated on disk, and chunks write directly to their final byte offset.
   - Zero concatenation delay or temporary file merging upon download completion.
5. **Speedify-Grade UI & Telemetry**:
   - Live combined Mbps speedometer.
   - Per-adapter real-time contribution chips.
   - Categorized download queue with progress percentages and instant folder reveal in Windows Explorer.
6. **Live Hot Auto-Refresh (Nodemon-Style for Electron)**:
   - Built-in recursive file watcher on `src/ui` and `src/core`.
   - Automatically hot-reloads the Electron window in 150ms whenever HTML, CSS, or JS files are edited — no need to restart the app manually during development.
7. **Complete Task Lifecycle Controls**:
   - **Play / Resume** (▶️): Seamlessly resumes downloads from exact byte offsets using chunk state snapshots.
   - **Pause** (⏸️): Gracefully pauses all active socket streams without discarding downloaded progress.
   - **Force Stop** (⏹️): Immediately aborts all active network sockets.
   - **Restart / Redownload** (🔄): Wipes existing progress and starts a fresh download from 0%.
   - **Delete Task** (🗑️): Cleans up task from store and optionally removes disk files.
   - **Global Actions**: One-click **Resume All**, **Pause All**, and **Clear Finished** toolbar buttons.

---

## Quick Start

In the `COBO IDM` directory:

```powershell
# Run the application
npx electron .
```

Or from the root directory:
```powershell
npx electron "COBO IDM"
```
