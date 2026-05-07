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
  CheckCircle,
  Globe,
  Signal,
  Volume2,
  VolumeX,
  Users,
  WifiOff,
  Wifi,
  Radio,
  Star,
  Zap,
  X,
  ChevronUp,
  ChevronDown,
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
  starSign: string | null;
  astrologicalIconUrl: string | null;
  hobbies: string[];
  withVideoPass: boolean;
}

interface AgoraSession {
  channel: string;
  token: string;
  uid: number;
  peerId: number | null;
  orderNo?: string | null;
  source?: "ws" | "api";
}

type StreamState = "idle" | "connecting" | "connected" | "no_stream" | "error";

const GRADIENTS = [
  "linear-gradient(160deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)",
  "linear-gradient(160deg,#0f2027 0%,#203a43 50%,#2c5364 100%)",
  "linear-gradient(160deg,#2d1b69 0%,#1a0533 50%,#11998e 100%)",
  "linear-gradient(160deg,#1f1c2c 0%,#3a1f5e 50%,#928dab 100%)",
  "linear-gradient(160deg,#141e30 0%,#0a2342 50%,#243b55 100%)",
  "linear-gradient(160deg,#0f0c29 0%,#302b63 50%,#24243e 100%)",
  "linear-gradient(160deg,#200122 0%,#6f0000 50%,#200122 100%)",
  "linear-gradient(160deg,#0d0d0d 0%,#1a1a1a 50%,#0d2137 100%)",
];

// ─── Agora viewer hook ──────────────────────────────────────────────────────
function useAgoraViewer(session: AgoraSession | null, videoEl: HTMLDivElement | null) {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [remoteVideo, setRemoteVideo] = useState<IRemoteVideoTrack | null>(null);
  const [remoteAudio, setRemoteAudio] = useState<IRemoteAudioTrack | null>(null);
  const [muted, setMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const pendingVideoRef = useRef<IRemoteVideoTrack | null>(null);
  const pendingAudioRef = useRef<IRemoteAudioTrack | null>(null);

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
    setAutoplayBlocked(false);
  }, [remoteVideo, remoteAudio]);

  const unblockAutoplay = useCallback(() => {
    if (!autoplayBlocked) return;
    try {
      pendingVideoRef.current?.play(undefined as unknown as HTMLElement);
      pendingAudioRef.current?.play();
    } catch {}
    setAutoplayBlocked(false);
    setMuted(false);
  }, [autoplayBlocked]);

  useEffect(() => {
    if (!session || !videoEl) return;
    let cancelled = false;

    async function playVideoTrack(track: IRemoteVideoTrack) {
      try {
        track.play(videoEl!);
      } catch (e: unknown) {
        const err = e as { name?: string };
        if (err?.name === "NotAllowedError" || String(e).includes("autoplay")) {
          pendingVideoRef.current = track;
          setAutoplayBlocked(true);
        }
      }
    }

    async function join() {
      if (!session || !videoEl) return;
      setStreamState("connecting");
      setAutoplayBlocked(false);

      const client = AgoraRTC.createClient({ mode: "live", codec: "h264" });
      clientRef.current = client;
      await client.setClientRole("audience");

      AgoraRTC.onAutoplayFailed = () => { setAutoplayBlocked(true); };

      client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (cancelled) return;
        await client.subscribe(user, mediaType);
        if (mediaType === "video") {
          const track = user.videoTrack;
          if (track && videoEl) {
            await playVideoTrack(track);
            if (!cancelled) { setRemoteVideo(track); setStreamState("connected"); }
          }
        }
        if (mediaType === "audio") {
          const track = user.audioTrack;
          if (track) {
            try { track.play(); } catch {
              pendingAudioRef.current = track;
              setAutoplayBlocked(true);
            }
            if (!cancelled) setRemoteAudio(track);
          }
        }
      });

      client.on("user-unpublished", (_user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (mediaType === "video") { setRemoteVideo(null); setStreamState("no_stream"); }
        if (mediaType === "audio") setRemoteAudio(null);
      });

      client.on("user-left", () => { if (!cancelled) setStreamState("no_stream"); });

      try {
        // token can be null if App Certificate not enabled (test mode)
        await client.join(AGORA_APP_ID, session.channel, session.token || null, session.uid);
        if (cancelled) { await client.leave(); return; }

        const remoteUsers = client.remoteUsers;
        if (remoteUsers.length === 0) {
          setStreamState("no_stream");
        } else {
          for (const user of remoteUsers) {
            if (user.hasVideo) {
              await client.subscribe(user, "video");
              const track = user.videoTrack;
              if (track && videoEl) {
                await playVideoTrack(track);
                if (!cancelled) { setRemoteVideo(track); setStreamState("connected"); }
              }
            }
            if (user.hasAudio) {
              await client.subscribe(user, "audio");
              try { user.audioTrack?.play(); } catch {
                if (user.audioTrack) { pendingAudioRef.current = user.audioTrack; setAutoplayBlocked(true); }
              }
              if (!cancelled && user.audioTrack) setRemoteAudio(user.audioTrack);
            }
          }
          if (remoteUsers.length > 0 && !remoteUsers.some((u) => u.hasVideo)) {
            setStreamState("no_stream");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStreamState("error");
        }
      }
    }

    join();
    return () => { cancelled = true; cleanup(); };
  }, [session, videoEl, cleanup]);

  const toggleMute = useCallback(() => {
    if (remoteAudio) {
      if (muted) remoteAudio.play();
      else remoteAudio.stop();
      setMuted((m) => !m);
    }
  }, [remoteAudio, muted]);

  return { streamState, remoteVideo, muted, toggleMute, cleanup, autoplayBlocked, unblockAutoplay };
}

