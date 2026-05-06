import React, { useState, useEffect, useCallback } from "react";
import { Phone, MapPin, Heart, Share2, UserPlus, Mic, MicOff, Video, Users, RefreshCw, WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface LiveRoom {
  id: string;
  anchorId?: string;
  liveId?: string;
  name: string;
  viewers: number;
  cover: string;
  avatar: string;
  liveName: string;
  streamUrl: string;
  streamProxyUrl: string;
  hasAuth?: boolean;
}

interface VidCallCard {
  id: string;
  callerName: string;
  callerHandle: string;
  callerAvatar: string;
  callerCover: string;
  viewers: number;
  topic: string;
  bg: string;
}

const GRADIENT_FALLBACKS = [
  "linear-gradient(160deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)",
  "linear-gradient(160deg,#0f2027 0%,#203a43 50%,#2c5364 100%)",
  "linear-gradient(160deg,#2d1b69 0%,#1a0533 50%,#11998e 100%)",
  "linear-gradient(160deg,#1f1c2c 0%,#3a1f5e 50%,#928dab 100%)",
  "linear-gradient(160deg,#141e30 0%,#0a2342 50%,#243b55 100%)",
  "linear-gradient(160deg,#0f0c29 0%,#302b63 50%,#24243e 100%)",
];

function formatViewers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function mapRoomToCard(room: LiveRoom, index: number): VidCallCard {
  return {
    id: room.id,
    callerName: room.name,
    callerHandle: "@" + room.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
    callerAvatar: room.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(room.name)}&background=EE1D52&color=fff&size=150`,
    callerCover: room.cover || "",
    viewers: room.viewers,
    topic: room.liveName || `${room.name} sedang live!`,
    bg: room.cover ? "" : GRADIENT_FALLBACKS[index % GRADIENT_FALLBACKS.length],
  };
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function VidCallCardItem({ card }: { card: VidCallCard }) {
  const [liked, setLiked] = useState(false);
  const [joined, setJoined] = useState(false);
  const [showHeart, setShowHeart] = useState(false);

  const handleDoubleTap = () => {
    if (!liked) setLiked(true);
    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 900);
  };

  return (
    <div
      className="relative w-full h-full select-none overflow-hidden"
      style={
        card.callerCover
          ? { background: "#000" }
          : { background: card.bg }
      }
      onDoubleClick={handleDoubleTap}
    >
      {/* Background cover image */}
      {card.callerCover && (
        <img
          src={card.callerCover}
          alt={card.callerName}
          className="absolute inset-0 w-full h-full object-cover opacity-50"
        />
      )}

      {/* Ambient blobs */}
      <div
        className="absolute top-[15%] left-[10%] w-48 h-48 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "#69C9D0" }}
      />
      <div
        className="absolute bottom-[20%] right-[5%] w-56 h-56 rounded-full opacity-15 blur-3xl pointer-events-none"
        style={{ background: "#EE1D52" }}
      />

      {/* Double-tap heart */}
      <AnimatePresence>
        {showHeart && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1.2 }}
            exit={{ opacity: 0, scale: 1.5 }}
            transition={{ duration: 0.4 }}
          >
            <Heart size={100} fill="#EE1D52" color="#EE1D52" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-20 px-4 pt-12 pb-6 flex items-center justify-between pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
            style={{ background: "rgba(238,29,82,0.85)", backdropFilter: "blur(6px)" }}
          >
            <Video size={10} />
            VIDEO CALL
          </span>
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-semibold"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
          >
            <Users size={10} />
            {formatViewers(card.viewers)}
          </span>
        </div>
        <span
          className="flex items-center gap-1 text-white text-[10px] font-bold px-2.5 py-1 rounded-full"
          style={{ background: "rgba(34,197,94,0.35)", border: "1px solid rgba(34,197,94,0.5)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          LIVE
        </span>
      </div>

      {/* Video call preview panels */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 px-8">
        {/* Main caller */}
        <motion.div
          className="relative w-full rounded-3xl overflow-hidden"
          style={{
            height: "45%",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(8px)",
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <img
            src={card.callerCover || card.callerAvatar}
            alt={card.callerName}
            className="absolute inset-0 w-full h-full object-cover opacity-70"
            onError={(e) => {
              (e.target as HTMLImageElement).src = card.callerAvatar;
            }}
          />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 60%)" }}
          />
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <Mic size={12} color="white" />
            <span className="text-white text-xs font-semibold">{card.callerName}</span>
          </div>
          <div className="absolute top-3 right-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
            </span>
          </div>
        </motion.div>

        {/* Viewer panel (you) */}
        <motion.div
          className="relative rounded-2xl overflow-hidden self-end"
          style={{
            width: "42%",
            height: "22%",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(8px)",
          }}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <MicOff size={16} color="rgba(255,255,255,0.6)" />
            </div>
          </div>
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)" }}
          />
          <div className="absolute bottom-2 left-2 flex items-center gap-1">
            <MicOff size={10} color="rgba(255,255,255,0.7)" />
            <span className="text-white/70 text-[10px] font-semibold">Kamu</span>
          </div>
        </motion.div>
      </div>

      {/* Bottom gradient */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[50%] pointer-events-none z-10"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)" }}
      />

      {/* Right action buttons */}
      <div className="absolute right-3 bottom-[70px] z-20 flex flex-col items-center gap-5">
        <div className="relative mb-1">
          <div className="w-11 h-11 rounded-full border-2 border-white overflow-hidden bg-gray-700">
            <img
              src={card.callerAvatar}
              alt={card.callerName}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(card.callerName)}&background=EE1D52&color=fff&size=44`;
              }}
            />
          </div>
          <button
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-white text-sm font-bold"
            style={{ background: "#EE1D52" }}
          >
            <UserPlus size={10} />
          </button>
        </div>

        <motion.button
          className="flex flex-col items-center gap-1 mt-2"
          whileTap={{ scale: 1.3 }}
          onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
        >
          <Heart
            size={32}
            fill={liked ? "#EE1D52" : "transparent"}
            color={liked ? "#EE1D52" : "white"}
            strokeWidth={1.5}
          />
          <span className="text-white text-xs font-semibold drop-shadow">Suka</span>
        </motion.button>

        <button className="flex flex-col items-center gap-1">
          <Share2 size={30} color="white" strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">Bagikan</span>
        </button>

        <motion.button
          className="flex flex-col items-center gap-1"
          whileTap={{ scale: 0.92 }}
          onClick={(e) => { e.stopPropagation(); setJoined(!joined); }}
        >
          <div
            className="w-[46px] h-[46px] rounded-full flex items-center justify-center"
            style={{ background: joined ? "#EE1D52" : "#22c55e", boxShadow: `0 0 16px ${joined ? "#EE1D52" : "#22c55e"}55` }}
          >
            <Phone size={20} color="white" fill="white" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">{joined ? "Keluar" : "Gabung"}</span>
        </motion.button>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-[60px] left-3 right-20 z-20">
        <p className="text-white font-bold text-sm drop-shadow mb-0.5">{card.callerHandle}</p>
        <p className="text-white text-xs leading-relaxed drop-shadow line-clamp-2 mb-2 opacity-90">
          {card.topic}
        </p>
        <div className="flex items-center gap-2">
          <Users size={11} color="rgba(255,255,255,0.7)" />
          <p className="text-white/70 text-xs drop-shadow">{formatViewers(card.viewers)} penonton</p>
        </div>
      </div>
    </div>
  );
}

