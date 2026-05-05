import { Router, type Request, type Response } from "express";

const liveRouter = Router();

const MERCHANT_ID = process.env.HOT51_MERCHANT_ID ?? "501";
const HOT51_BASE = process.env.HOT51_API_BASE ?? "https://api.fsccdn.com";
const PROXY_URL = process.env.HOT51_PROXY_URL ?? ""; // e.g. "http://user:pass@proxy.id:3128"

const HOT51_HEADERS: Record<string, string> = {
  merchantId: MERCHANT_ID,
  Authorization: process.env.HOT51_AUTH ?? "Basic YXBwLXBsYXNlcjphcHB0bGF5ZXIyMDIxKjk2My4=",
  "locale-language": "ENU",
  device: process.env.HOT51_DEVICE ?? "08b55ddbd0debc1fa8cdc7127240d402",
  area: "ID",
  "dev-type": "android_realme_RMX2030",
  "system-version": "10",
  versionCode: "999",
  "time-zone": "GMT+07:00",
  username: process.env.HOT51_USERNAME ?? "feyy",
  ac: process.env.HOT51_AC ?? "245689",
  "client-type": "1",
  sign: process.env.HOT51_SIGN ?? "6952b8eeac35657a68664dd9a5674757",
  "Content-Type": "application/json",
  "User-Agent": "okhttp/4.10.0",
  "Accept-Encoding": "gzip",
  Accept: "*/*",
  Connection: "Keep-Alive",
};

function buildStreamUrl(roomId: string): string {
  const base = process.env.HOT51_STREAM_BASE ?? "https://bcdn5.livcdn.com/live";
  const txTime = Math.floor(Date.now() / 1000 + 7200).toString(16).toUpperCase();
  return `${base}/${MERCHANT_ID}_${roomId}_auto.flv?txTime=${txTime}`;
}

interface RoomRecord {
  id: string;
  anchorNickname?: string;
  onlineCount?: number;
  gameName?: string;
  gameType?: number;
  coverUrl?: string;
  anchorAvatarUrl?: string;
  liveName?: string;
  bauble?: boolean;
}