// ─── WS / SSE relay hook ────────────────────────────────────────────────────
function useVavaRelay(onSession: (s: AgoraSession) => void) {
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${BASE}/api/vava/ws-relay`);
    esRef.current = es;
    setWsStatus("connecting");

    es.addEventListener("connected", () => setWsStatus("connecting"));
    es.addEventListener("ws_connecting", () => setWsStatus("connecting"));
    es.addEventListener("ws_connected", () => setWsStatus("connected"));
    es.addEventListener("ws_disconnected", () => setWsStatus("connecting"));
    es.addEventListener("ws_error", () => setWsStatus("error"));

    es.addEventListener("agora_session", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as {
          appId: string; channel: string; token: string; uid: number; eventType?: string;
        };
        if (d.channel && d.token) {
          onSession({
            channel: d.channel,
            token: d.token,
            uid: d.uid,
            peerId: null,
            source: "ws",
          });
        }
      } catch {}
    });

    es.onerror = () => setWsStatus("error");

    return () => { es.close(); esRef.current = null; setWsStatus("idle"); };
  }, [onSession]);

  return wsStatus;
}

// ─── User card ──────────────────────────────────────────────────────────────
interface CardProps {
  user: VavaUser;
  index: number;
  isActive: boolean;
  session: AgoraSession | null;
  sessionLoading: boolean;
  wsStatus: "idle" | "connecting" | "connected" | "error";
  onConnect: () => void;
  onDisconnect: () => void;
}

const VidCallCard = memo(function VidCallCard({
  user, index, isActive, session, sessionLoading, wsStatus, onConnect, onDisconnect,
}: CardProps) {
  const [liked, setLiked] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const [imgError, setImgError] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLDivElement | null>(null);

  const activeSession = isActive ? session : null;
  const { streamState, muted, toggleMute, autoplayBlocked, unblockAutoplay } =
    useAgoraViewer(activeSession, videoEl);

  useEffect(() => {
    if (videoContainerRef.current) setVideoEl(videoContainerRef.current);
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
      {/* Background photo */}
      <img
        src={mainImg}
        alt={user.displayName}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: isStreaming ? 0.08 : 0.5, transition: "opacity 0.6s ease" }}
        onError={() => setImgError(true)}
      />

      {/* Agora live video container */}
      <div
        ref={videoContainerRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: isStreaming ? "block" : "none", zIndex: 5 }}
      />

      {/* Gradient overlays */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: isStreaming
            ? "linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 50%)"
            : "rgba(0,0,0,0.30)",
          zIndex: 6,
          transition: "background 0.6s ease",
        }}
      />
      {!isStreaming && (
        <div className="absolute inset-0 pointer-events-none" style={{ backdropFilter: "blur(1px)", zIndex: 7 }} />
      )}

      {/* Ambient glows */}
      <div className="absolute top-[6%] left-[2%] w-48 h-48 rounded-full opacity-12 blur-3xl pointer-events-none" style={{ background: "#69C9D0", zIndex: 8 }} />
      <div className="absolute bottom-[22%] right-[2%] w-56 h-56 rounded-full opacity-8 blur-3xl pointer-events-none" style={{ background: "#EE1D52", zIndex: 8 }} />

      {/* Double-tap heart */}
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
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.78) 0%, transparent 100%)", zIndex: 20 }}
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(238,29,82,0.9)", backdropFilter: "blur(6px)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(238,29,82,0.8)", backdropFilter: "blur(6px)" }}>
              <Radio size={10} />
              VIDEO CALL
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* WS Status */}
          {!session && (
            <span className="flex items-center gap-1 text-white text-[10px] font-bold px-2 py-1 rounded-full"
              style={{
                background: wsStatus === "connected" ? "rgba(34,197,94,0.3)" : wsStatus === "error" ? "rgba(239,68,68,0.3)" : "rgba(250,204,21,0.25)",
                border: `1px solid ${wsStatus === "connected" ? "rgba(34,197,94,0.5)" : wsStatus === "error" ? "rgba(239,68,68,0.4)" : "rgba(250,204,21,0.4)"}`,
              }}>
              <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === "connected" ? "bg-green-400 animate-pulse" : wsStatus === "error" ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`} />
              {wsStatus === "connected" ? "WS AKTIF" : wsStatus === "error" ? "WS ERR" : "WS..."}
            </span>
          )}
          {session && (
            <span className="flex items-center gap-1 text-white text-[10px] font-bold px-2 py-1 rounded-full"
              style={{
                background: isStreaming ? "rgba(34,197,94,0.4)" : "rgba(250,204,21,0.35)",
                border: `1px solid ${isStreaming ? "rgba(34,197,94,0.6)" : "rgba(250,204,21,0.5)"}`,
              }}>
              <Signal size={10} />
              {isStreaming ? "STREAMING" : "CH: " + session.channel.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      {/* Connecting spinner */}
      <AnimatePresence>
        {isConnecting && (
          <motion.div className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ zIndex: 25 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="w-16 h-16 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <p className="text-white/80 text-sm font-medium">Menghubungkan ke RTC...</p>
            {session && <p className="text-white/50 text-xs font-mono">ch: {session.channel.slice(0, 16)}…</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Autoplay unblock */}
      {autoplayBlocked && isActive && (
        <motion.div className="absolute inset-0 flex items-center justify-center cursor-pointer"
          style={{ zIndex: 35 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={unblockAutoplay}>
          <div className="flex flex-col items-center gap-3 px-6 py-4 rounded-2xl"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.15)" }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(238,29,82,0.9)" }}>
              <Volume2 size={28} color="white" />
            </div>
            <p className="text-white font-bold text-sm">Tap untuk Play</p>
            <p className="text-white/60 text-xs text-center">Ketuk untuk mulai video</p>
          </div>
        </motion.div>
      )}

      {/* No stream notice */}
      {streamState === "no_stream" && !isConnecting && isActive && (
        <div className="absolute left-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.55)",
            border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(8px)", zIndex: 20 }}>
          <Wifi size={14} color="rgba(255,255,255,0.6)" />
          <div>
            <p className="text-white/80 text-xs font-semibold">Terhubung ke channel Agora</p>
            <p className="text-white/50 text-[10px]">Menunggu host mulai streaming…</p>
          </div>
        </div>
      )}

      {/* Error notice */}
      {streamState === "error" && !isConnecting && isActive && (
        <div className="absolute left-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ top: "50%", transform: "translateY(-50%)", background: "rgba(238,29,82,0.15)",
            border: "1px solid rgba(238,29,82,0.3)", backdropFilter: "blur(8px)", zIndex: 20 }}>
          <WifiOff size={14} color="#EE1D52" />
          <p className="text-white/70 text-xs">Gagal join channel</p>
        </div>
      )}

      {/* Profile photo panel (when not streaming) */}
      {!isStreaming && !isConnecting && (
        <motion.div className="absolute rounded-3xl overflow-hidden"
          style={{ top: "13%", left: "7%", right: "21%", height: "46%",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)", zIndex: 15 }}
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35 }}>
          <img src={mainImg} alt={user.displayName}
            className="absolute inset-0 w-full h-full object-cover object-top"
            onError={() => setImgError(true)} />
          <div className="absolute inset-0"
            style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)" }} />
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
            <div className="flex items-center gap-1.5">
              <Mic size={11} color="white" />
              <span className="text-white text-xs font-semibold">{user.displayName}</span>
              {user.verified && <CheckCircle size={11} color="#69C9D0" fill="#69C9D0" />}
            </div>
            {user.countryFlagUrl && (
              <img src={user.countryFlagUrl} alt={user.country} className="w-5 h-4 rounded object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
          </div>
          {/* Online indicator */}
          <div className="absolute top-3 right-3">
            {user.online ? (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            ) : (
              <span className="inline-flex h-3 w-3 rounded-full bg-gray-400" />
            )}
          </div>
        </motion.div>
      )}

      {/* Star sign badge */}
      {user.starSign && !isStreaming && !isConnecting && (
        <div className="absolute flex items-center gap-1 px-2 py-1 rounded-xl"
          style={{ top: "13%", right: "4%", width: "16%", background: "rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", zIndex: 16 }}>
          {user.astrologicalIconUrl && (
            <img src={user.astrologicalIconUrl} alt={user.starSign}
              className="w-5 h-5 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          )}
          <span className="text-white/80 text-[9px] font-semibold leading-tight">{user.starSign}</span>
        </div>
      )}

      {/* Bottom gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-[58%] pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)", zIndex: 18 }} />

      {/* Right action buttons */}
      <div className="absolute right-3 bottom-[72px] flex flex-col items-center gap-5" style={{ zIndex: 30 }}>
        <div className="relative mb-1">
          <div className="w-11 h-11 rounded-full border-2 border-white overflow-hidden bg-gray-700">
            <img src={mainImg} alt={user.displayName} className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).src = avatarFallback; }} />
          </div>
          <button className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: "#EE1D52" }}>
            <UserPlus size={10} color="white" />
          </button>
        </div>

        <motion.button className="flex flex-col items-center gap-1 mt-2" whileTap={{ scale: 1.3 }}
          onClick={(e) => { e.stopPropagation(); setLiked(!liked); }}>
          <Heart size={32} fill={liked ? "#EE1D52" : "transparent"} color={liked ? "#EE1D52" : "white"} strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">{liked ? "Disukai" : "Suka"}</span>
        </motion.button>

        {isStreaming && (
          <motion.button className="flex flex-col items-center gap-1" whileTap={{ scale: 1.1 }}
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}>
            {muted
              ? <VolumeX size={28} color="rgba(255,255,255,0.7)" strokeWidth={1.5} />
              : <Volume2 size={28} color="white" strokeWidth={1.5} />}
            <span className="text-white text-xs font-semibold drop-shadow">{muted ? "Unmute" : "Mute"}</span>
          </motion.button>
        )}

        <button className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Share2 size={28} color="white" strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">Bagikan</span>
        </button>

        <motion.button className="flex flex-col items-center gap-1" whileTap={{ scale: 0.92 }}
          onClick={(e) => { e.stopPropagation(); session ? onDisconnect() : onConnect(); }}>
          <div className="w-[46px] h-[46px] rounded-full flex items-center justify-center"
            style={{ background: session ? "rgba(238,29,82,0.9)" : "#22c55e",
              boxShadow: `0 0 18px ${session ? "#EE1D52" : "#22c55e"}66` }}>
            {session ? <PhoneOff size={20} color="white" /> : <Phone size={20} color="white" fill="white" />}
          </div>
          <span className="text-white text-xs font-semibold drop-shadow">{session ? "Keluar" : "Stream"}</span>
        </motion.button>
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-[60px] left-3 right-20" style={{ zIndex: 30 }}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <p className="text-white font-bold text-sm drop-shadow">{user.displayName}</p>
          {user.age && <span className="text-white/70 text-xs">{user.age} thn</span>}
          {user.verified && <CheckCircle size={13} color="#69C9D0" fill="#69C9D0" />}
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-1">
          {user.country && (
            <span className="flex items-center gap-1 text-white/80 text-xs">
              <Globe size={10} />
              {user.country}
            </span>
          )}
          {user.distance && <span className="text-white/60 text-xs">{user.distance}</span>}
          {user.busy && <span className="text-yellow-400 text-xs font-semibold">Sedang sibuk</span>}
        </div>

        {/* Hobby tags */}
        {user.hobbies.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {user.hobbies.slice(0, 3).map((h) => (
              <span key={h} className="px-2 py-0.5 rounded-full text-white/80 text-[10px] font-medium"
                style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" }}>
                {h}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Users size={11} color="rgba(255,255,255,0.7)" />
          <p className="text-white/70 text-xs drop-shadow">
            {isStreaming
              ? "🔴 Streaming live sekarang"
              : session
              ? "📡 Terhubung ke channel RTC"
              : user.withVideoPass
              ? "🎫 Tersedia video pass"
              : user.busy
              ? "Sedang dalam panggilan"
              : "Siap dihubungi"}
          </p>
        </div>
      </div>
    </div>
  );
});

// ─── Searching overlay ───────────────────────────────────────────────────────
function SearchingOverlay({
  user, onCancel,
}: { user: VavaUser; onCancel: () => void }) {
  const [phase, setPhase] = useState(0);
  const [imgError, setImgError] = useState(false);
  const phases = ["Mencari kecocokan…", "Menganalisis profil…", "Menghubungkan…", "Menunggu respons…"];

  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % phases.length), 2000);
    return () => clearInterval(t);
  }, []);

  const mainImg = !imgError && user.profilePictureUrl ? user.profilePictureUrl
    : `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=EE1D52&color=fff&size=300`;

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center gap-4"
      style={{ zIndex: 50, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Close button */}
      <button className="absolute top-12 right-4 w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.15)" }} onClick={onCancel}>
        <X size={16} color="white" />
      </button>

      {/* Ripple + photo */}
      <div className="relative flex items-center justify-center">
        {[1, 2, 3].map((i) => (
          <motion.div key={i}
            className="absolute rounded-full border-2 border-white/30"
            style={{ width: 80 + i * 40, height: 80 + i * 40 }}
            animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.15, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }} />
        ))}
        <div className="w-20 h-20 rounded-full overflow-hidden border-3 border-white/60 z-10"
          style={{ border: "3px solid rgba(255,255,255,0.6)" }}>
          <img src={mainImg} alt={user.displayName} className="w-full h-full object-cover"
            onError={() => setImgError(true)} />
        </div>
      </div>

      <div className="text-center">
        <p className="text-white font-bold text-base mb-1">{user.displayName}</p>
        <p className="text-white/60 text-xs">{user.country} · {user.age ? `${user.age} thn` : ""}</p>
      </div>

      <motion.p
        key={phase}
        className="text-white/80 text-sm font-medium text-center"
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.3 }}
      >
        {phases[phase]}
      </motion.p>

      <div className="flex gap-1.5">
        {phases.map((_, i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full"
            style={{ background: i === phase ? "white" : "rgba(255,255,255,0.3)" }} />
        ))}
      </div>

      <button className="mt-2 flex items-center gap-2 px-5 py-2.5 rounded-full"
        style={{ background: "rgba(238,29,82,0.9)" }} onClick={onCancel}>
        <PhoneOff size={16} color="white" />
        <span className="text-white text-sm font-bold">Batalkan</span>
      </button>
    </motion.div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
