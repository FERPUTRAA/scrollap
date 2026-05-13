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
  Heart,
  Share2,
  UserPlus,
  CheckCircle,
  Globe,
  Volume2,
  VolumeX,
  Users,
  WifiOff,
  Radio,
  Zap,
  ChevronUp,
  ChevronDown,
  Eye,
  Wifi,
  LogIn,
  RefreshCw,
  Shield,
  Video,
  VideoOff,
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
  viewerCount?: number;
  isLiveHost?: boolean;
}

interface AgoraSession {
  channel: string;
  token: string | null;
  uid: number;
  peerId: number | null;
  source?: "ws" | "api" | "live_table";
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

// ─── Fetch fresh Agora token from server ──────────────────────────────────────
async function fetchServerToken(channel: string, uid: number): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/api/agora/token?channel=${encodeURIComponent(channel)}&uid=${uid}`);
    const d = await r.json() as { success: boolean; token?: string };
    return d.success && d.token ? d.token : null;
  } catch { return null; }
}

// ─── Generate random stealth UID (avoid 0 which can be traceable) ────────────
function stealthUid(): number {
  return Math.floor(Math.random() * 999_000_000) + 1_000_000;
}

// ─── Try joining Agora with multiple token strategies ─────────────────────────
async function tryJoinAgora(
  client: IAgoraRTCClient,
  appId: string,
  channel: string,
  sessionToken: string | null,
  uid: number,
): Promise<"joined" | "error"> {
  // Always use a random stealth UID so VAVA cannot track us
  const stealthId = uid > 0 ? uid : stealthUid();

  // Strategy 1: token from VAVA live session table
  const vavaToken = sessionToken && sessionToken.length > 10 ? sessionToken : null;
  // Strategy 2: fresh token from our server (needs App Certificate)
  const serverToken = await fetchServerToken(channel, stealthId);
  // Strategy 3: null (some Agora apps allow audience without token)

  const tokenCandidates: (string | null)[] = [];
  if (vavaToken) tokenCandidates.push(vavaToken);
  if (serverToken && serverToken !== vavaToken) tokenCandidates.push(serverToken);
  tokenCandidates.push(null);

  for (const tok of tokenCandidates) {
    try {
      await client.join(appId, channel, tok, stealthId);
      return "joined";
    } catch (e: unknown) {
      const msg = String(e).toLowerCase();
      // CRC/channel error = channel doesn't exist, no point retrying with other tokens
      if (msg.includes("crc") || msg.includes("channel_not_exist") || msg.includes("not exist")) return "error";
      // Token error → try next token
      try { await client.leave(); } catch {}
    }
  }
  return "error";
}

// ─── Play audio through loudspeaker via <audio> element ───────────────────────
// Agora's track.play() uses WebAudio API → earpiece on mobile.
// Routing through an HTMLAudioElement forces the media/music speaker.
function playAudioViaSpeaker(track: IRemoteAudioTrack, audioElRef: React.MutableRefObject<HTMLAudioElement | null>, muted: boolean) {
  try {
    // Stop Agora's own internal audio player so no double audio
    try { track.stop(); } catch {}

    let el = audioElRef.current;
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      // No controls, hidden element
      el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
      document.body.appendChild(el);
      audioElRef.current = el;
    }

    const rawTrack = track.getMediaStreamTrack();
    if (rawTrack) {
      el.srcObject = new MediaStream([rawTrack]);
      el.muted = muted;
      el.play().catch(() => {});
    }
  } catch {}
}

// ─── Agora viewer hook ────────────────────────────────────────────────────────
function useAgoraViewer(session: AgoraSession | null, videoEl: HTMLDivElement | null) {
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const remoteVideoRef = useRef<IRemoteVideoTrack | null>(null);
  const remoteAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const speakerElRef = useRef<HTMLAudioElement | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [remoteVideo, setRemoteVideo] = useState<IRemoteVideoTrack | null>(null);
  const [muted, setMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const pendingVideoRef = useRef<IRemoteVideoTrack | null>(null);
  const pendingAudioRef = useRef<IRemoteAudioTrack | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupSpeaker = useCallback(() => {
    if (speakerElRef.current) {
      try { speakerElRef.current.pause(); speakerElRef.current.srcObject = null; } catch {}
      try { speakerElRef.current.remove(); } catch {}
      speakerElRef.current = null;
    }
  }, []);

  const cleanup = useCallback(async () => {
    const c = clientRef.current;
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    cleanupSpeaker();
    if (!c) return;
    try { remoteVideoRef.current?.stop(); await c.leave(); } catch {}
    clientRef.current = null;
    remoteVideoRef.current = null;
    remoteAudioRef.current = null;
    setStreamState("idle");
    setRemoteVideo(null);
    setAutoplayBlocked(false);
    setRetryIn(0);
  }, [cleanupSpeaker]);

  const unblockAutoplay = useCallback(() => {
    if (!autoplayBlocked) return;
    try { pendingVideoRef.current?.play(undefined as unknown as HTMLElement); } catch {}
    if (pendingAudioRef.current) {
      playAudioViaSpeaker(pendingAudioRef.current, speakerElRef, false);
      pendingAudioRef.current = null;
    }
    if (speakerElRef.current) speakerElRef.current.muted = false;
    setAutoplayBlocked(false);
    setMuted(false);
  }, [autoplayBlocked]);

  useEffect(() => {
    if (!session || !videoEl) return;
    let cancelled = false;

    async function playVideoTrack(track: IRemoteVideoTrack) {
      try { track.play(videoEl!); } catch (e: unknown) {
        const err = e as { name?: string };
        if (err?.name === "NotAllowedError" || String(e).includes("autoplay")) {
          pendingVideoRef.current = track;
          setAutoplayBlocked(true);
        }
      }
    }

    async function subscribeExistingUsers(client: IAgoraRTCClient) {
      const users = client.remoteUsers;
      if (users.length === 0) { setStreamState("no_stream"); return; }
      let hasVideo = false;
      for (const user of users) {
        if (user.hasVideo) {
          try {
            await client.subscribe(user, "video");
            const track = user.videoTrack;
            if (track && videoEl && !cancelled) {
              await playVideoTrack(track);
              remoteVideoRef.current = track;
              setRemoteVideo(track);
              setStreamState("connected");
              hasVideo = true;
            }
          } catch {}
        }
        if (user.hasAudio) {
          try {
            await client.subscribe(user, "audio");
            if (!cancelled && user.audioTrack) {
              remoteAudioRef.current = user.audioTrack;
              try {
                playAudioViaSpeaker(user.audioTrack, speakerElRef, muted);
              } catch {
                pendingAudioRef.current = user.audioTrack;
                setAutoplayBlocked(true);
              }
            }
          } catch {}
        }
      }
      if (!hasVideo) setStreamState("no_stream");
    }

    async function join() {
      if (!session || !videoEl || cancelled) return;
      setStreamState("connecting");
      setAutoplayBlocked(false);
      setRetryIn(0);

      const client = AgoraRTC.createClient({ mode: "live", codec: "h264" });
      clientRef.current = client;
      try { await client.setClientRole("audience", { level: 2 }); } catch {
        await client.setClientRole("audience");
      }

      AgoraRTC.onAutoplayFailed = () => { setAutoplayBlocked(true); };

      client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (cancelled) return;
        try { await client.subscribe(user, mediaType); } catch { return; }
        if (mediaType === "video") {
          const track = user.videoTrack;
          if (track && videoEl && !cancelled) {
            await playVideoTrack(track);
            remoteVideoRef.current = track; setRemoteVideo(track); setStreamState("connected");
          }
        }
        if (mediaType === "audio") {
          const track = user.audioTrack;
          if (track && !cancelled) {
            remoteAudioRef.current = track;
            try {
              playAudioViaSpeaker(track, speakerElRef, muted);
            } catch {
              pendingAudioRef.current = track;
              setAutoplayBlocked(true);
            }
          }
        }
      });

      client.on("user-unpublished", (_user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
        if (mediaType === "video") { setRemoteVideo(null); setStreamState("no_stream"); }
        if (mediaType === "audio") { remoteAudioRef.current = null; cleanupSpeaker(); }
      });

      client.on("user-left", () => { if (!cancelled) setStreamState("no_stream"); });

      client.on("connection-state-change", (cur: string) => {
        if (cancelled) return;
        if (cur === "DISCONNECTED") setStreamState("no_stream");
      });

      // Try join with multiple token strategies
      const result = await tryJoinAgora(client, AGORA_APP_ID, session.channel, session.token, session.uid ?? 0);

      if (cancelled) { try { await client.leave(); } catch {} return; }

      if (result === "error") {
        // Tidak langsung error — tampilkan no_stream dan auto-retry 30 detik lagi
        setStreamState("no_stream");
        let countdown = 30;
        setRetryIn(countdown);
        const tick = setInterval(() => {
          countdown--;
          setRetryIn(countdown);
          if (countdown <= 0) clearInterval(tick);
        }, 1000);
        retryTimerRef.current = setTimeout(async () => {
          clearInterval(tick);
          if (!cancelled) {
            try { await client.leave(); } catch {}
            clientRef.current = null;
            await join();
          }
        }, 30_000);
        return;
      }

      await subscribeExistingUsers(client);
    }

    join();
    return () => {
      cancelled = true;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      cleanup();
    };
  }, [session, videoEl, cleanup]);

  const toggleMute = useCallback(() => {
    const newMuted = !muted;
    // Mute/unmute via the <audio> element (loudspeaker routing), not Agora track
    if (speakerElRef.current) {
      speakerElRef.current.muted = newMuted;
    }
    setMuted(newMuted);
  }, [muted]);

  return { streamState, remoteVideo, muted, toggleMute, cleanup, autoplayBlocked, unblockAutoplay, retryIn };
}

// ─── WS / SSE relay hook ──────────────────────────────────────────────────────
function useVavaRelay(onSession: (s: AgoraSession) => void) {
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

  useEffect(() => {
    const es = new EventSource(`${BASE}/api/vava/ws-relay`);
    setWsStatus("connecting");
    es.addEventListener("connected", () => setWsStatus("connecting"));
    es.addEventListener("ws_connecting", () => setWsStatus("connecting"));
    es.addEventListener("ws_connected", () => setWsStatus("connected"));
    es.addEventListener("ws_disconnected", () => setWsStatus("connecting"));
    es.addEventListener("ws_error", () => setWsStatus("error"));
    es.addEventListener("agora_session", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data) as { appId: string; channel: string; token: string; uid: number };
        if (d.channel && d.token) {
          onSession({ channel: d.channel, token: d.token, uid: d.uid, peerId: null, source: "ws" });
        }
      } catch {}
    });
    es.onerror = () => setWsStatus("error");
    return () => { es.close(); setWsStatus("idle"); };
  }, [onSession]);

  return wsStatus;
}

// ─── Login Modal ─────────────────────────────────────────────────────────────
interface GoogleLoginModalProps {
  onSuccess: () => void;
  onManualToken: (token: string, userId: string) => void;
}

const CONSOLE_CMD = `JSON.parse(localStorage.getItem("vb_pwa_session")).authToken`;

const GoogleLoginModal = memo(function GoogleLoginModal({ onSuccess }: GoogleLoginModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [manualUserId, setManualUserId] = useState("");
  const [copied, setCopied] = useState(false);

  const copyCmd = () => {
    navigator.clipboard.writeText(CONSOLE_CMD).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const handleSave = async () => {
    if (!manualToken.trim()) { setError("Token tidak boleh kosong"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/api/vava/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authToken: manualToken.trim(), userId: manualUserId.trim() || undefined }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) onSuccess();
      else setError("Token tidak valid, coba lagi");
    } catch {
      setError("Koneksi gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col z-50 overflow-y-auto"
      style={{ background: "linear-gradient(160deg,#0d0d1a 0%,#160028 50%,#0d1117 100%)" }}>

      <div className="flex flex-col items-center px-5 pt-12 pb-8 min-h-full">

        {/* Header */}
        <motion.div className="flex flex-col items-center mb-6"
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3"
            style={{ background: "linear-gradient(135deg,#EE1D52,#a855f7)", boxShadow: "0 0 30px rgba(238,29,82,0.45)" }}>
            <Video size={32} color="white" />
          </div>
          <h1 className="text-white text-xl font-bold mb-0.5">Hubungkan VAVA</h1>
          <p className="text-white/40 text-xs text-center">Ikuti 3 langkah di bawah ini</p>
        </motion.div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {([1, 2, 3] as const).map((s) => (
            <React.Fragment key={s}>
              <button onClick={() => s < step ? setStep(s) : undefined}
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                style={{
                  background: step >= s ? "#EE1D52" : "rgba(255,255,255,0.08)",
                  color: "white",
                  border: step === s ? "2px solid rgba(255,255,255,0.4)" : "2px solid transparent",
                }}>
                {s}
              </button>
              {s < 3 && <div className="h-px w-8" style={{ background: step > s ? "#EE1D52" : "rgba(255,255,255,0.12)" }} />}
            </React.Fragment>
          ))}
        </div>

        <motion.div className="w-full max-w-xs flex flex-col gap-3"
          key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }}>

          {/* STEP 1 */}
          {step === 1 && (
            <>
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-white font-semibold text-sm mb-2">Langkah 1 — Buka VAVA di browser</p>
                <p className="text-white/50 text-xs leading-relaxed mb-3">
                  Kamu perlu login ke situs VAVA menggunakan akun <span className="text-yellow-400 font-medium">PRIA</span> agar bisa menonton host perempuan.
                </p>
                <a href="https://web.vava.chat" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-white text-sm"
                  style={{ background: "linear-gradient(135deg,#EE1D52,#c026d3)" }}>
                  <Globe size={15} />
                  Buka web.vava.chat
                </a>
                <p className="text-white/30 text-[10px] text-center mt-2">Login pakai Google → pilih <span className="text-white/50">Laki-laki</span> saat registrasi</p>
              </div>
              <button onClick={() => setStep(2)}
                className="w-full py-3 rounded-xl font-bold text-white text-sm"
                style={{ background: "rgba(238,29,82,0.15)", border: "1px solid rgba(238,29,82,0.3)" }}>
                Sudah login → Lanjut ke Langkah 2
              </button>
            </>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <>
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-white font-semibold text-sm mb-2">Langkah 2 — Ambil token di Console</p>
                <div className="flex flex-col gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: "rgba(238,29,82,0.3)", color: "#EE1D52" }}>1</span>
                    <p className="text-white/60 text-xs">Tekan <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(255,255,255,0.1)" }}>F12</kbd> → pilih tab <strong className="text-white/80">Console</strong></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: "rgba(238,29,82,0.3)", color: "#EE1D52" }}>2</span>
                    <p className="text-white/60 text-xs">Tempel perintah di bawah, lalu tekan <kbd className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "rgba(255,255,255,0.1)" }}>Enter</kbd></p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: "rgba(238,29,82,0.3)", color: "#EE1D52" }}>3</span>
                    <p className="text-white/60 text-xs">Salin hasilnya (string panjang)</p>
                  </div>
                </div>
                <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <code className="text-yellow-400 text-[10px] break-all flex-1 leading-relaxed">{CONSOLE_CMD}</code>
                  <button onClick={copyCmd} className="flex-shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold transition-all"
                    style={{ background: copied ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)", color: copied ? "#4ade80" : "white" }}>
                    {copied ? "✓" : "Salin"}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(1)}
                  className="flex-1 py-3 rounded-xl font-semibold text-white/50 text-sm"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  ← Kembali
                </button>
                <button onClick={() => setStep(3)}
                  className="flex-[2] py-3 rounded-xl font-bold text-white text-sm"
                  style={{ background: "rgba(238,29,82,0.15)", border: "1px solid rgba(238,29,82,0.3)" }}>
                  Sudah salin → Lanjut
                </button>
              </div>
            </>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <>
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <p className="text-white font-semibold text-sm mb-2">Langkah 3 — Tempel token</p>
                <p className="text-white/50 text-xs mb-3">Tempel token yang sudah disalin dari Console:</p>
                <div className="flex flex-col gap-2">
                  <textarea
                    className="w-full px-3 py-2.5 rounded-xl text-white text-xs resize-none"
                    style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.15)", outline: "none", minHeight: 72 }}
                    placeholder="Tempel authToken di sini…"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    autoFocus
                  />
                  <input
                    className="w-full px-3 py-2.5 rounded-xl text-white text-xs"
                    style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", outline: "none" }}
                    placeholder="User ID (opsional — ambil dari .userId)"
                    value={manualUserId}
                    onChange={(e) => setManualUserId(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-xl text-red-400 text-xs text-center"
                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep(2)}
                  className="flex-1 py-3 rounded-xl font-semibold text-white/50 text-sm"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  ← Kembali
                </button>
                <button onClick={handleSave} disabled={loading || !manualToken.trim()}
                  className="flex-[2] py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2"
                  style={{ background: loading || !manualToken.trim() ? "rgba(238,29,82,0.4)" : "#EE1D52" }}>
                  {loading
                    ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Memverifikasi…</>
                    : <><LogIn size={15} /> Masuk & Tonton</>}
                </button>
              </div>
            </>
          )}

          {/* Footer note */}
          <p className="text-white/25 text-[10px] text-center leading-relaxed mt-1">
            Token hanya digunakan untuk terhubung ke VAVA · tidak disimpan permanen
          </p>
        </motion.div>
      </div>
    </div>
  );
});

// ─── Live card ────────────────────────────────────────────────────────────────
interface CardProps {
  user: VavaUser;
  index: number;
  isActive: boolean;
  session: AgoraSession | null;
  wsStatus: "idle" | "connecting" | "connected" | "error";
}

const LiveCard = memo(function LiveCard({ user, index, isActive, session, wsStatus }: CardProps) {
  const [liked, setLiked] = useState(false);
  const [showHeart, setShowHeart] = useState(false);
  const [imgError, setImgError] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoEl, setVideoEl] = useState<HTMLDivElement | null>(null);

  const activeSession = isActive ? session : null;
  const { streamState, muted, toggleMute, autoplayBlocked, unblockAutoplay, retryIn } =
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
  const isConnecting = streamState === "connecting";

  return (
    <div
      className="relative w-full h-full select-none overflow-hidden"
      style={{ background: GRADIENTS[index % GRADIENTS.length] }}
      onDoubleClick={handleDoubleTap}
    >
      {/* Background photo */}
      <img src={mainImg} alt={user.displayName}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: isStreaming ? 0.07 : 0.55, transition: "opacity 0.6s ease" }}
        onError={() => setImgError(true)} />

      {/* Agora live video container */}
      <div ref={videoContainerRef} className="absolute inset-0 w-full h-full"
        style={{ display: isStreaming ? "block" : "none", zIndex: 5 }} />

      {/* Gradient overlays */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: isStreaming
          ? "linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 50%)"
          : "rgba(0,0,0,0.28)",
        zIndex: 6, transition: "background 0.6s ease",
      }} />
      {!isStreaming && (
        <div className="absolute inset-0 pointer-events-none" style={{ backdropFilter: "blur(1px)", zIndex: 7 }} />
      )}

      {/* Ambient glows */}
      <div className="absolute top-[6%] left-[2%] w-48 h-48 rounded-full opacity-12 blur-3xl pointer-events-none" style={{ background: "#69C9D0", zIndex: 8 }} />
      <div className="absolute bottom-[22%] right-[2%] w-56 h-56 rounded-full opacity-8 blur-3xl pointer-events-none" style={{ background: "#EE1D52", zIndex: 8 }} />

      {/* Double-tap heart */}
      <AnimatePresence>
        {showHeart && (
          <motion.div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 40 }}
            initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, scale: 1.5 }} transition={{ duration: 0.4 }}>
            <Heart size={100} fill="#EE1D52" color="#EE1D52" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 pb-5 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.78) 0%, transparent 100%)", zIndex: 20 }}>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(238,29,82,0.95)", backdropFilter: "blur(6px)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          ) : session ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(250,204,21,0.25)", border: "1px solid rgba(250,204,21,0.5)", backdropFilter: "blur(6px)" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              MENGHUBUNGKAN
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[11px] font-bold"
              style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(6px)" }}>
              <Radio size={10} />
              VAVA LIVE
            </span>
          )}

          {/* Viewer count */}
          {(isStreaming || user.isLiveHost) && typeof user.viewerCount === "number" && user.viewerCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-full text-white text-[10px] font-semibold"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}>
              <Eye size={10} />
              {user.viewerCount.toLocaleString("id-ID")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {(isStreaming || session) && (
            <span className="flex items-center gap-1 text-white text-[10px] font-bold px-2 py-1 rounded-full"
              style={{
                background: "rgba(34,197,94,0.25)",
                border: "1px solid rgba(34,197,94,0.5)",
              }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              SIARAN AKTIF
            </span>
          )}
        </div>
      </div>

      {/* Connecting spinner */}
      <AnimatePresence>
        {isConnecting && (
          <motion.div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 25 }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="w-16 h-16 rounded-full border-4 border-white/20 border-t-white animate-spin" />
            <p className="text-white/80 text-sm font-medium">Bergabung ke siaran live…</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Autoplay unblock */}
      {autoplayBlocked && isActive && (
        <motion.div className="absolute inset-0 flex items-center justify-center cursor-pointer"
          style={{ zIndex: 35 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={unblockAutoplay}>
          <div className="flex flex-col items-center gap-3 px-6 py-4 rounded-2xl"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.15)" }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(238,29,82,0.9)" }}>
              <Volume2 size={28} color="white" />
            </div>
            <p className="text-white font-bold text-sm">Tap untuk Play</p>
            <p className="text-white/60 text-xs text-center">Ketuk untuk mulai menonton</p>
          </div>
        </motion.div>
      )}

      {/* Waiting for live notice */}
      {streamState === "no_stream" && !isConnecting && isActive && (
        <div className="absolute left-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ top: "50%", transform: "translateY(-50%)", background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(8px)", zIndex: 20 }}>
          <Wifi size={14} color="rgba(255,255,255,0.6)" />
          <div>
            <p className="text-white/80 text-xs font-semibold">Bergabung ke channel</p>
            <p className="text-white/50 text-[10px]">Menunggu host mulai siaran…</p>
          </div>
        </div>
      )}

      {/* Retry countdown notice (replaces permanent error) */}
      {streamState === "no_stream" && retryIn > 0 && isActive && (
        <div className="absolute left-4 right-4 flex items-center gap-2 px-3 py-2 rounded-xl"
          style={{ top: "50%", transform: "translateY(-50%)", background: "rgba(238,29,82,0.12)", border: "1px solid rgba(238,29,82,0.25)", backdropFilter: "blur(8px)", zIndex: 20 }}>
          <VideoOff size={14} color="#EE1D52" />
          <div>
            <p className="text-white/80 text-xs font-semibold">Channel tidak aktif saat ini</p>
            <p className="text-white/50 text-[10px]">Coba ulang dalam {retryIn}s…</p>
          </div>
        </div>
      )}

      {/* Profile photo panel (offline state) */}
      {!isStreaming && !isConnecting && (
        <motion.div className="absolute rounded-3xl overflow-hidden"
          style={{ top: "13%", left: "7%", right: "21%", height: "46%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(10px)", zIndex: 15 }}
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}>
          <img src={mainImg} alt={user.displayName} className="absolute inset-0 w-full h-full object-cover object-top" onError={() => setImgError(true)} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)" }} />
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
            <div className="flex items-center gap-1.5">
              <Eye size={11} color="white" />
              <span className="text-white text-xs font-semibold">{user.displayName}</span>
              {user.verified && <CheckCircle size={11} color="#69C9D0" fill="#69C9D0" />}
            </div>
            {user.countryFlagUrl && (
              <img src={user.countryFlagUrl} alt={user.country} className="w-5 h-4 rounded object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
          </div>
          <div className="absolute top-3 right-3">
            {user.online ? (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
              </span>
            ) : <span className="inline-flex h-3 w-3 rounded-full bg-gray-400" />}
          </div>
        </motion.div>
      )}

      {/* Star sign badge */}
      {user.starSign && !isStreaming && !isConnecting && (
        <div className="absolute flex items-center gap-1 px-2 py-1 rounded-xl"
          style={{ top: "13%", right: "4%", width: "16%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", zIndex: 16 }}>
          {user.astrologicalIconUrl && (
            <img src={user.astrologicalIconUrl} alt={user.starSign} className="w-5 h-5 object-contain"
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
            {muted ? <VolumeX size={28} color="rgba(255,255,255,0.7)" strokeWidth={1.5} /> : <Volume2 size={28} color="white" strokeWidth={1.5} />}
            <span className="text-white text-xs font-semibold drop-shadow">{muted ? "Unmute" : "Mute"}</span>
          </motion.button>
        )}

        <button className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Share2 size={28} color="white" strokeWidth={1.5} />
          <span className="text-white text-xs font-semibold drop-shadow">Bagikan</span>
        </button>
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
            <span className="flex items-center gap-1 text-white/80 text-xs"><Globe size={10} />{user.country}</span>
          )}
          {user.distance && <span className="text-white/60 text-xs">{user.distance}</span>}
        </div>
        {user.hobbies.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {user.hobbies.slice(0, 3).map((h) => (
              <span key={h} className="px-2 py-0.5 rounded-full text-white/80 text-[10px] font-medium"
                style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" }}>{h}</span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Users size={11} color="rgba(255,255,255,0.7)" />
          <p className="text-white/70 text-xs drop-shadow">
            {isStreaming
              ? `🔴 Sedang live${user.viewerCount ? ` · ${user.viewerCount.toLocaleString("id-ID")} penonton` : ""}`
              : session ? "📡 Bergabung ke channel siaran…"
              : user.isLiveHost ? `📹 Live sekarang${user.viewerCount ? ` · ${user.viewerCount.toLocaleString("id-ID")} penonton` : ""}`
              : user.withVideoPass ? "🎬 Tersedia di video pass"
              : user.busy ? "📹 Sedang siaran"
              : "⏳ Menunggu siaran dimulai"}
          </p>
        </div>
      </div>
    </div>
  );
});

// ─── Page ─────────────────────────────────────────────────────────────────────
type PageStatus = "loading" | "ok" | "error" | "need_auth";

export default function FaVidCall() {
  const [activeTab, setActiveTab] = useState<"Semua" | "Live">("Semua");
  const [users, setUsers] = useState<VavaUser[]>([]);
  const [status, setStatus] = useState<PageStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessions, setSessions] = useState<Record<number, AgoraSession>>({});
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(true);
  const feedRef = useRef<HTMLDivElement>(null);

  // Check auth status on mount (non-blocking — default to authenticated)
  useEffect(() => {
    fetch(`${BASE}/api/vava/status`)
      .then((r) => r.json())
      .then((d: { authenticated?: boolean }) => {
        // Only mark unauthenticated if server explicitly says so
        if (d.authenticated === false) setIsAuthenticated(false);
      })
      .catch(() => {}); // keep true on network error
  }, []);

  // Passive WS relay: when a live session arrives, assign it to the active card
  // Use stealth UID — never expose our real VAVA userId to Agora
  const handleLiveSession = useCallback((s: AgoraSession) => {
    const stealthSession = { ...s, uid: stealthUid() };
    setActiveIndex((ai) => {
      setUsers((us) => {
        if (us.length > 0 && ai < us.length) {
          setSessions((prev) => ({ ...prev, [us[ai].userId]: stealthSession }));
        }
        return us;
      });
      return ai;
    });
  }, []);

  const wsStatus = useVavaRelay(handleLiveSession);

  // Poll live sessions from VAVA live session table every 20s
  // This is STEALTH: we only READ the session table, never call the matching API
  useEffect(() => {
    let cancelled = false;

    const pollLiveSessions = async () => {
      try {
        const res = await fetch(`${BASE}/api/vava/live-sessions`);
        const data = await res.json() as {
          success: boolean;
          sessions: Array<{
            channel: string; token: string | null;
            hostUserId: number | null; hostDisplayName: string;
            hostProfilePicture: string | null; viewerCount: number;
          }>;
        };
        if (!data.success || !data.sessions.length) return;

        // Map sessions by hostUserId (stealth: never call matching API)
        const newSessions: Record<number, AgoraSession> = {};
        data.sessions.forEach((s) => {
          if (s.hostUserId && s.channel) {
            newSessions[s.hostUserId] = {
              channel: s.channel, token: s.token, uid: stealthUid(), peerId: null, source: "live_table"
            };
          }
        });

        // Merge live hosts into users list if not already present
        setUsers((us) => {
          const seenIds = new Set(us.map((u) => u.userId));
          const newHosts: VavaUser[] = data.sessions
            .filter((s) => s.hostUserId && !seenIds.has(s.hostUserId) && s.channel)
            .map((s) => ({
              userId: s.hostUserId!,
              displayName: s.hostDisplayName || "Host",
              profilePictureUrl: s.hostProfilePicture ?? "",
              age: null, online: true, busy: true, verified: false,
              callCost: 0, country: "Indonesia", countryCode: "ID",
              countryFlagUrl: "", language: "id", distance: null,
              starSign: null, astrologicalIconUrl: null, hobbies: [],
              withVideoPass: false, viewerCount: s.viewerCount, isLiveHost: true,
            }));

          // Update viewerCount for existing live hosts
          const updated = us.map((u) => {
            const live = data.sessions.find((s) => s.hostUserId === u.userId);
            if (live) return { ...u, viewerCount: live.viewerCount, isLiveHost: true, busy: true };
            return u;
          });

          if (newHosts.length > 0) {
            return [...newHosts, ...updated];
          }
          return updated;
        });

        if (Object.keys(newSessions).length > 0) {
          setSessions((prev) => ({ ...prev, ...newSessions }));
        }
      } catch {}
    };

    if (!cancelled) pollLiveSessions();
    const interval = setInterval(() => { if (!cancelled) pollLiveSessions(); }, 20_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isAuthenticated]);

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

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
    // Re-validate after login
    fetch(`${BASE}/api/vava/status`)
      .then((r) => r.json())
      .then((d: { authenticated?: boolean }) => setIsAuthenticated(d.authenticated ?? true))
      .catch(() => setIsAuthenticated(true));
  }, []);

  const handleManualToken = useCallback(async (token: string, userId: string) => {
    await fetch(`${BASE}/api/vava/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authToken: token, userId: userId || undefined }),
    });
    setIsAuthenticated(true);
  }, []);

  const indonesianUsers = users.filter(
    (u) => u.countryCode === "ID" || u.country.toLowerCase().includes("indonesia") || u.countryCode === ""
  );
  const baseUsers = indonesianUsers.length > 0 ? indonesianUsers : users;

  // Sort: live hosts with sessions first (sorted by viewer count), then busy, then others
  const sortedUsers = [...baseUsers].sort((a, b) => {
    const aHasSession = !!sessions[a.userId];
    const bHasSession = !!sessions[b.userId];
    if (aHasSession !== bHasSession) return aHasSession ? -1 : 1;
    if (a.isLiveHost !== b.isLiveHost) return a.isLiveHost ? -1 : 1;
    if (a.busy !== b.busy) return a.busy ? -1 : 1;
    // Sort by viewer count descending
    const av = a.viewerCount ?? 0, bv = b.viewerCount ?? 0;
    if (av !== bv) return bv - av;
    return 0;
  });

  const effectiveUsers =
    activeTab === "Live"
      ? sortedUsers.filter((u) => u.isLiveHost || u.busy || !!sessions[u.userId])
      : sortedUsers;

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

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ background: "#0d1117" }}>
        <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-[#EE1D52] animate-spin" />
        <p className="text-white/60 text-sm">Memuat siaran VAVA Indonesia…</p>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 px-8" style={{ background: "#0d1117" }}>
        <WifiOff size={48} color="rgba(255,255,255,0.3)" />
        <p className="text-white/80 text-base font-semibold text-center">{errorMsg}</p>
        <button onClick={fetchUsers}
          className="px-6 py-2.5 rounded-full text-white font-bold text-sm flex items-center gap-2"
          style={{ background: "#EE1D52" }}>
          <RefreshCw size={14} />
          Coba Lagi
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col" style={{ background: "#0d1117" }}>

      {/* Google Login overlay (shown when not authenticated) */}
      <AnimatePresence>
        {!isAuthenticated && (
          <motion.div className="absolute inset-0 z-[100]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GoogleLoginModal onSuccess={handleLoginSuccess} onManualToken={handleManualToken} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab bar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-center gap-1 pt-14 pb-3 pointer-events-none"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
        <div className="flex items-center gap-1 pointer-events-auto"
          style={{ background: "rgba(255,255,255,0.1)", borderRadius: 20, padding: "3px 4px", backdropFilter: "blur(6px)" }}>
          {(["Semua", "Live"] as const).map((tab) => (
            <button key={tab}
              className="px-4 py-1.5 rounded-2xl text-xs font-bold transition-all"
              style={{ background: activeTab === tab ? "rgba(238,29,82,0.9)" : "transparent", color: "white" }}
              onClick={() => { setActiveTab(tab); setActiveIndex(0); scrollToIndex(0); }}>
              {tab === "Live" ? "🔴 Sedang Live" : tab}
            </button>
          ))}
        </div>

        {/* Auth indicator */}
        {isAuthenticated && (
          <div className="absolute right-3 top-14 flex items-center gap-1 px-2 py-1 rounded-full pointer-events-auto cursor-pointer"
            style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}
            onClick={() => setIsAuthenticated(false)}>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400 text-[9px] font-bold">VAVA</span>
          </div>
        )}
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

      {/* Live count */}
      <div className="absolute top-28 left-3 z-50 flex items-center gap-1 px-2.5 py-1 rounded-full"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}>
        <Zap size={11} color="#EE1D52" />
        <span className="text-white/80 text-[10px] font-semibold">
          {activeTab === "Live"
            ? `${effectiveUsers.length} sedang live`
            : `${effectiveUsers.length} host`}
        </span>
      </div>

      {/* Feed */}
      <div ref={feedRef}
        className="flex-1 overflow-y-scroll"
        style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none" }}
        onScroll={handleScroll}>
        <style>{`.feed-scroll::-webkit-scrollbar{display:none}`}</style>
        {effectiveUsers.map((user, i) => {
          const session = sessions[user.userId] ?? null;
          return (
            <div key={user.userId} className="relative w-full"
              style={{ height: "100svh", scrollSnapAlign: "start", scrollSnapStop: "always" }}>
              <LiveCard user={user} index={i} isActive={i === activeIndex} session={session} wsStatus={wsStatus} />
              {/* Dot indicator */}
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 z-20"
                style={{ display: effectiveUsers.length <= 10 ? "flex" : "none" }}>
                {effectiveUsers.slice(Math.max(0, i - 2), Math.min(effectiveUsers.length, i + 3)).map((_, di) => {
                  const realIdx = Math.max(0, i - 2) + di;
                  return (
                    <div key={realIdx} className="w-1 rounded-full transition-all"
                      style={{ height: realIdx === activeIndex ? 20 : 6, background: realIdx === activeIndex ? "white" : "rgba(255,255,255,0.3)" }} />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom hint */}
      <div className="absolute bottom-0 left-0 right-0 z-40 flex items-center justify-center pb-6 pt-3 pointer-events-none"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)" }}>
        <p className="text-white/40 text-[10px] font-medium">Geser untuk melihat lebih banyak siaran</p>
      </div>
    </div>
  );
}
