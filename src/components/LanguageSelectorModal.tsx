import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, X, Check, Languages } from "lucide-react";
import { SUPPORTED_LANGUAGES, LanguageOption } from "../lib/languages";

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLanguage: string;
  onSelectLanguage: (code: string) => void;
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedLanguage,
  onSelectLanguage,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-md bg-slate-900 border border-cyan-500/30 rounded-3xl p-5 shadow-2xl space-y-4 text-white"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-300">
                <Languages size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold tracking-wide">Select Language / زبان منتخب کریں</h3>
                <p className="text-[11px] text-slate-400">Choose Aura's voice and chat speaking language</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Language Options Grid */}
          <div className="grid grid-cols-1 gap-2 max-h-[360px] overflow-y-auto pr-1">
            {SUPPORTED_LANGUAGES.map((lang: LanguageOption) => {
              const isSelected = selectedLanguage.toLowerCase() === lang.code.toLowerCase();
              return (
                <button
                  key={lang.code}
                  onClick={() => {
                    onSelectLanguage(lang.code);
                    onClose();
                  }}
                  className={`w-full p-3 rounded-2xl flex items-center justify-between transition cursor-pointer border text-left ${
                    isSelected
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                      : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl leading-none">{lang.flag}</span>
                    <div>
                      <div className="text-sm font-bold flex items-center gap-2">
                        <span>{lang.nativeName}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">{lang.name}</div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="p-1 rounded-full bg-cyan-400 text-black">
                      <Check size={14} strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Footer note */}
          <div className="pt-2 border-t border-white/10 text-[11px] text-slate-400 text-center font-mono">
            💡 Aura will understand and speak completely in your chosen language.
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
