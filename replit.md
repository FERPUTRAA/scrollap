# Workspace

## Overview

pnpm workspace monorepo. TikTok-clone UI dengan live feed dari Hot51 API (platform live streaming Indonesia).

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24 / **TypeScript**: 5.9
- **Frontend**: React + Vite (artifacts/tiktok-ui)
- **Backend**: Express 5 (artifacts/api-server)
- **Animations**: framer-motion

## Key Commands

- `pnpm run typecheck` — full typecheck
- `pnpm --filter @workspace/api-server run dev` — run API server

## Artifacts

- **tiktok-ui** (`artifacts/tiktok-ui/`, preview `/`) — TikTok-clone UI
  - Home feed: live rooms dari Hot51 API (non-game), cover image nyata, viewer count
  - 5-tab bottom nav: Home, Discover, Create, Inbox, Profile
  - Graceful fallback ke demo data bila API diblokir

- **api-server** (`artifacts/api-server/`, preview `/api`) — Express API proxy
  - `GET /api/live-rooms` — list live rooms Hot51 (filter gameType=0, non-game)
  - `GET /api/room-info?roomId=xxx` — detail room + stream URL dari into-room endpoint
  - `GET /api/stream-proxy?roomId=xxx` — CORS proxy FLV stream
  - Cache 30 detik, fallback demo data bila IP diblokir

## Hot51 API Endpoints (dari decompile APK)

- Base: `https://api.fsccdn.com/501/`
- Room list: `POST /api/plr/v3/public/live/room-index` (body: `{area,gameType,offset,limit,sortBy,sortOrder}`)
- Room detail: `POST /api/plr/v3/public/live/into-room` (body: `roomId=xxx&liveId=xxx`)
- Stream URL pattern: `https://bcdn5.livcdn.com/live/501_{roomId}_auto.flv?txTime={hexEpoch}`
- Auth headers: merchantId, Authorization Basic, device, sign, ac (semua dari APK)

## Environment Variables

| Var | Keterangan |
|-----|------------|
| `HOT51_PROXY_URL` | **Wajib untuk data nyata** — proxy residential Indonesia, e.g. `http://user:pass@proxy.id:3128` |
| `HOT51_MERCHANT_ID` | Default: `501` |
| `HOT51_API_BASE` | Default: `https://api.fsccdn.com` |
| `HOT51_AUTH` | Authorization header |
| `HOT51_STREAM_BASE` | CDN base, default: `https://bcdn5.livcdn.com/live` |

## Gotchas

- Hot51 API geo-blocks non-Indonesian IPs (error `IP_LIMIT` / code 402)
- Tanpa `HOT51_PROXY_URL`, server serve **demo data** (8 room Indonesia fiktif) agar UI tetap berfungsi
- gameType=0 di request body memfilter live game — hanya live normal/non-game yang dikembalikan
- Stream URL FLV expire 2 jam (txTime = now + 7200 detik, dalam hex)
- FLV stream butuh CORS proxy karena bcdn5.livcdn.com tidak kirim CORS header
