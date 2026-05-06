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

const APP_HEADERS: Record<string, string> = {
  merchantId: MERCHANT_ID,
  Authorization: process.env.HOT51_AUTH ?? "Basic YXBwLXBsYXNlcjphcHB0bGF5ZXIyMDIxKjk2My4=",
  "locale-language": "ENU",
  device: process.env.HOT51_DEVICE ?? "08b55ddbd0debc1fa8cdc7127240d402",
  area: "ID",
  "dev-type": "android_realme_RMX2030",
  "system-version": "10",
  versionCode: "999",
  "time-zone": "GMT+07:00",
  "client-type": "1",
  "Content-Type": "application/json",
  "User-Agent": "okhttp/4.10.0",
  Accept: "*/*",
  Connection: "keep-alive",
};

interface Session {
  ac: string;
  sign: string;
  username: string;
  phone?: string;
}

let session: Session | null = null;

if (process.env.HOT51_AC && process.env.HOT51_SIGN) {
  session = {
    ac: process.env.HOT51_AC,
    sign: process.env.HOT51_SIGN,
    username: process.env.HOT51_USERNAME ?? "",
  };
}

function getUserHeaders(): Record<string, string> {
  if (!session) return APP_HEADERS;
  return {
    ...APP_HEADERS,
    username: session.username,
    ac: session.ac,
    sign: session.sign,
  };
}

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
    "-s", "--compressed",
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
  options: { method: string; headers: Record<string, string>; body?: string; timeoutMs?: number }
): Promise<unknown> {
  let text: string;
  if (PROXY_URL && options.method === "POST") {
    text = await curlPost(url, options.headers, options.body ?? "{}", options.timeoutMs);
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
    throw new Error(`Bad JSON: ${text.slice(0, 400)}`);
  }
}

interface RoomRecord {
  id: string;
  anchorId?: string;
  anchorNickname?: string;
  onlineCount?: number;
  gameName?: string;
  gameType?: number;
  coverUrl?: string;
  anchorAvatarUrl?: string;
  liveName?: string;
  area?: string;
}

interface ProcessedRoom {
  id: string;
  anchorId: string;
  name: string;
  viewers: number;
  cover: string;
  avatar: string;
  liveName: string;
  streamUrl: string;
  streamProxyUrl: string;
  hasAuth: boolean;
}

function mapRoom(r: RoomRecord): ProcessedRoom {
  return {
    id: r.id,
    anchorId: r.anchorId ?? "",
    name: r.anchorNickname ?? "Unknown",
    viewers: r.onlineCount ?? 0,
    cover: r.coverUrl ?? "",
    avatar: r.anchorAvatarUrl ?? r.coverUrl ?? "",
    liveName: r.liveName ?? "",
    streamUrl: buildStreamUrl(r.id),
    streamProxyUrl: `/api/stream-proxy?roomId=${r.id}`,
    hasAuth: !!session,
  };
}

let cache: { ts: number; rooms: ProcessedRoom[]; total: number } | null = null;
const CACHE_TTL = 2 * 60_000;

async function fetchLiveRooms(): Promise<{ rooms: ProcessedRoom[]; total: number }> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL) return cache;

  const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v4/public/live/lrl`;

  const data = await hotFetch(url, {
    method: "GET",
    headers: { ...APP_HEADERS, area: "ID" },
    timeoutMs: 20_000,
  }) as {
    records?: RoomRecord[];
    total?: number;
    size?: number;
  };

  const records = data?.records ?? [];

  if (records.length === 0) {
    const fallbackUrl = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/v3/public/live/room-index`;
    const fallbackBody = JSON.stringify({ area: "ID", gameType: 0, offset: 0, limit: 200, sortBy: "onlineCount", sortOrder: "desc" });
    const fallbackData = await hotFetch(fallbackUrl, {
      method: "POST",
      headers: APP_HEADERS,
      body: fallbackBody,
      timeoutMs: 20_000,
    }) as { code?: number; data?: { records?: RoomRecord[]; total?: number } };

    if (fallbackData.code !== 200) {
      const errData = fallbackData.data as Record<string, unknown> | undefined;
      throw new Error(`Hot51 error: ${errData?.localizedValue ?? fallbackData.code}`);
    }
    const fbRooms = (fallbackData.data?.records ?? []).map(mapRoom);
    cache = { ts: now, rooms: fbRooms, total: fallbackData.data?.total ?? fbRooms.length };
    return cache;
  }

  const rooms = records.map(mapRoom);
  const total = data.total ?? rooms.length;
  cache = { ts: now, rooms, total };
  return cache;
}

