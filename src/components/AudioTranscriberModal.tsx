import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Mic,
  Square,
  Play,
  Pause,
  Upload,
  Copy,
  Check,
  Download,
  Loader2,
  FileAudio,
  Sparkles,
  RefreshCw,
  Trash2,
  Send,
  AlertCircle,
  Volume2,
  CheckCircle2,
  Clock
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getAuthHeaders } from "../lib/user";

export interface AudioTranscriptRecord {
  id: string;
  transcription: string;
  timestamp: string;
  durationSeconds?: number;
  fileName?: string;
  modelUsed: string;
}

interface AudioTranscriberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendToChat?: (text: string) => void;
  userId?: string;
}

export const AudioTranscriberModal: React.FC<AudioTranscriberModalProps> = ({
  isOpen,
  onClose,
  onSendToChat,
  userId = "default_user"
}) => {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>("audio/webm");
  const [audioFileName, setAudioFileName] = useState<string>("mic_recording.webm");

  // Transcribe process state
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [currentTranscription, setCurrentTranscription] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // History state loaded strictly from server for authenticated user
  const [history, setHistory] = useState<AudioTranscriptRecord[]>([]);

  const [activeTab, setActiveTab] = useState<"record" | "upload" | "history">("record");

  // MediaRecorder references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load isolated transcripts when user changes or modal opens
  useEffect(() => {
    let active = true;
    if (!userId || userId === "anonymous") {
      setHistory([]);
      return;
    }

    try {
      localStorage.removeItem(`aura_audio_transcripts_${userId}`);
    } catch {}

    const fetchTranscripts = async () => {
      try {
        const res = await fetch("/api/transcripts", {
          headers: { ...getAuthHeaders() }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.transcripts)) {
          setHistory(data.transcripts);
        }
      } catch (err) {
        console.warn("Could not load isolated transcripts:", err);
      }
    };

    fetchTranscripts();
    return () => {
      active = false;
    };
  }, [userId, isOpen]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    setErrorMessage(null);
    setCurrentTranscription(null);
    setRecordedAudioUrl(null);
    setAudioBase64(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine optimal mimeType
      let mime = "audio/webm";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mime = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mime = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        mime = "audio/ogg";
      }

      setAudioMimeType(mime.split(";")[0]);
      setAudioFileName(`microphone_${Date.now()}.${mime.includes("mp4") ? "m4a" : "webm"}`);

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });
        const url = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(url);

        // Convert Blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          setAudioBase64(result);
        };
        reader.readAsDataURL(audioBlob);

        // Stop microphone tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start(250); // Collect chunk every 250ms
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      setErrorMessage(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Microphone access denied. Please allow microphone permissions in your browser settings."
          : "Could not access microphone device."
      );
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith("audio/")) {
      setErrorMessage("Please select a valid audio file (e.g. .mp3, .wav, .m4a, .webm, .ogg).");
      return;
    }

    setErrorMessage(null);
    setCurrentTranscription(null);
    setAudioFileName(file.name);
    setAudioMimeType(file.type || "audio/mp3");

    const url = URL.createObjectURL(file);
    setRecordedAudioUrl(url);

    const reader = new FileReader();
    reader.onloadend = () => {
      setAudioBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleTranscribeAudio = async () => {
    if (!audioBase64) {
      setErrorMessage("No audio recorded or selected for transcription.");
      return;
    }

    setIsTranscribing(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/transcribe-audio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders()
        },
        body: JSON.stringify({
          audioData: audioBase64,
          mimeType: audioMimeType,
          fileName: audioFileName,
          durationSeconds: recordingTime > 0 ? recordingTime : undefined,
          prompt: "Please transcribe the provided audio accurately into clear text. Provide ONLY the verbatim spoken text."
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Transcription request failed.");
      }

      const resultText = data.transcription || "No transcription generated.";
      setCurrentTranscription(resultText);

      const newRecord: AudioTranscriptRecord = data.record || {
        id: Math.random().toString(36).substring(2, 11),
        transcription: resultText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        durationSeconds: recordingTime > 0 ? recordingTime : undefined,
        fileName: audioFileName,
        modelUsed: data.modelUsed || "gemini-3.5-flash"
      };

      setHistory((prev) => [newRecord, ...prev]);
    } catch (err: any) {
      console.error("Audio Transcription error:", err);
      setErrorMessage(err.message || "Failed to transcribe audio.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadTranscript = (text: string, filename = "transcription.txt") => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSendToChatAction = (text: string) => {
    if (onSendToChat) {
      onSendToChat(text);
      onClose();
    }
  };

  const handleDeleteHistoryItem = async (id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
    try {
      await fetch(`/api/transcripts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { ...getAuthHeaders() }
      });
    } catch {}
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-xl">
        {/* Backdrop overlay */}
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ type: "spring", stiffness: 350, damping: 28 }}
          className="relative z-10 w-full max-w-3xl max-h-[90vh] bg-[#080d1a]/95 border border-cyan-500/30 rounded-3xl shadow-[0_0_80px_rgba(34,211,238,0.25)] flex flex-col overflow-hidden text-slate-100 backdrop-blur-2xl"
        >
          {/* Header Bar */}
          <div className="px-5 py-4 border-b border-white/10 bg-gradient-to-r from-cyan-950/80 via-slate-950 to-purple-950/80 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 via-teal-400 to-purple-500 p-0.5 shadow-[0_0_20px_rgba(34,211,238,0.4)]">
                <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                  <Mic size={20} className="text-cyan-300 animate-pulse" />
                </div>
              </div>
              <div>
                <h2 className="font-bold text-lg sm:text-xl text-white tracking-wide">
                  Audio Transcriber
                </h2>
                <p className="text-xs text-slate-400 hidden sm:block">
                  Record microphone or upload audio to transcribe using Gemini 3.5 Flash
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="p-2.5 bg-white/5 hover:bg-white/15 border border-white/10 text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Nav Tabs */}
          <div className="flex items-center gap-1 p-2 bg-slate-950/60 border-b border-white/10 text-xs">
            <button
              onClick={() => setActiveTab("record")}
              className={`flex-1 py-2.5 rounded-xl font-semibold transition cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === "record"
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Mic size={15} />
              <span>Microphone Record</span>
            </button>
            <button
              onClick={() => setActiveTab("upload")}
              className={`flex-1 py-2.5 rounded-xl font-semibold transition cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === "upload"
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Upload size={15} />
              <span>Upload Audio</span>
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex-1 py-2.5 rounded-xl font-semibold transition cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === "history"
                  ? "bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Clock size={15} />
              <span>History ({history.length})</span>
            </button>
          </div>

          {/* Content Body */}
          <div className="p-5 overflow-y-auto space-y-5 flex-1 bg-slate-950/40">
            {errorMessage && (
              <div className="p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-xs text-rose-200 flex items-center gap-2">
                <AlertCircle size={16} className="text-rose-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {activeTab === "record" && (
              <div className="space-y-5">
                {/* Microphone Recording Console */}
                <div className="p-6 bg-gradient-to-b from-white/5 to-white/0 rounded-3xl border border-white/10 flex flex-col items-center justify-center text-center space-y-4">
                  {/* Timer & Pulse Visualizer */}
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 ${
                        isRecording
                          ? isPaused
                            ? "bg-amber-500/20 border-2 border-amber-400/50 shadow-[0_0_30px_rgba(245,158,11,0.3)]"
                            : "bg-cyan-500/20 border-2 border-cyan-400 shadow-[0_0_40px_rgba(34,211,238,0.5)] animate-pulse"
                          : "bg-white/5 border border-white/15"
                      }`}
                    >
                      <Mic
                        size={40}
                        className={
                          isRecording
                            ? isPaused
                              ? "text-amber-400"
                              : "text-cyan-300 animate-bounce"
                            : "text-slate-400"
                        }
                      />
                    </div>
                  </div>

                  {/* Recording Time Display */}
                  <div className="space-y-1">
                    <span className="text-2xl font-mono font-bold tracking-wider text-white">
                      {formatTime(recordingTime)}
                    </span>
                    <p className="text-xs text-slate-400">
                      {isRecording
                        ? isPaused
                          ? "Recording Paused"
                          : "Recording speech live..."
                        : recordedAudioUrl
                        ? "Audio recorded. Ready to transcribe!"
                        : "Click Start Recording to speak"}
                    </p>
                  </div>

                  {/* Recording Action Buttons */}
                  <div className="flex items-center gap-3 pt-2">
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-bold rounded-2xl transition cursor-pointer flex items-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-95 text-sm"
                      >
                        <Mic size={18} />
                        <span>Start Recording</span>
                      </button>
                    ) : (
                      <>
                        {isPaused ? (
                          <button
                            onClick={resumeRecording}
                            className="px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-semibold rounded-xl transition cursor-pointer flex items-center gap-2 text-xs"
                          >
                            <Play size={16} />
                            <span>Resume</span>
                          </button>
                        ) : (
                          <button
                            onClick={pauseRecording}
                            className="px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-semibold rounded-xl transition cursor-pointer flex items-center gap-2 text-xs"
                          >
                            <Pause size={16} />
                            <span>Pause</span>
                          </button>
                        )}

                        <button
                          onClick={stopRecording}
                          className="px-5 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-bold rounded-xl transition cursor-pointer flex items-center gap-2 text-xs shadow-md"
                        >
                          <Square size={16} className="fill-current" />
                          <span>Stop Recording</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Audio Preview Player & Transcribe Trigger */}
                {recordedAudioUrl && !isRecording && (
                  <div className="p-4 bg-white/5 rounded-2xl border border-cyan-500/30 space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span className="font-semibold flex items-center gap-2">
                        <Volume2 size={15} className="text-cyan-400" />
                        <span>Recorded Audio Preview</span>
                      </span>
                      <span className="text-slate-500">{audioFileName}</span>
                    </div>

                    <audio src={recordedAudioUrl} controls className="w-full h-10 rounded-xl" />

                    <button
                      onClick={handleTranscribeAudio}
                      disabled={isTranscribing}
                      className="w-full py-3 bg-gradient-to-r from-cyan-500 via-teal-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-bold rounded-2xl transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 disabled:opacity-50 active:scale-[0.99] text-sm"
                    >
                      {isTranscribing ? (
                        <>
                          <Loader2 size={18} className="animate-spin text-slate-950" />
                          <span>Transcribing with Gemini 3.5 Flash...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />
                          <span>Transcribe Audio (Gemini 3.5 Flash)</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "upload" && (
              <div className="space-y-4">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="p-8 border-2 border-dashed border-white/20 hover:border-cyan-400/60 rounded-3xl text-center cursor-pointer transition bg-black/20 hover:bg-cyan-500/5 flex flex-col items-center justify-center space-y-3"
                >
                  <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-cyan-300">
                    <FileAudio size={28} />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white block">
                      Click or drag audio file here
                    </span>
                    <span className="text-xs text-slate-400">
                      Supports MP3, WAV, M4A, WEBM, OGG, AAC
                    </span>
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                  }}
                />

                {recordedAudioUrl && (
                  <div className="p-4 bg-white/5 rounded-2xl border border-cyan-500/30 space-y-3">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span className="font-semibold flex items-center gap-2">
                        <FileAudio size={15} className="text-cyan-400" />
                        <span>Selected File</span>
                      </span>
                      <span className="text-slate-400 font-mono">{audioFileName}</span>
                    </div>

                    <audio src={recordedAudioUrl} controls className="w-full h-10 rounded-xl" />

                    <button
                      onClick={handleTranscribeAudio}
                      disabled={isTranscribing}
                      className="w-full py-3 bg-gradient-to-r from-cyan-500 via-teal-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 text-slate-950 font-bold rounded-2xl transition cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 disabled:opacity-50 active:scale-[0.99] text-sm"
                    >
                      {isTranscribing ? (
                        <>
                          <Loader2 size={18} className="animate-spin text-slate-950" />
                          <span>Transcribing with Gemini 3.5 Flash...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={18} />
                          <span>Transcribe Audio File (Gemini 3.5 Flash)</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Current Transcription Result Output */}
            {currentTranscription && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-5 bg-gradient-to-br from-cyan-950/40 via-slate-900 to-purple-950/30 border border-cyan-400/40 rounded-3xl space-y-3 shadow-xl"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-cyan-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Transcription Output
                    </span>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                    Model: gemini-3.5-flash
                  </span>
                </div>

                <div className="p-4 bg-slate-950/80 rounded-2xl border border-white/10 text-sm text-slate-200 leading-relaxed font-sans select-text max-h-60 overflow-y-auto whitespace-pre-wrap">
                  {currentTranscription}
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopyText(currentTranscription)}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-medium rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                    >
                      {copied ? (
                        <>
                          <Check size={14} className="text-teal-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleDownloadTranscript(currentTranscription, `transcript_${Date.now()}.txt`)}
                      className="px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white font-medium rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Download size={14} />
                      <span>Download .txt</span>
                    </button>
                  </div>

                  {onSendToChat && (
                    <button
                      onClick={() => handleSendToChatAction(currentTranscription)}
                      className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5 shadow-md"
                    >
                      <Send size={14} />
                      <span>Send to Chat</span>
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* History Tab */}
            {activeTab === "history" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Saved Transcripts</span>
                  <span>{history.length} records</span>
                </div>

                {history.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    <Clock size={36} className="mx-auto mb-2 opacity-30" />
                    <p className="text-xs">No previous transcriptions found.</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 bg-white/5 border border-white/10 hover:border-cyan-500/30 rounded-2xl space-y-2 transition"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-semibold text-cyan-300">
                            {item.fileName || "Audio Transcript"}
                          </span>
                          <div className="flex items-center gap-2">
                            <span>{item.timestamp}</span>
                            <button
                              onClick={() => handleDeleteHistoryItem(item.id)}
                              className="p-1 hover:text-rose-400 transition"
                              title="Delete record"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-200 line-clamp-3 select-text font-sans">
                          {item.transcription}
                        </p>

                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] text-purple-300 font-mono">
                            {item.modelUsed}
                          </span>

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleCopyText(item.transcription)}
                              className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-[11px] transition cursor-pointer flex items-center gap-1"
                            >
                              <Copy size={12} />
                              <span>Copy</span>
                            </button>

                            {onSendToChat && (
                              <button
                                onClick={() => handleSendToChatAction(item.transcription)}
                                className="px-2.5 py-1 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-[11px] transition cursor-pointer flex items-center gap-1"
                              >
                                <Send size={12} />
                                <span>Use in Chat</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
