import { Router, type Request, type Response } from "express";
import { fetch as undiciFetch } from "undici";
import { createHmac } from "crypto";
import { createConnection } from "net";
import { connect as tlsConnect } from "tls";

const vavaRouter = Router();

const VAVA_BASE = "https://vbi.vervachat.com/api/v1";
const VAVA_WEB_BASE = "https://web.vava.chat/api/v1";
const VAVA_CDN = "https://img.vervachat.com";
const AGORA_APP_ID = "2f62afc1e7df4c71957bea05f56c8cbb";

const APP_SECRET = "pp81FSAq4SNooD00gEE7DKwg";
const PACKAGE_NAME = "com.vava.chat.web";

let CREDS = {
  authToken: process.env.VAVA_AUTH_TOKEN ?? "bf34649655074f18a425669faf312c60",
  userId: process.env.VAVA_USER_ID ?? "13910632",
  deviceId: process.env.VAVA_DEVICE_ID ?? "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
  nimToken: process.env.VAVA_NIM_TOKEN ?? "015311c51ec42a632508bb1ea93fba4b",
};

const CREDS_FALLBACK = {
  authToken: "c2523245696c4610a13a049ca7278e05",
  userId: "13872374",
  deviceId: "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
  nimToken: "",
};

function flattenParams(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && v !== undefined) {
      if (typeof v === "object" && !Array.isArray(v)) {
        Object.assign(result, flattenParams(v as Record<string, unknown>, key));
      } else {
        result[key] = String(v);
      }
    }
  }
  return result;
}

function genSignature(path: string, params: Record<string, unknown> = {}, cred = CREDS): {
  accessToken: string; ts: string; nonce: string;
} {
  const ts = Date.now().toString();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const nonce = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const flat = flattenParams(params);
  const sortedParams = Object.keys(flat).sort().map((k) => `${k}=${flat[k]}`).join("&");
  const message = [PACKAGE_NAME, cred.deviceId, path, ts, nonce, sortedParams, APP_SECRET].join(":");
  const accessToken = createHmac("sha256", APP_SECRET).update(message).digest("base64");
  return { accessToken, ts, nonce };
}

function buildHeaders(path: string, params: Record<string, unknown> = {}, cred = CREDS): Record<string, string> {
  const { accessToken, ts, nonce } = genSignature(path, params, cred);
  return {
    authToken: cred.authToken,
    userId: cred.userId,
    accessToken,
    deviceId: cred.deviceId,
    packageName: PACKAGE_NAME,
    appPackageName: PACKAGE_NAME,
    channel: "vvh",
    applicationLanguage: "id",
    userLanguage: "id-ID",
    deviceCategory: "0",
    operatingPlatform: "app",
    appVersion: "1.0.0",
    randomNonce: nonce,
    requestTimestamp: ts,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.3.2 Chrome/147.0.7727.111 Mobile Safari/537.36",
    Origin: "https://web.vava.chat",
    Referer: "https://web.vava.chat/",
    "X-Requested-With": "net.onecook.browser",
  };
}

async function vavaGet(path: string, qs = "", cred = CREDS): Promise<unknown> {
  const fullPath = `/api/v1/${path}`;
  const res = await undiciFetch(`${VAVA_BASE}/${path}${qs}`, {
    method: "GET",
    headers: buildHeaders(fullPath, {}, cred),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text.slice(0, 200)}`); }
}

async function vavaPost(path: string, body: Record<string, unknown>, cred = CREDS): Promise<unknown> {
  const fullPath = `/api/v1/${path}`;
  const res = await undiciFetch(`${VAVA_BASE}/${path}`, {
    method: "POST",
    headers: buildHeaders(fullPath, body, cred),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text.slice(0, 200)}`); }
}

