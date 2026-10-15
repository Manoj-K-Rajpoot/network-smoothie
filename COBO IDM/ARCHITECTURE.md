# COBO IDM — Architecture & Technical Specification
**Combined-Bandwidth Internet Download Manager (Multi-Network Channel Bonded)**

---

## 1. Executive Summary & Vision

**COBO IDM** is a high-performance download accelerator built specifically to solve the single-stream bandwidth limitation of conventional downloaders. Unlike standard download managers (which route all parallel streams through Windows' single default gateway), **COBO IDM** features a **Multi-Homed Socket Pool**: it discovers all physical and virtual network adapters (Ethernet, Wi-Fi, 4G/5G USB Tethering, Secondary LAN) and binds chunk workers to specific network interfaces simultaneously.

The result is true aggregated multi-gigabit throughput across multiple ISPs, complete with resume capability, dynamic chunk work-stealing, and an ultra-modern Speedify-grade telemetry dashboard.

---

## 2. High-Level System Architecture

```mermaid
graph TD
    User[User Input: URL / Queue] --> TaskManager[Download Task Manager]
    TaskManager --> Prober[Remote File Prober (HEAD / Range Support)]
    Prober --> Engine[COBO Slicing & Work-Stealing Engine]
    
    subgraph Network Hardware Layer
        Adapters[Network Interface Discovery]
        Adapters --> Adap1[Ethernet 1 (Realtek GbE)]
        Adapters --> Adap2[Wi-Fi (Intel AX201)]
        Adapters --> Adap3[Ethernet 2 (Mobile 5G USB)]
    end

    Engine --> Pool[Multi-Homed Connection Pool]
    Pool -->|Stream 1 & 2| Adap1
    Pool -->|Stream 3 & 4| Adap2
    Pool -->|Stream 5 & 6| Adap3

    Adap1 --> Worker1[Chunk Worker 1 & 2]
    Adap2 --> Worker2[Chunk Worker 3 & 4]
    Adap3 --> Worker3[Chunk Worker 5 & 6]

    Worker1 --> Assembler[Direct File Assembler / Sparse File Writer]
    Worker2 --> Assembler
    Worker3 --> Assembler

    Assembler --> FinalFile[Complete Downloaded File]
    Engine --> Telemetry[Real-Time Telemetry & UI Pipeline]
    Telemetry --> Dashboard[Modern Glassmorphic Dashboard]
```

---

## 3. Core Engine Modules

### 3.1 Network Interface & Multi-Homing Manager (`NetworkManager`)
- **Discovery**: Automatically tracks active IPv4 interfaces and default gateways using native OS hooks.
- **Health Probing**: Periodically probes latency and connectivity per adapter (via lightweight DNS probes) so dead connections are removed before assigning chunks.
- **Binding Strategy**: Every socket created by the connection pool specifies `localAddress: adapter.ip`, bypassing Windows' default routing metric and forcing traffic out of the designated hardware NIC.

### 3.2 Dynamic Work-Stealing Chunk Engine (`ChunkEngine`)
Standard segmented downloaders divide a file into $N$ static parts. If one adapter is slower (e.g., 4G mobile) or encounters packet loss, the entire download stalls waiting for the slow chunk.
- **Dynamic Chunk Splitting**:
  - The file is divided into initial segments based on adapter priority weights.
  - When a fast worker (e.g., Wi-Fi @ 60 Mbps) finishes its chunk while a slower worker (e.g., 4G @ 15 Mbps) is still halfway through, the engine **splits the remaining half of the slow chunk** and reassigns it to the idle fast worker.
  - This ensures 100% saturation across all links until the final byte is received.

### 3.3 Zero-Copy File Assembler (`FileAssembler`)
- **Pre-allocation**: When download starts, pre-allocates file space using Windows sparse file API or block descriptor to eliminate file fragmentation.
- **Direct Offset Writing**: Workers write their downloaded byte buffers directly to their specific byte offset in the target file (`fs.write(fd, buffer, offset, length, position)`).
- **No Concatenation Delay**: When the last chunk completes, the file is already 100% assembled on disk with zero post-processing or temp file merging time!

### 3.4 Task & Queue Manager (`TaskManager`)
- **Task States**: `Queued`, `Probing`, `Downloading`, `Paused`, `Completed`, `Error`.
- **Session Persistence**: Saves task state to JSON (`tasks.json`) so interrupted or paused downloads can be resumed across restarts.
- **Checksum Verification**: Automatic MD5/SHA-256 verification when hashes are provided by the user or headers.

---

## 4. UI/UX Specifications

Inspired by **Speedify** and modern creative developer tooling:
- **Palette**: Deep Obsidian Canvas (`#090c15`), Neon Cyan (`#00f2fe`), Electric Purple (`#b388ff`), Neon Emerald (`#00e676`), and Sunset Amber (`#ffb300`).
- **Telemetry Visualizer**:
  - Combined Live Speed Meter (`XX.XX Mbps ↓` with `XX.XX MB/s` subtext).
  - Multi-series real-time Canvas timeline graph tracking each adapter's individual contribution wave simultaneously.
- **Active Download Lanes**:
  - Visual chunk layout showing how the file is sliced and which physical adapter is currently pulling each block.
- **Adapter Control Drawer**:
  - Enable/disable adapters from participating in downloads on the fly.
  - Priority weight slider (1x, 2x, 3x, 4x) to fine-tune bandwidth sharing.

---

## 5. Configuration Schema

```json
{
  "general": {
    "downloadDir": "C:\\Users\\manoj\\Downloads\\COBO",
    "autoStartOnLaunch": false,
    "minimizeToTray": true,
    "maxConcurrentDownloads": 3
  },
  "connectionPool": {
    "connectionsPerAdapter": 2,
    "maxTotalConnections": 16,
    "bufferSizeKb": 64,
    "socketTimeoutMs": 10000,
    "workStealingEnabled": true,
    "minChunkSizeMb": 2
  },
  "adapters": {
    "autoDiscover": true,
    "defaultPriority": 2,
    "healthCheckIntervalSec": 10
  }
}
```

---

## 6. Project Directory Structure

```
COBO IDM/
├── ARCHITECTURE.md          # This specification document
├── package.json             # Project dependencies and startup scripts
├── README.md                # Quick-start documentation
├── src/
│   ├── index.js             # Main application orchestrator
│   ├── config/              # Default configuration and persistent store
│   │   └── index.js
│   ├── core/                # Core networking and download engine
│   │   ├── NetworkManager.js   # Hardware NIC discovery & health probing
│   │   ├── ConnectionPool.js   # Multi-homed socket connection pool
│   │   ├── ChunkEngine.js      # Dynamic slicing & work-stealing algorithm
│   │   ├── FileAssembler.js    # Pre-allocated direct-offset file writer
│   │   └── TaskManager.js      # Download tasks queue, resume, persistence
│   └── ui/                  # User interface and real-time telemetry
│       ├── index.html       # Modern dashboard UI
│       ├── css/
│       │   └── cobo.css     # Obsidian glassmorphic design system
│       └── js/
│           ├── dashboard.js # Telemetry visualizer & graph rendering
│           └── controller.js# Frontend event handling & IPC bridge
```
