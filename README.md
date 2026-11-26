# Aura AI — Real-Time Multimodal Voice & Screen Desktop Companion

**Aura AI** is a low-latency, voice-to-voice desktop AI companion powered by the **Gemini Live API** (`gemini-3.1-flash-live-preview`) with real-time **Share Screen Vision**, strict **Multi-Language Lock** (including Pakistani regional languages), direct **YouTube media playback**, and **per-email isolated memory & personal API keys**.

---

## Key Features

- **Real-Time Voice-to-Voice Conversation**: Full-duplex low-latency PCM audio streaming (`16kHz` input / `24kHz` output) over WebSockets (`/live`).
- **Live Share Screen Vision**: Share any screen, window, or browser tab so Aura can read code, explain errors, and assist with what is visible on screen.
- **Native & Web App Launcher**: Opens desktop apps via native OS protocols (`whatsapp:`, `vscode:`, `ms-calculator:`, `spotify:`, `tg:`, `discord:`, `zoommtg:`, `ms-settings:`) or web portals (`Gmail`, `YouTube`, `GitHub`, etc.) in a single clean action without duplicate tabs.
- **Direct YouTube Media Playback & Search**: Plays requested songs, naats, or videos directly in an embedded YouTube player or searches Google/YouTube on command.
- **Strict Language Lock (Pakistani & Global Languages)**: Supports Auto-Detect, Urdu, Pashto, Punjabi, Sindhi, Balochi, Saraiki, Kashmiri, and English — strictly locked to the selected language until manually changed.
- **Per-Email Isolated Accounts & Memory**: Email/password login automatically provisions a unique personal session key (`aura_key_...`) with strictly isolated chat history, audio transcripts, and persistent semantic memories.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Motion, Lucide Icons, Web Audio API (`AudioContext` + `MediaDevices.getDisplayMedia`)
- **Backend**: Node.js, Express, `ws` (WebSocket proxy to Gemini Live), `@google/genai` SDK
- **Build & Tooling**: Vite 6, `tsx`, `esbuild`

---

## Quick Start (Run Locally from GitHub / ZIP)

### Prerequisites
- **Node.js 20+** (includes `npm`)
- A **Gemini API Key** from Google AI Studio

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the project root (based on `.env.example`):
```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
```

### 3. Run the App
For development:
```bash
npm run dev
```
Or build and run for production:
```bash
npm run build
npm start
```

### 4. Open in Browser
Visit **`http://localhost:3000`** in Chrome or Edge:
1. Sign in with any email address and password (6+ characters) to initialize your private workspace.
2. Click the center **Power / Mic** orb to start talking with Aura AI.
3. Click **Share Screen** in the header anytime to let Aura see your screen.
