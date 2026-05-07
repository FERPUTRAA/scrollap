import { Router, type Request, type Response } from "express";
import { fetch as undiciFetch } from "undici";
import { createHmac } from "crypto";
import { createConnection } from "net";
import { connect as tlsConnect } from "tls";

const vavaRouter = Router();

const VAVA_BASE = "https://vbi.vervachat.com/api/v1";
const VAVA_CDN = "https://img.vervachat.com";
const AGORA_APP_ID = "2f62afc1e7df4c71957bea05f56c8cbb";

const APP_SECRET = "pp81FSAq4SNooD00gEE7DKwg";
const PACKAGE_NAME = "com.vava.chat.web";

// Account 13910632 - valid WS + visitor endpoints  
// Account 13872374 - visitor reco works too
let CREDS = {
  authToken: process.env.VAVA_AUTH_TOKEN ?? "bf34649655074f18a425669faf312c60",
  userId: process.env.VAVA_USER_ID ?? "13910632",
  deviceId: process.env.VAVA_DEVICE_ID ?? "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
  nimToken: process.env.VAVA_NIM_TOKEN ?? "015311c51ec42a632508bb1ea93fba4b",
};

// Fallback credentials (account 13872374 - works for reco endpoints)
const CREDS_FALLBACK = {
  authToken: "c2523245696c4610a13a049ca7278e05",
  userId: "13872374",
  deviceId: "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
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
    deviceCategory: "0",
    operatingPlatform: "app",
    appVersion: "1.0.0",
    randomNonce: nonce,
    requestTimestamp: ts,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.3.2 Chrome/147.0.7727.111 Mobile Safari/537.36",
    Origin: "https://web.vava.chat",
    Referer: "https://web.vava.chat/",
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

interface VavaUser {
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
  transactionId?: string;
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
  tags?: string[];
}

function normalizeUser(u: VavaUser): NormalizedUser {
  return {
    userId: u.userId,
    displayName: u.displayName || "Pengguna",
    profilePictureUrl: u.profilePicture ? `${VAVA_CDN}/${u.profilePicture}` : "",
    age: u.ageValue ?? null,
    online: u.onlineFlag ?? true,
    busy: u.busyStatusFlag ?? false,
    verified: u.verified ?? false,
    callCost: u.callCostPerUnit ?? 0,
    country: u.geoPosition?.locationNameValue ?? "",
    countryCode: u.geoPosition?.regionCode ?? "",
    countryFlagUrl: u.geoPosition?.whart ? `${VAVA_CDN}/${u.geoPosition.whart}` : "",
    language: u.userLanguage ?? "",
    distance: u.geographicalDistance ?? null,
    tags: u.tags ?? [],
  };
}

// GET /api/vava/users - fetch live online female users
vavaRouter.get("/vava/users", async (_req: Request, res: Response) => {
  try {
    const limit = 30;

    // Try multiple endpoints in parallel with both accounts
    const [visitorResult, matchResult, visitorFallbackResult] = await Promise.allSettled([
      vavaGet(`app/recommend/female/visitor?locationCode=ID&offset=0&limit=${limit}`, "", CREDS),
      vavaGet(`app/matching/recommends/visitor?locationCode=ID&offset=0&limit=${limit}`, "", CREDS),
      vavaGet(`app/recommend/female/visitor?locationCode=ID&offset=0&limit=${limit}`, "", CREDS_FALLBACK),
    ]);

    const allUsers: NormalizedUser[] = [];
    const seen = new Set<number>();

    function addUsers(result: PromiseSettledResult<unknown>) {
      if (result.status !== "fulfilled") return;
      const d = result.value as { data?: VavaUser[] | null; status?: number; failureResponse?: unknown };
      if (d?.data && Array.isArray(d.data)) {
        for (const u of d.data) {
          if (u.userId && !seen.has(u.userId) && u.genderType !== 1) {
            allUsers.push(normalizeUser(u));
            seen.add(u.userId);
          }
        }
      }
    }

    addUsers(visitorResult);
    addUsers(matchResult);
    addUsers(visitorFallbackResult);

    if (allUsers.length === 0) {
      return res.json({ success: false, error: "Tidak ada pengguna online saat ini", users: [] });
    }

    // Sort: online first, then by distance if available
    allUsers.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
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

// POST /api/vava/session - attempt to get Agora session via matching
vavaRouter.post("/vava/session", async (_req: Request, res: Response) => {
  try {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    const matchingRoundIdentifier = `${ts}_${rand}`;

    const result = (await vavaPost("client/connection", {
      appVersion: 1,
      matchingRoundIdentifier,
    })) as {
      data?: {
        channel?: string;
        authToken?: string;
        agoraToken?: string;
        nimToken?: string;
        orderNo?: string;
        userId?: number;
        peerId?: number;
        peerUserId?: number;
      };
      failureResponse?: { status: number; detailedDescription: string };
      status?: number;
    };

    if (result?.failureResponse?.status === 521) {
      return res.status(401).json({
        success: false,
        needsAuth: true,
        error: "Sesi login berakhir",
      });
    }

    const d = result?.data;
    // authToken in match response = Agora RTC token, channel = Agora channel
    if (d?.channel && (d?.authToken || d?.agoraToken)) {
      return res.json({
        success: true,
        appId: AGORA_APP_ID,
        channel: d.channel,
        token: d.authToken ?? d.agoraToken,
        uid: parseInt(CREDS.userId, 10),
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

// GET /api/vava/ws-relay - SSE relay for Vava WebSocket events (live Agora channels)
vavaRouter.get("/vava/ws-relay", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("connected", { status: "ok", timestamp: Date.now() });

  // Connect to Vava WebSocket
  let wsSocket: import("net").Socket | null = null;
  let tlsSocket: import("tls").TLSSocket | null = null;
  let closed = false;
  let buffer = Buffer.alloc(0);

  function connectWS() {
    if (closed) return;

    const rawSock = createConnection(443, "vbi.vervachat.com");
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
        send("ws_connecting", { uid: CREDS.userId });

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
              send("ws_error", { message: "WS handshake failed", header: headerStr.slice(0, 200) });
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

            if (opcode === 8) { // close
              tlsSock.destroy();
              buffer = Buffer.alloc(0);
              break;
            }

            if (opcode === 1 || opcode === 2) { // text or binary
              let payload = buffer.slice(offset + maskLen, totalLen);
              if (masked) {
                const mask = buffer.slice(offset, offset + 4);
                payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
              }
              const text = payload.toString("utf8");

              try {
                const msg = JSON.parse(text) as { event_type?: string; textContent?: string };
                const eventType = msg.event_type ?? "unknown";

                // Forward ALL events to frontend
                send("ws_message", { eventType, raw: text.slice(0, 500) });

                // Parse match events for Agora credentials
                if (
                  eventType === "MATCH_OUTCOME" ||
                  eventType === "MATCHING_RESULT" ||
                  eventType === "VIDEO_MATCH_REQUEST" ||
                  eventType === "VIDEO_CALL_ESTABLISHED" ||
                  eventType === "PRIORITY_HOST_MATCH_REQUEST"
                ) {
                  try {
                    const content = typeof msg.textContent === "string"
                      ? JSON.parse(msg.textContent)
                      : msg.textContent;
                    if (content && (content.channel || content.precaution?.channel)) {
                      const channel = content.channel ?? content.precaution?.channel;
                      const token = content.authToken ?? content.precaution?.authToken;
                      if (channel && token) {
                        send("agora_session", {
                          appId: AGORA_APP_ID,
                          channel,
                          token,
                          uid: parseInt(CREDS.userId, 10),
                          eventType,
                        });
                      }
                    }
                  } catch {}
                }
              } catch {
                // Non-JSON: "connected to server" etc.
                if (text.includes("connected to server")) {
                  send("ws_connected", { message: text });
                }
              }
            }

            buffer = buffer.slice(totalLen);
          }
        });

        // Send ping every 25s
        const pingInterval = setInterval(() => {
          if (closed || !tlsSock.writable) { clearInterval(pingInterval); return; }
          // WebSocket ping frame
          tlsSock.write(Buffer.from([0x89, 0x00]));
        }, 25_000);

        tlsSock.on("close", () => {
          clearInterval(pingInterval);
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

    wsSocket = rawSock;
  }

  connectWS();

  req.on("close", () => {
    closed = true;
    tlsSocket?.destroy();
    wsSocket?.destroy();
  });
});

export default vavaRouter;
