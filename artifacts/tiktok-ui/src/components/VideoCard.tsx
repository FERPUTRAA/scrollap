import React, { useState } from "react";
import { Heart, MessageCircle, Share2, Music } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Video {
  id: string;
  username: string;
  handle: string;
  caption: string;
  music: string;
  likes: string;
  comments: string;
  shares: string;
  bgColor: string;
  avatarUrl: string;
}

interface VideoCardProps {
  video: Video;
}

export default function VideoCard({ video }: VideoCardProps) {
  const [liked, setLiked] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [showHeart, setShowHeart] = useState(false);

  const handleDoubleTap = () => {
    if (!liked) setLiked(true);
    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 900);
  };

  return (
    <div
      className="relative w-full h-full select-none"
      style={{ background: video.bgColor }}
      onDoubleClick={handleDoubleTap}
      data-testid={`video-card-${video.id}`}
    >
      {/* Simulated video overlay pattern */}
      <div className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: "radial-gradient(circle at 30% 70%, rgba(255,255,255,0.3) 0%, transparent 60%)",
        }}
      />

      {/* Double-tap heart animation */}
      <AnimatePresence>
        {showHeart && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1.2 }}
            exit={{ opacity: 0, scale: 1.5 }}
            transition={{ duration: 0.4 }}
          >
            <Heart size={100} fill="#EE1D52" color="#EE1D52" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom gradient overlay */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[55%] pointer-events-none z-10"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)"
        }}
      />

      {/* Right action buttons */}
      <div className="absolute right-3 bottom-[70px] z-20 flex flex-col items-center gap-5">
        {/* Avatar + Follow */}
        <div className="relative flex flex-col items-center mb-2">
          <div className="w-11 h-11 rounded-full border-2 border-white overflow-hidden bg-gray-500">
            <img
              src={video.avatarUrl}
              alt={video.username}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${video.username}&background=random&color=fff&size=44`;
              }}
            />
          </div>
          {!followed && (
            <button
              data-testid={`button-follow-${video.id}`}
              onClick={(e) => { e.stopPropagation(); setFollowed(true); }}
              className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ background: "#EE1D52" }}
            >
              +
            </button>
          )}
        </div>

        {/* Like */}
        <motion.button
          data-testid={`button-like-${video.id}`}
          className="flex flex-col items-center gap-1"
          whileTap={{ scale: 1.3 }}
          onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
        >
          <Heart
            size={32}
            fill={liked ? "#EE1D52" : "transparent"}
            color={liked ? "#EE1D52" : "white"}
            strokeWidth={1.5}
          />
          <span className="text-white text-xs font-semibold drop-shadow">{video.likes}</span>
        </motion.button>

        {/* Comment */}
        <button
          data-testid={`button-comment-${video.id}`}
          className="flex flex-col items-center gap-1"
        >
          <MessageCircle size={32} color="white" strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">{video.comments}</span>
        </button>

        {/* Share */}
        <button
          data-testid={`button-share-${video.id}`}
          className="flex flex-col items-center gap-1"
        >
          <Share2 size={30} color="white" strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">{video.shares}</span>
        </button>

        {/* Spinning music disc */}
        <motion.div
          className="w-9 h-9 rounded-full border-2 border-white/40 overflow-hidden bg-gray-800 flex items-center justify-center"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
        >
          <Music size={16} color="white" />
        </motion.div>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-[60px] left-3 right-16 z-20">
        <p className="text-white font-bold text-sm drop-shadow mb-1">@{video.handle}</p>
        <p className="text-white text-xs leading-relaxed drop-shadow line-clamp-2 mb-2">{video.caption}</p>
        <div className="flex items-center gap-2">
          <Music size={12} color="white" />
          <p className="text-white text-xs drop-shadow truncate">{video.music}</p>
        </div>
      </div>
    </div>
  );
}