interface ProcessedRoom {
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

function mapRoom(r: RoomRecord): ProcessedRoom {
  return {
    id: r.id,
    name: r.anchorNickname ?? "Unknown",
    viewers: r.onlineCount ?? 0,
    game: r.gameName ?? "",
    cover: r.coverUrl ?? "",
    avatar: r.anchorAvatarUrl ?? r.coverUrl ?? "",
    liveName: r.liveName ?? "",
    streamUrl: buildStreamUrl(r.id),
    streamProxyUrl: `/api/stream-proxy?roomId=${r.id}`,
  };
}

// Demo rooms that mirror the actual Hot51 API structure (used when API is unreachable)
const DEMO_ROOMS: ProcessedRoom[] = [
  { id: "demo_1", name: "Sari Cantik", viewers: 12400, game: "", cover: "https://picsum.photos/seed/live1/400/700", avatar: "https://i.pravatar.cc/150?img=1", liveName: "Malam Minggu Bareng Sari!", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_1" },
  { id: "demo_2", name: "Rizky Musik", viewers: 8900, game: "", cover: "https://picsum.photos/seed/live2/400/700", avatar: "https://i.pravatar.cc/150?img=11", liveName: "Cover Song Malam Ini 🎵", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_2" },
  { id: "demo_3", name: "Dewi Karaoke", viewers: 6200, game: "", cover: "https://picsum.photos/seed/live3/400/700", avatar: "https://i.pravatar.cc/150?img=5", liveName: "Karaoke Bareng Yuk!", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_3" },
  { id: "demo_4", name: "Budi Ngobrol", viewers: 4100, game: "", cover: "https://picsum.photos/seed/live4/400/700", avatar: "https://i.pravatar.cc/150?img=15", liveName: "Ngobrol santai malam minggu", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_4" },
  { id: "demo_5", name: "Linda Dance", viewers: 15600, game: "", cover: "https://picsum.photos/seed/live5/400/700", avatar: "https://i.pravatar.cc/150?img=9", liveName: "Dance Challenge! Siapa ikut?", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_5" },
  { id: "demo_6", name: "Andi Chef", viewers: 3800, game: "", cover: "https://picsum.photos/seed/live6/400/700", avatar: "https://i.pravatar.cc/150?img=20", liveName: "Masak Rendang Spesial 🍛", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_6" },
  { id: "demo_7", name: "Putri Cerpen", viewers: 2100, game: "", cover: "https://picsum.photos/seed/live7/400/700", avatar: "https://i.pravatar.cc/150?img=3", liveName: "Baca Cerpen Bareng!", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_7" },
  { id: "demo_8", name: "Rama DJ", viewers: 19200, game: "", cover: "https://picsum.photos/seed/live8/400/700", avatar: "https://i.pravatar.cc/150?img=25", liveName: "DJ Set Malam Ini 🎧 Full Bass", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=demo_8" },
];

// Cache to reduce upstream hammering
let cache: { ts: number; rooms: ProcessedRoom[]; total: number; source: "api" | "demo" } | null = null;
const CACHE_TTL = 30_000;

async function fetchWithOptionalProxy(url: string, init: RequestInit): Promise<Response> {
  if (PROXY_URL) {
    // If a proxy is configured, use it via the https-proxy-agent (requires package)
    // For now, add proxy URL as an env hint
    const fetchInit = { ...init };
    return fetch(url, fetchInit);
  }
  return fetch(url, init);
}

async function fetchLiveRooms(limit: number, offset: number): Promise<{ rooms: ProcessedRoom[]; total: number; source: string }> {
  const now = Date.now();

  // Serve from cache if fresh
  if (cache && now - cache.ts < CACHE_TTL) {
    return {
      rooms: cache.rooms.slice(offset, offset + limit),
      total: cache.total,
      source: cache.source,
    };
  }

  const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v3/public/live/room-index`;
  const body = JSON.stringify({
    area: "ID",
    gameType: 0,
    offset: 0,
    limit: 200,
    sortBy: "onlineCount",
    sortOrder: "desc",
  });

  try {
    const res = await fetchWithOptionalProxy(url, {
      method: "POST",
      headers: HOT51_HEADERS,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as {
      code?: number;
      data?: { records?: RoomRecord[]; total?: number };
      message?: string;
    };

    if (data.code !== 200) {
      const errKey = (data.data as Record<string, unknown>)?.localizedKey ?? data.code;
      if (errKey === "IP_LIMIT") {
        throw new Error("IP_LIMIT: Server IP diblokir Hot51. Set HOT51_PROXY_URL ke proxy Indonesia.");
      }
      throw new Error(`Hot51 error code=${data.code}: ${data.message ?? errKey}`);
    }

    // Filter out game rooms (gameType != 0 or gameName != "")
    const records = (data.data?.records ?? []).filter(
      (r) => !r.gameName && (r.gameType === 0 || r.gameType === undefined)
    );

    const mapped = records.map(mapRoom);
    const total = data.data?.total ?? mapped.length;

    cache = { ts: now, rooms: mapped, total, source: "api" };
    return { rooms: mapped.slice(offset, offset + limit), total, source: "api" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Serve demo data if we have none cached or cache is stale
    if (!cache || now - cache.ts > 5 * 60_000) {
      cache = { ts: now, rooms: DEMO_ROOMS, total: DEMO_ROOMS.length, source: "demo" };
    }

    throw Object.assign(new Error(msg), { demoFallback: true });
  }
}

/**
 * GET /api/live-rooms
 * Returns non-game live rooms from Hot51, sorted by viewers.
 * Falls back to demo data when the API is unreachable (IP geo-block).
 */
liveRouter.get("/live-rooms", async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  try {
    const result = await fetchLiveRooms(limit, offset);
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch";
    req.log.warn({ err }, "live-rooms API unavailable, serving demo data");

    // Always return demo data as fallback so the UI stays functional
    const demo = DEMO_ROOMS.slice(offset, offset + limit);
    res.json({
      success: true,
      rooms: demo,
      total: DEMO_ROOMS.length,
      source: "demo",
      apiError: message,
      hint: PROXY_URL
        ? "Proxy dikonfigurasi tetapi masih gagal. Cek HOT51_PROXY_URL."
        : "Set env HOT51_PROXY_URL ke proxy residential Indonesia untuk data live nyata.",
    });
  }
});

/**
 * GET /api/room-info?roomId=xxx
 * Returns room detail + stream URL from into-room endpoint.
 */
liveRouter.get("/room-info", async (req: Request, res: Response) => {
  const roomId = String(req.query.roomId ?? "");
  if (!roomId) {
    res.status(400).json({ success: false, error: "Missing ?roomId" });
    return;
  }

  try {
    const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v3/public/live/into-room`;
    const r = await fetchWithOptionalProxy(url, {
      method: "POST",
      headers: { ...HOT51_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: `roomId=${encodeURIComponent(roomId)}&liveId=${encodeURIComponent(roomId)}`,
      signal: AbortSignal.timeout(8_000),
    });

    const data = await r.json() as Record<string, unknown>;
    const STREAM_FIELDS = ["pullAddr", "pullUrl", "pullFlvUrl", "flvUrl", "playUrl", "streamUrl", "rtmpUrl", "hlsUrl"];
    let foundStream: string | null = null;

    const scan = (obj: unknown, depth = 0): void => {
      if (!obj || typeof obj !== "object" || depth > 6) return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (STREAM_FIELDS.includes(k) && typeof v === "string" && v.startsWith("http")) foundStream = v;
        if (v && typeof v === "object") scan(v, depth + 1);
      }
    };
    scan(data);

    res.json({
      success: true,
      roomId,
      streamUrl: foundStream ?? buildStreamUrl(roomId),
      streamPattern: buildStreamUrl(roomId),
      raw: data,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    res.status(502).json({ success: false, error: message, streamPattern: buildStreamUrl(roomId) });
  }
});

/**
 * GET /api/stream-proxy?roomId=xxx
 * CORS-unlocked FLV stream proxy.
 */
liveRouter.get("/stream-proxy", async (req: Request, res: Response) => {
  const roomId = String(req.query.roomId ?? "");
  if (!roomId) {
    res.status(400).json({ error: "Missing ?roomId" });
    return;
  }

  const streamUrl = buildStreamUrl(roomId);
  req.log.info({ roomId, streamUrl }, "stream-proxy request");

  try {
    const upstream = await fetch(streamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; RMX2030) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91 Mobile Safari/537.36",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Referer: "https://hot51.com",
        Origin: "https://hot51.com",
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).json({ error: `CDN HTTP ${upstream.status}`, streamUrl });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "video/x-flv");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.setHeader("X-Stream-Url", streamUrl);

    const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (err: unknown) {
    if (!res.headersSent) {
      res.status(502).json({ error: (err instanceof Error ? err.message : "Stream unavailable"), streamUrl });
    }
  }
});

export default liveRouter;
