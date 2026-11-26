import React, { useState } from "react";
import { 
  X, 
  LogIn, 
  Mail, 
  Lock, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Sparkles,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  loginWithEmail, 
  cleanAuthErrorMessage 
} from "../lib/firebase";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!email.trim() || !password.trim()) {
      setError("Please fill in your email address and password.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);

    try {
      await loginWithEmail(email, password);
      setSuccessMsg("Signed in successfully! Personal API key active.");

      setTimeout(() => {
        onClose();
        if (onSuccess) onSuccess();
      }, 600);
    } catch (err: any) {
      console.error(err);
      setError(cleanAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="absolute inset-0" onClick={onClose} />

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 28 }}
            className="relative z-10 w-full max-w-md bg-[#0d1322]/95 border border-cyan-500/30 rounded-3xl shadow-[0_0_60px_rgba(34,211,238,0.2)] backdrop-blur-2xl overflow-hidden text-slate-100"
          >
            {/* Header */}
            <div className="relative px-6 pt-6 pb-5 border-b border-white/10 bg-gradient-to-r from-cyan-950/40 via-purple-950/40 to-slate-950">
              <button
                onClick={onClose}
                className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center text-black font-bold shadow-[0_0_20px_rgba(34,211,238,0.5)]">
                  <Sparkles size={22} className="text-white drop-shadow" />
                </div>
                <div>
                  <h3 className="font-bold text-xl text-white tracking-wide">
                    Sign In to Aura AI
                  </h3>
                  <p className="text-xs text-slate-400">
                    Access your isolated workspace &amp; personal API key
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-200 flex items-start gap-2.5">
                  <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-3.5 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-3 text-slate-400" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3.5 top-3 text-slate-400" />
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3 px-4 rounded-xl font-bold text-sm text-black flex items-center justify-center gap-2 transition cursor-pointer shadow-lg disabled:opacity-50 bg-cyan-400 hover:bg-cyan-300 shadow-cyan-500/25"
                >
                  {loading ? <Loader2 size={18} className="animate-spin text-black" /> : <LogIn size={16} />}
                  <span>Sign In</span>
                </button>
              </form>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-white/10 bg-black/40 text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
              <ShieldCheck size={13} className="text-cyan-400" />
              <span>Your chat history &amp; memories stay strictly isolated per email</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
