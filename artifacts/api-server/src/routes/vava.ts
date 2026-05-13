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
const GOOGLE_CLIENT_ID = "1060452493581-svne2ukq3vk3881on4d6k09sc3a16hg1.apps.googleusercontent.com";

let CREDS = {
  authToken: process.env.VAVA_AUTH_TOKEN ?? "1f3060ad97524a16824dd0154eb7b3d4",
  userId: process.env.VAVA_USER_ID ?? "14186923",
  deviceId: process.env.VAVA_DEVICE_ID ?? "2b61d981-b45f-46ec-16ee-b63f4b71d186",
  nimToken: process.env.VAVA_NIM_TOKEN ?? "94ec3828b8852283431255931e665b5b",
  valid: true,
  genderType: 2 as number, // 2=male viewer to watch female hosts
};

const CREDS_FALLBACK = {
  authToken: "c2523245696c4610a13a049ca7278e05",
  userId: "13872374",
  deviceId: "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
  nimToken: "015311c51ec42a632508bb1ea93fba4b",
  valid: true,
  genderType: 2 as number,
};

let lastValidationTime = 0;
const VALIDATION_TTL = 5 * 60 * 1000;

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

function genSignature(path: string, params: Record<string, unknown> = {}, cred: { authToken: string; userId: string; deviceId: string }): {
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

function buildHeaders(path: string, params: Record<string, unknown> = {}, cred: { authToken: string; userId: string; deviceId: string }): Record<string, string> {
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
  const url = path.startsWith("http") ? path : `${VAVA_BASE}/${path}${qs}`;
  const res = await undiciFetch(url, {
    method: "GET",
    headers: buildHeaders(fullPath, {}, cred),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text.slice(0, 200)}`); }
}

async function vavaPost(path: string, body: Record<string, unknown>, cred = CREDS): Promise<unknown> {
  const fullPath = `/api/v1/${path}`;
  const url = path.startsWith("http") ? path : `${VAVA_WEB_BASE.replace("/api/v1", "")}/${fullPath}`;
  const res = await undiciFetch(url, {
    method: "POST",
    headers: buildHeaders(fullPath, body, cred),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`Bad JSON: ${text.slice(0, 200)}`); }
}

async function vavaGetBoth(path: string, qs = ""): Promise<{ result: unknown; credUsed: typeof CREDS | typeof CREDS_FALLBACK }> {
  const [r1, r2] = await Promise.allSettled([
    vavaGet(path, qs, CREDS),
    vavaGet(path, qs, CREDS_FALLBACK),
  ]);

  for (const [r, cred] of [[r1, CREDS], [r2, CREDS_FALLBACK]] as const) {
    if (r.status === "fulfilled") {
      const d = r.value as { failureResponse?: { status: number } };
      if (d?.failureResponse?.status === 521) continue;
      return { result: r.value, credUsed: cred };
    }
  }

  if (r1.status === "fulfilled") return { result: r1.value, credUsed: CREDS };
  throw new Error("All credentials failed");
}

async function validateCreds(): Promise<boolean> {
  if (Date.now() - lastValidationTime < VALIDATION_TTL) return CREDS.valid || CREDS_FALLBACK.valid;
  lastValidationTime = Date.now();

  const [r1, r2] = await Promise.allSettled([
    vavaGet("client/recommend/female/free?locationCode=ID&offset=0&limit=1", "", CREDS),
    vavaGet("client/recommend/female/free?locationCode=ID&offset=0&limit=1", "", CREDS_FALLBACK),
  ]);

  const v1 = r1.status === "fulfilled" && !(r1.value as { failureResponse?: { status: number } })?.failureResponse;
  const v2 = r2.status === "fulfilled" && !(r2.value as { failureResponse?: { status: number } })?.failureResponse;

  // Only mark invalid if explicitly rejected (status 521). Network errors keep existing valid state.
  if (r1.status === "fulfilled") CREDS.valid = v1;
  if (r2.status === "fulfilled") CREDS_FALLBACK.valid = v2;

  return CREDS.valid || CREDS_FALLBACK.valid;
}

interface FreeUser {
  userId: number; displayName: string; profilePicture: string;
  ageValue?: number; genderType?: number; onlineFlag?: boolean; busyStatusFlag?: boolean;
  verified?: boolean; ifShowVerified?: boolean; callCostPerUnit?: number; userLanguage?: string;
  starSign?: string; astrologicalIcon?: string; withVideoPassFlag?: boolean;
  hobbyTagList?: Array<{ tagId: number; tagIdentifier: string; mediaImageRef?: string }>;
  languageTagList?: Array<{ tagId: number; tagIdentifier: string }>;
  geoPosition?: { regionCode?: string; locationNameValue?: string; whart?: string; superableSprinkleproof?: string };
  geographicalDistance?: string; bioText?: string;
}

interface VisitorUser {
  userId: number; displayName: string; profilePicture: string;
  ageValue?: number; genderType?: number; onlineFlag?: boolean; busyStatusFlag?: boolean;
  verified?: boolean; callCostPerUnit?: number; userLanguage?: string;
  geoPosition?: { regionCode?: string; locationNameValue?: string; whart?: string; superableSprinkleproof?: string };
  geographicalDistance?: string; bioText?: string; tags?: string[];
}

interface NormalizedUser {
  userId: number; displayName: string; profilePictureUrl: string;
  age: number | null; online: boolean; busy: boolean; verified: boolean;
  callCost: number; country: string; countryCode: string; countryFlagUrl: string;
  language: string; distance: string | null; starSign: string | null;
  astrologicalIconUrl: string | null; hobbies: string[]; withVideoPass: boolean;
}

function normalizeFreeUser(u: FreeUser): NormalizedUser {
  return {
    userId: u.userId, displayName: u.displayName || "Pengguna",
    profilePictureUrl: u.profilePicture ? `${VAVA_CDN}/${u.profilePicture}` : "",
    age: u.ageValue ?? null, online: u.onlineFlag ?? true, busy: u.busyStatusFlag ?? false,
    verified: (u.verified ?? u.ifShowVerified) ?? false, callCost: u.callCostPerUnit ?? 0,
    country: u.geoPosition?.locationNameValue ?? "Indonesia",
    countryCode: u.geoPosition?.regionCode ?? "ID",
    countryFlagUrl: u.geoPosition?.whart ? `${VAVA_CDN}/${u.geoPosition.whart}` : "",
    language: u.userLanguage ?? "id", distance: u.geographicalDistance ?? null,
    starSign: u.starSign ?? null,
    astrologicalIconUrl: u.astrologicalIcon ? `${VAVA_CDN}/${u.astrologicalIcon}` : null,
    hobbies: (u.hobbyTagList ?? []).map((h) => h.tagIdentifier).filter(Boolean),
    withVideoPass: u.withVideoPassFlag ?? false,
  };
}

function normalizeVisitorUser(u: VisitorUser): NormalizedUser {
  return {
    userId: u.userId, displayName: u.displayName || "Pengguna",
    profilePictureUrl: u.profilePicture ? `${VAVA_CDN}/${u.profilePicture}` : "",
    age: u.ageValue ?? null, online: u.onlineFlag ?? true, busy: u.busyStatusFlag ?? false,
    verified: u.verified ?? false, callCost: u.callCostPerUnit ?? 0,
    country: u.geoPosition?.locationNameValue ?? "Indonesia",
    countryCode: u.geoPosition?.regionCode ?? "ID",
    countryFlagUrl: u.geoPosition?.whart ? `${VAVA_CDN}/${u.geoPosition.whart}` : "",
    language: u.userLanguage ?? "id", distance: u.geographicalDistance ?? null,
    starSign: null, astrologicalIconUrl: null, hobbies: u.tags ?? [], withVideoPass: false,
  };
}

// GET /api/vava/users
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

    if (freeResult.status === "fulfilled") {
      const d = freeResult.value as { data?: FreeUser[] | null };
      if (Array.isArray(d?.data)) {
        for (const u of d.data) {
          if (u.userId && !seen.has(u.userId) && u.genderType !== 1) {
            const regionCode = u.geoPosition?.regionCode ?? "";
            const isIndonesia = regionCode === "ID" || regionCode === "" || (u.geoPosition?.locationNameValue ?? "").toLowerCase().includes("indonesia");
            if (isIndonesia) { allUsers.push(normalizeFreeUser(u)); seen.add(u.userId); }
          }
        }
      }
    }

    for (const result of [visitorResult, visitorFallback]) {
      if (result.status !== "fulfilled") continue;
      const d = result.value as { data?: VisitorUser[] | null };
      if (!Array.isArray(d?.data)) continue;
      for (const u of d.data) {
        if (u.userId && !seen.has(u.userId) && u.genderType !== 1) {
          const regionCode = u.geoPosition?.regionCode ?? "";
          const isIndonesia = regionCode === "ID" || regionCode === "" || (u.geoPosition?.locationNameValue ?? "").toLowerCase().includes("indonesia");
          if (isIndonesia) { allUsers.push(normalizeVisitorUser(u)); seen.add(u.userId); }
        }
      }
    }

    if (allUsers.length === 0) {
      return res.json({ success: false, error: "Tidak ada pengguna online saat ini", users: [] });
    }

    allUsers.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      if (a.distance && b.distance) {
        const da = parseFloat(a.distance), db = parseFloat(b.distance);
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

// GET /api/vava/match-recommends
vavaRouter.get("/vava/match-recommends", async (_req: Request, res: Response) => {
  try {
    const result = await vavaGet("client/connection/recommends/ver");
    const d = result as { data?: Array<{ profilePicture?: string; geographicalDistance?: string }> | null };
    const users = (Array.isArray(d?.data) ? d.data : [])
      .filter((u) => u.profilePicture)
      .map((u) => ({ profilePictureUrl: `${VAVA_CDN}/${u.profilePicture}`, distance: u.geographicalDistance ?? null }));
    return res.json({ success: true, users });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, users: [] });
  }
});

// POST /api/vava/google-login — accept Google ID token → exchange with VAVA
vavaRouter.post("/vava/google-login", async (req: Request, res: Response) => {
  const { googleToken } = req.body as { googleToken?: string };
  if (!googleToken) return res.status(400).json({ success: false, error: "googleToken required" });

  try {
    const body = { loginType: "GOOGLE", tempToken: googleToken };
    const loginPath = "/api/v1/client/identity/login";
    const ts = Date.now().toString();
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const nonce = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const tempDeviceId = "2d4b9fd3-2382-4f78-8122-8d0becdd7177";
    const flat = flattenParams(body as Record<string, unknown>);
    const sortedParams = Object.keys(flat).sort().map((k) => `${k}=${flat[k]}`).join("&");
    const message = [PACKAGE_NAME, tempDeviceId, loginPath, ts, nonce, sortedParams, APP_SECRET].join(":");
    const accessToken = createHmac("sha256", APP_SECRET).update(message).digest("base64");

    const loginRes = await undiciFetch(`${VAVA_WEB_BASE}/client/identity/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        packageName: PACKAGE_NAME,
        appPackageName: PACKAGE_NAME,
        channel: "vvh",
        applicationLanguage: "id",
        userLanguage: "id-ID",
        deviceCategory: "0",
        operatingPlatform: "app",
        appVersion: "1.0.0",
        deviceId: tempDeviceId,
        accessToken,
        randomNonce: nonce,
        requestTimestamp: ts,
        Origin: "https://web.vava.chat",
        Referer: "https://web.vava.chat/",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.3.2 Chrome/147.0.7727.111 Mobile Safari/537.36",
        "X-Requested-With": "net.onecook.browser",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const loginData = await loginRes.json() as {
      data?: { authToken?: string; userId?: number; nimToken?: string; needRegister?: boolean; tempToken?: string };
      failureResponse?: { status: number; detailedDescription: string };
    };

    if (loginData?.failureResponse) {
      const fs = loginData.failureResponse.status;
      if (fs === 502 || loginData?.data?.needRegister) {
        // New user - need to register
        return res.json({ success: false, needRegister: true, tempToken: loginData?.data?.tempToken ?? googleToken, error: "Akun baru - perlu registrasi" });
      }
      return res.json({ success: false, error: loginData.failureResponse.detailedDescription || "Login VAVA gagal" });
    }

    const d = loginData?.data;
    if (d?.authToken && d?.userId) {
      CREDS.authToken = d.authToken;
      CREDS.userId = String(d.userId);
      CREDS.valid = true;
      if (d.nimToken) CREDS.nimToken = d.nimToken;
      lastValidationTime = 0;
      // Fetch account info to know gender
      try {
        const info = await vavaGet("client/account/info") as { data?: { genderType?: number } };
        if (info?.data?.genderType) CREDS.genderType = info.data.genderType;
      } catch {}
      return res.json({ success: true, userId: d.userId, authToken: d.authToken, genderType: CREDS.genderType });
    }

    return res.json({ success: false, error: "Respons tidak valid dari VAVA", raw: loginData });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

// POST /api/vava/google-register — register new VAVA user after Google login
vavaRouter.post("/vava/google-register", async (req: Request, res: Response) => {
  const { tempToken, nickname, genderType, birthday } = req.body as {
    tempToken?: string; nickname?: string; genderType?: number; birthday?: number;
  };
  if (!tempToken) return res.status(400).json({ success: false, error: "tempToken required" });

  try {
    const body = {
      tempToken,
      loginType: "GOOGLE",
      nickname: nickname ?? `user_${Date.now().toString().slice(-6)}`,
      genderType: genderType ?? 2, // Default MALE (2) so new accounts can view female hosts
      birthday: birthday ?? 946684800000,
      avatar: "public/app/vvh_default_avatar.png",
    };
    const regPath = "/api/v1/client/identity/register";
    const tempDeviceId = "2d4b9fd3-2382-4f78-8122-8d0becdd7177";
    const ts = Date.now().toString();
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const nonce = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const flat = flattenParams(body as Record<string, unknown>);
    const sortedParams = Object.keys(flat).sort().map((k) => `${k}=${flat[k]}`).join("&");
    const message = [PACKAGE_NAME, tempDeviceId, regPath, ts, nonce, sortedParams, APP_SECRET].join(":");
    const accessToken = createHmac("sha256", APP_SECRET).update(message).digest("base64");

    const regRes = await undiciFetch(`${VAVA_WEB_BASE}/client/identity/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        packageName: PACKAGE_NAME,
        appPackageName: PACKAGE_NAME,
        channel: "vvh",
        applicationLanguage: "id",
        userLanguage: "id-ID",
        deviceCategory: "0",
        operatingPlatform: "app",
        appVersion: "1.0.0",
        deviceId: tempDeviceId,
        accessToken,
        randomNonce: nonce,
        requestTimestamp: ts,
        Origin: "https://web.vava.chat",
        Referer: "https://web.vava.chat/",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.3.2 Chrome/147.0.7727.111 Mobile Safari/537.36",
        "X-Requested-With": "net.onecook.browser",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const regData = await regRes.json() as {
      data?: { authToken?: string; userId?: number; nimToken?: string };
      failureResponse?: { status: number; detailedDescription: string };
    };

    if (regData?.data?.authToken && regData?.data?.userId) {
      CREDS.authToken = regData.data.authToken;
      CREDS.userId = String(regData.data.userId);
      CREDS.valid = true;
      if (regData.data.nimToken) CREDS.nimToken = regData.data.nimToken;
      lastValidationTime = 0;
      return res.json({ success: true, userId: regData.data.userId, authToken: regData.data.authToken });
    }

    return res.json({ success: false, error: regData?.failureResponse?.detailedDescription ?? "Registrasi gagal", raw: regData });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

// GET /api/vava/live-sessions — get active live Agora sessions from VAVA
vavaRouter.get("/vava/live-sessions", async (_req: Request, res: Response) => {
  try {
    const { result } = await vavaGetBoth("live/session/table/v2");
    const d = result as {
      data?: {
        sessionList?: Array<{
          orderId?: string; channel?: string; authToken?: string; agoraToken?: string;
          hostUserId?: number; hostDisplayName?: string; hostProfilePicture?: string;
          viewerCount?: number; duration?: number;
        }>;
      };
      failureResponse?: { status: number; detailedDescription: string };
    };

    if (d?.failureResponse?.status === 521) {
      return res.json({ success: false, error: "Perlu login VAVA", needAuth: true, sessions: [] });
    }

    const sessionList = d?.data?.sessionList ?? [];
    const sessions = sessionList
      .filter((s) => s.channel && (s.authToken || s.agoraToken))
      .map((s) => ({
        orderId: s.orderId ?? null,
        channel: s.channel!,
        token: s.authToken ?? s.agoraToken ?? null,
        appId: AGORA_APP_ID,
        hostUserId: s.hostUserId ?? null,
        hostDisplayName: s.hostDisplayName ?? "Host",
        hostProfilePicture: s.hostProfilePicture ? `${VAVA_CDN}/${s.hostProfilePicture}` : null,
        viewerCount: s.viewerCount ?? 0,
        duration: s.duration ?? 0,
      }));

    return res.json({ success: true, sessions, raw: d?.data ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg, sessions: [] });
  }
});

// POST /api/vava/session - attempt to get Agora session via matching
vavaRouter.post("/vava/session", async (_req: Request, res: Response) => {
  type ConnResult = {
    data?: { channel?: string; authToken?: string; agoraToken?: string; orderNo?: string; peerId?: number; peerUserId?: number };
    failureResponse?: { status: number; detailedDescription: string };
  };

  try {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    const matchingRoundIdentifier = `${ts}_${rand}`;

    // Try each credential sequentially so we know WHICH credential got a session.
    // The Agora token VAVA returns is tied to that credential's userId — we must
    // join Agora with the same UID or the token will be rejected.
    // Try all credentials for matching regardless of the `valid` flag —
    // validity is checked via the recommend endpoint, but matching may still
    // work even if the credential is blocked from recommendation APIs.
    const credPairs: Array<typeof CREDS> = [CREDS, CREDS_FALLBACK];
    let winResult: ConnResult | null = null;
    let winCred: typeof CREDS | null = null;

    for (const cred of credPairs) {
      try {
        const r = (await vavaPost("client/connection", { appVersion: 1, matchingRoundIdentifier }, cred)) as ConnResult;
        const failStatus = r?.failureResponse?.status;
        if (failStatus === 521) { cred.valid = false; continue; }
        if (failStatus === 545) continue; // noCoins, try next
        if (r?.data?.channel && (r?.data?.authToken || r?.data?.agoraToken)) {
          winResult = r;
          winCred = cred;
          break;
        }
        // "waiting" response — store first waiting result and continue trying
        if (!winResult) { winResult = r; }
      } catch { /* network error, try next */ }
    }

    if (!winResult) {
      return res.status(502).json({ success: false, error: "Semua koneksi gagal", waiting: true });
    }

    const failStatus = winResult?.failureResponse?.status;
    if (failStatus === 521) {
      return res.status(401).json({ success: false, needsAuth: true, error: "Sesi login berakhir" });
    }
    if (failStatus === 545) {
      return res.status(202).json({ success: false, waiting: true, noCoins: true, error: "Koin tidak mencukupi" });
    }

    const d = winResult?.data;
    if (d?.channel && (d?.authToken || d?.agoraToken)) {
      // Return the exact userId whose credential generated this token.
      // The frontend MUST join Agora with this uid so the token validates.
      const uid = winCred ? Number(winCred.userId) : 0;
      return res.json({
        success: true, appId: AGORA_APP_ID,
        channel: d.channel, token: d.authToken ?? d.agoraToken,
        uid,
        peerId: d.peerId ?? d.peerUserId ?? null, orderNo: d.orderNo ?? null,
      });
    }

    return res.status(202).json({ success: false, waiting: true, error: "Menunggu pengguna tersedia", raw: winResult });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

// GET /api/vava/live
vavaRouter.get("/vava/live", async (_req: Request, res: Response) => {
  try {
    const result = (await vavaGet("live/session/table/v2")) as { data?: unknown; status?: number };
    return res.json({ success: true, data: result?.data ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ success: false, error: msg });
  }
});

// GET /api/vava/status — check if credentials are valid
vavaRouter.get("/vava/status", async (_req: Request, res: Response) => {
  try {
    const valid = await validateCreds();
    return res.json({
      success: true,
      authenticated: valid,
      primary: { userId: CREDS.userId, valid: CREDS.valid },
      fallback: { userId: CREDS_FALLBACK.userId, valid: CREDS_FALLBACK.valid },
      googleClientId: GOOGLE_CLIENT_ID,
    });
  } catch (err: unknown) {
    return res.json({ success: false, authenticated: false, googleClientId: GOOGLE_CLIENT_ID });
  }
});

// POST /api/vava/credentials - update credentials
vavaRouter.post("/vava/credentials", (req: Request, res: Response) => {
  const { authToken, userId, deviceId, nimToken } = req.body as {
    authToken?: string; userId?: string; deviceId?: string; nimToken?: string;
  };
  if (authToken) CREDS.authToken = authToken;
  if (userId) CREDS.userId = userId;
  if (deviceId) CREDS.deviceId = deviceId;
  if (nimToken) CREDS.nimToken = nimToken;
  CREDS.valid = true;
  lastValidationTime = 0;
  return res.json({ success: true, userId: CREDS.userId });
});

// GET /api/vava/config
vavaRouter.get("/vava/config", (_req: Request, res: Response) => {
  return res.json({ appId: AGORA_APP_ID, userId: CREDS.userId, authenticated: CREDS.valid, googleClientId: GOOGLE_CLIENT_ID });
});

function extractAgoraCredentials(obj: unknown): { channel: string; token: string } | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.channel === "string" && o.channel.length > 0) {
    const token = (o.authToken ?? o.token ?? o.agoraToken ?? o.chatToken) as string | undefined;
    if (typeof token === "string" && token.length > 0) return { channel: o.channel, token };
  }
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

// GET /api/vava/ws-relay - SSE relay for Vava WebSocket events
vavaRouter.get("/vava/ws-relay", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  send("connected", { status: "ok", timestamp: Date.now() });

  const activeCred = CREDS.valid ? CREDS : CREDS_FALLBACK;
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
      const tlsSock = tlsConnect({ socket: rawSock, servername: "vbi.vervachat.com", rejectUnauthorized: false });
      tlsSocket = tlsSock;

      tlsSock.on("secureConnect", () => {
        if (closed) { tlsSock.destroy(); return; }
        const keyB = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
        const key = keyB.toString("base64");
        const path = `/ws?uid=${activeCred.userId}&token=${activeCred.authToken}&version=1`;
        const handshake = [
          `GET ${path} HTTP/1.1`, "Host: vbi.vervachat.com", "Upgrade: websocket",
          "Connection: Upgrade", `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13",
          "Origin: https://web.vava.chat", "User-Agent: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36", "", "",
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
              send("ws_connected", { uid: activeCred.userId });
            } else {
              send("ws_error", { message: "Handshake failed", header: headerStr.slice(0, 100) });
              tlsSock.destroy(); return;
            }
          }

          while (buffer.length >= 2) {
            const b0 = buffer[0], b1 = buffer[1];
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let payloadLen = b1 & 0x7f;
            let offset = 2;
            if (payloadLen === 126) { if (buffer.length < 4) break; payloadLen = buffer.readUInt16BE(2); offset = 4; }
            else if (payloadLen === 127) { if (buffer.length < 10) break; payloadLen = Number(buffer.readBigUInt64BE(2)); offset = 10; }
            const maskLen = masked ? 4 : 0;
            const totalLen = offset + maskLen + payloadLen;
            if (buffer.length < totalLen) break;
            if (opcode === 8) { tlsSock.destroy(); buffer = Buffer.alloc(0); break; }
            if (opcode === 9 && tlsSock.writable) tlsSock.write(Buffer.from([0x8a, 0x00]));
            if (opcode === 1 || opcode === 2) {
              let payload = buffer.slice(offset + maskLen, totalLen);
              if (masked) { const mask = buffer.slice(offset, offset + 4); payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4])); }
              const text = payload.toString("utf8");
              if (text.includes("connected to server")) {
                send("ws_connected", { message: text });
              } else {
                try {
                  const msg = JSON.parse(text) as Record<string, unknown>;
                  const eventType = (msg.event_type ?? msg.eventType ?? msg.type ?? "unknown") as string;
                  send("ws_message", { eventType, raw: text.slice(0, 300) });
                  const creds = extractAgoraCredentials(msg);
                  if (creds) {
                    send("agora_session", { appId: AGORA_APP_ID, channel: creds.channel, token: creds.token, uid: parseInt(activeCred.userId, 10), eventType });
                  }
                } catch {
                  send("ws_raw", { text: text.slice(0, 200) });
                }
              }
            }
            buffer = buffer.slice(totalLen);
          }
        });

        const pingInterval = setInterval(() => {
          if (closed || !tlsSock.writable) { clearInterval(pingInterval); return; }
          tlsSock.write(Buffer.from([0x89, 0x00]));
        }, 20_000);

        tlsSock.on("close", () => { clearInterval(pingInterval); buffer = Buffer.alloc(0); if (!closed) { send("ws_disconnected", { message: "Reconnecting..." }); setTimeout(connectWS, 3000); } });
        tlsSock.on("error", (e: Error) => { clearInterval(pingInterval); send("ws_error", { message: e.message }); if (!closed) setTimeout(connectWS, 5000); });
      });
      tlsSock.on("error", (e: Error) => { send("ws_error", { message: e.message }); if (!closed) setTimeout(connectWS, 5000); });
    });
    rawSock.on("error", (e: Error) => { send("ws_error", { message: e.message }); if (!closed) setTimeout(connectWS, 5000); });
  }

  connectWS();
  req.on("close", () => { closed = true; tlsSocket?.destroy(); wsSocket?.destroy(); });
});

export default vavaRouter;