interface FreeUser {
  userId: number;
  displayName: string;
  profilePicture: string;
  ageValue?: number;
  genderType?: number;
  onlineFlag?: boolean;
  busyStatusFlag?: boolean;
  verified?: boolean;
  ifShowVerified?: boolean;
  callCostPerUnit?: number;
  userLanguage?: string;
  starSign?: string;
  astrologicalIcon?: string;
  withVideoPassFlag?: boolean;
  hobbyTagList?: Array<{ tagId: number; tagIdentifier: string; mediaImageRef?: string }>;
  languageTagList?: Array<{ tagId: number; tagIdentifier: string }>;
  geoPosition?: {
    regionCode?: string;
    locationNameValue?: string;
    whart?: string;
    superableSprinkleproof?: string;
  };
  geographicalDistance?: string;
  bioText?: string;
}

interface VisitorUser {
  userId: number;
  displayName: string;
  profilePicture: string;
  ageValue?: number;
  genderType?: number;
  onlineFlag?: boolean;
  busyStatusFlag?: boolean;
  verified?: boolean;
  callCostPerUnit?: number;
  userLanguage?: string;
  geoPosition?: {
    regionCode?: string;
    locationNameValue?: string;
    whart?: string;
    superableSprinkleproof?: string;
  };
  geographicalDistance?: string;
  bioText?: string;
  tags?: string[];
}

interface NormalizedUser {
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

function normalizeFreeUser(u: FreeUser): NormalizedUser {
  return {
    userId: u.userId,
    displayName: u.displayName || "Pengguna",
    profilePictureUrl: u.profilePicture ? `${VAVA_CDN}/${u.profilePicture}` : "",
    age: u.ageValue ?? null,
    online: u.onlineFlag ?? true,
    busy: u.busyStatusFlag ?? false,
    verified: (u.verified ?? u.ifShowVerified) ?? false,
    callCost: u.callCostPerUnit ?? 0,
    country: u.geoPosition?.locationNameValue ?? "Indonesia",
    countryCode: u.geoPosition?.regionCode ?? "ID",
    countryFlagUrl: u.geoPosition?.whart ? `${VAVA_CDN}/${u.geoPosition.whart}` : "",
    language: u.userLanguage ?? "id",
    distance: u.geographicalDistance ?? null,
    starSign: u.starSign ?? null,
    astrologicalIconUrl: u.astrologicalIcon ? `${VAVA_CDN}/${u.astrologicalIcon}` : null,
    hobbies: (u.hobbyTagList ?? []).map((h) => h.tagIdentifier).filter(Boolean),
    withVideoPass: u.withVideoPassFlag ?? false,
  };
}

function normalizeVisitorUser(u: VisitorUser): NormalizedUser {
  return {
    userId: u.userId,
    displayName: u.displayName || "Pengguna",
    profilePictureUrl: u.profilePicture ? `${VAVA_CDN}/${u.profilePicture}` : "",
    age: u.ageValue ?? null,
    online: u.onlineFlag ?? true,
    busy: u.busyStatusFlag ?? false,
    verified: u.verified ?? false,
    callCost: u.callCostPerUnit ?? 0,
    country: u.geoPosition?.locationNameValue ?? "Indonesia",
    countryCode: u.geoPosition?.regionCode ?? "ID",
    countryFlagUrl: u.geoPosition?.whart ? `${VAVA_CDN}/${u.geoPosition.whart}` : "",
    language: u.userLanguage ?? "id",
    distance: u.geographicalDistance ?? null,
    starSign: null,
    astrologicalIconUrl: null,
    hobbies: u.tags ?? [],
    withVideoPass: false,
  };
}

// GET /api/vava/users - fetch online Indonesian female users
vavaRouter.get("/vava/users", async (_req: Request, res: Response) => {
  try {
    const limit = 30;

    const [freeResult, visitorResult, visitorFallback] = await Promise.allSettled([
      vavaGet(`client/recommend/female/free?locationCode=ID&offset=0&limit=${limit}`),
      vavaGet(`app/recommend/female/visitor?locationCode=ID&offset=0&limit=${limit}`),
      vavaGet(`app/recommend/female/visitor?locationCode=ID&offset=0&limit=${limit}`, "", CREDS_FALLBACK),
    ]);

    const allUsers: NormalizedUser[] = [];
    const seen = new Set<number>();

    // Primary: free recommends (richest data)
    if (freeResult.status === "fulfilled") {
      const d = freeResult.value as { data?: FreeUser[] | null };
      if (Array.isArray(d?.data)) {
        for (const u of d.data) {
          if (u.userId && !seen.has(u.userId) && u.genderType !== 1) {
            const regionCode = u.geoPosition?.regionCode ?? "";
            const isIndonesia = regionCode === "ID" || regionCode === "" ||
              (u.geoPosition?.locationNameValue ?? "").toLowerCase().includes("indonesia");
            if (isIndonesia) {
              allUsers.push(normalizeFreeUser(u));
              seen.add(u.userId);
            }
          }
        }
      }
    }

    // Fallback: visitor recommends
    for (const result of [visitorResult, visitorFallback]) {
      if (result.status !== "fulfilled") continue;
      const d = result.value as { data?: VisitorUser[] | null };
      if (!Array.isArray(d?.data)) continue;
      for (const u of d.data) {
        if (u.userId && !seen.has(u.userId) && u.genderType !== 1) {
          const regionCode = u.geoPosition?.regionCode ?? "";
          const isIndonesia = regionCode === "ID" || regionCode === "" ||
            (u.geoPosition?.locationNameValue ?? "").toLowerCase().includes("indonesia");
          if (isIndonesia) {
            allUsers.push(normalizeVisitorUser(u));
            seen.add(u.userId);
          }
        }
      }
    }

    if (allUsers.length === 0) {
      return res.json({ success: false, error: "Tidak ada pengguna online saat ini", users: [] });
    }

    // Sort: online first, then non-busy, then by distance
    allUsers.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      if (a.distance && b.distance) {
        const da = parseFloat(a.distance);
        const db = parseFloat(b.distance);
        if (!isNaN(da) && !isNaN(db)) return da - db;
      }
      return 0;
    });

    return res.json({ success: true, users: allUsers, total: allUsers.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, users: [] });
  }
});

