/**
 * Audio handling utility for Myraa Live API Voice stream.
 * Handles:
 * - 16kHz layout sampling for microphone stream.
 * - Raw Little Endian Int16 PCM translation.
 * - 24kHz layout output sampling for model voice playback.
 * - Gapless double-buffer queue scheduler.
 * - Interrupt signal immediate stop.
 * - Input & Output AnalyserNodes for real-time waveform visuals.
 */

import { getAuthToken } from "./user";

export type LiveState = "disconnected" | "connecting" | "listening" | "speaking";

// Storage helpers for Voice Personalization
export function getSavedVoicePitch(): number {
  try {
    const val = localStorage.getItem("aura_voice_pitch");
    if (val !== null) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) return parsed;
    }
  } catch (e) {}
  return 0; // Default: Natural / 0 cents
}

export function saveVoicePitch(cents: number): void {
  try {
    localStorage.setItem("aura_voice_pitch", String(cents));
  } catch (e) {}
}

export function getSavedVoiceVolume(): number {
  try {
    const val = localStorage.getItem("aura_voice_volume");
    if (val !== null) {
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) return parsed;
    }
  } catch (e) {}
  return 1.0; // Default: 100%
}

export function saveVoiceVolume(vol: number): void {
  try {
    localStorage.setItem("aura_voice_volume", String(vol));
  } catch (e) {}
}

// PCM Conversion Helper: converts Float32Array [-1.0, 1.0] to signed Int16 Raw PCM Little Endian
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

// Float conversion helper: converts signed Int16 array buffer to Float32Array [-1.0, 1.0]
function pcm16ToFloats(uint8Array: Uint8Array): Float32Array {
  const int16 = new Int16Array(
    uint8Array.buffer,
    uint8Array.byteOffset,
    uint8Array.byteLength / 2
  );
  const floats = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    floats[i] = int16[i] / 32768.0;
  }
  return floats;
}

