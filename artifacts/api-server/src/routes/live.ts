import { Router, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { fetch as undiciFetch } from "undici";

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

async function curlPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 20_000,
): Promise<string> {
  const headerArgs = Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]);
  const args = [
    "-s",
    "--compressed",
    "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "--connect-timeout", "10",
    ...proxyFlag(),
    "-X", "POST",
    ...headerArgs,
    "-d", body,
    url,
  ];
  const { stdout } = await execFileAsync("curl", args, { timeout: timeoutMs + 3_000 });
  return stdout;
}

async function hotFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string; timeoutMs?: number }
): Promise<unknown> {
  let text: string;

  if (PROXY_URL) {
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
    throw new Error(`Bad JSON from Hot51: ${text.slice(0, 400)}`);
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

let cache: { ts: number; rooms: ProcessedRoom[]; total: number } | null = null;
const CACHE_TTL = 2 * 60_000;

async function fetchLiveRooms(): Promise<{ rooms: ProcessedRoom[]; total: number }> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL) return cache;

  const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v3/public/live/room-index`;
  const body = JSON.stringify({ area: "ID", gameType: 0, offset: 0, limit: 200, sortBy: "onlineCount", sortOrder: "desc" });

  const data = await hotFetch(url, { method: "POST", headers: HOT51_HEADERS, body, timeoutMs: 20_000 }) as {
    code?: number;
    data?: { records?: RoomRecord[]; total?: number } & Record<string, unknown>;
    message?: string;
  };

  if (data.code !== 200) {
    const errData = data.data as Record<string, unknown> | undefined;
    const key = errData?.localizedKey ?? data.code;
    const val = errData?.localizedValue ?? data.message ?? "unknown";
    throw new Error(`Hot51 error [${key}]: ${val}`);
  }

  const payload = data.data as { records?: RoomRecord[]; total?: number };
  const records = payload?.records ?? [];
  const rooms = records.map(mapRoom);
  const total = payload?.total ?? rooms.length;

  cache = { ts: now, rooms, total };
  return cache;
}

/** GET /api/live-rooms */
liveRouter.get("/live-rooms", async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  try {
    const { rooms, total } = await fetchLiveRooms();
    res.json({ success: true, rooms: rooms.slice(offset, offset + limit), total, source: "api" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal mengambil data";
    req.log.error({ err, proxy: PROXY_URL || "none" }, "live-rooms failed");
    res.status(502).json({ success: false, error: message, proxy: PROXY_URL ? "set" : "not set" });
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
      res.write(value);
      return pump();
    };
    await pump();
  } catch (err: unknown) {
    if (!res.headersSent) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Stream failed", streamUrl });
    }
  }
});

export default liveRouter;
