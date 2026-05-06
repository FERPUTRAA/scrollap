import React, { useEffect, useRef, useState, useCallback } from "react";
import mpegts from "mpegts.js";
import { useZegoPlayer } from "./ZegoPlayer";

interface LivePlayerProps {
  streamUrl: string;
  anchorId?: string;
  liveId?: string;
  roomId: string;
  cover?: string;
  className?: string;
  hasAuth?: boolean;
  zegoStreamId?: string;
}

type PlayerState = "idle" | "loading" | "playing" | "error" | "blocked";
type PlayerMode = "zego" | "flv" | "none";

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LivePlayer({
  streamUrl,
  anchorId = "",
  liveId,
  roomId,
  cover,
  className = "",
  hasAuth = false,
  zegoStreamId = "",
}: LivePlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  // Callback ref so Zego hook gets the real DOM element
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoCallbackRef = useCallback((el: HTMLVideoElement | null) => setVideoEl(el), []);

  const playerRef = useRef<mpegts.Player | null>(null);
  const [state, setState] = useState<PlayerState>("idle");
  const [muted, setMuted] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [mode, setMode] = useState<PlayerMode>("none");
  // zegoActive: only true when user manually clicks "Zego RTC" button
  const [zegoActive, setZegoActive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  // Intersection observer — only play when this card is on screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.5),
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const destroyFlvPlayer = useCallback(() => {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.unload();
        playerRef.current.detachMediaElement();
        playerRef.current.destroy();
      } catch { /* ignore */ }
      playerRef.current = null;
    }
  }, []);

  const startFlv = useCallback((url: string, el: HTMLVideoElement) => {
    destroyFlvPlayer();
    try { el.srcObject = null; } catch { /* ignore */ }

    setState("loading");
    setErrorMsg("");
    setMode("flv");

    const player = mpegts.createPlayer(
      { type: "flv", url, isLive: true, cors: true },
      {
        enableWorker: true,
        lazyLoadMaxDuration: 3 * 60,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 2.0,
        liveBufferLatencyMinRemain: 0.5,
        autoCleanupSourceBuffer: true,
        fixAudioTimestampGap: true,
      }
    );

    playerRef.current = player;
    player.attachMediaElement(el);
    player.load();

    player.on(mpegts.Events.ERROR, () => {
      destroyFlvPlayer();
      setState("blocked");
      setErrorMsg(
        hasAuth
          ? "CDN Hot51 tidak dapat diakses dari server ini."
          : "Login ke Hot51 untuk mendapatkan URL stream asli."
      );
    });

    player.on(mpegts.Events.MEDIA_INFO, () => {
      setState("playing");
      setMode("flv");
    });

    el.play().catch(() => {});
  }, [destroyFlvPlayer, hasAuth]);

  const tryProxy = useCallback(async (el: HTMLVideoElement) => {
    setState("loading");
    setErrorMsg("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const qs = new URLSearchParams({ roomId });
      if (anchorId) qs.set("anchorId", anchorId);
      if (liveId) qs.set("liveId", liveId);
      const proxyUrl = `${BASE}/api/stream-proxy?${qs.toString()}`;
      const r = await fetch(proxyUrl, { signal: ctrl.signal, method: "HEAD" }).catch(() =>
        fetch(proxyUrl, { signal: ctrl.signal })
      );
      if (!ctrl.signal.aborted) {
        if (r.ok) {
          startFlv(toAbsoluteUrl(proxyUrl), el);
        } else {
          const body = await r.json().catch(() => ({})) as Record<string, unknown>;
          setState("blocked");
          setErrorMsg(String(body.error ?? `Proxy error ${r.status}`));
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setState("error");
        setErrorMsg("Koneksi ke server gagal");
      }
    }
  }, [roomId, anchorId, liveId, startFlv]);

  const startCdn = useCallback((el: HTMLVideoElement) => {
    if (streamUrl) startFlv(toAbsoluteUrl(streamUrl), el);
    else tryProxy(el);
  }, [streamUrl, startFlv, tryProxy]);

  // Zego callbacks
  const handleZegoPlaying = useCallback(() => {
    setMode("zego");
    setState("playing");
  }, []);

  const handleZegoError = useCallback((_msg: string) => {
    setZegoActive(false);
    if (videoEl) startCdn(videoEl);
  }, [videoEl, startCdn]);

  // Zego only connects when user clicks the button
  useZegoPlayer({
    roomId,
    anchorId,
    zegoStreamId,
    videoEl: zegoActive && zegoStreamId && videoEl ? videoEl : null,
    onPlaying: handleZegoPlaying,
    onError: handleZegoError,
  });

  // Start playback when card becomes visible AND video element is mounted
  useEffect(() => {
    if (!visible || !videoEl || startedRef.current) return;
    startedRef.current = true;
    startCdn(videoEl);
  }, [visible, videoEl, startCdn]);

  // Pause/resume when visibility changes
  useEffect(() => {
    if (!videoEl) return;
    if (visible) {
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
  }, [visible, videoEl]);

  // Reset when roomId changes
  useEffect(() => {
    startedRef.current = false;
    setZegoActive(false);
    setState("idle");
    setErrorMsg("");
    setMode("none");
    abortRef.current?.abort();
    destroyFlvPlayer();
    if (videoEl) try { videoEl.srcObject = null; } catch { /* ignore */ }
  }, [roomId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      destroyFlvPlayer();
    };
  }, []);

  function handleRetry() {
    setZegoActive(false);
    startedRef.current = false;
    setState("idle");
    setErrorMsg("");
    destroyFlvPlayer();
    if (videoEl) {
      try { videoEl.srcObject = null; } catch { /* ignore */ }
      startedRef.current = true;
      startCdn(videoEl);
    }
  }

  function handleTryZego() {
    destroyFlvPlayer();
    if (videoEl) try { videoEl.srcObject = null; } catch { /* ignore */ }
    setState("loading");
    setErrorMsg("");
    setZegoActive(true);
  }

  return (
    <div ref={containerRef} className={`relative w-full h-full bg-black overflow-hidden ${className}`}>
      {cover && state !== "playing" && (
        <img
          src={cover}
          alt="cover"
          className="absolute inset-0 w-full h-full object-cover opacity-70"
        />
      )}

      <video
        ref={videoCallbackRef}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${state === "playing" ? "opacity-100" : "opacity-0"}`}
        muted={muted}
        playsInline
        autoPlay
      />

      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none gap-2">
          <div
            className="w-9 h-9 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#EE1D52 transparent transparent transparent" }}
          />
          <p className="text-white/40 text-[10px]">
            {zegoActive ? "Mencoba Zego RTC…" : "Memuat stream…"}
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2 px-6">
          <p className="text-white/60 text-[11px] text-center leading-relaxed">{errorMsg}</p>
          <button
            onClick={handleRetry}
            className="px-4 py-1.5 rounded-full text-white text-xs font-bold"
            style={{ background: "#EE1D52" }}
          >
            Coba Lagi
          </button>
        </div>
      )}

      {state === "blocked" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2 px-6">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center mb-1"
            style={{ background: "rgba(238,29,82,0.2)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EE1D52" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <p className="text-white text-xs font-semibold text-center">
            {hasAuth ? "CDN Diblokir" : "Login Diperlukan"}
          </p>
          <p className="text-white/50 text-[10px] text-center leading-relaxed px-2">
            {errorMsg || (hasAuth
              ? "CDN Hot51 memblokir IP server ini."
              : "Login ke Hot51 untuk mendapatkan URL stream asli.")}
          </p>
          <div className="flex gap-2 mt-1">
            <button
              onClick={handleRetry}
              className="px-3 py-1.5 rounded-full text-white text-xs font-bold"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              CDN
            </button>
            {zegoStreamId && (
              <button
                onClick={handleTryZego}
                className="px-3 py-1.5 rounded-full text-white text-xs font-bold"
                style={{ background: "#EE1D52" }}
              >
                Zego RTC
              </button>
            )}
          </div>
        </div>
      )}

      {state === "playing" && (
        <div className="absolute top-[72px] right-3 z-20 flex flex-col gap-1.5 items-center">
          <button
            onClick={() => setMuted((m) => !m)}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
          >
            {muted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
          <span className="text-[9px] text-white/60 font-mono">
            {mode === "zego" ? "RTC" : "CDN"}
          </span>
        </div>
      )}
    </div>
  );
}
