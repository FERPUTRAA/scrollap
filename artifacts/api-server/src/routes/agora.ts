import { Router, type Request, type Response } from "express";
import { fetch as undiciFetch } from "undici";
import { createHmac, createHash } from "crypto";

const agoraRouter = Router();

const AGORA_APP_ID = process.env.AGORA_APP_ID ?? "2f62afc1e7df4c71957bea05f56c8cbb";
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? "";
const AGORA_CUSTOMER_ID = process.env.AGORA_CUSTOMER_ID ?? "";
const AGORA_CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET ?? "";

// ─── Agora Token V2 Builder (AccessToken2 / "007" prefix) ─────────────────────
function packUInt16LE(v: number): Buffer {
  const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b;
}
function packUInt32LE(v: number): Buffer {
  const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b;
}
function packBytes(buf: Buffer): Buffer {
  return Buffer.concat([packUInt16LE(buf.length), buf]);
}
function packString(s: string): Buffer {
  return packBytes(Buffer.from(s, "utf8"));
}

function buildAgoraTokenV2(
  appId: string,
  appCertificate: string,
  channelName: string,
  uid: number | string,
  tokenExpirySec = 86400,
): string {
  const uidStr = uid === 0 || uid === "0" ? "" : String(uid);
  const now = Math.floor(Date.now() / 1000);
  const salt = (Math.random() * 0xffffffff) >>> 0;
  const expire = now + tokenExpirySec;

  // Privilege 1 = JoinChannel (always granted for audience)
  const privileges: [number, number][] = [[1, expire]];
  const privBuf = Buffer.concat([
    packUInt16LE(privileges.length),
    ...privileges.flatMap(([k, v]) => [packUInt16LE(k), packUInt32LE(v)]),
  ]);

  // Message: salt + issueTs + expireTs + privileges
  const message = Buffer.concat([
    packUInt32LE(salt),
    packUInt32LE(now),
    packUInt32LE(expire),
    privBuf,
  ]);

  // Signing input: appId + channelName + uidStr + message
  const sigInput = Buffer.concat([
    Buffer.from(appId, "utf8"),
    Buffer.from(channelName, "utf8"),
    Buffer.from(uidStr, "utf8"),
    message,
  ]);

  const signature = createHmac("sha256", Buffer.from(appCertificate, "utf8"))
    .update(sigInput)
    .digest();

  // Content = signature(32 bytes) + message
  const content = Buffer.concat([signature, message]);

  return "007" + content.toString("base64");
}

