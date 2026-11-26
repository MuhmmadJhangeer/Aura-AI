import React, { useState, useRef, useEffect } from "react";
import { 
  X, 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  Trash2, 
  Copy, 
  Check, 
  Loader2, 
  Cpu, 
  Zap, 
  BrainCircuit, 
  Settings2, 
  MessageSquare,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { getAuthHeaders } from "../lib/user";

export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  modelUsed?: string;
}

export interface PersonaRole {
  id: string;
  title: string;
  icon: string;
  systemInstruction: string;
  description: string;
}

const PRESET_ROLES: PersonaRole[] = [
  {
    id: "aura",
    title: "Aura Heroine Companion",
    icon: "🌸",
    description: "Cute, sweet, and caring anime companion",
    systemInstruction: "You are Aura AI, a warm, sweet, high-pitched anime companion (age 18-22). Speak in a gentle, polite, and affectionate tone. Be helpful, cozy, and charming."
  },
  {
    id: "general",
    title: "General AI Assistant",
    icon: "✨",
    description: "Balanced, helpful, and clear conversational assistant",
    systemInstruction: "You are a highly intelligent, polite, and clear AI assistant. Provide helpful, accurate, and structured answers."
  },
  {
    id: "coder",
    title: "Senior Software Engineer",
    icon: "💻",
    description: "Specialized in clean code, debugging & architecture",
    systemInstruction: "You are an expert Senior Full-Stack Developer. Provide concise, modern, bug-free code examples in TypeScript, React, Node.js, or HTML/CSS with clear explanations."
  },
  {
    id: "writer",
    title: "Creative Storyteller",
    icon: "✍️",
    description: "Imaginative writing, prose & content creation",
    systemInstruction: "You are a masterful creative writer. Help draft imaginative stories, engaging essays, persuasive copy, and compelling poetry."
  }
];

export const MODEL_OPTIONS = [
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    tagline: "Fast, Intelligent & Versatile (Recommended)",
    badgeColor: "from-cyan-500 to-blue-600",
    icon: Zap
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    tagline: "Ultra-Fast & Low Latency",
    badgeColor: "from-emerald-400 to-teal-600",
    icon: Cpu
  },
  {
    id: "gemini-flash-latest",
    name: "Gemini Flash Latest",
    tagline: "Complex Tasks & High Capacity",
    badgeColor: "from-purple-500 to-pink-600",
    icon: BrainCircuit
  }
];

interface GeminiChatbotProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
  selectedLanguage?: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome_msg",
  role: "model",
  text: "Hello! I am your multi-turn Gemini Chatbot. How can I assist you today? You can switch model modes or custom roles using the toolbar above!",
  timestamp: "",
  modelUsed: "gemini-3.6-flash"
};

