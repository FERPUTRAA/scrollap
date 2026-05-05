import React, { useState, useEffect } from "react";
import { Search, RefreshCw, Radio } from "lucide-react";
import { MOCK_VIDEOS } from "../data/mock";
import VideoCard from "../components/VideoCard";

interface LiveRoom {
  id: string;
  name: string;
  viewers: number;
  game: string;
  cover: string;
  avatar: string;
  liveName: string;
  streamUrl: string;
  streamProxyUrl: string;
}

interface ApiResponse {
  success: boolean;
  rooms?: LiveRoom[];
  total?: number;
  source?: string;
  apiError?: string;
  hint?: string;
}

const GRADIENT_FALLBACKS = [
  "linear-gradient(160deg,#0f2027,#203a43,#2c5364)",
  "linear-gradient(160deg,#2d1b69,#11998e)",
  "linear-gradient(160deg,#141e30,#243b55)",
  "linear-gradient(160deg,#1f1c2c,#928dab)",
  "linear-gradient(160deg,#0f0c29,#302b63,#24243e)",
  "linear-gradient(160deg,#232526,#414345)",
  "linear-gradient(160deg,#373b44,#4286f4)",
  "linear-gradient(160deg,#1a1a2e,#16213e,#0f3460)",
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function mapRoomToVideo(room: LiveRoom, index: number) {
  const viewers = room.viewers;
  return {
    id: room.id,
    username: room.name,
    handle: room.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
    caption: room.liveName || `${room.name} sedang live!`,
    music: "Hot51 Live Stream",
    likes: formatCount(viewers),
    comments: formatCount(Math.max(0, Math.floor(viewers * 0.06))),
    shares: formatCount(Math.max(0, Math.floor(viewers * 0.02))),
    bgColor: room.cover ? undefined : GRADIENT_FALLBACKS[index % GRADIENT_FALLBACKS.length],
    coverUrl: room.cover || undefined,
    avatarUrl: room.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(room.name)}&background=EE1D52&color=fff&size=44`,
    streamUrl: room.streamUrl,
    streamProxyUrl: room.streamProxyUrl,
    viewers,
    isLive: true,
  };
}

function mapMockToVideo(v: (typeof MOCK_VIDEOS)[0]) {
  return {
    ...v,
    coverUrl: undefined as string | undefined,
    streamUrl: "",
    streamProxyUrl: "",
    viewers: 0,
    isLive: false,
    bgColor: v.bgColor,
  };
}

type FeedTab = "ForYou" | "Following";

export default function Feed() {
  const [activeTab, setActiveTab] = useState<FeedTab>("ForYou");
  const [videos, setVideos] = useState<ReturnType<typeof mapRoomToVideo>[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "demo" | "mock" | null>(null);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/live-rooms?limit=30");
      const data: ApiResponse = await res.json();

      if (data.success && data.rooms && data.rooms.length > 0) {
        setVideos(data.rooms.map(mapRoomToVideo));
        setSource((data.source as "api" | "demo") ?? "api");
      } else {
        throw new Error("No rooms");
      }
    } catch {
      setVideos(MOCK_VIDEOS.map(mapMockToVideo));
      setSource("mock");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    const iv = setInterval(fetchRooms, 60_000);
    return () => clearInterval(iv);
  }, []);

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
            data-testid="tab-following"
            onClick={() => setActiveTab("Following")}
            className={`transition-colors ${activeTab === "Following" ? "text-white" : "text-white/50"}`}
          >
            Following
          </button>
          <button
            data-testid="tab-foryou"
            onClick={() => setActiveTab("ForYou")}
            className="relative text-white"
          >
            For You
            {activeTab === "ForYou" && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-white rounded-full" />
            )}
          </button>
        </div>

        <div className="flex-1 flex items-center justify-end gap-2 pointer-events-auto">
          {/* Source badge */}
          {source === "api" && (
            <span className="flex items-center gap-1">
              <Radio size={12} color="#69C9D0" />
              <span className="text-[10px] text-[#69C9D0] font-bold">LIVE</span>
            </span>
          )}
          {source === "demo" && (
            <span className="text-[9px] text-white/40 font-medium bg-white/10 px-1.5 py-0.5 rounded-full">DEMO</span>
          )}
          <button data-testid="button-search-refresh" onClick={fetchRooms} className="p-1">
            {loading
              ? <RefreshCw size={19} color="white" className="animate-spin" />
              : <Search size={19} color="white" />
            }
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && videos.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#EE1D52 transparent transparent transparent" }} />
          <p className="text-white/50 text-sm">Memuat live rooms...</p>
        </div>
      )}

      {/* Video feed */}
      {videos.length > 0 && (
        <div
          className="h-full w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
          style={{ scrollBehavior: "smooth" }}
        >
          {videos.map((video, i) => (
            <div key={video.id} className="snap-start snap-always h-full w-full relative">
              <VideoCard video={video} index={i} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
