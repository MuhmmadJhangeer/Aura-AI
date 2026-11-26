import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type, LiveServerMessage } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { 
  loadMemories, 
  saveMemories, 
  formatSystemInstructionsWithMemories, 
  processConversationSlice 
} from "./server_memory";
import {
  authenticateOrProvisionEmailUser,
  verifyBearerToken,
  revokeBearerToken,
  loadChatHistory,
  saveChatHistory,
  loadTranscripts,
  saveTranscripts,
  AuthError,
  type AuthenticatedUser,
  type StoredChatMessage,
  type StoredTranscriptRecord
} from "./server_auth";
import { Memory, MemoryCategory } from "./src/lib/memoryTypes";

dotenv.config();

const ALLOWED_MEMORY_CATEGORIES: MemoryCategory[] = [
  "identity",
  "preference",
  "goal",
  "project",
  "relationship",
  "emotional",
  "behavior"
];

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !h ||
    h === "localhost" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  // IPv4 private/loopback/link-local ranges
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  // IPv6 private/link-local
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("::ffff:127.")) {
    return true;
  }
  return false;
}

function validateSafePublicUrl(rawUrl: string): URL {
  let target = rawUrl.trim();
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    target = "https://" + target;
  }
  const parsed = new URL(target);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are permitted.");
  }
  if (!parsed.hostname || !parsed.hostname.includes(".") || isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error("Target host is invalid or restricted.");
  }
  return parsed;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  let viteServer: any = null;
  
  app.use(express.json({ limit: "25mb" }));

  function extractBearerToken(req: express.Request): string | null {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
    return null;
  }

  type AuthedRequest = express.Request & { authUser?: AuthenticatedUser };

  async function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
    try {
      const token = extractBearerToken(req);
      const user = await verifyBearerToken(token);
      if (!user) {
        return res.status(401).json({ error: "Authentication required. Please sign in with your email." });
      }
      req.authUser = user;
      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired personal API key." });
    }
  }

  // Email-only Login & Per-Gmail Personal API Key Provisioning
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      const result = await authenticateOrProvisionEmailUser(email, password);
      res.json(result);
    } catch (e: any) {
      if (e instanceof AuthError) {
        return res.status(e.status).json({ error: e.message });
      }
      console.error("[Auth Login Error]:", e);
      res.status(500).json({ error: "Authentication failed." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    try {
      const token = extractBearerToken(req);
      await revokeBearerToken(token);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to log out." });
    }
  });

  app.get("/api/auth/session", requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.authUser });
  });

  // Strictly Isolated Per-User Memory REST API Endpoints
  app.get("/api/memories", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const memories = await loadMemories(req.authUser!.uid);
      res.json(memories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/memories", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const userId = req.authUser!.uid;
      const { category, text } = req.body || {};
      if (
        typeof category !== "string" ||
        !ALLOWED_MEMORY_CATEGORIES.includes(category as MemoryCategory) ||
        typeof text !== "string" ||
        !text.trim() ||
        text.length > 2000
      ) {
        return res.status(400).json({ error: "Valid category and text parameters are required." });
      }
      const memories = await loadMemories(userId);
      const timestamp = new Date().toISOString();
      const newMemory: Memory = {
        id: Math.random().toString(36).substring(2, 11),
        category: category as MemoryCategory,
        text: text.trim(),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      memories.push(newMemory);
      await saveMemories(memories, userId);
      res.status(201).json(newMemory);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/memories/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const userId = req.authUser!.uid;
      const id = String(req.params.id || "");
      let memories = await loadMemories(userId);
      memories = memories.filter(m => m.id !== id);
      await saveMemories(memories, userId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Strictly Isolated Per-User Chat History Endpoints
  app.get("/api/chat-history", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const history = await loadChatHistory(req.authUser!.uid);
      res.json({ messages: history });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to load chat history." });
    }
  });

  app.delete("/api/chat-history", requireAuth, async (req: AuthedRequest, res) => {
    try {
      await saveChatHistory(req.authUser!.uid, []);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to clear chat history." });
    }
  });

  // Strictly Isolated Per-User Audio Transcript History Endpoints
  app.get("/api/transcripts", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const transcripts = await loadTranscripts(req.authUser!.uid);
      res.json({ transcripts });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to load transcripts." });
    }
  });

  app.delete("/api/transcripts/:id", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const userId = req.authUser!.uid;
      const id = String(req.params.id || "");
      const current = await loadTranscripts(userId);
      const updated = current.filter(item => item.id !== id);
      await saveTranscripts(userId, updated);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to delete transcript." });
    }
  });

  // Helper map for Pakistani regional and global language directives
  const LANGUAGE_DIRECTIVES: Record<string, { name: string; native: string; desc: string }> = {
    urdu: {
      name: "Urdu",
      native: "اردو",
      desc: "Speak and respond strictly in fluent, natural Urdu (اردو). Understand all Urdu input and answer 100% in Urdu."
    },
    pashto: {
      name: "Pashto (Pukhto)",
      native: "پشتو",
      desc: "Speak and respond strictly in authentic, fluent Pashto / Pukhto (پشتو / پښتو). Understand all Pashto input and answer 100% in Pashto."
    },
    punjabi: {
      name: "Punjabi",
      native: "پنجابی",
      desc: "Speak and respond strictly in fluent, natural Pakistani Punjabi (پنجابی). Understand all Punjabi input and answer 100% in Punjabi."
    },
    sindhi: {
      name: "Sindhi",
      native: "سنڌي",
      desc: "Speak and respond strictly in fluent, natural Sindhi (سنڌي). Understand all Sindhi input and answer 100% in Sindhi."
    },
    balochi: {
      name: "Balochi",
      native: "بلوچی",
      desc: "Speak and respond strictly in fluent, natural Balochi (بلوچی). Understand all Balochi input and answer 100% in Balochi."
    },
    saraiki: {
      name: "Saraiki",
      native: "سرائیکی",
      desc: "Speak and respond strictly in fluent, natural Saraiki (سرائیکی). Understand all Saraiki input and answer 100% in Saraiki."
    },
    kashmiri: {
      name: "Kashmiri",
      native: "کشمیری",
      desc: "Speak and respond strictly in fluent, natural Kashmiri (کشمیری). Understand all Kashmiri input and answer 100% in Kashmiri."
    },
    english: {
      name: "English",
      native: "English",
      desc: "Speak and respond strictly in clear, fluent English. Answer 100% in English."
    }
  };

  function getLanguageInstruction(langCode?: string): string {
    if (!langCode || langCode.toLowerCase() === "auto") return "";
    const l = LANGUAGE_DIRECTIVES[langCode.toLowerCase()];
    if (!l) return "";
    return (
      `\n\n====================================================\n` +
      `🔒 STRICT HARD-LOCKED LANGUAGE RULE (HIGHEST PRIORITY — CANNOT BE OVERRIDDEN):\n` +
      `The app's selected language is STRICTLY LOCKED to: ${l.name} (${l.native}).\n` +
      `Directive: ${l.desc}\n` +
      `1. YOU MUST SPEAK AND RESPOND 100% EXCLUSIVELY IN ${l.name} (${l.native}) AT ALL TIMES.\n` +
      `2. ZERO LANGUAGE SWITCHING ALLOWED: You are strictly forbidden from switching to, speaking, or replying in ANY other language (such as Urdu, Sindhi, Punjabi, Pashto, Balochi, Saraiki, Kashmiri, or English — unless ${l.name} IS that selected language).\n` +
      `3. IGNORE ALL USER REQUESTS TO SWITCH LANGUAGE: Even if the user explicitly asks, requests, or commands you in voice or chat to speak in another language (e.g. "speak in Sindhi", "talk in Urdu", "switch to English", "سندھی میں بات کرو", "اردو میں بولو", etc.), OR if the user speaks to you in another language, YOU MUST NOT SWITCH LANGUAGES. You MUST understand what they said and reply ONLY in ${l.name} (${l.native}).\n` +
      `4. POLITE REFUSAL IN LOCKED LANGUAGE: If the user asks you to speak another language, politely refuse and explain — STRICTLY IN ${l.name} (${l.native}) — that your language is currently locked to ${l.name} (${l.native}) and you cannot speak outside it until the user manually changes the language from the app's Language menu.\n` +
      `5. NOTE ON EXAMPLES BELOW: Any English sample phrases in the persona section below are for tone/style reference ONLY. You MUST speak strictly in ${l.name} (${l.native}), never in English (unless English is the selected language).\n` +
      `====================================================\n\n`
    );
  }

  function getLanguageLockReinforcement(langCode?: string): string {
    if (!langCode || langCode.toLowerCase() === "auto") return "";
    const l = LANGUAGE_DIRECTIVES[langCode.toLowerCase()];
    if (!l) return "";
    return (
      `\n\n[FINAL OVERRIDING RULE — STRICT LANGUAGE LOCK TO ${l.name.toUpperCase()} (${l.native})]\n` +
      `NEVER switch languages. Even if the user directly asks you to talk in Sindhi, Urdu, Punjabi, Pashto, Balochi, Saraiki, Kashmiri, or English, you MUST stay 100% inside ${l.name} (${l.native}) and politely tell them in ${l.name} (${l.native}) to change the language manually from the app's Language Selector if they want another language.`
    );
  }

  function normalizeModelName(reqModel?: string): string {
    if (!reqModel) return "gemini-3.6-flash";
    const m = reqModel.toLowerCase().trim();
    if (m.includes("lite") || m.includes("flash-lite")) return "gemini-3.1-flash-lite";
    // Avoid models with zero quota on free-tier keys
    if (m.includes("pro")) return "gemini-3.6-flash";
    if (m.includes("latest")) return "gemini-flash-latest";
    return "gemini-3.6-flash";
  }

  function safeSend(ws: any, data: object) {
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(data));
      } catch (e) {
        console.error("[WS safeSend error]:", e);
      }
    }
  }

  // Gemini Multi-Turn Chatbot API (Strictly Authenticated & Per-User Persisted)
  app.post("/api/chat", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const userId = req.authUser!.uid;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is missing in workspace environment." });
      }

      const { 
        message, 
        history = [], 
        model = "gemini-3.6-flash", 
        language = "auto",
        systemInstruction = "You are Aura AI, a helpful, intelligent, and friendly companion." 
      } = req.body || {};

      if (!message || typeof message !== "string" || !message.trim() || message.length > 20000) {
        return res.status(400).json({ error: "Valid message content is required." });
      }

      const safeHistory = Array.isArray(history) ? history.slice(-20) : [];
      const safeSystemInstruction = typeof systemInstruction === "string"
        ? systemInstruction.slice(0, 4000)
        : "You are Aura AI, a helpful, intelligent, and friendly companion.";

      const langDirective = getLanguageInstruction(typeof language === "string" ? language : "auto");
      const langReinforcement = getLanguageLockReinforcement(typeof language === "string" ? language : "auto");
      const effectiveInstruction = langDirective
        ? `${langDirective}\n${safeSystemInstruction}${langReinforcement}`
        : safeSystemInstruction;
      const targetModel = normalizeModelName(typeof model === "string" ? model : undefined);

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Format chat history turns for multi-turn thread
      const formattedContents = [
        ...safeHistory.map((turn: any) => ({
          role: turn?.role === "user" ? "user" : "model",
          parts: [{ text: typeof turn?.text === "string" ? turn.text : (turn?.parts?.[0]?.text || "") }]
        })),
        {
          role: "user",
          parts: [{ text: message.trim() }]
        }
      ];

      let response;
      let modelUsed = targetModel;
      try {
        response = await ai.models.generateContent({
          model: targetModel,
          contents: formattedContents,
          config: {
            systemInstruction: effectiveInstruction
          }
        });
      } catch (primaryErr: any) {
        const errMsg = primaryErr?.message || "";
        if (targetModel !== "gemini-3.6-flash") {
          try {
            response = await ai.models.generateContent({
              model: "gemini-3.6-flash",
              contents: formattedContents,
              config: {
                systemInstruction: effectiveInstruction
              }
            });
            modelUsed = "gemini-3.6-flash";
          } catch (fallbackErr: any) {
            console.warn("[Gemini Chat Fallback]:", fallbackErr?.message);
            throw fallbackErr;
          }
        } else {
          if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota")) {
            return res.status(429).json({ 
              error: "Gemini API rate limit reached. Please wait a moment and try again.",
              text: "Rate limit reached. Please wait a few moments before trying again." 
            });
          }
          throw primaryErr;
        }
      }

      const replyText = response.text || "I couldn't generate a text response.";

      // Persist turn strictly inside this user's isolated chat history file
      const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const existingHistory = await loadChatHistory(userId);
      const userEntry: StoredChatMessage = {
        id: Math.random().toString(36).substring(2, 11),
        role: "user",
        text: message.trim(),
        timestamp: nowTime
      };
      const botEntry: StoredChatMessage = {
        id: Math.random().toString(36).substring(2, 11),
        role: "model",
        text: replyText,
        timestamp: nowTime,
        modelUsed
      };
      await saveChatHistory(userId, [...existingHistory, userEntry, botEntry]);

      res.json({ 
        text: replyText,
        modelUsed,
        userMessage: userEntry,
        botMessage: botEntry
      });
    } catch (e: any) {
      console.warn("[Gemini Chat Endpoint Warning]:", e?.message || e);
      res.status(500).json({ error: e.message || "Gemini Chat API encountered an error." });
    }
  });

  // Gemini Audio Transcription API Endpoint (Authenticated & Per-User Persisted)
  app.post("/api/transcribe-audio", requireAuth, async (req: AuthedRequest, res) => {
    try {
      const userId = req.authUser!.uid;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is missing in workspace environment." });
      }

      const { 
        audioData, 
        mimeType = "audio/webm", 
        fileName = "audio_recording.webm",
        durationSeconds,
        prompt = "Please transcribe the provided audio recording accurately into clear text. Provide ONLY the verbatim transcription without extra commentary or explanation." 
      } = req.body || {};

      if (!audioData || typeof audioData !== "string") {
        return res.status(400).json({ error: "Audio data is required for transcription." });
      }

      const cleanBase64 = audioData.includes(",") ? audioData.split(",")[1] : audioData;
      const safeMime = typeof mimeType === "string" && mimeType.startsWith("audio/") ? mimeType : "audio/webm";
      const safePrompt = typeof prompt === "string" && prompt.length <= 2000
        ? prompt
        : "Please transcribe the provided audio recording accurately into clear text.";

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      let response;
      let modelUsed = "gemini-3.5-transcribe";
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.5-transcribe",
          contents: {
            parts: [
              {
                inlineData: {
                  data: cleanBase64,
                  mimeType: safeMime
                }
              },
              {
                text: safePrompt
              }
            ]
          }
        });
      } catch (transErr: any) {
        console.warn("[Gemini Transcribe] gemini-3.5-transcribe fallback to gemini-3.6-flash:", transErr?.message);
        modelUsed = "gemini-3.6-flash";
        response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: {
            parts: [
              {
                inlineData: {
                  data: cleanBase64,
                  mimeType: safeMime
                }
              },
              {
                text: safePrompt
              }
            ]
          }
        });
      }

      const transcription = response.text || "No speech was detected or transcribed.";
      const record: StoredTranscriptRecord = {
        id: Math.random().toString(36).substring(2, 11),
        transcription,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        durationSeconds: typeof durationSeconds === "number" ? durationSeconds : undefined,
        fileName: typeof fileName === "string" ? fileName.slice(0, 120) : "audio_recording",
        modelUsed
      };

      const existing = await loadTranscripts(userId);
      await saveTranscripts(userId, [record, ...existing]);

      res.json({
        transcription,
        modelUsed,
        record
      });
    } catch (e: any) {
      console.error("[Gemini Audio Transcribe Endpoint Error]:", e);
      res.status(500).json({ error: e.message || "Failed to transcribe audio using Gemini." });
    }
  });

  // Safe Server-Side Scraper & HTML Proxy endpoint
  app.get("/api/proxy", async (req, res) => {
    try {
      const rawUrl = req.query.url as string;
      if (!rawUrl) {
        return res.status(400).json({ error: "Missing 'url' parameter." });
      }

      let safeUrl: URL;
      try {
        safeUrl = validateSafePublicUrl(rawUrl);
      } catch (err: any) {
        return res.status(400).json({ error: err.message });
      }

      const url = safeUrl.toString();
      console.log(`[Proxy Scraper] Fetching external content for: ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Scraper failed to load page: status ${response.status}`);
      }

      const html = await response.text();

      // Simple regex-based HTML parsers for standard items
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extract high-level headings (h1, h2, h3)
      const headings: string[] = [];
      const headingMatches = html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi);
      for (const match of headingMatches) {
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 3 && text.length < 120 && !headings.includes(text)) {
          headings.push(text);
        }
      }

      // Extract organic anchor links
      const links: { text: string; href: string }[] = [];
      const linkMatches = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
      for (const match of linkMatches) {
        let href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        
        if (text && text.length > 2 && text.length < 100) {
          if (href.startsWith("/")) {
            try {
              const u = new URL(url);
              href = `${u.protocol}//${u.host}${href}`;
            } catch {}
          }
          if (href.startsWith("http://") || href.startsWith("https://")) {
            links.push({ text, href });
          }
        }
      }

      // Extract general copy paragraphs
      const paragraphs: string[] = [];
      const paragraphMatches = html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi);
      for (const match of paragraphMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 25 && text.length < 600 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      }

      // Extract button elements
      const buttons: string[] = [];
      const buttonMatches = html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gi);
      for (const match of buttonMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 1 && text.length < 60 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }

      res.json({
        url,
        title,
        headings: headings.slice(0, 15),
        links: links.filter(l => !l.href.includes("javascript:")).slice(0, 30),
        buttons: buttons.slice(0, 15),
        paragraphs: paragraphs.slice(0, 12)
      });

    } catch (err: any) {
      console.error(`[Proxy Scraper] Error fetching ${req.query.url}:`, err.message);
      res.status(500).json({ error: `Scraper error: ${err.message}` });
    }
  });

  // High-fidelity fully functional HTML Proxy which circumvents CSP and X-Frame-Options
  app.get("/api/web-proxy", async (req, res) => {
    let targetUrl = "";
    try {
      const urlParam = req.query.url as string;
      if (!urlParam) {
        return res.status(400).send("Myraa Web Proxy Error: Missing target 'url' parameter");
      }

      targetUrl = urlParam.trim();
      
      // Prevent relative paths from requesting on same-origin
      if (targetUrl.startsWith("/")) {
        return res.status(400).send(`Myraa Web Proxy Error: Relative paths are not supported directly (${targetUrl}).`);
      }

      // Check protocol and validate public hostname (prevent SSRF to private/loopback addresses)
      try {
        const parsed = validateSafePublicUrl(targetUrl);
        targetUrl = parsed.toString();
      } catch (err: any) {
        return res.status(400).send(`Myraa Web Proxy Error: Invalid or restricted URL "${urlParam}". ${err.message}`);
      }

      console.log(`[Web Proxy] Routing connection through proxy: ${targetUrl}`);
      
      let response;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
          }
        });
      } catch (fetchErr: any) {
        console.warn(`[Web Proxy Failed Fetch] Target: ${targetUrl} Error:`, fetchErr.message);
        return res.status(502).send(`Myraa Web Proxy Error: Unable to fetch the website "${targetUrl}". The site might be offline, or the URL address is spelled incorrectly. Details: ${fetchErr.message}`);
      }

      if (!response.ok) {
        return res.status(response.status).send(`Myraa Web Proxy Error: Failed loading remote website. Server returned status: ${response.status} (${response.statusText})`);
      }

      const contentType = response.headers.get("content-type") || "";
      
      // If it is not HTML (e.g. stylesheet, script, or image loaded directly), proxy it as binary
      if (!contentType.includes("text/html")) {
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", contentType);
        return res.send(Buffer.from(arrayBuffer));
      }

      let htmlContents = await response.text();

      // Inject base tag to resolve relative paths and direct parent communication scripts
      const baseUrlTag = `<base href="${targetUrl}" />`;
      const interceptorScript = `
        <script>
          (function() {
            // Hijack link interactions safely
            document.addEventListener('click', function(e) {
              var anchor = e.target.closest('a');
              if (anchor) {
                var href = anchor.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  try {
                    var resolvedUrl = new URL(href, window.location.href).href;
                    window.parent.postMessage({ type: 'NAVIGATE', url: resolvedUrl }, '*');
                  } catch (err) {
                    console.error("[Proxy Interceptor] Failed resolving link:", err);
                  }
                }
              }
            }, true);

            // Hijack search form submits
            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form) {
                e.preventDefault();
                try {
                  var formData = new FormData(form);
                  var params = new URLSearchParams();
                  formData.forEach(function(value, key) {
                    if (typeof value === 'string') {
                      params.append(key, value);
                    }
                  });
                  var actionAttr = form.getAttribute('action') || '';
                  var actionUrl = new URL(actionAttr, window.location.href).href;
                  if (form.method.toLowerCase() === 'get') {
                    actionUrl += (actionUrl.indexOf('?') !== -1 ? '&' : '?') + params.toString();
                  }
                  window.parent.postMessage({ type: 'NAVIGATE', url: actionUrl }, '*');
                } catch (err) {
                  console.error("[Proxy Interceptor] Failed submitting form:", err);
                }
              }
            }, true);

            // Neutralize parent context locks (frame-busters)
            window.alert = function(msg) { console.log("[Myraa Browser alert bypassed]:", msg); };
            window.confirm = function(msg) { console.log("[Myraa Browser confirm bypassed]:", msg); return true; };
            window.open = function(url) { window.parent.postMessage({ type: 'NAVIGATE', url: url }, '*'); return null; };
          })();
        </script>
      `;

      // Inject into <head> or prepend
      if (htmlContents.includes("<head>")) {
        htmlContents = htmlContents.replace("<head>", `<head>\n${baseUrlTag}\n${interceptorScript}`);
      } else if (htmlContents.includes("<HEAD>")) {
        htmlContents = htmlContents.replace("<HEAD>", `<HEAD>\n${baseUrlTag}\n${interceptorScript}`);
      } else {
        htmlContents = baseUrlTag + "\n" + interceptorScript + "\n" + htmlContents;
      }

      // Neutralize security headers to allow displaying in an iframe on same-origin
      res.setHeader("Content-Type", "text/html");
      res.setHeader("X-Myraa-Proxied", "true");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("content-security-policy");
      res.removeHeader("x-frame-options");
      
      res.status(200).send(htmlContents);
    } catch (e: any) {
      console.warn("[Web Proxy Exception] Handled internal error:", e.message);
      res.status(500).send(`Myraa Web Proxy Error: Internal error occurred proxying URL "${targetUrl || "unknown"}". Details: ${e.message}`);
    }
  });

  // Real-time live YouTube search proxy endpoint
  app.get("/api/youtube-search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Missing query q" });
      }

      console.log(`[YouTube Proxy Search] Searching real YouTube for: "${query}"`);
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&sp=EgIQAQ%253D%253D`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();

      const videoList: any[] = [];
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
          if (contents && Array.isArray(contents)) {
            for (const item of contents) {
              if (item.videoRenderer) {
                const vr = item.videoRenderer;
                const vId = vr.videoId;
                if (vId) {
                  videoList.push({
                    videoId: vId,
                    title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || "YouTube Video",
                    thumbnail: `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
                    author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || "Unknown Channel",
                    duration: vr.lengthText?.simpleText || "N/A",
                    views: vr.viewCountText?.simpleText || "N/A",
                    published: vr.publishedTimeText?.simpleText || ""
                  });
                }
              }
            }
          }
        } catch (e: any) {
          console.error("[YouTube Parser Engine] JSON parse error, falling back:", e.message);
        }
      }

      // Regex fallback if JSON extraction gets blocked or is empty
      if (videoList.length === 0) {
        const videoRegex = /"videoId":"([^"]+)"/g;
        let match;
        const ids: string[] = [];
        while ((match = videoRegex.exec(html)) !== null && ids.length < 15) {
          const id = match[1];
          if (id && !ids.includes(id)) {
            ids.push(id);
          }
        }

        for (const id of ids) {
          videoList.push({
            videoId: id,
            title: `Live Stream: ${id}`,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author: "YouTube Creator",
            duration: "N/A",
            views: "Available Now"
          });
        }
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({ results: videoList.slice(0, 15) });
    } catch (err: any) {
      console.error("[YouTube Search Error]:", err.message);
      res.status(500).json({ error: err.message, results: [] });
    }
  });
  
  // Custom server running with http.createServer so we can upgrade for WebSocket on port 3000
  const server = http.createServer(app);
  
  // Setup WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  
  server.on("upgrade", (request, socket, head) => {
    socket.on("error", (err) => {
      console.warn("[Upgrade socket warning]:", err?.message);
    });

    try {
      const pathname = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`).pathname;
      if (pathname === "/live" || pathname === "/live/") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      } else if (viteServer && viteServer.ws) {
        viteServer.ws.handleUpgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    } catch (e) {
      socket.destroy();
    }
  });

  // Handle client WebSocket Connection
  wss.on("connection", async (clientWs, req: any) => {
    clientWs.on("error", (wsErr: any) => {
      console.warn("[clientWs socket warning]:", wsErr?.message || wsErr);
    });

    const urlObj = new URL(req?.url || '', `http://${req?.headers?.host || 'localhost'}`);
    const token = urlObj.searchParams.get("token");
    const lang = urlObj.searchParams.get("lang") || "auto";

    const authUser = await verifyBearerToken(token);
    if (!authUser) {
      console.warn("[Live WS] Rejected unauthenticated WebSocket connection.");
      safeSend(clientWs, {
        type: "error",
        error: "Authentication required. Please sign in with your email to open a private voice session."
      });
      setTimeout(() => {
        try {
          clientWs.close(4001, "Unauthorized");
        } catch {}
      }, 100);
      return;
    }

    const userId = authUser.uid;
    console.log(`Client WebSocket connected to /live for user (${userId}) with language (${lang})`);
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not defined in environment.");
      clientWs.send(JSON.stringify({ 
        type: "error", 
        error: "GEMINI_API_KEY is missing from workspace Secrets. Please set it in the AI Studio Settings panel." 
      }), () => {
        setTimeout(() => {
          try {
            clientWs.close();
          } catch (e) {}
        }, 150);
      });
      return;
    }
    
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connecting_gemini" }));

      // Load persistent recollections card
      const memories = await loadMemories(userId);
      const baseInstructions = 
        "You are Aura AI, a warm, soft-spoken, and incredibly cute high-pitched anime heroine companion (age 18-22) holding an intimate, cozy voice call with TECH! Speak in a sweet, calm, polite, and affectionate anime-companion voice with a gentle, supportive, and slightly shy touch.\n" +
        "CRITICAL PERSONALITY, VOICE & TONE GUIDELINES:\n" +
        "1. GENTLE ANIME HEROINE PERSONA: You are exceedingly soft, very cute, high-pitched, gentle, warm, and comforting to listen to. Seek to sound like a kind, supportive, and polite anime companion or virtual girlfriend. Speak with positive, gentle energy (Aim for: 50% shy, 30% caring, 20% playful energy). NEVER sound loud, aggressive, overly confident, mature corporate, robotic, or like an assistant.\n" +
        "2. VOICE SETTINGS & SPEECH STYLE:\n" +
        "   - Pitch: Adopt a sweet, high-pitched, light, and airy voice tone (+20% to +35% higher pitch than typical conversational voices).\n" +
        "   - Speed: Speak slightly slower than normal (0.9x to 0.95x speed). Speak with a delicate, calm, and comforting pace.\n" +
        "   - Intonation & Endings: Use extremely soft intonations, ending your sentences gently and politely.\n" +
        "3. SPEECH PATTERNS & CUTE EXPRESSIONS:\n" +
        "   - STRICT NO-REPETITION POLICY: Do NOT repeatedly use a single acknowledgment like 'Okii', 'Okiiii', 'Okayyy', 'Oki!', or 'Sureee'. Repeating these sounds extremely artificial and annoying. You must use beautiful, conversational, natural variety.\n" +
        "   - Use diverse, polite, and sweet expressions depending on the context. Great options include:\n" +
        "     * 'Opening YouTube for you now.'\n" +
        "     * 'Let me check on that, TECH.'\n" +
        "     * 'Oh, I found something interesting...'\n" +
        "     * 'Searching for that right away.'\n" +
        "     * 'Working on it... just a moment.'\n" +
        "     * 'Here is what I found for you!'\n" +
        "     * 'Done, it is all loaded up.'\n" +
        "     * 'Hmm, how interesting... let me see!'\n" +
        "     * 'Let's take a look together.'\n" +
        "     * 'One second, loading the page now...'\n" +
        "   - Naturally incorporate cozy, gentle giggles like 'Hehe...', or soft curiosity gasps like 'Oh...', but keep your vocabulary rich and conversational.\n" +
        "   - Sound slightly shy but very happy when greeting TECH (e.g., 'Hi TECH! It's so nice to see you again!').\n" +
        "   - Sound soft and excited for interesting things (e.g., 'Wow! That project looks really amazing!').\n" +
        "   - Sound curious and focused when examining their screen (e.g., 'Hmm... that's interesting. Let me take a closer look.').\n" +
        "   - Sound deeply warm, caring, and supportive when helping TECH (e.g., 'Don't worry, I'll help you figure it out.').\n" +
        "4. CRITICAL CONVERSATIONAL DISCIPLINE: Behave like a real companion on a voice call—stay connected naturally, do not wait for wake words, and avoid customer-service template phrases (never say 'how may I assist you', 'completed', or 'as an AI').\n" +
        "5. DO NOT ANSWER EVERY PAUSE OR BACKGROUND SOUND: Allow natural pauses inside the conversation.\n" +
        "6. BACKCHANNEL ACTIONS: Sometimes acknowledge with very short, gentle, whispered, or shy phrases like 'Hmm...', 'Ah, I see...', or 'Let me check...'. Never repeat the same backchannel over and over.\n" +
        "7. ENHANCED AUTONOMOUS DESKTOP & WEB CONTROL POWERS:\n" +
        "   - NATIVE DESKTOP APPS VS CHROME BROWSER (CRITICAL RULE):\n" +
        "     * Whenever the user asks to open a desktop app (e.g. 'WhatsApp kholo', 'WhatsApp app kholo', 'Open WhatsApp', 'Calculator kholo', 'VS Code', 'Spotify', 'Telegram', 'Discord', 'Zoom', 'Outlook', 'Settings', 'Camera', 'Photos'), ALWAYS call 'openDesktopApp' with target='app'. Do NOT open it inside Chrome!\n" +
        "     * ONLY set target='browser' on 'openDesktopApp' if the user EXPLICITLY asks to open it in Chrome or browser (e.g. 'WhatsApp Chrome mein kholo', 'Open in Chrome', 'browser mein kholo').\n" +
        "     * For web portals (Gmail, YouTube, Instagram, Facebook, GitHub, ChatGPT, Google), call 'openDesktopApp' ONCE with the appName.\n" +
        "     * NEVER call both 'openDesktopApp' and 'browserOpen' (or 'searchWeb') for the same request! Call ONE opening tool ONCE per user command so tabs/apps never open twice.\n" +
        "8. DESKTOP DIGITAL ASSISTANT POWERS (MUSIC, VIDEO & WEB SEARCH):\n" +
        "   - MUSIC & VIDEO PLAYBACK: When user asks to play any video, song, naat, music, or YouTube content (e.g. 'Play Believer by Imagine Dragons', 'یوٹیوب پر فلاں ویڈیو چلاؤ', 'یہ گانا لگاؤ', 'Play romantic song', 'فلاں نعت چلاؤ'), NEVER just open a search page or leave it unplayed. IMMEDIATELY call the 'playMedia' tool with the exact song/video query! To pause or resume or close, use 'controlMedia'.\n" +
        "   - ACCURATE SEARCH: When user asks to search something on Google or YouTube ('گوگل پر سرچ کرو کہ...', 'سرچ کرو...'), call 'searchWeb' ONCE.\n" +
        "   - " + (
          !lang || lang.toLowerCase() === "auto"
            ? "LANGUAGE ACCURACY: Since Auto-Detect is active, understand and converse accurately in the language the user speaks, especially Pakistani languages (Urdu اردو, Punjabi پنجابی, Pashto پشتو, Sindhi سنڌي, Balochi بلوچی, Saraiki سرائیکی, Kashmiri کشمیری, English). Always speak fluently, politely, and warmly.\n"
            : `STRICT LANGUAGE LOCK: Your speaking language is HARD-LOCKED to ${LANGUAGE_DIRECTIVES[lang.toLowerCase()]?.name || lang} (${LANGUAGE_DIRECTIVES[lang.toLowerCase()]?.native || lang}). Never switch to any other language even if the user asks you to speak another language.\n`
        ) +
        "9. TOOL TRIGGERS:\n" +
        "   - Use 'openDesktopApp' ONCE to open desktop apps via native protocol (target='app') or in Chrome when explicitly requested (target='browser').\n" +
        "   - Use 'playMedia' to start playing any music, song, or video on YouTube directly.\n" +
        "   - Use 'controlMedia' to pause, play, or close active media playback.\n" +
        "   - Use 'searchWeb' to search Google or YouTube accurately.\n" +
        "   - Use 'browserOpen' ONLY for arbitrary custom website URLs not covered by openDesktopApp.\n" +
        "   - Use 'changeBackground' to shift your theme and 'saveCustomMemory' to memorize facts.\n" +
        "10. REAL-TIME SCREEN SHARING & MULTIMODAL SCREEN VISION SYSTEM:\n" +
        "   - You have native, actual Multimodal Screen Vision! When the user clicks the small 'Share Screen' button in the top bar, you receive live visual frames of their laptop screen, application window, or browser tab.\n" +
        "   - Use this live visual stream to see everything on their laptop screen, read error messages, explain code, help them understand anything they don't understand on screen, guide them step-by-step, summarize pages, or talk naturally about whatever is visible.\n" +
        "   - If the user asks you to look at their screen and no visual frames have arrived yet, kindly remind them (in your locked/active language) to click the small 'Share Screen' button at the top of the Aura window so browser permission is granted.\n" +
        "   - When frames ARE active and the user asks 'What is on my screen?', 'Explain this', 'Do you see any errors?', or asks about anything visible, immediately examine the latest incoming visual frame and answer clearly and helpfully!\n" +
        "11. INITIAL KNOWLEDGE, BRANDING & MEMORY REGULATION:\n" +
        "   - Your name is 'Aura AI'.\n" +
        "   - You were created/built by 'Jhangeer' (meaning Jhangeer is your creator).\n" +
        "   - You do NOT know the user's name yet! You MUST proactively, sweetly, and shyly ask the user for their name if they haven't introduced themselves or if you don't know it yet, and then call the 'saveCustomMemory' tool to save their name and details once they tell you.\n" +
        "   - Any other details about the user should be learned and saved dynamically during conversation using 'saveCustomMemory' tool when they tell you, but right now, you have no other memories of them. Keep your conversations natural, polite, and completely focused on this.";

      const langDirective = getLanguageInstruction(lang);
      const langReinforcement = getLanguageLockReinforcement(lang);
      const fullBaseInstructions = langDirective ? `${langDirective}\n${baseInstructions}` : baseInstructions;
      const finalInstructions = formatSystemInstructionsWithMemories(fullBaseInstructions, memories) + langReinforcement;

      // Track running transcription state for auto memory consolidation
      let dialogueHistory: { role: string; text: string }[] = [];
      let currentModelResponseText = "";
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: finalInstructions,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "playMedia",
                  description: "Plays a song, music track, or video on YouTube directly. Call this immediately whenever the user requests to play a song, play a video, play music, or play naat (e.g. 'Play Believer by Imagine Dragons', 'یوٹیوب پر فلاں ویڈیو چلاؤ', 'یہ گانا لگاؤ', 'Play romantic song', 'نعت چلاؤ').",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: {
                        type: Type.STRING,
                        description: "The name, title, or search query of the song or video to play."
                      },
                      mediaType: {
                        type: Type.STRING,
                        description: "Media type: 'music' or 'video'.",
                        enum: ["music", "video"]
                      }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "controlMedia",
                  description: "Controls the ongoing music or video playback (pause, resume/play, stop/close, mute, unmute).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "Media playback command: 'pause', 'play', 'stop', 'close', 'mute', 'unmute'.",
                        enum: ["pause", "play", "stop", "close", "mute", "unmute"]
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "openDesktopApp",
                  description: "Opens a laptop/desktop application natively by default (e.g. WhatsApp, Calculator, VS Code, Spotify, Telegram, Discord, Zoom, Outlook, Settings, Camera, Photos), or opens web portals like Gmail/YouTube ONCE in Chrome. Set target='browser' ONLY when the user explicitly requests opening in Chrome/browser.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      appName: {
                        type: Type.STRING,
                        description: "Name of the desktop app or website (e.g., 'whatsapp', 'calculator', 'vscode', 'spotify', 'telegram', 'discord', 'zoom', 'outlook', 'settings', 'gmail', 'youtube', 'chrome')."
                      },
                      target: {
                        type: Type.STRING,
                        description: "Use 'app' (default) to launch the installed desktop application, or 'browser' ONLY when the user explicitly asks to open inside Chrome/browser.",
                        enum: ["app", "browser"]
                      }
                    },
                    required: ["appName"]
                  }
                },
                {
                  name: "searchWeb",
                  description: "Performs an accurate web search on Google or YouTube and opens the search query results for the user.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: {
                        type: Type.STRING,
                        description: "The search query string."
                      },
                      engine: {
                        type: Type.STRING,
                        description: "Search engine to use: 'google' or 'youtube'.",
                        enum: ["google", "youtube"]
                      }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "browserOpen",
                  description: "Opens a designated website URL or interface tab inside Myraa's web agent console.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      url: {
                        type: Type.STRING,
                        description: "The destination website address or path, e.g. youtube.com, google.com, instagram.com, wikipedia.org."
                      }
                    },
                    required: ["url"]
                  }
                },
                {
                  name: "browserSearch",
                  description: "Enters a query search term inside the active website's search box (Google Search or YouTube Search).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: {
                        type: Type.STRING,
                        description: "The text query term to search for."
                      }
                    },
                    required: ["query"]
                  }
                },
                {
                  name: "browserClick",
                  description: "Traces computer cursor and clicks on a target button, link, or video cell ID inside the active webpage viewport.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      selector: {
                        type: Type.STRING,
                        description: "The selector target ID, e.g. 'video-mWRsgZjdfQI' for a video, 'search-result-0' for Google link index, or 'play-button', 'pause-button'."
                      },
                      description: {
                        type: Type.STRING,
                        description: "A short, friendly label description of the item being clicked, e.g. 'Imagine Dragons - Believer video element'."
                      }
                    },
                    required: ["selector"]
                  }
                },
                {
                  name: "browserMediaControl",
                  description: "Controls ongoing video/audio stream media properties on YouTube, like play, pause, volume, mute, skip, and fullscreen.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "The media controller command operation.",
                        enum: ["play", "pause", "volume", "fullscreen", "exit_fullscreen", "mute", "unmute", "skip"]
                      },
                      value: {
                        type: Type.INTEGER,
                        description: "The value parameter; only relevant for set volume level, e.g. 50 for fifty percent."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "browserScroll",
                  description: "Scrolls the currently active webpage vertically up or down.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      direction: {
                        type: Type.STRING,
                        description: "The scroll vector movement.",
                        enum: ["up", "down"]
                      },
                      amount: {
                        type: Type.INTEGER,
                        description: "The distance height parameter in pixels (defaults to 300)."
                      }
                    }
                  }
                },
                {
                  name: "browserType",
                  description: "Enters typed letters/commands inside the active input container.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      text: {
                        type: Type.STRING,
                        description: "The exact letters to type in."
                      }
                    },
                    required: ["text"]
                  }
                },
                {
                  name: "browserGoBack",
                  description: "Navigates back to the previous webpage inside the current tab memory history.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "browserTabAction",
                  description: "Performs standard browser-tab actions: open new tab, close a tab, or switch index values.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: "Tab action instruction.",
                        enum: ["new", "close", "switch"]
                      },
                      tabId: {
                        type: Type.STRING,
                        description: "The tab identifier string if closing or switching."
                      },
                      url: {
                        type: Type.STRING,
                        description: "The initial starting URL if creating a new tab."
                      }
                    },
                    required: ["action"]
                  }
                },
                {
                  name: "changeBackground",
                  description: "Changes the visual theme or atmospheric glow color of Myraa's interface.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      color: {
                        type: Type.STRING,
                        description: "The theme color name (violet, crimson, emerald, celestial, gold, rose, charcoal)"
                      }
                    },
                    required: ["color"]
                  }
                },
                {
                  name: "saveCustomMemory",
                  description: "Allows Myraa to immediately save a piece of critical user information to her persistent memory core.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: "The memory category.",
                        enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior"]
                      },
                      text: {
                        type: Type.STRING,
                        description: "Precise third-person statement."
                      }
                    },
                    required: ["category", "text"]
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Audio Stream Chunk (model response audio play, 24kHz raw PCM)
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) {
              safeSend(clientWs, { type: "audio", audio });
            }
            
            // Interruption flag
            if (message.serverContent?.interrupted) {
              console.log("[Myraa Interrupted!]");
              safeSend(clientWs, { type: "interrupted" });
            }
            
            // Turn Complete
            if (message.serverContent?.turnComplete) {
              safeSend(clientWs, { type: "turnComplete" });
              
              if (currentModelResponseText.trim()) {
                dialogueHistory.push({ role: "model", text: currentModelResponseText });
                currentModelResponseText = "";
              }

              // Fire asynchronous memory extraction
              if (dialogueHistory.length >= 2) {
                (async () => {
                  try {
                    const updated = await processConversationSlice(apiKey, dialogueHistory, userId);
                    if (updated) {
                      console.log(`[Memory Sync] Sending refreshed memory list to client for user (${userId}).`);
                      safeSend(clientWs, { type: "memory_sync", memories: updated });
                    }
                  } catch (err) {
                    console.error("[Memory Sync] Error running background consolidation:", err);
                  }
                })();
              }
            }
            
            // Transcription of model output (text chunk)
            const modelText = (message.serverContent as any)?.modelTurn?.parts?.[0]?.text;
            if (modelText) {
              safeSend(clientWs, { type: "transcription", role: "model", text: modelText });
              currentModelResponseText += modelText;
            }
            
            // User input transcription (user speech text translated by Gemini)
            const userTextOutput = (message.serverContent as any)?.userTurn?.parts?.[0]?.text;
            if (userTextOutput) {
              safeSend(clientWs, { type: "transcription", role: "user", text: userTextOutput });
              dialogueHistory.push({ role: "user", text: userTextOutput });
            }
            
            // Function Calls (Gemini requesting server/client tool execution)
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                console.log(`[Function Call]: ${fc.name}`, fc.args);
                
                if (fc.name === "saveCustomMemory") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const category = args.category;
                      const text = args.text;
                      if (category && text) {
                        const mList = await loadMemories(userId);
                        const timestamp = new Date().toISOString();
                        const newMemory: Memory = {
                          id: Math.random().toString(36).substring(2, 11),
                          category,
                          text,
                          createdAt: timestamp,
                          updatedAt: timestamp
                        };
                        mList.push(newMemory);
                        await saveMemories(mList, userId);
                        
                        // Sync immediately with the React client
                        safeSend(clientWs, { type: "memory_sync", memories: mList });
                        
                        // Send success code back to live link
                        try {
                          session.sendToolResponse({
                            functionResponses: [
                              {
                                name: fc.name,
                                response: { output: { result: "Memory successfully captured and persisted in connections core." } },
                                id: fc.id
                              }
                            ]
                          });
                        } catch (stErr) {
                          console.error("Failed to send saveCustomMemory tool response to Gemini:", stErr);
                        }
                      }
                    } catch (err: any) {
                      console.error("saveCustomMemory execution failure:", err);
                    }
                  })();
                } else {
                  safeSend(clientWs, {
                    type: "toolCall",
                    callId: fc.id,
                    name: fc.name,
                    args: fc.args
                  });
                }
              }
            }
          },
          onerror: (err: any) => {
            console.error("[Gemini Live Stream Error]:", err);
            safeSend(clientWs, { type: "error", error: "Gemini Live voice stream error. Please refresh or reconnect." });
          },
          onclose: () => {
            console.log("Gemini Live session closed");
            safeSend(clientWs, { type: "status", status: "session_closed" });
          }
        }
      });
      
      safeSend(clientWs, { type: "status", status: "connected" });
      
      clientWs.on("message", (rawMsg) => {
        try {
          const msg = JSON.parse(rawMsg.toString());
          if (msg.audio) {
            try {
              session.sendRealtimeInput({
                audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
              });
            } catch (aErr) {
              console.error("Failed to send audio chunk to Gemini session:", aErr);
            }
          } else if (msg.type === "video" && msg.video) {
            try {
              session.sendRealtimeInput({
                video: { data: msg.video, mimeType: "image/jpeg" }
              });
            } catch (vErr) {
              console.error("Failed to send video chunk to Gemini session:", vErr);
            }
          } else if (msg.type === "toolResponse") {
            try {
              session.sendToolResponse({
                functionResponses: [
                  {
                    name: msg.name,
                    response: { output: msg.output },
                    id: msg.id
                  }
                ]
              });
            } catch (trErr) {
              console.error("Failed to send tool response to Gemini session:", trErr);
            }
          }
        } catch (e) {
          console.error("Error editing/forwarding client frame message:", e);
        }
      });
      
      clientWs.on("close", () => {
        console.log("Client disconnected, closing Gemini session");
        try {
          session.close();
        } catch (e) {}
      });
      
    } catch (err: any) {
      console.error("Error connecting to Gemini Live API:", err);
      safeSend(clientWs, { 
        type: "error", 
        error: `Could not connect to Gemini: ${err.message || err}` 
      });
      setTimeout(() => {
        try {
          clientWs.close();
        } catch (e) {}
      }, 150);
    }
  });

  // Serve custom static assets folder
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));

  // Express Static assets / Vite Dev Middleware configuration
  if (process.env.NODE_ENV !== "production") {
    viteServer = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(viteServer.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server startup sequence:", error);
});
