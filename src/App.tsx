import { useState, useEffect, useRef } from "react";
import { MyraaAudioSession, LiveState } from "./lib/audio";
import { MyraaCoreVisualizer, MyraaEmotion } from "./components/MyraaCoreVisualizer";
import { BrowserAgent } from "./components/BrowserAgent";
import { 
  Power, 
  Volume2, 
  Info, 
  Sparkles, 
  Globe, 
  Maximize2, 
  MessageSquare,
  MessageSquareOff, 
  Compass, 
  CircleAlert,
  MicOff,
  Mic,
  X,
  Brain,
  Monitor,
  Play,
  Pause,
  Square,
  RefreshCw,
  User as UserIcon,
  LogIn,
  LogOut,
  Menu,
  Languages
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Memory, MemoryCategory } from "./lib/memoryTypes";
import { MemoryDashboard } from "./components/MemoryDashboard";
import { AuthModal } from "./components/AuthModal";
import { AudioTranscriberModal } from "./components/AudioTranscriberModal";
import { LanguageSelectorModal } from "./components/LanguageSelectorModal";
import { AuraAuthGate } from "./components/AuraAuthGate";
import { AuraMediaPlayer, type ActiveMedia } from "./components/AuraMediaPlayer";
import { getLanguageByCode } from "./lib/languages";
import { logoutUser, subscribeToAuth, getCachedUser, type AuraUser } from "./lib/firebase";
import { getAuthHeaders, setActiveUserId } from "./lib/user";

