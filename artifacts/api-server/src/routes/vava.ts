import { Router, type Request, type Response } from "express";
import { fetch as undiciFetch } from "undici";

const vavaRouter = Router();

const VAVA_BASE = "https://vbi.vervachat.com/api/v1";
const VAVA_CDN = "https://img.vervachat.com";

const VAVA_HEADERS: Record<string, string> = {
  authToken: "c2523245696c4610a13a049ca7278e05",
  userId: "13872374",
  accessToken: "00YrjZBMGH3UPHVurwe7CU7XHzbx6C8QAuxNUcrKzPA=",
  deviceId: "2d4b9fd3-2382-4f78-8122-8d0becdd7177",
  packageName: "com.vava.chat.web",
  appPackageName: "com.vava.chat.web",
  channel: "vvh",
  applicationLanguage: "id",
  deviceCategory: "0",
  operatingPlatform: "app",
  appVersion: "1.0.0",
  randomNonce: "kfD5fDHC",
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.3.2 Chrome/147.0.7727.111 Mobile Safari/537.36",
  Origin: "https://web.vava.chat",
  Referer: "https://web.vava.chat/",
};

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
  const ts = Date.now().toString();
  const res = await undiciFetch(`${VAVA_BASE}/${path}`, {
    method: "GET",
    headers: { ...VAVA_HEADERS, requestTimestamp: ts },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from vava API: ${text.slice(0, 200)}`);
  }
}

vavaRouter.get("/vava/users", async (_req: Request, res: Response) => {
  try {
    const limit = 20;

    const [femaleResult, visitorResult] = await Promise.allSettled([
      vavaFetch(`client/reco/female/refresh?offset=0&limit=${limit}`),
      vavaFetch(
        `app/recommend/female/visitor?locationCode=ID&offset=0`
      ),
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

export default vavaRouter;
