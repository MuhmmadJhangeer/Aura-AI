import React, { useState } from "react";
import { 
  Sparkles, 
  LogIn, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  ShieldCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  loginWithEmail, 
  cleanAuthErrorMessage,
  AuraUser 
} from "../lib/firebase";

interface AuraAuthGateProps {
  onAuthenticated: (user: AuraUser) => void;
  currentLanguage?: string;
  onLanguageChange?: (langCode: string) => void;
}

export const AuraAuthGate: React.FC<AuraAuthGateProps> = ({
  onAuthenticated
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

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
      const user = await loginWithEmail(email, password);
      setSuccessMsg("Signed in! Personal workspace & unique key ready.");

      setTimeout(() => {
        onAuthenticated(user);
      }, 350);
    } catch (err: any) {
      console.error(err);
      setError(cleanAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 w-full h-full overflow-y-auto overflow-x-hidden bg-[#020205] text-white flex flex-col items-center justify-center p-6 selection:bg-cyan-500 selection:text-black">
      {/* Ambient background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-cyan-600/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[420px] h-[420px] bg-purple-600/10 rounded-full blur-[140px]" />
      </div>

      {/* Centered Login Container */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md flex flex-col items-center space-y-6"
      >
        {/* Logo & Brand */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-400 via-teal-400 to-purple-600 p-[1.5px] shadow-[0_0_30px_rgba(34,211,238,0.35)]">
            <div className="w-full h-full bg-[#060913] rounded-[14px] flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-cyan-400" />
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-widest uppercase bg-gradient-to-r from-cyan-300 via-teal-200 to-purple-300 bg-clip-text text-transparent">
            AURA
          </h1>
          <p className="text-xs text-slate-400">
            Sign in with your Gmail / Email to access your private workspace
          </p>
        </div>

        {/* Login-Only Card */}
        <div className="w-full rounded-3xl bg-[#090d19]/90 border border-white/10 p-7 shadow-[0_0_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl text-slate-100">
          <div className="flex items-center gap-2.5 mb-5 pb-3.5 border-b border-white/10">
            <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-300">
              <LogIn size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Sign In</h2>
              <p className="text-[11px] text-slate-400">
                Each email receives its own isolated API key &amp; private history
              </p>
            </div>
          </div>

          {/* Error Message */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mb-4 p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-200 flex items-start gap-2.5 text-left"
              >
                <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed block flex-1">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success Message */}
          <AnimatePresence>
            {successMsg && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mb-4 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 flex items-center gap-2.5 text-left"
              >
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                <span className="flex-1">{successMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Email / Password Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/15 focus:border-cyan-400 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/15 focus:border-cyan-400 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-3 text-slate-400 hover:text-white cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition cursor-pointer bg-cyan-400 hover:bg-cyan-300 text-black shadow-cyan-500/20 shadow-md disabled:opacity-50"
            >
              {loading && <Loader2 size={16} className="animate-spin text-black" />}
              <LogIn size={16} />
              <span>Sign In</span>
            </button>
          </form>

          <div className="mt-4 pt-3.5 border-t border-white/5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck size={13} className="text-cyan-400 shrink-0" />
            <span>Private per-email isolation • Desktop Workspace</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