async function getRealStreamUrl(roomId: string, anchorId: string): Promise<string | null> {
  if (!session) return null;

  try {
    const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/zbliv/v3/public/live/room-info`;
    const data = await hotFetch(url, {
      method: "POST",
      headers: { ...getUserHeaders() },
      body: JSON.stringify({ anchorId, liveId: roomId }),
      timeoutMs: 10_000,
    }) as Record<string, unknown>;

    if (data.errorCode) return null;

    const STREAM_FIELDS = ["pullAddr", "pullAddress", "pullUrl", "pullFlvUrl", "flvUrl", "playUrl", "streamUrl", "rtmpUrl"];
    let foundStream: string | null = null;
    const scan = (obj: unknown, depth = 0): void => {
      if (!obj || typeof obj !== "object" || depth > 6) return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (STREAM_FIELDS.some(f => k.toLowerCase().includes(f.toLowerCase())) && typeof v === "string" && v.startsWith("http")) {
          foundStream = v;
        }
        if (v && typeof v === "object") scan(v, depth + 1);
      }
    };
    scan(data);
    return foundStream;
  } catch {
    return null;
  }
}

/** GET /api/live-rooms */
liveRouter.get("/live-rooms", async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "30"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  try {
    const { rooms, total } = await fetchLiveRooms();
    const sliced = rooms.slice(offset, offset + limit).map(r => ({
      ...r,
      hasAuth: !!session,
    }));
    res.json({ success: true, rooms: sliced, total, source: "api", hasAuth: !!session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal mengambil data";
    req.log.error({ err, proxy: PROXY_URL || "none" }, "live-rooms failed");
    res.status(502).json({ success: false, error: message, proxy: PROXY_URL ? "set" : "not set" });
  }
});

/** GET /api/room-info?roomId=xxx&anchorId=xxx */
liveRouter.get("/room-info", async (req: Request, res: Response) => {
  const roomId = String(req.query.roomId ?? "");
  const anchorId = String(req.query.anchorId ?? "");
  if (!roomId) { res.status(400).json({ success: false, error: "Missing ?roomId" }); return; }

  const realUrl = await getRealStreamUrl(roomId, anchorId);

  res.json({
    success: true,
    roomId,
    streamUrl: realUrl ?? buildStreamUrl(roomId),
    hasAuth: !!session,
    fromApi: !!realUrl,
  });
});

/** POST /api/send-otp - send OTP to phone */
liveRouter.post("/send-otp", async (req: Request, res: Response) => {
  const { phone, phoneRegion = "ID", phoneRegionCode = "+62" } = req.body as {
    phone?: string;
    phoneRegion?: string;
    phoneRegionCode?: string;
  };

  if (!phone) { res.status(400).json({ success: false, error: "Phone required" }); return; }

  try {
    const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/grcen/verify-code/v1/centralized/phone`;
    const body = JSON.stringify({
      phone: phone.replace(/^0/, `${phoneRegionCode.replace("+", "")}`),
      phoneRegion,
      phoneRegionCode,
      loginType: 1,
    });

    const data = await hotFetch(url, {
      method: "POST",
      headers: APP_HEADERS,
      body,
      timeoutMs: 15_000,
    }) as Record<string, unknown>;

    if (data.errorCode || data.code === 401) {
      const body2 = JSON.stringify({ phone, phoneRegion, phoneRegionCode, type: "login" });
      const data2 = await hotFetch(url, {
        method: "POST",
        headers: APP_HEADERS,
        body: body2,
        timeoutMs: 15_000,
      }) as Record<string, unknown>;
      if (data2.errorCode && data2.errorCode !== "200") {
        res.json({ success: false, error: String(data2.localizedValue ?? data2.errorCode ?? "Failed to send OTP"), raw: data2 });
        return;
      }
      res.json({ success: true, message: "OTP sent" });
      return;
    }

    res.json({ success: true, message: "OTP sent" });
  } catch (err: unknown) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : "Failed" });
  }
});

