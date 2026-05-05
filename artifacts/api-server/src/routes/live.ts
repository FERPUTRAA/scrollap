import { Router, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const execFileAsync = promisify(execFile);

const liveRouter = Router();

const MERCHANT_ID = process.env.HOT51_MERCHANT_ID ?? "501";
const HOT51_BASE = process.env.HOT51_API_BASE ?? "https://api.fsccdn.com";
const STREAM_BASE = process.env.HOT51_STREAM_BASE ?? "https://bcdn5.livcdn.com/live";
const STREAM_KEY = process.env.HOT51_STREAM_KEY ?? "4ad75f5e2eb06d315ea14e8484a29e1d";
const PROXY_URL = process.env.HOT51_PROXY_URL ?? "";

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
  Accept: "*/*",
  Connection: "keep-alive",
};

function buildStreamUrl(roomId: string): string {
  return `${STREAM_BASE}/${MERCHANT_ID}_${roomId}_${STREAM_KEY}.flv`;
}

function proxyFlag(): string[] {
  if (!PROXY_URL) return [];
  if (/^socks5/i.test(PROXY_URL)) return ["--socks5", PROXY_URL.replace(/^socks5:\/\//i, "")];
  if (/^socks4a/i.test(PROXY_URL)) return ["--socks4a", PROXY_URL.replace(/^socks4a:\/\//i, "")];
  if (/^socks/i.test(PROXY_URL)) return ["--socks4", PROXY_URL.replace(/^socks4:\/\//i, "").replace(/^socks:\/\//i, "")];
  return ["--proxy", PROXY_URL];
}

/**
 * Makes an HTTP POST using curl — proven to work with SOCKS4/5 proxies.
 * curl handles all TLS, HTTP/2, proxy negotiation natively.
 */
async function curlPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 14_000,
): Promise<string> {
  const headerArgs = Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
  const args = [
    "-s",
    "--compressed",
    "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "--connect-timeout", "8",
    ...proxyFlag(),
    "-X", "POST",
    ...headerArgs,
    "-d", body,
    url,
  ];
  const { stdout } = await execFileAsync("curl", args, { timeout: timeoutMs + 2_000 });
  return stdout;
}

/**
 * Unified fetch for Hot51 — uses curl (via proxy if set) or undici for direct.
 */
async function hotFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string; timeoutMs?: number }
): Promise<unknown> {
  let text: string;

  if (PROXY_URL) {
    // Always use curl when proxy is set — handles SOCKS4/5 and HTTP proxies reliably
    text = await curlPost(url, options.headers, options.body, options.timeoutMs);
  } else {
    const res = await undiciFetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
    });
    text = await res.text();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON: ${text.slice(0, 300)}`);
  }
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
}

interface ProcessedRoom {
  id: string;
  name: string;
  viewers: number;
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
    cover: r.coverUrl ?? "",
    avatar: r.anchorAvatarUrl ?? r.coverUrl ?? "",
    liveName: r.liveName ?? "",
    streamUrl: buildStreamUrl(r.id),
    streamProxyUrl: `/api/stream-proxy?roomId=${r.id}`,
  };
}

// Demo rooms shown when proxy is unavailable
const DEMO_ROOMS: ProcessedRoom[] = [
  { id: "d1", name: "Sari Cantik", viewers: 12400, cover: "https://picsum.photos/seed/hot1/400/700", avatar: "https://i.pravatar.cc/150?img=1", liveName: "Malam Minggu Bareng Sari!", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d1" },
  { id: "d2", name: "Rizky Musik", viewers: 8900, cover: "https://picsum.photos/seed/hot2/400/700", avatar: "https://i.pravatar.cc/150?img=11", liveName: "Cover Song Malam Ini 🎵", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d2" },
  { id: "d3", name: "Dewi Karaoke", viewers: 6200, cover: "https://picsum.photos/seed/hot3/400/700", avatar: "https://i.pravatar.cc/150?img=5", liveName: "Karaoke Bareng Yuk!", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d3" },
  { id: "d4", name: "Budi Ngobrol", viewers: 4100, cover: "https://picsum.photos/seed/hot4/400/700", avatar: "https://i.pravatar.cc/150?img=15", liveName: "Ngobrol santai malam minggu", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d4" },
  { id: "d5", name: "Linda Dance", viewers: 15600, cover: "https://picsum.photos/seed/hot5/400/700", avatar: "https://i.pravatar.cc/150?img=9", liveName: "Dance Challenge! Siapa ikut?", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d5" },
  { id: "d6", name: "Andi Chef", viewers: 3800, cover: "https://picsum.photos/seed/hot6/400/700", avatar: "https://i.pravatar.cc/150?img=20", liveName: "Masak Rendang Spesial 🍛", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d6" },
  { id: "d7", name: "Putri Cerpen", viewers: 2100, cover: "https://picsum.photos/seed/hot7/400/700", avatar: "https://i.pravatar.cc/150?img=3", liveName: "Baca Cerpen Bareng!", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d7" },
  { id: "d8", name: "Rama DJ", viewers: 19200, cover: "https://picsum.photos/seed/hot8/400/700", avatar: "https://i.pravatar.cc/150?img=25", liveName: "DJ Set Malam Ini 🎧 Full Bass", streamUrl: "", streamProxyUrl: "/api/stream-proxy?roomId=d8" },
];

let cache: { ts: number; rooms: ProcessedRoom[]; total: number; source: "api" | "demo" } | null = null;
const CACHE_TTL = 2 * 60_000; // 2 minutes — reduces proxy hammering

async function fetchLiveRooms(): Promise<{ rooms: ProcessedRoom[]; total: number; source: "api" | "demo" }> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL) return cache;

  const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v3/public/live/room-index`;
  const body = JSON.stringify({ area: "ID", gameType: 0, offset: 0, limit: 200, sortBy: "onlineCount", sortOrder: "desc" });

  try {
    const data = await hotFetch(url, { method: "POST", headers: HOT51_HEADERS, body }) as {
      code?: number;
      data?: { records?: RoomRecord[]; total?: number } & Record<string, unknown>;
      message?: string;
    };

    if (data.code !== 200) {
      const errData = data.data as Record<string, unknown> | undefined;
      const key = errData?.localizedKey ?? data.code;
      const val = errData?.localizedValue ?? data.message ?? "unknown";
      throw new Error(`Hot51 [${key}]: ${val}`);
    }

    const payload = data.data as { records?: RoomRecord[]; total?: number };
    // Only exclude rooms where gameName is explicitly a non-empty string
    const records = (payload?.records ?? []).filter(
      (r) => !r.gameName || r.gameName.trim() === ""
    );
    const rooms = records.map(mapRoom);
    const total = payload?.total ?? rooms.length;

    cache = { ts: now, rooms, total, source: "api" };
    return cache;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fall back to demo data so UI stays functional
    cache = { ts: now, rooms: DEMO_ROOMS, total: DEMO_ROOMS.length, source: "demo" };
    throw Object.assign(new Error(msg), { usedDemo: true });
  }
}

/** GET /api/live-rooms */
liveRouter.get("/live-rooms", async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  try {
    const { rooms, total, source } = await fetchLiveRooms();
    res.json({ success: true, rooms: rooms.slice(offset, offset + limit), total, source });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    req.log.warn({ proxy: PROXY_URL || "none" }, "live-rooms API failed, serving demo");
    // Always return demo data so UI is never blank
    res.json({
      success: true,
      rooms: DEMO_ROOMS.slice(offset, offset + limit),
      total: DEMO_ROOMS.length,
      source: "demo",
      apiError: message,
    });
  }
});

/** GET /api/room-info?roomId=xxx */
liveRouter.get("/room-info", async (req: Request, res: Response) => {
  const roomId = String(req.query.roomId ?? "");
  if (!roomId) { res.status(400).json({ success: false, error: "Missing ?roomId" }); return; }

  try {
    const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v3/public/live/into-room`;
    const data = await hotFetch(url, {
      method: "POST",
      headers: { ...HOT51_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: `roomId=${encodeURIComponent(roomId)}&liveId=${encodeURIComponent(roomId)}`,
    }) as Record<string, unknown>;

    const STREAM_FIELDS = ["pullAddr", "pullUrl", "pullFlvUrl", "flvUrl", "playUrl", "streamUrl", "rtmpUrl"];
    let foundStream: string | null = null;
    const scan = (obj: unknown, depth = 0): void => {
      if (!obj || typeof obj !== "object" || depth > 6) return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (STREAM_FIELDS.includes(k) && typeof v === "string" && v.startsWith("http")) foundStream = v;
        if (v && typeof v === "object") scan(v, depth + 1);
      }
    };
    scan(data);

    res.json({ success: true, roomId, streamUrl: foundStream ?? buildStreamUrl(roomId), raw: data });
  } catch (err: unknown) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : "Failed", streamPattern: buildStreamUrl(roomId) });
  }
});

/** GET /api/stream-proxy?roomId=xxx */
liveRouter.get("/stream-proxy", async (req: Request, res: Response) => {
  const roomId = String(req.query.roomId ?? "");
  if (!roomId) { res.status(400).json({ error: "Missing ?roomId" }); return; }

  const streamUrl = buildStreamUrl(roomId);
  req.log.info({ roomId, streamUrl }, "stream-proxy");

  try {
    const upstream = await undiciFetch(streamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Mobile Safari/537.36",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Referer: "https://hot51.com",
      },
      signal: AbortSignal.timeout(5_000),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).json({ error: `CDN HTTP ${upstream.status}`, streamUrl });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "video/x-flv");
    res.setHeader("Cache-Control", "no-store");

    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (err: unknown) {
    if (!res.headersSent) res.status(502).json({ error: err instanceof Error ? err.message : "Stream unavailable", streamUrl });
  }
});

export default liveRouter;
