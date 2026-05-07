import { Router, type Request, type Response } from "express";
import { fetch as undiciFetch } from "undici";

const vavaRouter = Router();

const VAVA_BASE = "https://vbi.vervachat.com/api/v1";
const VAVA_CDN = "https://img.vervachat.com";

const AGORA_APP_ID = "2f62afc1e7df4c71957bea05f56c8cbb";

let CREDS = {
  authToken: process.env.VAVA_AUTH_TOKEN ?? "c2523245696c4610a13a049ca7278e05",
  userId: process.env.VAVA_USER_ID ?? "13872374",
  accessToken: process.env.VAVA_ACCESS_TOKEN ?? "00YrjZBMGH3UPHVurwe7CU7XHzbx6C8QAuxNUcrKzPA=",
  deviceId: process.env.VAVA_DEVICE_ID ?? "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
  nimToken: process.env.VAVA_NIM_TOKEN ?? "015311c51ec42a632508bb1ea93fba4b",
};

function buildHeaders(): Record<string, string> {
  return {
    authToken: CREDS.authToken,
    userId: CREDS.userId,
    accessToken: CREDS.accessToken,
    deviceId: CREDS.deviceId,
    packageName: "com.vava.chat.web",
    appPackageName: "com.vava.chat.web",
    channel: "vvh",
    applicationLanguage: "id",
    deviceCategory: "0",
    operatingPlatform: "app",
    appVersion: "1.0.0",
    randomNonce: "kfD5fDHC",
    requestTimestamp: Date.now().toString(),
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.3.2 Chrome/147.0.7727.111 Mobile Safari/537.36",
    Origin: "https://web.vava.chat",
    Referer: "https://web.vava.chat/",
  };
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
  };
  geographicalDistance?: string;
  transactionId?: string;
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
}

function normalizeUser(u: VavaUser): NormalizedUser {
  return {
    userId: u.userId,
    displayName: u.displayName || "Pengguna",
    profilePictureUrl: u.profilePicture
      ? `${VAVA_CDN}/${u.profilePicture}`
      : "",
    age: u.ageValue ?? null,
    online: u.onlineFlag ?? true,
    busy: u.busyStatusFlag ?? false,
    verified: u.verified ?? false,
    callCost: u.callCostPerUnit ?? 0,
    country: u.geoPosition?.locationNameValue ?? "",
    countryCode: u.geoPosition?.regionCode ?? "",
    countryFlagUrl: u.geoPosition?.whart
      ? `${VAVA_CDN}/${u.geoPosition.whart}`
      : "",
    language: u.userLanguage ?? "",
    distance: u.geographicalDistance ?? null,
  };
}

async function vavaFetch(path: string): Promise<unknown> {
  const res = await undiciFetch(`${VAVA_BASE}/${path}`, {
    method: "GET",
    headers: buildHeaders(),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON: ${text.slice(0, 200)}`);
  }
}

async function vavaPost(path: string, body: object): Promise<unknown> {
  const res = await undiciFetch(`${VAVA_BASE}/${path}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON: ${text.slice(0, 200)}`);
  }
}

vavaRouter.get("/vava/users", async (_req: Request, res: Response) => {
  try {
    const limit = 20;

    const [femaleResult, visitorResult] = await Promise.allSettled([
      vavaFetch(`client/reco/female/refresh?offset=0&limit=${limit}`),
      vavaFetch(`app/recommend/female/visitor?locationCode=ID&offset=0`),
    ]);

    const allUsers: NormalizedUser[] = [];

    if (femaleResult.status === "fulfilled") {
      const d = femaleResult.value as { data?: VavaUser[]; status?: number };
      if (d?.data && Array.isArray(d.data)) {
        allUsers.push(...d.data.map(normalizeUser));
      }
    }

    if (visitorResult.status === "fulfilled") {
      const d = visitorResult.value as { data?: VavaUser[]; status?: number };
      if (d?.data && Array.isArray(d.data)) {
        const existing = new Set(allUsers.map((u) => u.userId));
        for (const u of d.data) {
          if (u.userId && !existing.has(u.userId)) {
            allUsers.push(normalizeUser(u));
            existing.add(u.userId);
          }
        }
      }
    }

    if (allUsers.length === 0) {
      return res.json({ success: false, error: "Tidak ada pengguna online saat ini", users: [] });
    }

    return res.json({ success: true, users: allUsers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, users: [] });
  }
});

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
        agoraToken?: string;
        authToken?: string;
        nimToken?: string;
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
        error: "Sesi login telah berakhir. Perlu refresh kredensial.",
      });
    }

    if (result?.data?.channel && result?.data?.agoraToken) {
      return res.json({
        success: true,
        appId: AGORA_APP_ID,
        channel: result.data.channel,
        token: result.data.agoraToken,
        uid: parseInt(CREDS.userId, 10),
        peerId: result.data.peerId ?? result.data.peerUserId ?? null,
      });
    }

    return res.status(202).json({
      success: false,
      waiting: true,
      error: "Menunggu pengguna lain tersedia",
      raw: result,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

vavaRouter.post("/vava/credentials", (req: Request, res: Response) => {
  const { authToken, userId, accessToken, deviceId, nimToken } = req.body as {
    authToken?: string;
    userId?: string;
    accessToken?: string;
    deviceId?: string;
    nimToken?: string;
  };
  if (authToken) CREDS.authToken = authToken;
  if (userId) CREDS.userId = userId;
  if (accessToken) CREDS.accessToken = accessToken;
  if (deviceId) CREDS.deviceId = deviceId;
  if (nimToken) CREDS.nimToken = nimToken;
  return res.json({ success: true, userId: CREDS.userId });
});

vavaRouter.get("/vava/config", (_req: Request, res: Response) => {
  return res.json({
    appId: AGORA_APP_ID,
    userId: CREDS.userId,
    authenticated: true,
  });
});

export default vavaRouter;