type PageStatus = "loading" | "ok" | "error";

export default function FaVidCall() {
  const [activeTab, setActiveTab] = useState<"Nearby" | "All">("All");
  const [cards, setCards] = useState<VidCallCard[]>([]);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const fetchRooms = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`${BASE}/api/live-rooms?limit=30`);
      const data = await res.json();
      if (data.success && data.rooms && data.rooms.length > 0) {
        setCards((data.rooms as LiveRoom[]).map(mapRoomToCard));
        setStatus("ok");
        setErrorMsg("");
      } else {
        throw new Error(data.error ?? "Tidak ada live room aktif saat ini");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal memuat data");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const iv = setInterval(fetchRooms, 60_000);
    return () => clearInterval(iv);
  }, [fetchRooms]);

  return (
    <div className="relative h-full w-full bg-black">

      {/* Top Nav */}
      <div
        className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center px-4 pt-12 pb-4 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)" }}
      >
        <div className="flex-1" />
        <div className="flex gap-5 items-center font-bold text-[15px] drop-shadow pointer-events-auto">
          <button
            onClick={() => setActiveTab("Nearby")}
            className={`transition-colors ${activeTab === "Nearby" ? "text-white" : "text-white/50"}`}
          >
            Terdekat
          </button>
          <button
            onClick={() => setActiveTab("All")}
            className="relative text-white"
          >
            Semua
            {activeTab === "All" && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-white rounded-full" />
            )}
          </button>
        </div>
        <div className="flex-1 flex justify-end">
          <span
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-bold"
            style={{ background: "rgba(34,197,94,0.35)", border: "1px solid rgba(34,197,94,0.5)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      {/* Loading state */}
      {status === "loading" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4">
          <RefreshCw size={36} color="white" className="animate-spin" />
          <p className="text-white/70 text-sm">Memuat video call live...</p>
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-8">
          <WifiOff size={40} color="rgba(255,255,255,0.5)" />
          <p className="text-white/70 text-sm text-center">{errorMsg}</p>
          <button
            onClick={fetchRooms}
            className="px-5 py-2 rounded-full text-white text-sm font-semibold flex items-center gap-2"
            style={{ background: "#EE1D52" }}
          >
            <RefreshCw size={14} />
            Coba Lagi
          </button>
        </div>
      )}

      {/* Vertical snap scroll feed */}
      {status === "ok" && (
        <div
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
          style={{ scrollBehavior: "smooth" }}
        >
          {cards.map((card) => (
            <div key={card.id} className="snap-start snap-always h-full w-full relative">
              <VidCallCardItem card={card} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
