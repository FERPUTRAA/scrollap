import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from "react";
import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type IRemoteVideoTrack,
  type IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import {
  Phone,
  PhoneOff,
  Heart,
  Share2,
  UserPlus,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  RefreshCw,
  WifiOff,
  CheckCircle,
  Globe,
  Signal,
  Wifi,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const AGORA_APP_ID = "2f62afc1e7df4c71957bea05f56c8cbb";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VAVA_CDN = "https://img.vervachat.com";

AgoraRTC.setLogLevel(4);

interface VavaUser {
  userId: number;
  displayName: string;
  profilePictureUrl: string;
  age: number | null;
  online: boolean;
  busy: boolean;
  verified: boolean;
  callCost: number;
  country: string;
  countryCode: string;
  countryFlagUrl: string;
  language: string;
  distance: string | null;
}

interface AgoraSession {
  channel: string;
  token: string;
  uid: number;
  peerId: number | null;
}

type StreamState =
  | "idle"
  | "connecting"
  | "connected"
  | "no_stream"
  | "error";

const GRADIENTS = [
  "linear-gradient(160deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)",
  "linear-gradient(160deg,#0f2027 0%,#203a43 50%,#2c5364 100%)",
  "linear-gradient(160deg,#2d1b69 0%,#1a0533 50%,#11998e 100%)",
  "linear-gradient(160deg,#1f1c2c 0%,#3a1f5e 50%,#928dab 100%)",
  "linear-gradient(160deg,#141e30 0%,#0a2342 50%,#243b55 100%)",
  "linear-gradient(160deg,#0f0c29 0%,#302b63 50%,#24243e 100%)",
];

function useAgoraViewer(session: AgoraSession | null, videoEl: HTMLDivElement | null) {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [remoteVideo, setRemoteVideo] = useState<IRemoteVideoTrack | null>(null);
  const [remoteAudio, setRemoteAudio] = useState<IRemoteAudioTrack | null>(null);
  const [muted, setMuted] = useState(false);

  const cleanup = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      remoteVideo?.stop();
      remoteAudio?.stop();
      await c.leave();
    } catch {}
    clientRef.current = null;
    setStreamState("idle");
    setRemoteVideo(null);
    setRemoteAudio(null);
  }, [remoteVideo, remoteAudio]);

  useEffect(() => {
    if (!session || !videoEl) return;

    let cancelled = false;

    async function join() {
      if (!session || !videoEl) return;
      setStreamState("connecting");

      const client = AgoraRTC.createClient({ mode: "live", codec: "h264" });
      clientRef.current = client;

      await client.setClientRole("audience");

      client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (cancelled) return;
        await client.subscribe(user, mediaType);
        if (mediaType === "video") {
          const track = user.videoTrack;
          if (track && videoEl) {
            track.play(videoEl);
            if (!cancelled) {
              setRemoteVideo(track);
              setStreamState("connected");
            }
          }
        }
        if (mediaType === "audio") {
          const track = user.audioTrack;
          if (track) {
            track.play();
            if (!cancelled) setRemoteAudio(track);
          }
        }
      });

      client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (mediaType === "video") {
          setRemoteVideo(null);
          setStreamState("no_stream");
        }
        if (mediaType === "audio") {
          setRemoteAudio(null);
        }
      });

      client.on("user-left", () => {
        if (!cancelled) setStreamState("no_stream");
      });

      try {
        await client.join(
          AGORA_APP_ID,
          session.channel,
          session.token,
          session.uid
        );

        if (cancelled) {
          await client.leave();
          return;
        }

        const remoteUsers = client.remoteUsers;
        if (remoteUsers.length === 0) {
          setStreamState("no_stream");
        } else {
          for (const user of remoteUsers) {
            if (user.hasVideo) {
              await client.subscribe(user, "video");
              const track = user.videoTrack;
              if (track && videoEl) {
                track.play(videoEl);
                if (!cancelled) {
                  setRemoteVideo(track);
                  setStreamState("connected");
                }
              }
            }
            if (user.hasAudio) {
              await client.subscribe(user, "audio");
              user.audioTrack?.play();
              if (!cancelled && user.audioTrack) setRemoteAudio(user.audioTrack);
            }
          }
          if (remoteUsers.length > 0 && !remoteUsers.some((u) => u.hasVideo)) {
            setStreamState("no_stream");
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Agora join failed:", err);
          setStreamState("error");
        }
      }
    }

    join();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [session, videoEl]);

  const toggleMute = useCallback(() => {
    if (remoteAudio) {
      if (muted) {
        remoteAudio.play();
      } else {
        remoteAudio.stop();
      }
      setMuted((m) => !m);
    }
  }, [remoteAudio, muted]);

  return { streamState, remoteVideo, muted, toggleMute, cleanup };
}