type PageStatus = "loading" | "ok" | "error";

export default function FaVidCall() {
  const [activeTab, setActiveTab] = useState<"Semua" | "Terdekat">("Semua");
  const [users, setUsers] = useState<VavaUser[]>([]);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessions, setSessions] = useState<Record<number, AgoraSession>>({});
  const [loadingSession, setLoadingSession] = useState<number | null>(null);
  const [liveSession, setLiveSession] = useState<AgoraSession | null>(null);
  const [searchingUserId, setSearchingUserId] = useState<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef<Record<number, number>>({});

  const handleLiveSession = useCallback((s: AgoraSession) => {
    setLiveSession(s);
    setSearchingUserId(null);
    setActiveIndex((ai) => {
      setUsers((us) => {
        if (us.length > 0 && ai < us.length) {
          setSessions((prev) => ({ ...prev, [us[ai].userId]: s }));
        }
        return us;
      });
      return ai;
    });
  }, []);

  const wsStatus = useVavaRelay(handleLiveSession);

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

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // Filter Indonesian users
  const indonesianUsers = users.filter(
    (u) => u.countryCode === "ID" || u.country.toLowerCase().includes("indonesia") || u.countryCode === ""
  );
  const baseUsers = indonesianUsers.length > 0 ? indonesianUsers : users;
  const effectiveUsers =
    activeTab === "Terdekat"
      ? baseUsers.filter((u) => u.distance !== null).concat(baseUsers.filter((u) => u.distance === null))
      : baseUsers;

  const handleConnect = useCallback(async (userId: number) => {
    if (liveSession) {
      setSessions((prev) => ({ ...prev, [userId]: liveSession }));
      setSearchingUserId(null);
      return;
    }
    setSearchingUserId(userId);
    setLoadingSession(userId);
    try {
      const res = await fetch(`${BASE}/api/vava/session`, { method: "POST" });
      const data = await res.json();
      if (data.success && data.channel && data.token) {
        setSessions((prev) => ({
          ...prev,
          [userId]: { channel: data.channel, token: data.token, uid: data.uid, peerId: data.peerId, orderNo: data.orderNo, source: "api" },
        }));
        setSearchingUserId(null);
      } else {
        // No coins / waiting - keep searching overlay, WS relay will deliver session
        const count = (retryCountRef.current[userId] ?? 0) + 1;
        retryCountRef.current[userId] = count;
        if (count > 2) {
          // Stay in searching state - WS will deliver when match arrives
          retryCountRef.current[userId] = 0;
        }
      }
    } catch {
      // Ignore error, searching overlay stays
    } finally {
      setLoadingSession(null);
    }
  }, [liveSession]);

  const handleDisconnect = useCallback((userId: number) => {
    setSessions((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setSearchingUserId(null);
    setLoadingSession(null);
    retryCountRef.current[userId] = 0;
  }, []);

  // Scroll snap navigation
  const scrollToIndex = (idx: number) => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: idx * el.clientHeight, behavior: "smooth" });
    setActiveIndex(idx);
  };

  const handleScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    if (idx !== activeIndex) setActiveIndex(idx);
  }, [activeIndex]);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4"
        style={{ background: "#0d1117" }}>
        <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-[#EE1D52] animate-spin" />
        <p className="text-white/60 text-sm">Memuat pengguna Indonesia…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-8"
        style={{ background: "#0d1117" }}>
        <WifiOff size={48} color="rgba(255,255,255,0.3)" />
        <p className="text-white/80 text-base font-semibold text-center">{errorMsg}</p>
        <button onClick={fetchUsers}
          className="px-6 py-2.5 rounded-full text-white font-bold text-sm"
          style={{ background: "#EE1D52" }}>
          Coba Lagi
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col" style={{ background: "#0d1117" }}>
      {/* Tab bar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-1 pt-14 pb-3 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
        <div className="flex items-center gap-1 pointer-events-auto"
          style={{ background: "rgba(255,255,255,0.1)", borderRadius: 20, padding: "3px 4px", backdropFilter: "blur(6px)" }}>
          {(["Semua", "Terdekat"] as const).map((tab) => (
            <button key={tab}
              className="px-4 py-1.5 rounded-2xl text-xs font-bold transition-all"
              style={{
                background: activeTab === tab ? "rgba(238,29,82,0.9)" : "transparent",
                color: "white",
              }}
              onClick={() => { setActiveTab(tab); setActiveIndex(0); scrollToIndex(0); }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Nav arrows */}
      {activeIndex > 0 && (
        <button className="absolute top-28 right-3 z-50 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)" }}
          onClick={() => scrollToIndex(activeIndex - 1)}>
          <ChevronUp size={18} color="white" />
        </button>
      )}
      {activeIndex < effectiveUsers.length - 1 && (
        <button className="absolute bottom-24 right-3 z-50 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(4px)" }}
          onClick={() => scrollToIndex(activeIndex + 1)}>
          <ChevronDown size={18} color="white" />
        </button>
      )}

      {/* User count */}
      <div className="absolute top-28 left-3 z-50 flex items-center gap-1 px-2.5 py-1 rounded-full"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}>
        <Zap size={11} color="#EE1D52" />
        <span className="text-white/80 text-[10px] font-semibold">{effectiveUsers.length} online</span>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-scroll"
        style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none" }}
        onScroll={handleScroll}
      >
        <style>{`.feed-scroll::-webkit-scrollbar{display:none}`}</style>
        {effectiveUsers.map((user, i) => {
          const session = sessions[user.userId] ?? null;
          const isLoading = loadingSession === user.userId;
          const isSearching = searchingUserId === user.userId;

          return (
            <div key={user.userId}
              className="relative w-full"
              style={{ height: "100svh", scrollSnapAlign: "start", scrollSnapStop: "always" }}>
              <VidCallCard
                user={user}
                index={i}
                isActive={i === activeIndex}
                session={session}
                sessionLoading={isLoading}
                wsStatus={wsStatus}
                onConnect={() => handleConnect(user.userId)}
                onDisconnect={() => handleDisconnect(user.userId)}
              />

              {/* Searching overlay for this card */}
              <AnimatePresence>
                {isSearching && !session && (
                  <SearchingOverlay
                    user={user}
                    onCancel={() => {
                      setSearchingUserId(null);
                      setLoadingSession(null);
                      retryCountRef.current[user.userId] = 0;
                    }}
                  />
                )}
              </AnimatePresence>

              {/* Dot indicator */}
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-20"
                style={{ display: effectiveUsers.length <= 10 ? "flex" : "none" }}>
                {effectiveUsers.slice(Math.max(0, i - 2), Math.min(effectiveUsers.length, i + 3)).map((_, di) => {
                  const realIdx = Math.max(0, i - 2) + di;
                  return (
                    <div key={realIdx}
                      className="w-1 rounded-full transition-all"
                      style={{ height: realIdx === activeIndex ? 20 : 6,
                        background: realIdx === activeIndex ? "white" : "rgba(255,255,255,0.3)" }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom nav hint */}
      <div className="absolute bottom-0 left-0 right-0 z-40 flex items-center justify-center pb-6 pt-3 pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)" }}>
        <div className="flex items-center gap-3">
          <Star size={12} color="rgba(255,255,255,0.4)" />
          <span className="text-white/40 text-[10px] font-medium">Geser untuk melihat lebih banyak</span>
          <Star size={12} color="rgba(255,255,255,0.4)" />
        </div>
      </div>
    </div>
  );
}
