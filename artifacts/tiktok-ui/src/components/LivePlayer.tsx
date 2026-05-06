import React, { useEffect, useRef, useState } from "react";
import mpegts from "mpegts.js";

interface LivePlayerProps {
  streamUrl: string;
  streamProxyUrl?: string;
  anchorId?: string;
  roomId: string;
  cover?: string;
  className?: string;
}

type PlayerState = "idle" | "loading" | "playing" | "error";

function toAbsoluteUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
}

export default function LivePlayer({ streamUrl, streamProxyUrl, anchorId, roomId, cover, className = "" }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);
  const [state, setState] = useState<PlayerState>("idle");
  const [muted, setMuted] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const tryCountRef = useRef(0);
  const urlQueueRef = useRef<string[]>([]);

  useEffect(() => {
    tryCountRef.current = 0;

    const queue: string[] = [];
    if (streamUrl) queue.push(toAbsoluteUrl(streamUrl));
    if (streamProxyUrl) {
      const proxyWithAnchor = anchorId
        ? `${streamProxyUrl}${streamProxyUrl.includes("?") ? "&" : "?"}anchorId=${anchorId}`
        : streamProxyUrl;
      queue.push(toAbsoluteUrl(proxyWithAnchor));
    }
    urlQueueRef.current = queue;

    if (queue.length > 0) startPlayer(queue[0]);
    return () => destroyPlayer();
  }, [roomId, streamUrl]);

  function startPlayer(url: string) {
    destroyPlayer();
    if (!videoRef.current) return;

    if (!mpegts.getFeatureList().mseLivePlayback) {
      setState("error");
      setErrorMsg("Browser tidak mendukung MSE live playback");
      return;
    }

    setState("loading");
    setErrorMsg("");

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
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 2.0,
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
      destroyPlayer();

      tryCountRef.current += 1;
      const nextUrl = urlQueueRef.current[tryCountRef.current];
      if (nextUrl) {
        startPlayer(nextUrl);
        return;
      }

      setState("error");
      setErrorMsg(info?.msg ?? "Stream tidak dapat diputar");
    });

    player.on(mpegts.Events.MEDIA_INFO, () => {
      setState("playing");
    });

    videoRef.current.play().catch(() => {});
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
    const url = urlQueueRef.current[0];
    if (url) startPlayer(url);
  }

  return (
    <div className={`relative w-full h-full bg-black overflow-hidden ${className}`}>
      {cover && state !== "playing" && (
        <img
          src={cover}
          alt="cover"
          className="absolute inset-0 w-full h-full object-cover opacity-70"
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
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div
            className="w-9 h-9 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#EE1D52 transparent transparent transparent" }}
          />
        </div>
      )}

      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2 px-6">
          <p className="text-white/60 text-[11px] text-center leading-relaxed">{errorMsg}</p>
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
