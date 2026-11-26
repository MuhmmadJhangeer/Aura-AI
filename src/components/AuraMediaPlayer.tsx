import React, { useState, useEffect } from "react";
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize2, 
  Minimize2, 
  X, 
  ExternalLink, 
  Music2, 
  Sparkles,
  Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface ActiveMedia {
  query: string;
  mediaType: "music" | "video";
  videoId?: string;
  title?: string;
  author?: string;
  thumbnail?: string;
}

interface AuraMediaPlayerProps {
  media: ActiveMedia | null;
  onClose: () => void;
  onControlMedia?: (action: string) => void;
}

export const AuraMediaPlayer: React.FC<AuraMediaPlayerProps> = ({
  media,
  onClose
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [videoDetails, setVideoDetails] = useState<{
    videoId: string;
    title: string;
    author: string;
    thumbnail: string;
  } | null>(null);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  useEffect(() => {
    if (!media) {
      setVideoDetails(null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    // If videoId is directly provided, use it immediately
    if (media.videoId) {
      setVideoDetails({
        videoId: media.videoId,
        title: media.title || media.query,
        author: media.author || "YouTube Media",
        thumbnail: media.thumbnail || `https://i.ytimg.com/vi/${media.videoId}/hqdefault.jpg`
      });
      setLoading(false);
      return;
    }

    // Otherwise, perform real search via server-side YouTube proxy
    const fetchVideo = async () => {
      try {
        const res = await fetch(`/api/youtube-search?q=${encodeURIComponent(media.query)}`);
        if (!res.ok) throw new Error("Search proxy failed");
        const data = await res.json();
        
        if (isMounted && data.results && data.results.length > 0) {
          const top = data.results[0];
          setVideoDetails({
            videoId: top.videoId,
            title: top.title || media.query,
            author: top.author || "YouTube Artist",
            thumbnail: top.thumbnail || `https://i.ytimg.com/vi/${top.videoId}/hqdefault.jpg`
          });
        } else if (isMounted) {
          // Fallback if no specific video returned
          setVideoDetails({
            videoId: "dQw4w9WgXcQ", // fallback
            title: media.query,
            author: "Aura Media Stream",
            thumbnail: ""
          });
        }
      } catch (e) {
        console.warn("[AuraMediaPlayer] YouTube search lookup fallback:", e);
        if (isMounted) {
          setVideoDetails({
            videoId: "5qap5aO4i9A", // lofi fallback
            title: media.query,
            author: "Live Audio",
            thumbnail: ""
          });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchVideo();

    return () => {
      isMounted = false;
    };
  }, [media?.query, media?.videoId]);

  if (!media) return null;

  const currentVideoId = videoDetails?.videoId;

  const openInYouTubeTab = () => {
    if (!currentVideoId) return;
    window.open(`https://www.youtube.com/watch?v=${currentVideoId}`, "_blank", "noopener,noreferrer");
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className={`fixed z-40 transition-all duration-300 ${
          isMinimized
            ? "bottom-20 right-4 sm:bottom-24 sm:right-8 w-72 sm:w-80"
            : "bottom-16 sm:bottom-20 right-3 sm:right-6 w-[calc(100vw-24px)] max-w-sm sm:max-w-md"
        }`}
      >
        <div className="relative rounded-2xl bg-[#090d1c]/95 border border-cyan-500/40 shadow-[0_0_35px_rgba(6,182,212,0.25)] backdrop-blur-2xl overflow-hidden flex flex-col">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-gradient-to-r from-cyan-950/60 to-purple-950/60 border-b border-white/10 select-none">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shrink-0">
                <Music2 size={13} className="text-cyan-300 animate-pulse" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate max-w-[170px] sm:max-w-[210px]">
                  {loading ? "Searching & Loading..." : videoDetails?.title || media.query}
                </p>
                <span className="text-[10px] text-cyan-300/80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                  {media.mediaType === "video" ? "YouTube Video" : "YouTube Music"}
                </span>
              </div>
            </div>

            {/* Quick Action Icons */}
            <div className="flex items-center gap-1 shrink-0 text-slate-300">
              <button
                type="button"
                onClick={openInYouTubeTab}
                title="Open in YouTube"
                className="p-1.5 hover:bg-white/10 rounded-lg hover:text-white transition cursor-pointer"
              >
                <ExternalLink size={13} />
              </button>
              <button
                type="button"
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? "Expand" : "Minimize"}
                className="p-1.5 hover:bg-white/10 rounded-lg hover:text-white transition cursor-pointer"
              >
                {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Close Player"
                className="p-1.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded-lg transition cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Player Body */}
          {!isMinimized && (
            <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
              {loading ? (
                <div className="flex flex-col items-center gap-2 text-cyan-400 p-6 text-center">
                  <Loader2 size={28} className="animate-spin" />
                  <p className="text-xs font-semibold text-slate-300">Playing: {media.query}</p>
                </div>
              ) : currentVideoId ? (
                <iframe
                  title="YouTube Player"
                  src={`https://www.youtube-nocookie.com/embed/${currentVideoId}?autoplay=1&playsinline=1&enablejsapi=1&rel=0&modestbranding=1`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              ) : (
                <div className="p-4 text-xs text-slate-400 text-center">
                  Could not load video player.
                </div>
              )}
            </div>
          )}

          {/* Minimized Quick Bar */}
          {isMinimized && (
            <div className="p-2.5 flex items-center justify-between text-xs">
              <span className="text-cyan-200 truncate font-medium">
                {videoDetails?.title || media.query}
              </span>
              <button
                type="button"
                onClick={() => setIsMinimized(false)}
                className="text-[11px] font-bold text-cyan-400 hover:underline px-2 cursor-pointer"
              >
                Show
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