// ─── Agora Token V1 Builder (AccessToken / "006" prefix) ────────────────────
// CRC32 table
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(str: string): number {
  let crc = 0xffffffff;
  for (const b of Buffer.from(str, "utf8")) {
    crc = CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildAgoraTokenV1(
  appId: string,
  appCertificate: string,
  channelName: string,
  uid: number,
  tokenExpirySec = 86400,
): string {
  const VERSION = "006";
  const uidStr = uid === 0 ? "" : String(uid);
  const now = Math.floor(Date.now() / 1000);
  const salt = (Math.random() * 0xffffffff) >>> 0;
  const ts = now + tokenExpirySec;

  // Privileges: 1=JoinChannel, 2=PubAudio, 3=PubVideo, 4=PubData
  const privileges: [number, number][] = [
    [1, ts], // JoinChannel
  ];

  const privBuf = Buffer.concat([
    packUInt16LE(privileges.length),
    ...privileges.flatMap(([k, v]) => [packUInt16LE(k), packUInt32LE(v)]),
  ]);

  const message = Buffer.concat([
    packUInt32LE(salt),
    packUInt32LE(ts),
    privBuf,
  ]);

  // Sign: VERSION + appId + ts + salt + message
  const sigInput = Buffer.concat([
    Buffer.from(VERSION + appId, "utf8"),
    packUInt32LE(ts),
    packUInt32LE(salt),
    message,
  ]);

  const signature = createHmac("sha256", Buffer.from(appCertificate, "utf8"))
    .update(sigInput)
    .digest();

  const content = Buffer.concat([
    packBytes(signature),
    packUInt32LE(crc32(channelName)),
    packUInt32LE(crc32(uidStr)),
    message,
  ]);

  return VERSION + appId + content.toString("base64");
}

// ─── GET /api/agora/config ───────────────────────────────────────────────────
agoraRouter.get("/agora/config", (_req: Request, res: Response) => {
  res.json({
    appId: AGORA_APP_ID,
    hasCertificate: Boolean(AGORA_APP_CERTIFICATE),
    hasCustomerCredentials: Boolean(AGORA_CUSTOMER_ID && AGORA_CUSTOMER_SECRET),
  });
});

// ─── GET /api/agora/token?channel=xxx&uid=0&expiry=86400 ────────────────────
agoraRouter.get("/agora/token", (req: Request, res: Response) => {
  const { channel, uid = "0", expiry = "86400" } = req.query as Record<string, string>;

  if (!channel) {
    return res.status(400).json({ success: false, error: "channel required" });
  }

  if (!AGORA_APP_CERTIFICATE) {
    return res.json({
      success: false,
      error: "AGORA_APP_CERTIFICATE tidak diset. Tambahkan di environment variables.",
      noCertificate: true,
    });
  }

  try {
    const uidNum = parseInt(uid, 10) || 0;
    const expiryNum = parseInt(expiry, 10) || 86400;

    // Try Token V2 first (newer format), V1 as fallback
    const tokenV2 = buildAgoraTokenV2(AGORA_APP_ID, AGORA_APP_CERTIFICATE, channel, uidNum, expiryNum);
    const tokenV1 = buildAgoraTokenV1(AGORA_APP_ID, AGORA_APP_CERTIFICATE, channel, uidNum, expiryNum);

    return res.json({
      success: true,
      appId: AGORA_APP_ID,
      channel,
      uid: uidNum,
      tokenV2,
      tokenV1,
      token: tokenV2, // default to V2
      expiresIn: expiryNum,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: msg });
  }
});

// ─── GET /api/agora/channels?page=0&size=100 ────────────────────────────────
// Lists active channels using Agora REST API (needs AGORA_CUSTOMER_ID + AGORA_CUSTOMER_SECRET)
agoraRouter.get("/agora/channels", async (req: Request, res: Response) => {
  if (!AGORA_CUSTOMER_ID || !AGORA_CUSTOMER_SECRET) {
    return res.json({
      success: false,
      error: "AGORA_CUSTOMER_ID dan AGORA_CUSTOMER_SECRET belum diset.",
      noCredentials: true,
      channels: [],
    });
  }

  const page = parseInt((req.query.page as string) ?? "0", 10);
  const size = parseInt((req.query.size as string) ?? "100", 10);

  const basicAuth = Buffer.from(`${AGORA_CUSTOMER_ID}:${AGORA_CUSTOMER_SECRET}`).toString("base64");

  try {
    const url = `https://api.agora.io/dev/v1/channel/${AGORA_APP_ID}?page_no=${page}&page_size=${size}`;
    const apiRes = await undiciFetch(url, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(502).json({ success: false, error: `Agora API ${apiRes.status}: ${errText.slice(0, 200)}`, channels: [] });
    }

    const data = await apiRes.json() as {
      success: boolean;
      data?: {
        channel?: Array<{ channel_name: string; user_count: number }>;
        total_size?: number;
      };
    };

    const channels = (data?.data?.channel ?? []).map((c) => ({
      channelName: c.channel_name,
      userCount: c.user_count,
    }));

    return res.json({
      success: true,
      channels,
      total: data?.data?.total_size ?? channels.length,
      appId: AGORA_APP_ID,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, channels: [] });
  }
});

// ─── GET /api/agora/channel-users/:channelName ───────────────────────────────
// Check if a specific channel is active and how many users are in it
agoraRouter.get("/agora/channel-users/:channelName", async (req: Request, res: Response) => {
  const channelName = req.params.channelName as string;

  if (!AGORA_CUSTOMER_ID || !AGORA_CUSTOMER_SECRET) {
    return res.json({
      success: false,
      error: "AGORA_CUSTOMER_ID dan AGORA_CUSTOMER_SECRET belum diset.",
      noCredentials: true,
      users: [],
    });
  }

  const basicAuth = Buffer.from(`${AGORA_CUSTOMER_ID}:${AGORA_CUSTOMER_SECRET}`).toString("base64");

  try {
    const url = `https://api.agora.io/dev/v1/channel/user/${AGORA_APP_ID}/${encodeURIComponent(channelName)}`;
    const apiRes = await undiciFetch(url, {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(502).json({ success: false, error: `Agora API ${apiRes.status}: ${errText.slice(0, 200)}`, users: [] });
    }

    const data = await apiRes.json() as {
      success: boolean;
      data?: { channel_exist: boolean; mode: number; total_size: number; broadcasters?: number[]; audience?: number[] };
    };

    const d = data?.data;
    return res.json({
      success: true,
      channelName,
      exists: d?.channel_exist ?? false,
      totalUsers: d?.total_size ?? 0,
      broadcasters: d?.broadcasters ?? [],
      audience: d?.audience ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, users: [] });
  }
});

export default agoraRouter;