// Convert ArrayBuffer to Base64 String
function base64ArrayBuffer(arrayBuffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 string to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class MyraaAudioSession {
  private ws: WebSocket | null = null;
  
  // Audios contexts (separate to match exact required sample rates)
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  
  // Audio sources & processors
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micProcessorNode: ScriptProcessorNode | null = null;
  
  // Visualisers
  public inputAnalyser: AnalyserNode | null = null;
  public outputAnalyser: AnalyserNode | null = null;
  private outputGainNode: GainNode | null = null;
  
  // Voice Personalization Settings
  private voicePitchCents: number = getSavedVoicePitch();
  private outputVolume: number = getSavedVoiceVolume();

  // Buffering / Playback details
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  
  // State Callbacks
  private onStateChange: (state: LiveState) => void;
  private onTranscription: (role: "user" | "model", text: string) => void;
  private onToolCall: (name: string, args: any, callback: (result: any) => void) => void;
  private onError: (error: string) => void;
  private onMemorySync?: (memories: any[]) => void;
  
  private currentState: LiveState = "disconnected";
  private isActivated = false;
  private hasErrorDispatched = false;

  constructor(handlers: {
    onStateChange: (state: LiveState) => void;
    onTranscription: (role: "user" | "model", text: string) => void;
    onToolCall: (name: string, args: any, callback: (result: any) => void) => void;
    onError: (error: string) => void;
    onMemorySync?: (memories: any[]) => void;
  }) {
    this.onStateChange = handlers.onStateChange;
    this.onTranscription = handlers.onTranscription;
    this.onToolCall = handlers.onToolCall;
    this.onError = handlers.onError;
    this.onMemorySync = handlers.onMemorySync;
  }

  private dispatchError(msg: string) {
    if (!this.hasErrorDispatched) {
      this.hasErrorDispatched = true;
      this.onError(msg);
    }
  }

  private setState(state: LiveState) {
    this.currentState = state;
    this.onStateChange(state);
  }

  public getState(): LiveState {
    return this.currentState;
  }

  /**
   * Pushes a compressed JPEG base64 screenshot frame directly to the live WebSocket server.
   */
  public sendVideoFrame(base64Data: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentState !== "disconnected") {
      this.ws.send(JSON.stringify({ type: "video", video: base64Data }));
    }
  }

  // Requests microphone and creates connections
  public async connect(lang: string = "auto") {
    if (this.isActivated) return;
    this.isActivated = true;
    this.hasErrorDispatched = false;
    this.setState("connecting");

    try {
      // 1. Establish custom WebSocket server bridge with verified per-Gmail API key & language lock
      const token = getAuthToken();
      if (!token) {
        throw new Error("Authentication required. Please sign in with your email first.");
      }
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.ws = new WebSocket(`${protocol}//${window.location.host}/live?token=${encodeURIComponent(token)}&lang=${encodeURIComponent(lang)}`);
      this.ws.binaryType = "blob";

      this.ws.onopen = async () => {
        console.log("[Myraa] Connected to server side WS bridge");
        try {
          // Guard against early user disconnect during connection setup
          if (!this.isActivated) return;

          // Safe, cross-browser AudioContext initialization
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!AudioContextClass) {
            throw new Error("Holographic audio link unsupported: Web Audio API missing in browser.");
          }

          this.inputAudioCtx = new AudioContextClass({ sampleRate: 16000 });
          this.outputAudioCtx = new AudioContextClass({ sampleRate: 24000 });

          // Ensure Audio Contexts are active and resumed to bypass browser security blocks
          if (this.inputAudioCtx.state === "suspended") {
            await this.inputAudioCtx.resume().catch(() => {});
          }
          if (this.outputAudioCtx.state === "suspended") {
            await this.outputAudioCtx.resume().catch(() => {});
          }
          
          // Setup custom output Analyser & Volume Gains
          this.outputGainNode = this.outputAudioCtx.createGain();
          this.outputGainNode.gain.value = this.outputVolume;
          this.outputAnalyser = this.outputAudioCtx.createAnalyser();
          this.outputAnalyser.fftSize = 256;
          this.outputAnalyser.smoothingTimeConstant = 0.8;
          
          this.outputGainNode.connect(this.outputAnalyser);
          this.outputAnalyser.connect(this.outputAudioCtx.destination);
          
          // Obtain User Microphone layout
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          });

          // Safeguard: Check if we disconnected while waiting for user to grant mic permissions
          if (!this.isActivated || !this.inputAudioCtx || !this.outputAudioCtx) {
            stream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (e) {}
            });
            return;
          }

          this.micStream = stream;

          // Setup custom input Analyser
          this.inputAnalyser = this.inputAudioCtx.createAnalyser();
          this.inputAnalyser.fftSize = 256;
          
          this.micSourceNode = this.inputAudioCtx.createMediaStreamSource(this.micStream);
          this.micSourceNode.connect(this.inputAnalyser);

          // Stream input PCM 16-bit to WS
          this.micProcessorNode = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);
          this.micSourceNode.connect(this.micProcessorNode);
          this.micProcessorNode.connect(this.inputAudioCtx.destination);

          this.micProcessorNode.onaudioprocess = (e) => {
            if (this.currentState === "disconnected" || this.currentState === "connecting") return;
            try {
              const channelData = e.inputBuffer.getChannelData(0);
              
              // Convert to base64 Int16 Little Endian PCM
              const pcmBuffer = floatTo16BitPCM(channelData);
              const base64 = base64ArrayBuffer(pcmBuffer);
              
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ audio: base64 }));
              }
            } catch (frameErr) {
              // Ignore temporary frame send glitches during disconnect
            }
          };

          // Sound setups are fully functional
          this.setState("listening");

        } catch (audioError: any) {
          const isPermDenied = 
            audioError?.name === "NotAllowedError" || 
            audioError?.name === "PermissionDeniedError" || 
            audioError?.message?.toLowerCase().includes("permission denied") ||
            audioError?.message?.toLowerCase().includes("denied") ||
            audioError?.message?.toLowerCase().includes("permission");

          if (isPermDenied) {
            console.warn("[Aura Audio] Microphone permission denied or blocked by browser/iframe.");
            this.dispatchError("Microphone access was denied. Please allow microphone access in your browser address bar settings, or open the app in a new tab if running in an iframe.");
          } else {
            console.warn("Audio Context or Microphone Initialization Failed:", audioError?.message || audioError);
            this.dispatchError(`Microphone setup error: ${audioError.message || "Microphone initialization failed."}`);
          }
          this.disconnect();
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Root Error Handler message
          if (data.type === "error") {
            this.dispatchError(data.error);
            this.disconnect();
            return;
          }

          // Handle server-side states
          if (data.type === "status") {
            console.log("[Myraa WS Status]:", data.status);
            if (data.status === "connecting_gemini") {
              // Wait for Gemini Live connection
            } else if (data.status === "connected") {
              this.setState("listening");
            } else if (data.status === "session_closed") {
              this.disconnect();
            }
            return;
          }

          // Handle audio payload (24kHzPCM model response)
          if (data.type === "audio" && data.audio) {
            this.playAudioPCMChunk(data.audio);
          }

          // Handle interruption signal (e.g. user talked over Myraa)
          if (data.type === "interrupted") {
            this.handleInterruption();
          }

          // Turn complete
          if (data.type === "turnComplete") {
            // Once Myraa completes speaking, change visual state back to listening
            setTimeout(() => {
              if (this.activeSources.length === 0 && this.currentState === "speaking") {
                this.setState("listening");
              }
            }, 100);
          }

          // Handle live captions transcription
          if (data.type === "transcription") {
            this.onTranscription(data.role, data.text);
          }

          // Handle memory synchronization
          if (data.type === "memory_sync" && data.memories) {
            if (this.onMemorySync) {
              this.onMemorySync(data.memories);
            }
          }

          // Handle Tool Calling
          if (data.type === "toolCall") {
            const { callId, name, args } = data;
            this.onToolCall(name, args, (result) => {
              // Send back execution result to server bridge
              if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                  type: "toolResponse",
                  id: callId,
                  name: name,
                  output: result
                }));
              }
            });
          }

        } catch (parseError) {
          console.error("Error reading server packet:", parseError);
        }
      };

      this.ws.onerror = (wsError) => {
        if (!this.isActivated || this.currentState === "disconnected") return;
        console.warn("[Aura Audio] WebSocket transport interrupted or disconnected.");
        this.dispatchError("Voice channel connection failed. If running inside the preview iframe, try opening the app in a new tab or use the Chatbot panel.");
        this.disconnect();
      };

      this.ws.onclose = (event) => {
        if (!this.isActivated || this.currentState === "disconnected") return;
        console.log(`WebSocket connection closed (code: ${event.code})`);
        if (event.code === 1006) {
          this.dispatchError("Voice channel disconnected. Please verify that GEMINI_API_KEY is active in AI Studio Secrets.");
        }
        this.disconnect();
      };

    } catch (e: any) {
      console.warn("Connection establish sequence failed:", e?.message || e);
      this.dispatchError(e.message || "Failed to initialize active channel.");
      this.disconnect();
    }
  }

  // Interruption triggers: stops all active audio players immediately
  private handleInterruption() {
    console.log("[Audio] Interruption signal received; flushing play logs.");
    
    // Stop all playing nodes
    this.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch (err) {
        // Already finished or stopped
      }
    });
    this.activeSources = [];
    this.nextStartTime = 0;
    
    // Set state back to user listening
    this.setState("listening");
  }

  // Direct raw PCM chunk scheduled playback at 24kHz
  private playAudioPCMChunk(base64Audio: string) {
    if (!this.outputAudioCtx || !this.outputGainNode) return;

    try {
      this.setState("speaking");
      const uint8Array = base64ToUint8Array(base64Audio);
      const floats = pcm16ToFloats(uint8Array);

      // Create AudioBuffer of 24000Hz (the exact playback sample rate of Gemini outputs)
      const buffer = this.outputAudioCtx.createBuffer(1, floats.length, 24000);
      buffer.getChannelData(0).set(floats);

      // Create Buffer source
      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = buffer;

      // Apply personalized voice pitch (detune in cents: 100 cents = 1 semitone)
      if (source.detune) {
        source.detune.value = this.voicePitchCents;
      }

      // Connect source to gain which is routed to analyser & speakers
      source.connect(this.outputGainNode);

      const currentTime = this.outputAudioCtx.currentTime;
      
      // Calculate effective playback duration based on pitch detune ratio
      const pitchRatio = Math.pow(2, this.voicePitchCents / 1200);
      const effectiveDuration = buffer.duration / pitchRatio;

      // Gapless scheduler sync
      if (this.nextStartTime < currentTime) {
        // Start fresh: 30ms ahead to bridge schedule timing
        this.nextStartTime = currentTime + 0.03;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += effectiveDuration;

      // Keep reference to handle real-time interruptions
      source.onended = () => {
        const index = this.activeSources.indexOf(source);
        if (index > -1) {
          this.activeSources.splice(index, 1);
        }
        
        // If there are no more active play nodes, revert state back to listening
        if (this.activeSources.length === 0 && this.currentState === "speaking") {
          this.setState("listening");
        }
      };

      this.activeSources.push(source);

    } catch (playbackError) {
      console.error("PCM Chunk buffering/playback failed:", playbackError);
    }
  }

  // Fully cleanup and release microphones & connection sockets
  public disconnect() {
    this.isActivated = false;
    this.setState("disconnected");

    // Close WS socket cleanly without firing spurious events
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    // Stop and release user microphone streams
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      this.micStream = null;
    }

    // Disconnect routing nodes
    if (this.micProcessorNode) {
      try {
        this.micProcessorNode.disconnect();
      } catch (e) {}
      this.micProcessorNode = null;
    }

    if (this.micSourceNode) {
      try {
        this.micSourceNode.disconnect();
      } catch (e) {}
      this.micSourceNode = null;
    }

    // Close Audio contexts
    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch (e) {}
      this.inputAudioCtx = null;
    }

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch (e) {}
      this.outputAudioCtx = null;
    }

    this.activeSources = [];
    this.nextStartTime = 0;
    this.inputAnalyser = null;
    this.outputAnalyser = null;
    this.outputGainNode = null;
  }

  /**
   * Dynamically adjusts AI voice pitch in cents (-600 to +600 cents).
   * 100 cents = 1 semitone. 0 = default natural tone.
   */
  public setVoicePitch(cents: number) {
    this.voicePitchCents = Math.max(-1000, Math.min(1000, cents));
    saveVoicePitch(this.voicePitchCents);

    // If audio is currently playing, update detune in real-time
    if (this.outputAudioCtx) {
      const now = this.outputAudioCtx.currentTime;
      this.activeSources.forEach((source) => {
        try {
          if (source.detune) {
            source.detune.setValueAtTime(this.voicePitchCents, now);
          }
        } catch (e) {}
      });
    }
  }

  public getVoicePitch(): number {
    return this.voicePitchCents;
  }

  /**
   * Adjusts voice playback volume (0.0 to 1.5).
   */
  public setOutputVolume(vol: number) {
    this.outputVolume = Math.max(0, Math.min(1.5, vol));
    saveVoiceVolume(this.outputVolume);

    if (this.outputGainNode && this.outputAudioCtx) {
      try {
        this.outputGainNode.gain.setValueAtTime(this.outputVolume, this.outputAudioCtx.currentTime);
      } catch (e) {}
    }
  }

  public getOutputVolume(): number {
    return this.outputVolume;
  }

  /**
   * Plays a pleasant interactive voice pitch preview sample so users can test how
   * Aura's voice sounds at the selected pitch before or during active sessions.
   */
  public playPitchPreview(overrideCents?: number): void {
    const cents = overrideCents !== undefined ? overrideCents : this.voicePitchCents;
    const pitchRatio = Math.pow(2, cents / 1200);

    // 1. Try SpeechSynthesis Utterance with customized pitch factor
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance("Hello, I am Aura.");
        // SpeechSynthesis pitch scale: 1.0 is default, ranges 0.1 to 2.0
        utterance.pitch = Math.max(0.5, Math.min(1.8, pitchRatio));
        utterance.rate = 1.0;
        utterance.volume = Math.min(1.0, this.outputVolume);

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
          (v.name.toLowerCase().includes("natural") || 
           v.name.toLowerCase().includes("samantha") || 
           v.name.toLowerCase().includes("google") ||
           v.name.toLowerCase().includes("female")) &&
          v.lang.startsWith("en")
        ) || voices.find(v => v.lang.startsWith("en"));

        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        window.speechSynthesis.speak(utterance);
        return;
      } catch (e) {
        console.warn("SpeechSynthesis preview fallback:", e);
      }
    }

    // 2. Fallback: Synthesize dual harmonic vocal-formant chime using Web Audio API
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtxClass) return;
      const ctx = new AudioCtxClass();
      
      const now = ctx.currentTime;
      const baseFreq = 440 * pitchRatio; // A4 scaled by pitch
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = "bandpass";
      filter.frequency.value = 1000 * pitchRatio;
      filter.Q.value = 2.0;

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(baseFreq, now);
      osc1.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + 0.3);

      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(baseFreq * 1.5, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.2 * this.outputVolume, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.85);
      osc2.stop(now + 0.85);

      setTimeout(() => {
        try {
          ctx.close();
        } catch (e) {}
      }, 1000);
    } catch (err) {
      console.warn("Audio preview synth error:", err);
    }
  }
}