export default function App() {
  const [state, setState] = useState<LiveState>("disconnected");

  // Media Player state (Playing songs / videos on YouTube)
  const [activeMedia, setActiveMedia] = useState<ActiveMedia | null>(null);

  // Real-time Screen Sharing states
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isScreenSharingPaused, setIsScreenSharingPaused] = useState<boolean>(false);
  const [screenVisionMode, setScreenVisionMode] = useState<boolean>(true);

  // References to preserve state across intervals
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenIntervalRef = useRef<any>(null);

  const isPausedRef = useRef<boolean>(false);
  const screenVisionRef = useRef<boolean>(true);
  const stateRef = useRef<LiveState>("disconnected");
  const recentOpensRef = useRef<Map<string, number>>(new Map());

  const isDuplicateOpen = (key: string, cooldownMs = 2500): boolean => {
    const now = Date.now();
    const prev = recentOpensRef.current.get(key);
    if (prev && now - prev < cooldownMs) {
      return true;
    }
    recentOpensRef.current.set(key, now);
    if (recentOpensRef.current.size > 40) {
      for (const [k, ts] of recentOpensRef.current.entries()) {
        if (now - ts > 10000) recentOpensRef.current.delete(k);
      }
    }
    return false;
  };

  const openExternalUrlOnce = (url: string) => {
    const a = document.createElement("a");
    a.href = url;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Sync state changes with refs to totally prevent stale closures in callbacks
  useEffect(() => {
    isPausedRef.current = isScreenSharingPaused;
  }, [isScreenSharingPaused]);

  useEffect(() => {
    screenVisionRef.current = screenVisionMode;
  }, [screenVisionMode]);

  useEffect(() => {
    stateRef.current = state;
    if (isScreenSharing && !isScreenSharingPaused && (state === "listening" || state === "speaking")) {
      setTimeout(() => {
        captureFrameAndSend();
      }, 250);
    }
  }, [state, isScreenSharing, isScreenSharingPaused]);

  // Clean up streaming intervals on unmount
  useEffect(() => {
    return () => {
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
    };
  }, []);

  const captureFrameAndSend = () => {
    const video = screenVideoRef.current;
    if (!video || isPausedRef.current || !screenVisionRef.current) {
      return;
    }

    if (stateRef.current === "disconnected") {
      return;
    }

    try {
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      if (!screenCanvasRef.current) {
        screenCanvasRef.current = document.createElement("canvas");
      }
      const canvas = screenCanvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Restrict maximum resolution size to keep payload light for Gemini Live
      const maxDim = 960;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(video, 0, 0, width, height);

      // Highly compressed JPEG standard is optimized and preserves details perfectly
      const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
      const base64 = dataUrl.split(",")[1];

      if (sessionRef.current) {
        sessionRef.current.sendVideoFrame(base64);
      }
    } catch (err) {
      console.error("[Screen Capture] Failed drawing frame to canvas:", err);
    }
  };

  const startScreenSharing = async () => {
    setErrorText(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 5 }
        },
        audio: false
      });

      screenStreamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(e => console.error("Video play warning:", e));
      screenVideoRef.current = video;

      setIsScreenSharing(true);
      setIsScreenSharingPaused(false);

      // Stop handling when native stop sharing bar button ends
      stream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };

      // Set up frame capture interval (one frame every 2 seconds is highly robust, preventing overload)
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
      }
      screenIntervalRef.current = setInterval(() => {
        captureFrameAndSend();
      }, 2000);

      // Promptly capture first frame immediately
      setTimeout(() => {
        captureFrameAndSend();
      }, 500);

    } catch (e: any) {
      const isUserDenial = 
        e.name === "NotAllowedError" || 
        e.name === "PermissionDeniedError" || 
        e.message?.toLowerCase().includes("denied") || 
        e.message?.toLowerCase().includes("permission") ||
        e.message?.toLowerCase().includes("cancel");

      if (isUserDenial) {
        console.warn("[Screen Share] Permission was declined or cancelled by the user:", e.message || e);
        setErrorText("Screen sharing was cancelled or permission was denied. Click Share Screen again to retry.");
        setTimeout(() => {
          setErrorText(prev => prev?.includes("cancelled or permission") ? null : prev);
        }, 5000);
      } else {
        console.error("Screen sharing failed with unexpected error:", e);
        setErrorText(`Could not capture screen: ${e.message || e}`);
      }
    }
  };

  const stopScreenSharing = () => {
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    if (screenVideoRef.current) {
      screenVideoRef.current.pause();
      screenVideoRef.current = null;
    }

    setIsScreenSharing(false);
    setIsScreenSharingPaused(false);
  };

  const pauseScreenSharing = () => {
    setIsScreenSharingPaused(true);
  };

  const resumeScreenSharing = () => {
    setIsScreenSharingPaused(false);
    // Refresh first frame immediately
    setTimeout(() => {
      captureFrameAndSend();
    }, 100);
  };

  const switchScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
    }
    await startScreenSharing();
  };

  const [activeEmotion, setActiveEmotion] = useState<MyraaEmotion>("idle");
  const [themeColor, setThemeColor] = useState<string>("charcoal");
  const [userCaption, setUserCaption] = useState<string>("");
  const [characterState, setCharacterState] = useState<"idle" | "thinking" | "talking">("idle");

  const detectEmotionFromText = (text: string): MyraaEmotion => {
    const lower = text.toLowerCase();
    if (lower.includes("haha") || lower.includes("lol") || lower.includes("funny") || lower.includes("joke") || lower.includes("hehe") || lower.includes("wink")) return "playful";
    if (lower.includes("happy") || lower.includes("harmony") || lower.includes("glad") || lower.includes("joy") || lower.includes("wonderful") || lower.includes("love") || lower.includes("smile")) return "happy";
    if (lower.includes("wow") || lower.includes("awesome") || lower.includes("excited") || lower.includes("amazing") || lower.includes("yay") || lower.includes("incredible") || lower.includes("hype")) return "excited";
    if (lower.includes("really?") || lower.includes("curious") || lower.includes("interest") || lower.includes("tell me more") || lower.includes("why") || lower.includes("how") || lower.includes("wonder")) return "curious";
    if (lower.includes("think") || lower.includes("calculat") || lower.includes("analyz") || lower.includes("hmmm") || lower.includes("process") || lower.includes("let me see") || lower.includes("conclude")) return "thinking";
    if (lower.includes("proud") || lower.includes("achieved") || lower.includes("expert") || lower.includes("skill") || lower.includes("confidence") || lower.includes("succeed")) return "proud";
    if (lower.includes("sad") || lower.includes("sorry") || lower.includes("unfortunate") || lower.includes("grief") || lower.includes("bad") || lower.includes("regret") || lower.includes("alas") || lower.includes("cry")) return "sad";
    if (lower.includes("shock") || lower.includes("surprise") || lower.includes("gasp") || lower.includes("unexpected") || lower.includes("seriously") || lower.includes("oh my")) return "surprised";
    if (lower.includes("blush") || lower.includes("shy") || lower.includes("embarrass") || lower.includes("nervous") || lower.includes("oops") || lower.includes("sorry about")) return "embarrassed";
    if (lower.includes("what?") || lower.includes("confus") || lower.includes("puzzled") || lower.includes("dont know") || lower.includes("not sure") || lower.includes("wait")) return "confused";
    return "idle";
  };
  const [modelCaption, setModelCaption] = useState<string>("");
  const [showTranscription, setShowTranscription] = useState<boolean>(true);

  const [activeProjectorUrl, setActiveProjectorUrl] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Myraa Autopilot system controller state
  const [browserTrigger, setBrowserTrigger] = useState<{
    type: string;
    args: any;
    id: string;
    callback: (res: any) => void;
  } | null>(null);

  // Auth State with instant cached recovery
  const [currentUser, setCurrentUser] = useState<AuraUser | null>(() => getCachedUser());
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);

  // Mobile Menu Drawer State
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Language Selection State (Urdu, Pashto, Punjabi, Sindhi, Balochi, Saraiki, Kashmiri, English, Auto)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    return localStorage.getItem("aura_language") || "auto";
  });
  const [showLanguageModal, setShowLanguageModal] = useState<boolean>(false);

  const activeLangObj = getLanguageByCode(selectedLanguage);

  const handleSelectLanguage = (code: string) => {
    setSelectedLanguage(code);
    localStorage.setItem("aura_language", code);

    // If session is active, reconnect immediately with the new language
    if (sessionRef.current && state !== "disconnected") {
      sessionRef.current.disconnect();
      setTimeout(() => {
        if (sessionRef.current) {
          sessionRef.current.connect(code);
        }
      }, 300);
    }
  };

  // Audio Transcriber State
  const [showAudioTranscriber, setShowAudioTranscriber] = useState<boolean>(false);

  // Persistent recollections database core state
  const [memories, setMemories] = useState<Memory[]>([]);
  const [showMemoryDashboard, setShowMemoryDashboard] = useState<boolean>(false);

  const sessionRef = useRef<MyraaAudioSession | null>(null);

  // Auth state listener (memory-backed, cleared immediately on sign out)
  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setCurrentUser(user);
      if (user) {
        setActiveUserId(user.uid);
      } else {
        setActiveUserId(null);
        setMemories([]);
        setUserCaption("");
        setModelCaption("");
        setActiveMedia(null);
        setActiveProjectorUrl(null);
        setErrorText(null);
        stopScreenSharing();
        if (sessionRef.current) {
          sessionRef.current.disconnect();
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Strictly isolate and load user's memories attached to their authenticated Gmail API key
  useEffect(() => {
    if (!currentUser) {
      setMemories([]);
      return;
    }
    const userId = currentUser.uid;
    setActiveUserId(userId);
    setMemories([]);

    // Remove any legacy localStorage memory caches so shared PCs never expose past accounts
    try {
      localStorage.removeItem(`aura_memories_${userId}`);
    } catch {}

    let isSubscribed = true;
    const fetchMemoriesWithRetry = async (attempt = 1) => {
      try {
        const res = await fetch("/api/memories", {
          headers: { ...getAuthHeaders() }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (isSubscribed && Array.isArray(data)) {
          setMemories(data);
        }
      } catch {
        if (isSubscribed && attempt < 3) {
          setTimeout(() => fetchMemoriesWithRetry(attempt + 1), 1500 * attempt);
        }
      }
    };

    fetchMemoriesWithRetry();

    return () => {
      isSubscribed = false;
    };
  }, [currentUser]);

  const handleAddManualMemory = async (category: MemoryCategory, text: string) => {
    try {
      const resp = await fetch("/api/memories", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({ category, text })
      });
      const saved = await resp.json();
      if (saved && saved.id) {
        setMemories((prev) => [...prev, saved]);
      }
    } catch (err) {
      console.error("Manual database recollect upload error:", err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      const resp = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() }
      });
      const resObj = await resp.json();
      if (resObj && resObj.success) {
        setMemories((prev) => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error("Manual memory delete execution failed:", err);
    }
  };

  // Initialize the audio session handlers once on mount
  useEffect(() => {
    sessionRef.current = new MyraaAudioSession({
      onStateChange: (newState) => {
        setState(newState);
        if (newState === "disconnected") {
          // Reset captions on disconnect
          setUserCaption("");
          setModelCaption("");
          setActiveEmotion("idle");
          setCharacterState("idle");
        } else if (newState === "listening") {
          // Return to receptive resting state
          setActiveEmotion("idle");
          setCharacterState("idle");
        } else if (newState === "speaking") {
          setCharacterState("talking");
        }
      },
      onTranscription: (role, text) => {
        if (role === "user") {
          setUserCaption(text);
          // Auto-clear the other caption when user starts talking
          setModelCaption("");
          setCharacterState("thinking");
        } else if (role === "model") {
          setModelCaption((prev) => {
            const next = prev + text;
            const newEmotion = detectEmotionFromText(next);
            setActiveEmotion(newEmotion);
            return next;
          });
          // Clear user caption when model replies
          setUserCaption("");
        }
      },
      onToolCall: async (name, args, callback) => {
        console.log(`[App] Tool call triggered: ${name}`, args);

        if (name === "playMedia") {
          const query = args.query;
          const mediaType = (args.mediaType as any) || "video";
          setActiveMedia({
            query,
            mediaType
          });
          callback({ result: `Now playing '${query}' directly on YouTube player.` });
          return;
        }

        if (name === "controlMedia") {
          const action = args.action;
          if (action === "close" || action === "stop") {
            setActiveMedia(null);
            callback({ result: "Media playback stopped and closed." });
          } else {
            callback({ result: `Media action '${action}' applied.` });
          }
          return;
        }

        if (name === "openDesktopApp") {
          const rawApp = String(args.appName || "").trim().toLowerCase();
          const targetMode: "app" | "browser" = args.target === "browser" ? "browser" : "app";

          if (isDuplicateOpen(`openDesktopApp:${rawApp}:${targetMode}`)) {
            callback({ result: `${args.appName || "App"} was just opened.` });
            return;
          }

          const nativeAppsCatalog: Record<
            string,
            { label: string; uri?: string; webUrl?: string }
          > = {
            whatsapp: { label: "WhatsApp", uri: "whatsapp:", webUrl: "https://web.whatsapp.com" },
            "whats app": { label: "WhatsApp", uri: "whatsapp:", webUrl: "https://web.whatsapp.com" },
            "whatsapp app": { label: "WhatsApp", uri: "whatsapp:", webUrl: "https://web.whatsapp.com" },
            "whatsapp desktop": { label: "WhatsApp", uri: "whatsapp:", webUrl: "https://web.whatsapp.com" },
            calculator: { label: "Calculator", uri: "ms-calculator:" },
            calc: { label: "Calculator", uri: "ms-calculator:" },
            vscode: { label: "VS Code", uri: "vscode:" },
            "vs code": { label: "VS Code", uri: "vscode:" },
            "visual studio code": { label: "VS Code", uri: "vscode:" },
            spotify: { label: "Spotify", uri: "spotify:", webUrl: "https://open.spotify.com" },
            telegram: { label: "Telegram", uri: "tg:", webUrl: "https://web.telegram.org" },
            discord: { label: "Discord", uri: "discord:", webUrl: "https://discord.com/app" },
            zoom: { label: "Zoom", uri: "zoommtg:", webUrl: "https://zoom.us/join" },
            settings: { label: "Windows Settings", uri: "ms-settings:" },
            "windows settings": { label: "Windows Settings", uri: "ms-settings:" },
            camera: { label: "Camera", uri: "microsoft.windows.camera:" },
            photos: { label: "Photos", uri: "ms-photos:" },
            clock: { label: "Clock", uri: "ms-clock:" },
            outlook: { label: "Outlook / Mail", uri: "mailto:" },
            "mail app": { label: "Outlook / Mail", uri: "mailto:" }
          };

          const webPortalsCatalog: Record<string, { label: string; url: string }> = {
            youtube: { label: "YouTube", url: "https://www.youtube.com" },
            "youtube music": { label: "YouTube Music", url: "https://music.youtube.com" },
            yt: { label: "YouTube", url: "https://www.youtube.com" },
            gmail: { label: "Gmail", url: "https://mail.google.com" },
            mail: { label: "Gmail", url: "https://mail.google.com" },
            google: { label: "Google", url: "https://www.google.com" },
            chrome: { label: "Google Chrome", url: "https://www.google.com" },
            browser: { label: "Google", url: "https://www.google.com" },
            instagram: { label: "Instagram", url: "https://www.instagram.com" },
            facebook: { label: "Facebook", url: "https://www.facebook.com" },
            netflix: { label: "Netflix", url: "https://www.netflix.com" },
            tiktok: { label: "TikTok", url: "https://www.tiktok.com" },
            twitter: { label: "X (Twitter)", url: "https://x.com" },
            x: { label: "X (Twitter)", url: "https://x.com" },
            linkedin: { label: "LinkedIn", url: "https://www.linkedin.com" },
            github: { label: "GitHub", url: "https://github.com" },
            maps: { label: "Google Maps", url: "https://maps.google.com" },
            "google maps": { label: "Google Maps", url: "https://maps.google.com" },
            drive: { label: "Google Drive", url: "https://drive.google.com" },
            "google drive": { label: "Google Drive", url: "https://drive.google.com" },
            docs: { label: "Google Docs", url: "https://docs.google.com" },
            "google docs": { label: "Google Docs", url: "https://docs.google.com" },
            sheets: { label: "Google Sheets", url: "https://sheets.google.com" },
            slides: { label: "Google Slides", url: "https://slides.google.com" },
            calendar: { label: "Google Calendar", url: "https://calendar.google.com" },
            meet: { label: "Google Meet", url: "https://meet.google.com" },
            "google meet": { label: "Google Meet", url: "https://meet.google.com" },
            translate: { label: "Google Translate", url: "https://translate.google.com" },
            chatgpt: { label: "ChatGPT", url: "https://chatgpt.com" }
          };

          const nativeMatch =
            nativeAppsCatalog[rawApp] ||
            Object.entries(nativeAppsCatalog).find(([k]) => {
              const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              return new RegExp(`\\b${escaped}\\b`, "i").test(rawApp);
            })?.[1];

          // Native desktop app via OS URI protocol (launched ONCE without opening duplicate Chrome tabs)
          if (nativeMatch && targetMode === "app" && nativeMatch.uri) {
            if (!isDuplicateOpen(`url:${nativeMatch.uri}`)) {
              openExternalUrlOnce(nativeMatch.uri);
            }
            callback({
              result: `Launched ${nativeMatch.label} desktop application on your laptop.`
            });
            return;
          }

          // Explicit Chrome/Browser mode OR web portal (Gmail, YouTube, etc.)
          let targetUrl =
            (nativeMatch && nativeMatch.webUrl) ||
            webPortalsCatalog[rawApp]?.url ||
            Object.entries(webPortalsCatalog).find(([k]) => {
              const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              return new RegExp(`\\b${escaped}\\b`, "i").test(rawApp);
            })?.[1]?.url;

          const label =
            nativeMatch?.label ||
            webPortalsCatalog[rawApp]?.label ||
            args.appName ||
            "App";

          if (!targetUrl) {
            const cleanQuery = String(args.appName || "").trim();
            if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanQuery)) {
              targetUrl = `https://${cleanQuery}`;
            } else {
              targetUrl = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
            }
          }

          if (!isDuplicateOpen(`url:${targetUrl}`)) {
            openExternalUrlOnce(targetUrl);
          }

          callback({ result: `Opened ${label} once (${targetUrl}).` });
          return;
        }

        if (name === "searchWeb") {
          const q = args.query || "";
          const engine = args.engine || "google";
          const searchUrl = engine === "youtube"
            ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
            : `https://www.google.com/search?q=${encodeURIComponent(q)}`;

          if (!isDuplicateOpen(`url:${searchUrl}`)) {
            openExternalUrlOnce(searchUrl);
          }
          callback({ result: `Searching ${engine} for '${q}'.` });
          return;
        }

        const browserTools = [
          "browserOpen",
          "browserSearch",
          "browserClick",
          "browserMediaControl",
          "browserScroll",
          "browserType",
          "browserGoBack",
          "browserTabAction",
          "openWebsite"
        ];

        if (browserTools.includes(name)) {
          let startingUrl = "https://youtube.com";
          if ((name === "browserOpen" || name === "openWebsite") && args.url) {
            startingUrl = args.url;
          } else if (name === "browserSearch" && args.query) {
            startingUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`;
          }

          if (startingUrl && !startingUrl.startsWith("http://") && !startingUrl.startsWith("https://")) {
            startingUrl = "https://" + startingUrl;
          }

          if (!isDuplicateOpen(`url:${startingUrl}`)) {
            openExternalUrlOnce(startingUrl);
          }

          callback({ result: `Opened ${startingUrl} once in a new tab.` });
        } else if (name === "changeBackground") {
          const colorName = args.color?.toLowerCase();
          const validColors = ["violet", "crimson", "emerald", "celestial", "gold", "rose", "charcoal"];
          
          if (colorName && validColors.includes(colorName)) {
            setThemeColor(colorName);
            callback({ result: `Successfully shifted aesthetic atmosphere to ${colorName}.` });
          } else {
            callback({ error: `Unsupported color '${colorName}'. Supported themes are: ${validColors.join(", ")}` });
          }
        } else {
          callback({ error: `Tool ${name} is not implemented.` });
        }
      },
      onError: (err) => {
        setErrorText(err);
      },
      onMemorySync: (updatedMemories) => {
        console.log("[App] WebSocket memories sync triggered:", updatedMemories);
        if (Array.isArray(updatedMemories)) {
          setMemories(updatedMemories);
        }
      }
    });

    return () => {
      if (sessionRef.current) {
        sessionRef.current.disconnect();
      }
    };
  }, []);

  const handleToggleConnection = async () => {
    setErrorText(null);

    // Require user to be logged in before starting conversation
    if (!currentUser) {
      setShowAuthModal(true);
      return;
    }

    if (!sessionRef.current) return;

    if (state === "disconnected") {
      await sessionRef.current.connect(selectedLanguage);
    } else {
      sessionRef.current.disconnect();
    }
  };

  // Maps theme colors to CSS ambient light spots
  const getAmbientStyles = () => {
    switch (themeColor) {
      case "violet":
        return "from-purple-950/40 via-violet-950/20 to-slate-950";
      case "crimson":
        return "from-red-950/40 via-orange-950/20 to-slate-950";
      case "emerald":
        return "from-emerald-950/40 via-teal-950/20 to-slate-950";
      case "celestial":
        return "from-sky-950/45 via-indigo-950/25 to-slate-950";
      case "gold":
        return "from-amber-950/30 via-yellow-950/15 to-slate-950";
      case "rose":
        return "from-rose-950/40 via-pink-950/20 to-slate-950";
      case "charcoal":
      default:
        return "from-slate-900/50 via-slate-950/30 to-slate-950";
    }
  };

  const getThemeTextGlow = () => {
    switch (themeColor) {
      case "violet": return "text-purple-400 drop-shadow-[0_0_12px_rgba(168,85,247,0.5)]";
      case "crimson": return "text-rose-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]";
      case "emerald": return "text-emerald-400 drop-shadow-[0_0_12px_rgba(16,185,129,0.5)]";
      case "celestial": return "text-sky-400 drop-shadow-[0_0_12px_rgba(14,165,233,0.5)]";
      case "gold": return "text-amber-400 drop-shadow-[0_0_12px_rgba(245,158,11,0.5)]";
      case "rose": return "text-pink-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.5)]";
      case "charcoal":
      default:
        return "text-indigo-400 drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]";
    }
  };

  const getOrbRingColor = () => {
    switch (state) {
      case "listening": return "border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.3)] bg-indigo-500/10";
      case "speaking": return "border-purple-500/70 shadow-[0_0_40px_rgba(168,85,247,0.4)] bg-purple-500/10";
      case "connecting": return "border-amber-500/50 animate-pulse bg-amber-500/10";
      case "disconnected":
      default:
        return "border-white/10 hover:border-indigo-500/30 bg-white/5";
    }
  };

  // Gatekeeper: Before the AI opens, display the welcome & authentication gateway page
  // Ensures each email gets its own isolated personal API key and private history
  if (!currentUser) {
    return (
      <AuraAuthGate
        onAuthenticated={(user) => {
          setCurrentUser(user);
          setActiveUserId(user.uid);
        }}
        currentLanguage={selectedLanguage}
        onLanguageChange={handleSelectLanguage}
      />
    );
  }

  return (
    <div
      id="myraa-holographic-desktop"
      className={`fixed inset-0 w-full h-full overflow-hidden bg-[#020205] text-white ${getAmbientStyles()} theme-transition flex flex-col justify-between p-3 sm:p-8 select-none`}
    >
      {/* Ambient Background Gradients contained to eliminate horizontal and vertical viewport bleed */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-900/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-cyan-900/15 rounded-full blur-[150px]" />
        <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] bg-indigo-800/10 rounded-full blur-[100px]" />
      </div>

      {/* Decorative grid pattern background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />

      {/* FULL VIEWPORT HOLOGRAPHIC STAGE: Myraa materializes across the entire screen */}
      <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
        <MyraaCoreVisualizer
          session={sessionRef.current}
          state={state}
          themeColor={themeColor}
          activeEmotion={activeEmotion}
          characterState={characterState}
        />
      </div>

      {/* HEADER SECTION - Clean, uncluttered layout */}
      <header className="relative z-30 flex items-center justify-between w-full max-w-5xl mx-auto select-none gap-2 px-1 shrink-0">
        {/* Clean Logo - ONLY "AURA" */}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-black tracking-widest uppercase bg-gradient-to-r from-cyan-400 via-teal-300 to-purple-400 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(34,211,238,0.4)] whitespace-nowrap">
            AURA
          </h1>
          <div className={`w-2 h-2 rounded-full ${
            state === "listening" || state === "speaking" 
              ? "bg-cyan-400 animate-ping" 
              : "bg-white/20"
          }`} />
        </div>

        {/* Desktop Navigation Action Buttons */}
        <div className="hidden md:flex items-center gap-2.5">
          {/* Compact Screen Sharing Toggle Button */}
          {!isScreenSharing ? (
            <button
              type="button"
              onClick={startScreenSharing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 hover:border-cyan-400/50 text-xs font-medium text-slate-200 hover:text-cyan-200 transition duration-200 cursor-pointer backdrop-blur-md active:scale-95"
              title="Share laptop screen so Aura can see & help you"
            >
              <Monitor size={13} className="text-cyan-400 shrink-0" />
              <span>Share Screen</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/50 text-xs font-medium text-emerald-200 backdrop-blur-md">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isScreenSharingPaused ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
                }`}
              />
              <span className="text-[11px]">{isScreenSharingPaused ? "Paused" : "Sharing"}</span>
              <button
                type="button"
                onClick={isScreenSharingPaused ? resumeScreenSharing : pauseScreenSharing}
                className="p-1 hover:bg-white/10 rounded-full text-emerald-200 transition cursor-pointer"
                title={isScreenSharingPaused ? "Resume Screen Share" : "Pause Screen Share"}
              >
                {isScreenSharingPaused ? <Play size={11} /> : <Pause size={11} />}
              </button>
              <button
                type="button"
                onClick={stopScreenSharing}
                className="p-1 hover:bg-rose-500/25 rounded-full text-rose-300 transition cursor-pointer"
                title="Stop Screen Sharing"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Language Selector Toggle Button */}
          <button
            onClick={() => setShowLanguageModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-cyan-400/40 text-xs font-semibold text-cyan-200 transition duration-200 cursor-pointer backdrop-blur-md active:scale-95 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
            title="Select Language / زبان منتخب کریں"
          >
            <span className="text-sm leading-none">{activeLangObj.flag}</span>
            <span className="max-w-[90px] truncate">{activeLangObj.nativeName}</span>
            <Languages size={14} className="text-cyan-400 shrink-0" />
          </button>

          {/* User Account / Auth Button */}
          {currentUser ? (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 backdrop-blur-md">
              {currentUser.photoURL ? (
                <img 
                  src={currentUser.photoURL} 
                  alt="Profile" 
                  className="w-5 h-5 rounded-full object-cover border border-cyan-400"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-400 to-purple-600 text-black font-bold flex items-center justify-center text-[10px]">
                  {(currentUser.displayName || currentUser.email || "U").charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-xs font-semibold text-cyan-100 max-w-[140px] truncate">
                {currentUser.displayName || currentUser.email?.split("@")[0]}
              </span>
              {currentUser.keyPrefix && (
                <span
                  className="hidden lg:inline text-[10px] font-mono text-cyan-300/80 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20"
                  title="Unique isolated personal API key active for this email"
                >
                  {currentUser.keyPrefix}
                </span>
              )}
              <button
                onClick={() => logoutUser()}
                className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition cursor-pointer"
                title="Sign Out"
              >
                <LogOut size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-black font-bold text-xs shadow-[0_0_15px_rgba(34,211,238,0.3)] transition cursor-pointer active:scale-95"
            >
              <LogIn size={15} />
              <span>Sign In</span>
            </button>
          )}
        </div>

        {/* Mobile Menu Toggle Button */}
        <div className="flex md:hidden items-center gap-2">
          {currentUser ? (
            <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-2.5 py-1">
              <div className="w-5 h-5 rounded-full bg-cyan-400 text-black font-bold flex items-center justify-center text-[10px]">
                {(currentUser.displayName || currentUser.email || "U").charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-medium text-cyan-200 max-w-[70px] truncate">
                {currentUser.displayName || currentUser.email?.split("@")[0]}
              </span>
            </div>
          ) : (
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-2.5 py-1 rounded-full bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-bold text-xs flex items-center gap-1"
            >
              <LogIn size={13} />
              <span>Sign In</span>
            </button>
          )}

          {/* Compact Screen Share Icon Button (narrow screens) */}
          <button
            type="button"
            onClick={isScreenSharing ? stopScreenSharing : startScreenSharing}
            className={`p-2 rounded-xl border transition cursor-pointer active:scale-95 flex items-center gap-1 ${
              isScreenSharing
                ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-200"
                : "bg-white/10 hover:bg-white/15 border-white/15 text-cyan-200"
            }`}
            title={isScreenSharing ? "Stop Screen Sharing" : "Share Screen"}
          >
            <Monitor size={15} />
          </button>

          {/* Compact Language Button */}
          <button
            onClick={() => setShowLanguageModal(true)}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/15 border border-cyan-400/30 text-cyan-200 transition cursor-pointer active:scale-95 flex items-center gap-1"
            title="Select Language / زبان منتخب کریں"
          >
            <span className="text-xs leading-none">{activeLangObj.flag}</span>
            <Languages size={15} className="text-cyan-400" />
          </button>

          <button
            onClick={() => setMobileMenuOpen(true)}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-cyan-200 transition cursor-pointer active:scale-95"
            title="Open Features Menu"
          >
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* CORE AVATAR AND VISUALS */}
      <main className="relative z-10 flex-1 w-full max-w-4xl mx-auto flex flex-col items-center justify-between py-1 sm:py-4 min-h-0 overflow-hidden">
        
        {/* Holographic Projection Screen Widget (if website opened) */}
        <AnimatePresence>
          {activeProjectorUrl && (
            <div className="absolute inset-x-0 top-0 z-30 flex justify-center p-2">
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                className="flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-indigo-500/20 bg-indigo-950/45 backdrop-blur-xl shadow-lg w-full max-w-md"
              >
                <div className="flex items-center gap-3 overflow-hidden text-left">
                  <div className="p-2 ml-1 rounded-xl bg-indigo-500/20 text-indigo-300">
                    <Globe size={18} />
                  </div>
                  <div className="overflow-hidden">
                    <h4 className="text-xs font-bold font-mono tracking-wide text-indigo-200 uppercase">Holographic Projection Broadcast</h4>
                    <p className="text-xs text-indigo-400 truncate max-w-[200px]">{activeProjectorUrl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setActiveProjectorUrl(activeProjectorUrl)}
                    className="p-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-400 transition"
                    title="View Frame"
                  >
                    <Maximize2 size={14} />
                  </button>
                  <button
                    onClick={() => setActiveProjectorUrl(null)}
                    className="p-2 rounded-xl hover:bg-white/5 text-slate-400 hover:text-white transition"
                  >
                    <X size={14} />
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Space Spacer to avoid head area */}
        <div className="h-0 sm:h-6 shrink-0" />

        {/* Cinematic dialogue layer overlay - Smooth, delicate text transitions with soft focus blur */}
        <div id="cinematic-subtitles" className="w-full max-w-3xl flex flex-col items-center justify-center text-center px-4 relative z-25 mt-auto mb-1 sm:mb-4 pointer-events-none min-h-[2.5rem] sm:min-h-[5rem] shrink-0">
          <AnimatePresence mode="wait">
            {(() => {
              const textType = modelCaption 
                ? "model" 
                : userCaption 
                  ? "user" 
                  : "status";

              const activeText = modelCaption 
                ? modelCaption 
                : userCaption 
                  ? userCaption 
                  : state === "listening" 
                    ? "I am listening. Speak freely..." 
                    : state === "connecting" 
                      ? "Materializing presence links..." 
                      : "";

              if (!activeText) {
                return null;
              }

              // If subtitle overlay is manually disabled, hide speech transcriptions to keep visualizer screen completely clean
              if (!showTranscription && (textType === "model" || textType === "user")) {
                return null;
              }

              return (
                <motion.div
                  key={textType}
                  initial={{ opacity: 0, y: 15, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -15, filter: "blur(6px)" }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center justify-center w-full"
                >
                  {textType === "model" && (
                    <h2 className="text-xl sm:text-2xl font-light text-white leading-relaxed tracking-wide font-display max-w-2xl drop-shadow-[0_2px_20px_rgba(0,0,0,0.9)]">
                      {activeText}
                    </h2>
                  )}

                  {textType === "user" && (
                    <p className="text-cyan-300 font-mono text-sm sm:text-base tracking-wider flex items-center justify-center gap-2 drop-shadow-[0_1px_10px_rgba(0,0,0,0.85)] font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      <span>&ldquo;{activeText}&rdquo;</span>
                    </p>
                  )}

                  {textType === "status" && (
                    <span className="text-xs sm:text-sm uppercase tracking-[0.3em] font-medium text-white/30 font-sans tracking-widest drop-shadow-[0_1px_4px_rgba(0, 0, 0, 0.5)]">
                      {activeText}
                    </span>
                  )}
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </div>

        {/* Interactive suggestions prompt guide */}
        <AnimatePresence>
          {showGuide && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="mt-6 p-5 rounded-2xl border border-white/10 bg-slate-900/85 backdrop-blur-2xl max-w-md text-left w-full absolute z-40 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-3 text-white">
                <div className="flex items-center gap-1.5 font-display text-sm font-bold tracking-wide">
                  <Compass size={16} className="text-indigo-400" />
                  <span>PLAYFUL CORE SUGGESTIONS</span>
                </div>
                <button 
                  onClick={() => setShowGuide(false)}
                  className="text-slate-400 hover:text-white transition"
                >
                  <X size={14} />
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-4 font-mono leading-relaxed">
                Aura is equipped with dynamic visual modules and browser controllers. Here are clever triggers to try speaking aloud:
              </p>
              <div className="space-y-2 text-xs font-serif italic text-indigo-300">
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer font-sans normal-case text-slate-200">
                  ⚡ &quot;Aura, change atmosphere of your core to crimson&quot; <span className="text-[10px] font-mono text-indigo-400 block mt-0.5 font-medium">Shifts theme color background</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer font-sans normal-case text-slate-200">
                  ⚡ &quot;Open youtube.com on my screen please&quot; <span className="text-[10px] font-mono text-indigo-400 block mt-0.5 font-medium">Opens the link directly in a new tab</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition cursor-pointer font-sans normal-case text-slate-200">
                  ⚡ &quot;Tell me a witty joke and change background to gold&quot; <span className="text-[10px] font-mono text-indigo-400 block mt-0.5 font-medium">Combines tools & voice</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Global Error Banner */}
        <AnimatePresence>
          {errorText && (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              className="mt-6 flex items-start gap-3 p-4 rounded-2xl border border-rose-500/30 bg-rose-950/60 backdrop-blur-xl max-w-lg w-full text-left shadow-lg"
            >
              <CircleAlert className="text-rose-400 shrink-0 mt-0.5" size={18} />
              <div className="flex-1">
                <h4 className="text-xs font-bold uppercase tracking-widest text-rose-300 font-mono">Notification / نوٹس</h4>
                <p className="text-xs text-rose-100 mt-1 leading-relaxed">{errorText}</p>
                
                {(errorText.toLowerCase().includes("permission") || errorText.toLowerCase().includes("microphone") || errorText.toLowerCase().includes("audio")) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setErrorText(null);
                        handleToggleConnection();
                      }}
                      className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 rounded-xl text-xs font-semibold text-cyan-200 cursor-pointer transition active:scale-95 flex items-center gap-1.5"
                    >
                      <RefreshCw size={12} />
                      <span>Retry Microphone</span>
                    </button>
                  </div>
                ) : null}

                <button
                  onClick={() => setErrorText(null)}
                  className="mt-2.5 text-[10px] font-bold text-rose-400 hover:text-rose-300 underline font-mono uppercase cursor-pointer block"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* FOOTER INTERFACE WITH WAVEFORM AND CONTROLS */}
      <footer className="relative z-10 w-full max-w-2xl mx-auto flex flex-col items-center gap-2 sm:gap-4 mt-auto pb-1 sm:pb-3 shrink-0">
        
        {/* Dynamic Minimalist Waveform Visualizer */}
        <div className="flex items-center justify-center gap-1 h-6 sm:h-8 w-44 shrink-0">
          {[12, 28, 16, 32, 20, 8].map((baseHeight, idx) => {
            let heightFactor = 0.35;
            if (state === "speaking") {
              heightFactor = 0.35 + Math.sin(Date.now() * 0.02 + idx * 0.9) * 0.65;
            } else if (state === "listening") {
              heightFactor = 0.2 + Math.sin(Date.now() * 0.01 + idx * 0.5) * 0.4;
            } else {
              heightFactor = idx % 2 === 0 ? 0.25 : 0.12;
            }
            const calculatedHeight = Math.max(3, baseHeight * heightFactor);

            return (
              <div
                key={idx}
                className={`w-0.5 rounded-full transition-all duration-300 ${
                  state === "speaking" ? "bg-purple-400" : state === "listening" ? "bg-cyan-400" : "bg-white/10"
                }`}
                style={{ height: `${calculatedHeight}px` }}
              />
            );
          })}
        </div>

        {/* Sign In Required Callout Banner */}
        {!currentUser && state === "disconnected" && (
          <button
            onClick={() => setShowAuthModal(true)}
            className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 border border-cyan-400/40 hover:border-cyan-400 text-cyan-200 text-xs sm:text-sm font-semibold rounded-2xl shadow-[0_0_25px_rgba(34,211,238,0.25)] flex items-center gap-2 backdrop-blur-xl transition hover:scale-105 cursor-pointer animate-pulse shrink-0"
          >
            <LogIn size={15} className="text-cyan-400 shrink-0" />
            <span>Sign in to start talking with Aura AI</span>
          </button>
        )}

        {/* Glossy Beautiful Primary Connector Core Node */}
        <div className="flex items-center justify-center relative mb-1 sm:mb-3 shrink-0">
          <button 
            onClick={handleToggleConnection}
            className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer ${
              state === "disconnected"
                ? "bg-white/10 hover:bg-white/15 border border-white/15 text-white shadow-[0_0_20px_rgba(255,255,255,0.02)] hover:scale-105 active:scale-95"
                : state === "listening"
                ? "bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/80 text-cyan-200 shadow-[0_0_35px_rgba(34,211,238,0.3)] animate-pulse scale-105"
                : state === "speaking"
                ? "bg-purple-500/90 hover:bg-purple-600 border border-purple-400/95 text-white shadow-[0_0_35px_rgba(168,85,247,0.4)] scale-105"
                : "bg-amber-600 border border-amber-300 text-white animate-spin"
            }`}
            title={state === "disconnected" ? "Wake Aura" : "Sleep core"}
          >
            {state === "disconnected" ? (
              <Power className="opacity-80 w-5 h-5 sm:w-6 sm:h-6" />
            ) : state === "connecting" ? (
              <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : state === "listening" ? (
              <Mic className="text-cyan-200 w-5 h-5 sm:w-6 sm:h-6" />
            ) : (
              <Volume2 className="text-white w-5 h-5 sm:w-6 sm:h-6" />
            )}
          </button>

          {/* Quiet Reset Projection Anchor */}
          {(activeProjectorUrl || errorText) && (
            <button 
              onClick={() => {
                if (activeProjectorUrl) setActiveProjectorUrl(null);
                setErrorText(null);
              }}
              className="absolute right-[-60px] p-2 rounded-full hover:bg-white/5 text-slate-400 hover:text-white transition duration-150 cursor-pointer"
              title="Reset Screen Broadcasts"
            >
              <X size={16} />
            </button>
          )}
        </div>

      </footer>

      {/* In-app Browser Agent / Holographic Projector Viewport */}
      <AnimatePresence>
        {activeProjectorUrl && (
          <BrowserAgent
            url={activeProjectorUrl}
            onClose={() => {
              setActiveProjectorUrl(null);
              setBrowserTrigger(null);
            }}
            actionTrigger={browserTrigger}
          />
        )}
      </AnimatePresence>

      {/* Recollections sliding core panel */}
      <MemoryDashboard
        isOpen={showMemoryDashboard}
        onClose={() => setShowMemoryDashboard(false)}
        memories={memories}
        onAddMemory={handleAddManualMemory}
        onDeleteMemory={handleDeleteMemory}
        themeColor={themeColor}
      />

      {/* Real Firebase Authentication Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      {/* Language Selector Modal */}
      <LanguageSelectorModal
        isOpen={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        selectedLanguage={selectedLanguage}
        onSelectLanguage={handleSelectLanguage}
      />

      {/* Mobile Features Navigation Sheet */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="w-full max-w-md bg-slate-900 border border-cyan-500/30 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-white">Aura Features</h3>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    if (isScreenSharing) {
                      stopScreenSharing();
                    } else {
                      startScreenSharing();
                    }
                  }}
                  className={`w-full p-3.5 rounded-2xl border flex items-center justify-between text-left transition cursor-pointer ${
                    isScreenSharing
                      ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
                      : "bg-white/5 hover:bg-white/10 border-white/15 text-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-300">
                      <Monitor size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-bold">
                        {isScreenSharing ? "Stop Screen Sharing" : "Share Laptop Screen"}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {isScreenSharing ? "Aura is viewing your screen" : "Let Aura see your screen and help"}
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setShowLanguageModal(true);
                  }}
                  className="w-full p-3.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-cyan-400/40 flex items-center justify-between text-left transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-300">
                      <Languages size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span>Language: {activeLangObj.nativeName}</span>
                        <span className="text-sm">{activeLangObj.flag}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">Urdu, Pashto, Punjabi, Sindhi, Balochi, English</div>
                    </div>
                  </div>
                </button>

                {currentUser ? (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      logoutUser();
                    }}
                    className="w-full p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-left transition text-rose-300"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-rose-500/20">
                        <LogOut size={18} />
                      </div>
                      <div>
                        <div className="text-xs font-bold">Sign Out</div>
                        <div className="text-[11px] text-rose-300/70">{currentUser.email}</div>
                      </div>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setShowAuthModal(true);
                    }}
                    className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 text-black font-bold text-xs flex items-center justify-center gap-2"
                  >
                      <LogIn size={16} />
                      <span>Sign In</span>
                    </button>
                  )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Real-time YouTube Video & Music Player */}
      <AuraMediaPlayer
        media={activeMedia}
        onClose={() => setActiveMedia(null)}
      />

    </div>
  );
}