export const GeminiChatbot: React.FC<GeminiChatbotProps> = ({
  isOpen,
  onClose,
  userId = "anonymous",
  selectedLanguage
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      ...WELCOME_MESSAGE,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }
  ]);

  const [inputMessage, setInputMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3.6-flash");
  const [selectedRoleId, setSelectedRoleId] = useState("aura");
  const [customPrompt, setCustomPrompt] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load isolated server-side chat history whenever userId or modal open state changes
  useEffect(() => {
    let active = true;
    const defaultWelcome: ChatMessage = {
      ...WELCOME_MESSAGE,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    if (!userId || userId === "anonymous") {
      setMessages([defaultWelcome]);
      return;
    }

    // Clear any legacy localStorage chat entries so shared browsers never leak history
    try {
      localStorage.removeItem(`aura_gemini_chat_${userId}`);
    } catch {}

    const loadServerHistory = async () => {
      try {
        const res = await fetch("/api/chat-history", {
          headers: {
            ...getAuthHeaders()
          }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.messages)) {
          setMessages(data.messages.length > 0 ? data.messages : [defaultWelcome]);
        }
      } catch (err) {
        console.warn("Could not load isolated chat history:", err);
      }
    };

    loadServerHistory();
    return () => {
      active = false;
    };
  }, [userId, isOpen]);

  // Auto-scroll thread
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, loading]);

  const activeRole = PRESET_ROLES.find(r => r.id === selectedRoleId) || PRESET_ROLES[0];
  const activeSystemInstruction = selectedRoleId === "custom" && customPrompt.trim()
    ? customPrompt.trim()
    : activeRole.systemInstruction;

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || loading) return;

    const userText = inputMessage.trim();
    setInputMessage("");
    setErrorText(null);

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 11),
      role: "user",
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setLoading(true);

    try {
      // Prepare history excluding the current query
      const historyPayload = updatedMessages.slice(-10).map(m => ({
        role: m.role,
        text: m.text
      }));

      const currentLanguage = selectedLanguage || localStorage.getItem("aura_language") || "auto";

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          message: userText,
          history: historyPayload.slice(0, -1),
          model: selectedModel,
          language: currentLanguage,
          systemInstruction: activeSystemInstruction
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to reach Gemini Chat service.");
      }

      const botMsg: ChatMessage = data.botMessage || {
        id: Math.random().toString(36).substring(2, 11),
        role: "model",
        text: data.text || "No response text received.",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        modelUsed: selectedModel
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err: any) {
      console.error("Gemini Chat send error:", err);
      setErrorText(err.message || "Failed to get response from Gemini.");
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      await fetch("/api/chat-history", {
        method: "DELETE",
        headers: {
          ...getAuthHeaders()
        }
      });
      setMessages([]);
    } catch (err) {
      console.error("Failed to clear chat history:", err);
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xl">
        {/* Backdrop overlay */}
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="relative z-10 w-full max-w-4xl h-[90vh] max-h-[850px] bg-[#0a0f1d]/95 border border-cyan-500/30 rounded-3xl shadow-[0_0_80px_rgba(34,211,238,0.25)] flex flex-col overflow-hidden text-slate-100 backdrop-blur-2xl"
        >
          {/* Header Bar */}
          <div className="px-5 py-4 border-b border-white/10 bg-gradient-to-r from-cyan-950/60 via-purple-950/60 to-slate-950/90 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 p-0.5 shadow-[0_0_20px_rgba(34,211,238,0.5)]">
                <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                  <Sparkles size={20} className="text-cyan-400 animate-pulse" />
                </div>
              </div>
              <div>
                <h2 className="font-bold text-lg sm:text-xl text-white tracking-wide">
                  Gemini Chat
                </h2>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Conversational assistant with customizable system instructions & model presets
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center gap-1.5 text-xs font-medium ${
                  showSettings 
                    ? "bg-cyan-500 text-black border-cyan-400 shadow-md shadow-cyan-500/30" 
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                }`}
                title="Configure Roles & Models"
              >
                <Settings2 size={16} />
                <span className="hidden sm:inline">Settings</span>
              </button>

              <button
                onClick={handleClearHistory}
                className="p-2.5 bg-white/5 hover:bg-rose-500/20 border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 rounded-xl transition cursor-pointer"
                title="Clear Chat History"
              >
                <Trash2 size={16} />
              </button>

              <button
                onClick={onClose}
                className="p-2.5 bg-white/5 hover:bg-white/15 border border-white/10 text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Model & Role Controls Bar */}
          <div className="px-5 py-3 border-b border-white/10 bg-black/40 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Model Selector Pills */}
            <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
              <span className="text-slate-400 font-medium shrink-0">Model:</span>
              {MODEL_OPTIONS.map((m) => {
                const IconComponent = m.icon;
                const isSelected = selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModel(m.id)}
                    className={`px-3 py-1.5 rounded-xl font-medium transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
                      isSelected
                        ? `bg-gradient-to-r ${m.badgeColor} text-white shadow-lg`
                        : "bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                    }`}
                  >
                    <IconComponent size={14} />
                    <span>{m.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Active Role Indicator */}
            <div className="flex items-center gap-2 text-slate-300 bg-white/5 px-3 py-1.5 rounded-xl border border-white/10">
              <span>Role:</span>
              <span className="font-semibold text-cyan-300 flex items-center gap-1">
                <span>{activeRole.icon}</span>
                <span>{activeRole.title}</span>
              </span>
            </div>
          </div>

          {/* Settings Drawer Overlay */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-b border-cyan-500/30 bg-slate-950/90 p-4 space-y-4 text-xs overflow-hidden"
              >
                <div>
                  <h4 className="font-bold text-slate-200 mb-2 flex items-center gap-2 text-sm">
                    <Sparkles size={16} className="text-cyan-400" />
                    Select Chatbot System Role
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                    {PRESET_ROLES.map((role) => (
                      <button
                        key={role.id}
                        onClick={() => setSelectedRoleId(role.id)}
                        className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                          selectedRoleId === role.id
                            ? "bg-cyan-950/60 border-cyan-400 text-white shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                            : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2 font-bold mb-1">
                            <span className="text-base">{role.icon}</span>
                            <span>{role.title}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            {role.description}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom System Instruction Input */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Custom System Instruction Prompt
                  </label>
                  <textarea
                    rows={2}
                    value={customPrompt}
                    onChange={(e) => {
                      setCustomPrompt(e.target.value);
                      setSelectedRoleId("custom");
                    }}
                    placeholder="Enter custom instructions for Gemini (e.g., 'You are a physics tutor explaining concepts to a 10-year old')..."
                    className="w-full p-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 resize-none"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scrollable Chat Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 scrollbar-thin scrollbar-thumb-cyan-500/20">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                <MessageSquare size={48} className="text-cyan-400/40 mb-3 animate-bounce" />
                <h3 className="text-base font-semibold text-slate-200 mb-1">Start a Conversation</h3>
                <p className="text-xs max-w-sm">
                  Send a prompt below to interact with Gemini in a multi-turn chat environment.
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-3 max-w-[90%] sm:max-w-[82%] ${
                    msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-xs font-bold shadow-md ${
                      msg.role === "user"
                        ? "bg-gradient-to-br from-purple-500 to-pink-600 text-white"
                        : "bg-gradient-to-br from-cyan-400 to-blue-600 text-black"
                    }`}
                  >
                    {msg.role === "user" ? <User size={16} /> : <Bot size={16} />}
                  </div>

                  {/* Message Bubble */}
                  <div className="space-y-1">
                    <div
                      className={`relative p-4 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-lg ${
                        msg.role === "user"
                          ? "bg-purple-600/30 border border-purple-500/40 text-purple-100 rounded-tr-none"
                          : "bg-slate-900/90 border border-cyan-500/30 text-slate-100 rounded-tl-none"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      ) : (
                        <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10 prose-code:text-cyan-300">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      )}

                      {/* Copy Action */}
                      <button
                        onClick={() => handleCopyMessage(msg.id, msg.text)}
                        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-white bg-black/30 hover:bg-black/50 rounded-lg transition cursor-pointer"
                        title="Copy text"
                      >
                        {copiedId === msg.id ? (
                          <Check size={12} className="text-emerald-400" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>

                    {/* Metadata Subtext */}
                    <div
                      className={`flex items-center gap-2 text-[10px] text-slate-500 px-1 ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <span>{msg.timestamp}</span>
                      {msg.modelUsed && (
                        <span className="text-cyan-400/70 font-mono">
                          • {msg.modelUsed}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))
            )}

            {/* Loading Indicator */}
            {loading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 mr-auto max-w-[80%]"
              >
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-black flex items-center justify-center shrink-0">
                  <Bot size={16} />
                </div>
                <div className="p-4 rounded-2xl rounded-tl-none bg-slate-900/90 border border-cyan-500/30 text-slate-300 flex items-center gap-2 text-xs">
                  <Loader2 size={16} className="animate-spin text-cyan-400" />
                  <span>Gemini is formulating response...</span>
                </div>
              </motion.div>
            )}

            {/* Error Message */}
            {errorText && (
              <div className="p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-xs text-rose-200 flex items-center gap-2.5">
                <AlertCircle size={16} className="text-rose-400 shrink-0" />
                <span>{errorText}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Form */}
          <div className="p-4 border-t border-white/10 bg-slate-950/80 backdrop-blur-xl">
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type a message..."
                disabled={loading}
                className="flex-1 px-4 py-3 bg-white/5 border border-white/15 focus:border-cyan-400/60 rounded-2xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none transition disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || loading}
                className="px-5 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-black font-bold rounded-2xl flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 text-xs sm:text-sm"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin text-black" />
                ) : (
                  <>
                    <span>Send</span>
                    <Send size={16} />
                  </>
                )}
              </button>
            </form>
            <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500 px-1">
              <span>Multi-turn chat maintains recent conversation context</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