interface CardProps {
  user: VavaUser;
  index: number;
  isActive: boolean;
  session: AgoraSession | null;
  sessionLoading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const VidCallCard = memo(function VidCallCard({
  user,
  index,
  isActive,
  session,
  sessionLoading,
  onConnect,
  onDisconnect,
}: CardProps) {
  const [liked, setLiked] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const [imgError, setImgError] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLDivElement | null>(null);

  const activeSession = isActive ? session : null;
  const { streamState, muted, toggleMute } = useAgoraViewer(activeSession, videoEl);

  useEffect(() => {
    if (videoContainerRef.current) {
      setVideoEl(videoContainerRef.current);
    }
  }, []);

  const handleDoubleTap = () => {
    if (!liked) setLiked(true);
    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 900);
  };

  const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=EE1D52&color=fff&size=400&bold=true`;
  const mainImg = !imgError && user.profilePictureUrl ? user.profilePictureUrl : avatarFallback;

  const isStreaming = streamState === "connected";
  const isConnecting = streamState === "connecting" || sessionLoading;

  return (
    <div
      className="relative w-full h-full select-none overflow-hidden"
      style={{ background: GRADIENTS[index % GRADIENTS.length] }}
      onDoubleClick={handleDoubleTap}
    >
      {/* Profile image background (always shown as background) */}
      <img
        src={mainImg}
        alt={user.displayName}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: isStreaming ? 0.12 : 0.6 }}
        onError={() => setImgError(true)}
      />

      {/* Agora live video container - fills the screen */}
      <div
        ref={videoContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{
          display: isStreaming ? "block" : "none",
          zIndex: 5,
        }}
      />

      {/* Dark overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isStreaming
            ? "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 40%)"
            : "rgba(0,0,0,0.32)",
          zIndex: 6,
        }}
      />

      {/* Blur when no stream */}
      {!isStreaming && (
        <div className="absolute inset-0 pointer-events-none" style={{ backdropFilter: "blur(2px)", zIndex: 7 }} />
      )}

      {/* Ambient glows */}
      <div className="absolute top-[8%] left-[4%] w-44 h-44 rounded-full opacity-15 blur-3xl pointer-events-none" style={{ background: "#69C9D0", zIndex: 8 }} />
      <div className="absolute bottom-[20%] right-[4%] w-52 h-52 rounded-full opacity-12 blur-3xl pointer-events-none" style={{ background: "#EE1D52", zIndex: 8 }} />

      {/* Double-tap heart animation */}
      <AnimatePresence>
        {showHeart && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 40 }}
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
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 pb-5 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)", zIndex: 20 }}
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(238,29,82,0.9)", backdropFilter: "blur(6px)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(238,29,82,0.8)", backdropFilter: "blur(6px)" }}
            >
              <Video size={10} />
              VIDEO CALL
            </span>
          )}
          {user.callCost > 0 && (
            <span
              className="flex items-center gap-1 px-2 py-1 rounded-full text-yellow-300 text-[10px] font-bold"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
            >
              🪙 {user.callCost}/mnt
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <span
              className="flex items-center gap-1 text-white text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: "rgba(34,197,94,0.4)", border: "1px solid rgba(34,197,94,0.6)" }}
            >
              <Signal size={10} />
              RTC
            </span>
          )}
          {!isStreaming && (
            <span
              className="flex items-center gap-1 text-white text-[10px] font-bold px-2.5 py-1 rounded-full"
              style={{ background: "rgba(34,197,94,0.3)", border: "1px solid rgba(34,197,94,0.5)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              ONLINE
            </span>
          )}
        </div>
      </div>

      {/* Connecting / loading overlay */}
      <AnimatePresence>
        {isConnecting && (
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ zIndex: 25 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="w-16 h-16 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <p className="text-white/80 text-sm font-medium">Menghubungkan stream...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No stream info overlay */}
      {streamState === "no_stream" && !isConnecting && isActive && (
        <div
          className="absolute left-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.1)",
            backdropFilter: "blur(8px)",
            zIndex: 20,
          }}
        >
          <Wifi size={14} color="rgba(255,255,255,0.6)" />
          <p className="text-white/70 text-xs">Terhubung ke channel - menunggu host live</p>
        </div>
      )}

      {/* Profile photo panel - shown when NOT streaming */}
      {!isStreaming && !isConnecting && (
        <motion.div
          className="absolute rounded-3xl overflow-hidden"
          style={{
            top: "14%",
            left: "8%",
            right: "20%",
            height: "44%",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.13)",
            backdropFilter: "blur(10px)",
            zIndex: 15,
          }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}
        >
          <img
            src={mainImg}
            alt={user.displayName}
            className="absolute inset-0 w-full h-full object-cover object-top"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)" }} />

          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
            <div className="flex items-center gap-1.5">
              <Mic size={11} color="white" />
              <span className="text-white text-xs font-semibold">{user.displayName}</span>
              {user.verified && <CheckCircle size={11} color="#69C9D0" fill="#69C9D0" />}
            </div>
            {user.countryFlagUrl && (
              <img
                src={user.countryFlagUrl}
                alt={user.country}
                className="w-5 h-4 rounded object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
          </div>

          <div className="absolute top-3 right-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
            </span>
          </div>
        </motion.div>
      )}

      {/* Bottom gradient */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[55%] pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.5) 55%, transparent 100%)", zIndex: 18 }}
      />

      {/* Right action buttons */}
      <div className="absolute right-3 bottom-[72px] flex flex-col items-center gap-5" style={{ zIndex: 30 }}>
        <div className="relative mb-1">
          <div className="w-11 h-11 rounded-full border-2 border-white overflow-hidden bg-gray-700">
            <img
              src={mainImg}
              alt={user.displayName}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).src = avatarFallback; }}
            />
          </div>
          <button
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: "#EE1D52" }}
          >
            <UserPlus size={10} color="white" />
          </button>
        </div>

        <motion.button
          className="flex flex-col items-center gap-1 mt-2"
          whileTap={{ scale: 1.3 }}
          onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}
        >
          <Heart size={32} fill={liked ? "#EE1D52" : "transparent"} color={liked ? "#EE1D52" : "white"} strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">{liked ? "Disukai" : "Suka"}</span>
        </motion.button>

        {isStreaming && (
          <motion.button
            className="flex flex-col items-center gap-1"
            whileTap={{ scale: 1.1 }}
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
          >
            {muted ? (
              <VolumeX size={28} color="rgba(255,255,255,0.7)" strokeWidth={1.5} />
            ) : (
              <Volume2 size={28} color="white" strokeWidth={1.5} />
            )}
            <span className="text-white text-xs font-semibold drop-shadow">{muted ? "Unmute" : "Mute"}</span>
          </motion.button>
        )}

        <button className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Share2 size={28} color="white" strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">Bagikan</span>
        </button>

        <motion.button
          className="flex flex-col items-center gap-1"
          whileTap={{ scale: 0.92 }}
          onClick={(e) => {
            e.stopPropagation();
            if (session) {
              onDisconnect();
            } else {
              onConnect();
            }
          }}
        >
          <div
            className="w-[46px] h-[46px] rounded-full flex items-center justify-center"
            style={{
              background: session ? "rgba(238,29,82,0.9)" : "#22c55e",
              boxShadow: `0 0 18px ${session ? "#EE1D52" : "#22c55e"}66`,
            }}
          >
            {session ? (
              <PhoneOff size={20} color="white" />
            ) : (
              <Phone size={20} color="white" fill="white" />
            )}
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">
            {session ? "Keluar" : "Stream"}
          </span>
        </motion.button>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-[60px] left-3 right-20" style={{ zIndex: 30 }}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-white font-bold text-sm drop-shadow">{user.displayName}</p>
          {user.verified && <CheckCircle size={13} color="#69C9D0" fill="#69C9D0" />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {user.country && (
            <span className="flex items-center gap-1 text-white/80 text-xs">
              <Globe size={10} />
              {user.country}
            </span>
          )}
          {user.distance && <span className="text-white/60 text-xs">{user.distance}</span>}
          {user.age && <span className="text-white/60 text-xs">{user.age} thn</span>}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Users size={11} color="rgba(255,255,255,0.7)" />
          <p className="text-white/70 text-xs drop-shadow">
            {isStreaming
              ? "🔴 Streaming live sekarang"
              : user.busy
              ? "Sedang dalam panggilan"
              : "Siap dihubungi"}
          </p>
        </div>
      </div>
    </div>
  );
});

type PageStatus = "loading" | "ok" | "error";

export default function FaVidCall() {
  const [activeTab, setActiveTab] = useState<"Nearby" | "All">("All");
  const [users, setUsers] = useState<VavaUser[]>([]);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessions, setSessions] = useState<Record<number, AgoraSession>>({});
  const [loadingSession, setLoadingSession] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const fetchUsers = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`${BASE}/api/vava/users`);
      const data = await res.json();
      if (data.success && data.users && data.users.length > 0) {
        setUsers(data.users as VavaUser[]);
        setStatus("ok");
        setErrorMsg("");
      } else {
        throw new Error(data.error ?? "Tidak ada pengguna online");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Gagal memuat data");
      setStatus("error");
    }
  }, []);

  const displayedUsers = activeTab === "Nearby"
    ? users.filter((u) => u.distance !== null)
    : users;

  const effectiveUsers = displayedUsers.length > 0 ? displayedUsers : users;

  const handleConnect = useCallback(async (userId: number) => {
    setLoadingSession(userId);
    try {
      const res = await fetch(`${BASE}/api/vava/session`, { method: "POST" });
      const data = await res.json();

      if (data.success && data.channel && data.token) {
        setSessions((prev) => ({
          ...prev,
          [userId]: {
            channel: data.channel,
            token: data.token,
            uid: data.uid,
            peerId: data.peerId,
          },
        }));
      } else if (data.needsAuth) {
        alert("Sesi login Vava telah berakhir. Perlu login ulang untuk streaming live.");
      } else if (data.waiting) {
        alert("Tidak ada pengguna tersedia saat ini. Coba lagi dalam beberapa detik.");
      } else {
        console.warn("Session response:", data);
      }
    } catch (err) {
      console.error("Session fetch failed:", err);
    } finally {
      setLoadingSession(null);
    }
  }, []);

  const handleDisconnect = useCallback((userId: number) => {
    setSessions((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  useEffect(() => {
    fetchUsers();
    const iv = setInterval(fetchUsers, 60_000);
    return () => clearInterval(iv);
  }, [fetchUsers]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;

    const handleScroll = () => {
      const children = feed.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const rect = el.getBoundingClientRect();
        const feedRect = feed.getBoundingClientRect();
        const relTop = rect.top - feedRect.top;
        const relBottom = rect.bottom - feedRect.top;
        const feedH = feedRect.height;
        if (relTop >= -feedH * 0.3 && relBottom <= feedH * 1.3) {
          setActiveIndex(i);
          break;
        }
      }
    };

    feed.addEventListener("scroll", handleScroll, { passive: true });
    return () => feed.removeEventListener("scroll", handleScroll);
  }, [status]);

  return (
    <div className="relative h-full w-full bg-black">

      {/* Top Nav */}
      <div
        className="absolute top-0 left-0 right-0 z-30 flex justify-between items-center px-4 pt-12 pb-4 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)" }}
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
            style={{ background: "rgba(238,29,82,0.35)", border: "1px solid rgba(238,29,82,0.5)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            VAVA LIVE
          </span>
        </div>
      </div>

      {/* Loading */}
      {status === "loading" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4">
          <RefreshCw size={36} color="white" className="animate-spin" />
          <p className="text-white/70 text-sm">Memuat pengguna online...</p>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-8">
          <WifiOff size={40} color="rgba(255,255,255,0.5)" />
          <p className="text-white/70 text-sm text-center">{errorMsg}</p>
          <button
            onClick={fetchUsers}
            className="px-5 py-2 rounded-full text-white text-sm font-semibold flex items-center gap-2"
            style={{ background: "#EE1D52" }}
          >
            <RefreshCw size={14} />
            Coba Lagi
          </button>
        </div>
      )}

      {/* Feed */}
      {status === "ok" && (
        <div
          ref={feedRef}
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
          style={{ scrollBehavior: "smooth" }}
        >
          {effectiveUsers.map((user, i) => (
            <div key={user.userId} className="snap-start snap-always h-full w-full relative">
              <VidCallCard
                user={user}
                index={i}
                isActive={i === activeIndex}
                session={sessions[user.userId] ?? null}
                sessionLoading={loadingSession === user.userId}
                onConnect={() => handleConnect(user.userId)}
                onDisconnect={() => handleDisconnect(user.userId)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
