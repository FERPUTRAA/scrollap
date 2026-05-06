import React, { useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";

interface LivePlayerProps {
  streamUrl: string;
  streamProxyUrl?: string;
  roomId: string;
  cover?: string;
  className?: string;
}

type PlayerState = "idle" | "loading" | "playing" | "error";

export default function LivePlayer({ streamUrl, streamProxyUrl, roomId, cover, className = "" }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);
  const [state, setState] = useState<PlayerState>("idle");
  const [muted, setMuted] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const tryCountRef = useRef(0);

  useEffect(() => {
    resolveStreamUrl();
    return () => destroyPlayer();
  }, [roomId]);

  async function resolveStreamUrl() {
    setState("loading");
    setErrorMsg("");

    try {
      const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${baseUrl}/api/room-info?roomId=${encodeURIComponent(roomId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.streamUrl) {
          setResolvedUrl(data.streamUrl);
          return;
        }
      }
    } catch {
    }

    setResolvedUrl(streamUrl);
  }

  useEffect(() => {
    if (!resolvedUrl) return;
    startPlayer(resolvedUrl);
  }, [resolvedUrl]);

  function startPlayer(url: string) {
    destroyPlayer();
    if (!videoRef.current) return;
    if (!mpegts.getFeatureList().mseLivePlayback) {
      setState("error");
      setErrorMsg("Browser tidak mendukung MSE live playback");
      return;
    }

    setState("loading");

    const player = mpegts.createPlayer(
      {
        type: "flv",
        url,
        isLive: true,
        cors: true,
      },
      {
        enableWorker: true,
        lazyLoadMaxDuration: 3 * 60,
        seekType: "range",
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 1.5,
        liveBufferLatencyMinRemain: 0.5,
        autoCleanupSourceBuffer: true,
        fixAudioTimestampGap: true,
      }
    );

    playerRef.current = player;
    player.attachMediaElement(videoRef.current);
    player.load();

    player.on(mpegts.Events.ERROR, (_errType: unknown, _errDetail: unknown, errInfo: unknown) => {
      const info = errInfo as { msg?: string } | null;
      const prevUrl = url;
      tryCountRef.current += 1;

      if (tryCountRef.current === 1 && streamProxyUrl && prevUrl !== streamProxyUrl) {
        destroyPlayer();
        startPlayer(streamProxyUrl);
        return;
      }

      setState("error");
      setErrorMsg(info?.msg ?? "Stream tidak tersedia");
    });

    player.on(mpegts.Events.MEDIA_INFO, () => {
      setState("playing");
    });

    videoRef.current
      .play()
      .catch(() => {});
  }

  function destroyPlayer() {
    if (playerRef.current) {
      try {
        playerRef.current.pause();
        playerRef.current.unload();
        playerRef.current.detachMediaElement();
        playerRef.current.destroy();
      } catch {
      }
      playerRef.current = null;
    }
  }

  function handleRetry() {
    tryCountRef.current = 0;
    resolveStreamUrl();
  }

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden ${className}`}>
      {cover && state !== "playing" && (
        <img
          src={cover}
          alt="cover"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
      )}

      <video
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${state === "playing" ? "opacity-100" : "opacity-0"}`}
        muted={muted}
        playsInline
        autoPlay
      />

      {state === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div
            className="w-9 h-9 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#EE1D52 transparent transparent transparent" }}
          />
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2 px-6">
          <p className="text-white/60 text-[11px] text-center leading-relaxed">{errorMsg || "Stream offline"}</p>
          <button
            onClick={handleRetry}
            className="mt-1 px-4 py-1.5 rounded-full text-white text-xs font-bold"
            style={{ background: "#EE1D52" }}
          >
            Coba Lagi
          </button>
        </div>
      )}

      {state === "playing" && (
        <button
          onClick={() => setMuted((m) => !m)}
          className="absolute top-[72px] right-3 z-20 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
        >
          {muted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