/** POST /api/verify-otp - verify OTP and store session */
liveRouter.post("/verify-otp", async (req: Request, res: Response) => {
  const { phone, verifyCode, phoneRegion = "ID", phoneRegionCode = "+62" } = req.body as {
    phone?: string;
    verifyCode?: string;
    phoneRegion?: string;
    phoneRegionCode?: string;
  };

  if (!phone || !verifyCode) {
    res.status(400).json({ success: false, error: "Phone and verifyCode required" });
    return;
  }

  try {
    const url = `${HOT51_BASE}/${MERCHANT_ID}/api/plr/grcen/verify-code/verify/phone`;
    const data = await hotFetch(url, {
      method: "POST",
      headers: APP_HEADERS,
      body: JSON.stringify({ phone, phoneRegion, phoneRegionCode, verifyCode, loginType: 1 }),
      timeoutMs: 15_000,
    }) as Record<string, unknown>;

    if (data.errorCode && data.errorCode !== "200") {
      res.json({ success: false, error: String(data.localizedValue ?? data.errorCode), raw: data });
      return;
    }

    const d = data.data as Record<string, unknown> | undefined ?? data;
    const ac = String(d.ac ?? d.id ?? d.userId ?? "");
    const sign = String(d.sign ?? d.token ?? d.sessionToken ?? "");
    const username = String(d.username ?? d.nickname ?? d.phone ?? phone);

    if (!ac || !sign) {
      res.json({ success: false, error: "No session in response", raw: data });
      return;
    }

    session = { ac, sign, username, phone };
    cache = null;

    res.json({ success: true, username, message: "Login berhasil" });
  } catch (err: unknown) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : "Failed" });
  }
});

/** POST /api/set-credentials - manually set ac/sign */
liveRouter.post("/set-credentials", (req: Request, res: Response) => {
  const { ac, sign, username = "" } = req.body as { ac?: string; sign?: string; username?: string };
  if (!ac || !sign) {
    res.status(400).json({ success: false, error: "ac and sign required" });
    return;
  }
  session = { ac, sign, username };
  cache = null;
  res.json({ success: true, message: "Credentials set" });
});

/** GET /api/session-status */
liveRouter.get("/session-status", (_req: Request, res: Response) => {
  res.json({ loggedIn: !!session, username: session?.username ?? null });
});

/** POST /api/logout */
liveRouter.post("/logout", (_req: Request, res: Response) => {
  session = null;
  cache = null;
  res.json({ success: true });
});

/** GET /api/stream-proxy?roomId=xxx&anchorId=xxx */
liveRouter.get("/stream-proxy", async (req: Request, res: Response) => {
  const roomId = String(req.query.roomId ?? "");
  const anchorId = String(req.query.anchorId ?? "");
  if (!roomId) { res.status(400).json({ error: "Missing ?roomId" }); return; }

  let streamUrl = buildStreamUrl(roomId);

  if (session && anchorId) {
    const realUrl = await getRealStreamUrl(roomId, anchorId);
    if (realUrl) streamUrl = realUrl;
  }

  req.log.info({ roomId, streamUrl }, "stream-proxy");

  try {
    const upstream = await undiciFetch(streamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Mobile Safari/537.36",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Referer: "https://hot51.com",
        Origin: "https://hot51.com",
      },
      signal: AbortSignal.timeout(8_000),
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