// GET /api/vava/match-recommends - users shown during match search
vavaRouter.get("/vava/match-recommends", async (_req: Request, res: Response) => {
  try {
    const result = await vavaGet("client/connection/recommends/ver");
    const d = result as { data?: Array<{ profilePicture?: string; geographicalDistance?: string }> | null };
    const users = (Array.isArray(d?.data) ? d.data : [])
      .filter((u) => u.profilePicture)
      .map((u) => ({
        profilePictureUrl: `${VAVA_CDN}/${u.profilePicture}`,
        distance: u.geographicalDistance ?? null,
      }));
    return res.json({ success: true, users });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, users: [] });
  }
});

// POST /api/vava/session - attempt to get Agora session via matching
vavaRouter.post("/vava/session", async (_req: Request, res: Response) => {
  try {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    const matchingRoundIdentifier = `${ts}_${rand}`;

    const [result1, result2] = await Promise.allSettled([
      vavaPost("client/connection", { appVersion: 1, matchingRoundIdentifier }, CREDS),
      vavaPost("client/connection", { appVersion: 1, matchingRoundIdentifier }, CREDS_FALLBACK),
    ]);

    const result = (result1.status === "fulfilled" ? result1.value : result2.status === "fulfilled" ? result2.value : null) as {
      data?: {
        channel?: string;
        authToken?: string;
        agoraToken?: string;
        orderNo?: string;
        peerId?: number;
        peerUserId?: number;
      };
      failureResponse?: { status: number; detailedDescription: string };
    };

    if (!result) {
      return res.status(502).json({ success: false, error: "Semua koneksi gagal", waiting: true });
    }

    const failStatus = result?.failureResponse?.status;
    if (failStatus === 521) {
      return res.status(401).json({ success: false, needsAuth: true, error: "Sesi login berakhir" });
    }
    if (failStatus === 545) {
      return res.status(202).json({ success: false, waiting: true, noCoins: true, error: "Koin tidak mencukupi" });
    }

    const d = result?.data;
    if (d?.channel && (d?.authToken || d?.agoraToken)) {
      return res.json({
        success: true,
        appId: AGORA_APP_ID,
        channel: d.channel,
        token: d.authToken ?? d.agoraToken,
        uid: 0,
        peerId: d.peerId ?? d.peerUserId ?? null,
        orderNo: d.orderNo ?? null,
      });
    }

    return res.status(202).json({
      success: false,
      waiting: true,
      error: "Menunggu pengguna tersedia",
      raw: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

// GET /api/vava/live - get currently live sessions table
vavaRouter.get("/vava/live", async (_req: Request, res: Response) => {
  try {
    const result = (await vavaGet("live/session/table/v2")) as {
      data?: unknown;
      status?: number;
    };
    return res.json({ success: true, data: result?.data ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

// POST /api/vava/credentials - update credentials
vavaRouter.post("/vava/credentials", (req: Request, res: Response) => {
  const { authToken, userId, deviceId, nimToken } = req.body as {
    authToken?: string;
    userId?: string;
    deviceId?: string;
    nimToken?: string;
  };
  if (authToken) CREDS.authToken = authToken;
  if (userId) CREDS.userId = userId;
  if (deviceId) CREDS.deviceId = deviceId;
  if (nimToken) CREDS.nimToken = nimToken;
  return res.json({ success: true, userId: CREDS.userId });
});

// GET /api/vava/config
vavaRouter.get("/vava/config", (_req: Request, res: Response) => {
  return res.json({
    appId: AGORA_APP_ID,
    userId: CREDS.userId,
    authenticated: true,
  });
});

// Recursively search any object for Agora credentials
function extractAgoraCredentials(obj: unknown): { channel: string; token: string } | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // Direct fields
  if (typeof o.channel === "string" && o.channel.length > 0) {
    const token = (o.authToken ?? o.token ?? o.agoraToken ?? o.chatToken) as string | undefined;
    if (typeof token === "string" && token.length > 0) {
      return { channel: o.channel, token };
    }
  }

  // Recurse into nested objects
  for (const v of Object.values(o)) {
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        const found = extractAgoraCredentials(parsed);
        if (found) return found;
      } catch {}
    } else if (typeof v === "object" && v !== null) {
      const found = extractAgoraCredentials(v);
      if (found) return found;
    }
  }

  return null;
}

// GET /api/vava/ws-relay - SSE relay for Vava WebSocket events (live Agora channels)
vavaRouter.get("/vava/ws-relay", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  send("connected", { status: "ok", timestamp: Date.now() });

  let wsSocket: import("net").Socket | null = null;
  let tlsSocket: import("tls").TLSSocket | null = null;
  let closed = false;
  let buffer = Buffer.alloc(0);

  function connectWS() {
    if (closed) return;

    const rawSock = createConnection(443, "vbi.vervachat.com");
    wsSocket = rawSock;

    rawSock.on("connect", () => {
      if (closed) { rawSock.destroy(); return; }
      const tlsSock = tlsConnect({
        socket: rawSock,
        servername: "vbi.vervachat.com",
        rejectUnauthorized: false,
      });
      tlsSocket = tlsSock;

      tlsSock.on("secureConnect", () => {
        if (closed) { tlsSock.destroy(); return; }

        const keyB = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
        const key = keyB.toString("base64");
        const path = `/ws?uid=${CREDS.userId}&token=${CREDS.authToken}&version=1`;
        const handshake = [
          `GET ${path} HTTP/1.1`,
          "Host: vbi.vervachat.com",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "Origin: https://web.vava.chat",
          "User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36",
          "",
          "",
        ].join("\r\n");

        tlsSock.write(handshake);

        let headersDone = false;

        tlsSock.on("data", (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);

          if (!headersDone) {
            const idx = buffer.indexOf("\r\n\r\n");
            if (idx < 0) return;
            const headerStr = buffer.slice(0, idx).toString();
            if (headerStr.includes("101 Switching Protocols")) {
              headersDone = true;
              buffer = buffer.slice(idx + 4);
              send("ws_connected", { uid: CREDS.userId });
            } else {
              send("ws_error", { message: "Handshake failed", header: headerStr.slice(0, 100) });
              tlsSock.destroy();
              return;
            }
          }

          // Parse WebSocket frames
          while (buffer.length >= 2) {
            const b0 = buffer[0];
            const b1 = buffer[1];
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let payloadLen = b1 & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
              if (buffer.length < 4) break;
              payloadLen = buffer.readUInt16BE(2);
              offset = 4;
            } else if (payloadLen === 127) {
              if (buffer.length < 10) break;
              payloadLen = Number(buffer.readBigUInt64BE(2));
              offset = 10;
            }

            const maskLen = masked ? 4 : 0;
            const totalLen = offset + maskLen + payloadLen;
            if (buffer.length < totalLen) break;

            if (opcode === 8) {
              tlsSock.destroy();
              buffer = Buffer.alloc(0);
              break;
            }

            if (opcode === 9) {
              // Ping -> send pong
              const pongFrame = Buffer.from([0x8a, 0x00]);
              if (tlsSock.writable) tlsSock.write(pongFrame);
            }

            if (opcode === 1 || opcode === 2) {
              let payload = buffer.slice(offset + maskLen, totalLen);
              if (masked) {
                const mask = buffer.slice(offset, offset + 4);
                payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
              }
              const text = payload.toString("utf8");

              // Forward raw message for debugging
              if (text.includes("connected to server")) {
                send("ws_connected", { message: text });
              } else {
                try {
                  const msg = JSON.parse(text) as Record<string, unknown>;
                  const eventType = (msg.event_type ?? msg.eventType ?? msg.type ?? "unknown") as string;

                  send("ws_message", { eventType, raw: text.slice(0, 300) });

                  // Try to extract Agora credentials from anywhere in the message
                  const creds = extractAgoraCredentials(msg);
                  if (creds) {
                    send("agora_session", {
                      appId: AGORA_APP_ID,
                      channel: creds.channel,
                      token: creds.token,
                      uid: parseInt(CREDS.userId, 10),
                      eventType,
                    });
                  }
                } catch {
                  // Non-JSON message
                  send("ws_raw", { text: text.slice(0, 200) });
                }
              }
            }

            buffer = buffer.slice(totalLen);
          }
        });

        // Send WebSocket ping every 20s
        const pingInterval = setInterval(() => {
          if (closed || !tlsSock.writable) { clearInterval(pingInterval); return; }
          tlsSock.write(Buffer.from([0x89, 0x00]));
        }, 20_000);

        tlsSock.on("close", () => {
          clearInterval(pingInterval);
          buffer = Buffer.alloc(0);
          if (!closed) {
            send("ws_disconnected", { message: "Reconnecting..." });
            setTimeout(connectWS, 3000);
          }
        });

        tlsSock.on("error", (e: Error) => {
          clearInterval(pingInterval);
          send("ws_error", { message: e.message });
          if (!closed) setTimeout(connectWS, 5000);
        });
      });

      tlsSock.on("error", (e: Error) => {
        send("ws_error", { message: e.message });
        if (!closed) setTimeout(connectWS, 5000);
      });
    });

    rawSock.on("error", (e: Error) => {
      send("ws_error", { message: e.message });
      if (!closed) setTimeout(connectWS, 5000);
    });
  }

  connectWS();

  req.on("close", () => {
    closed = true;
    tlsSocket?.destroy();
    wsSocket?.destroy();
  });
});

export default vavaRouter;
