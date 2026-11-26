import React, { useState, useEffect, useRef } from "react";
import { 
  MessageSquare, 
  X, 
  Trash2, 
  Copy, 
  Check, 
  Download, 
  User, 
  Sparkles, 
  Search,
  ArrowDown,
  Volume2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface TranscriptItem {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
}

interface TranscriptDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  transcripts: TranscriptItem[];
  onClearTranscripts: () => void;
  aiName?: string;
}

export const TranscriptDashboard: React.FC<TranscriptDashboardProps> = ({
  isOpen,
  onClose,
  transcripts,
  onClearTranscripts,
  aiName = "Aura AI"
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new transcript messages
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts, isOpen]);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExport = () => {
    if (transcripts.length === 0) return;
    const content = transcripts
      .map(t => `[${t.timestamp}] ${t.role === "user" ? "You" : aiName}: ${t.text}`)
      .join("\n\n");
    
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${aiName.toLowerCase().replace(/\s+/g, "_")}_transcripts_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredTranscripts = transcripts.filter(t => 
    t.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md">
          {/* Backdrop click to close */}
          <div 
            className="absolute inset-0" 
            onClick={onClose} 
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="relative z-10 w-full max-w-2xl bg-[#0b0f19]/90 border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(34,211,238,0.15)] backdrop-blur-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  <MessageSquare size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white flex items-center gap-2">
                    Conversation Transcripts
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      {transcripts.length} {transcripts.length === 1 ? "entry" : "entries"}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">Review and copy recent dialogue with {aiName}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {transcripts.length > 0 && (
                  <>
                    <button
                      onClick={handleExport}
                      className="p-2 text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                      title="Download transcript text file"
                    >
                      <Download size={15} />
                      <span className="hidden sm:inline">Export</span>
                    </button>
                    <button
                      onClick={onClearTranscripts}
                      className="p-2 text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                      title="Clear transcript history"
                    >
                      <Trash2 size={15} />
                      <span className="hidden sm:inline">Clear</span>
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Filter / Search Bar */}
            {transcripts.length > 0 && (
              <div className="px-5 py-3 border-b border-white/5 bg-slate-950/40">
                <div className="relative flex items-center">
                  <Search size={16} className="absolute left-3 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search conversation text..."
                    className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition"
                  />
                  {searchTerm && (
                    <button 
                      onClick={() => setSearchTerm("")}
                      className="absolute right-3 text-xs text-slate-400 hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Transcripts List */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 min-h-[220px] max-h-[500px]"
            >
              {filteredTranscripts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 mb-3 border border-cyan-500/20">
                    <MessageSquare size={24} />
                  </div>
                  <p className="text-sm font-medium text-slate-300">
                    {searchTerm ? "No transcripts match your search filter." : "No transcripts recorded yet"}
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs mt-1">
                    {searchTerm 
                      ? "Try typing a different keyword or clear the search input." 
                      : `Start speaking with ${aiName} using the power button below to see live transcripts here.`}
                  </p>
                </div>
              ) : (
                filteredTranscripts.map((item) => {
                  const isUser = item.role === "user";
                  return (
                    <div
                      key={item.id}
                      className={`flex gap-3 text-left ${isUser ? "flex-row-reverse" : "flex-row"}`}
                    >
                      {/* Avatar */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border ${
                        isUser 
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" 
                          : "bg-purple-500/20 text-purple-300 border-purple-500/40"
                      }`}>
                        {isUser ? <User size={15} /> : <Sparkles size={15} />}
                      </div>

                      {/* Bubble content */}
                      <div className={`group relative max-w-[82%] rounded-2xl p-3.5 border text-xs sm:text-sm leading-relaxed transition ${
                        isUser
                          ? "bg-cyan-950/40 border-cyan-500/30 text-cyan-50 rounded-tr-none"
                          : "bg-purple-950/40 border-purple-500/30 text-purple-50 rounded-tl-none"
                      }`}>
                        <div className="flex items-center justify-between gap-3 mb-1 text-[11px] font-semibold text-slate-400">
                          <span className={isUser ? "text-cyan-300" : "text-purple-300"}>
                            {isUser ? "You" : aiName}
                          </span>
                          <span className="text-[10px] opacity-60 font-mono">{item.timestamp}</span>
                        </div>

                        <p className="whitespace-pre-wrap break-words">{item.text}</p>

                        {/* Copy button overlay */}
                        <button
                          onClick={() => handleCopy(item.id, item.text)}
                          className="absolute bottom-2 right-2 p-1 rounded bg-black/40 hover:bg-black/70 text-slate-300 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                          title="Copy message"
                        >
                          {copiedId === item.id ? (
                            <Check size={13} className="text-emerald-400" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer info */}
            <div className="px-5 py-3 border-t border-white/10 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                <Volume2 size={13} className="text-cyan-400" />
                <span>Live speech recognition active</span>
              </div>
              <button
                onClick={onClose}
                className="px-3 py-1 bg-white/10 hover:bg-white/15 text-white rounded-lg text-xs font-medium transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
