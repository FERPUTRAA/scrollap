import { Router, type Request, type Response } from "express";
import { fetch as undiciFetch } from "undici";

const vidiocallRouter = Router();

/* ── In-memory state ── */
interface ActivityLog {
  id: string;
  event: string;
  stream_id: string;
  stream_name: string;
  timestamp: string;
}

interface GoPartySession {
  apiBase: string;
  token: string;
  username: string;
}

const activityLogs: ActivityLog[] = [];
const MAX_LOGS = 200;
let gopartySession: GoPartySession | null = null;

function addLog(event: string, stream_id: string, stream_name: string): ActivityLog {
  const log: ActivityLog = {
    id: Math.random().toString(36).slice(2, 10),
    event,
    stream_id,
    stream_name,
    timestamp: new Date().toISOString(),
  };
  activityLogs.unshift(log);
  if (activityLogs.length > MAX_LOGS) activityLogs.splice(MAX_LOGS);
  return log;
}

/* ── Repository analysis data (static, extracted from decompile) ── */
const REPO_ANALYSIS = {
  appPackage: "com.client.goparty",
  appName: "GoParty / Vava",
  version: "4.4.1 (versionCode: 249)",
  domain: "goparty.tech",
  firebase: "relationcoach2023",
  nimSdk: "NetEase NIM v1.8.0",
  auth: "AWS Cognito (Amplify) + Facebook + Google",
  streaming: "Zego / WebRTC (compiled into Dart native binary)",
  discoveredAt: new Date().toISOString(),
  note: "API endpoint dikompilasi ke libapp.so (Dart native). Autentikasi via AWS Cognito diperlukan untuk akses live rooms.",
};

/* ── Try to fetch GoParty live rooms with given credentials ── */
async function fetchGoPartyRooms(session: GoPartySession): Promise<unknown> {
  const endpoints = [
    `${session.apiBase}/api/v1/live/rooms`,
    `${session.apiBase}/api/live/list`,
    `${session.apiBase}/api/v2/live/list`,
    `${session.apiBase}/live/rooms`,
    `${session.apiBase}/api/rooms`,
    `${session.apiBase}/api/v1/rooms/live`,
  ];

  const headers: Record<string, string> = {
    "Authorization": session.token.startsWith("Bearer ") ? session.token : `Bearer ${session.token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "GoParty/4.4.1 (Android; com.client.goparty)",
    "X-Package-Name": "com.client.goparty",
  };

  const errors: string[] = [];
  for (const url of endpoints) {
    try {
      const res = await undiciFetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        return { success: true, endpoint: url, status: res.status, data: json };
      } catch {
        errors.push(`${url}: HTTP ${res.status} (non-JSON)`);
      }
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return { success: false, errors, triedEndpoints: endpoints };
}

/* ── API: POST /api/vidiocall/connect — try GoParty session ── */
vidiocallRouter.post("/vidiocall/connect", async (req: Request, res: Response) => {
  const { apiBase = "https://goparty.tech", token = "", username = "" } = req.body as {
    apiBase?: string; token?: string; username?: string;
  };

  if (!token) {
    res.status(400).json({ success: false, error: "Token diperlukan" });
    return;
  }

  const session: GoPartySession = {
    apiBase: apiBase.replace(/\/$/, ""),
    token,
    username,
  };

  const result = await fetchGoPartyRooms(session);
  const ok = (result as Record<string, unknown>).success === true;
  if (ok) gopartySession = session;

  res.json(result);
});

/* ── API: GET /api/vidiocall/rooms ── */
vidiocallRouter.get("/vidiocall/rooms", async (_req: Request, res: Response) => {
  if (!gopartySession) {
    res.json({ success: false, error: "Belum login ke GoParty API", session: null });
    return;
  }
  const result = await fetchGoPartyRooms(gopartySession);
  res.json(result);
});

/* ── API: GET /api/vidiocall/session ── */
vidiocallRouter.get("/vidiocall/session", (_req: Request, res: Response) => {
  res.json({
    connected: !!gopartySession,
    username: gopartySession?.username ?? null,
    apiBase: gopartySession?.apiBase ?? null,
  });
});

/* ── API: POST /api/vidiocall/logout ── */
vidiocallRouter.post("/vidiocall/logout", (_req: Request, res: Response) => {
  gopartySession = null;
  res.json({ success: true });
});

/* ── API: POST /api/vidiocall/log ── */
vidiocallRouter.post("/vidiocall/log", (req: Request, res: Response) => {
  const { event = "admin_viewed_stream", stream_id = "", stream_name = "" } = req.body as {
    event?: string; stream_id?: string; stream_name?: string;
  };
  const log = addLog(event, stream_id, stream_name);
  res.json({ success: true, log });
});

/* ── API: GET /api/vidiocall/logs ── */
vidiocallRouter.get("/vidiocall/logs", (_req: Request, res: Response) => {
  res.json({ success: true, logs: activityLogs });
});

/* ── API: GET /api/vidiocall/repo-info ── */
vidiocallRouter.get("/vidiocall/repo-info", (_req: Request, res: Response) => {
  res.json({ success: true, analysis: REPO_ANALYSIS });
});

/* ── Dashboard HTML ── */
vidiocallRouter.get("/vidiocall", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>GoParty Admin — Video Live Dashboard</title>
  <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0d0f14;--surface:#161b24;--surface2:#1e2533;--border:#2a3348;
      --accent:#5865f2;--red:#eb4034;--green:#3ba55d;--yellow:#f0b132;
      --text:#e8eaf0;--muted:#8b92a5;--radius:12px;
    }
    body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}

    /* HEADER */
    header{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:14px;position:sticky;top:0;z-index:100}
    .logo{display:flex;align-items:center;gap:10px;font-size:17px;font-weight:700}
    .live-dot{width:9px;height:9px;background:var(--red);border-radius:50%;animation:pulse 1.4s infinite}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.5)}}
    .header-right{margin-left:auto;display:flex;align-items:center;gap:10px}
    .badge{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:12px;color:var(--muted)}
    .badge span{color:var(--text);font-weight:600}
    #conn-status{padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;border:none;cursor:default}
    .status-ok{background:rgba(59,165,93,.15);color:var(--green);border:1px solid rgba(59,165,93,.3)!important}
    .status-no{background:rgba(235,64,52,.1);color:var(--red);border:1px solid rgba(235,64,52,.25)!important}

    /* TABS */
    .tabs{display:flex;gap:0;border-bottom:1px solid var(--border);background:var(--surface);padding:0 24px}
    .tab{padding:12px 18px;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
    .tab:hover{color:var(--text)}
    .tab.active{color:var(--text);border-bottom-color:var(--accent)}

    /* LAYOUT */
    .layout{display:grid;grid-template-columns:1fr 300px;min-height:calc(100vh - 105px)}
    @media(max-width:860px){.layout{grid-template-columns:1fr}.sidebar{border-left:none;border-top:1px solid var(--border)}}

    /* MAIN */
    main{padding:20px;overflow:hidden}
    .panel{display:none}.panel.active{display:block}

    /* SECTION TITLE */
    .sec{font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:14px}

    /* STREAM GRID */
    #stream-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:transform .18s,border-color .18s,box-shadow .18s;position:relative}
    .card:hover{transform:translateY(-3px);border-color:var(--accent);box-shadow:0 6px 24px rgba(88,101,242,.18)}
    .card-thumb{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;background:var(--surface2)}
    .live-badge{position:absolute;top:8px;left:8px;background:var(--red);color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:4px}
    .card-body{padding:10px 12px}
    .card-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px}
    .card-viewers{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px}
    .vdot{width:6px;height:6px;background:var(--green);border-radius:50%}
    .skeleton{background:linear-gradient(90deg,var(--surface2) 25%,#252d3d 50%,var(--surface2) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:var(--radius);aspect-ratio:9/16}
    @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
    #empty-state{display:none;text-align:center;padding:60px 20px;color:var(--muted)}
    #empty-state h3{color:var(--text);margin-bottom:8px}

    /* CONNECT PANEL */
    .connect-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:560px;margin:0 auto}
    .connect-box h2{font-size:16px;font-weight:700;margin-bottom:6px}
    .connect-box p{font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.6}
    .field{margin-bottom:14px}
    .field label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase}
    .field input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;color:var(--text);font-size:13px;outline:none;transition:border-color .15s}
    .field input:focus{border-color:var(--accent)}
    .field input::placeholder{color:var(--muted)}
    .btn{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s;width:100%}
    .btn:hover{opacity:.85}
    .btn:disabled{opacity:.4;cursor:not-allowed}
    .btn-sm{padding:6px 14px;font-size:12px;width:auto}
    .btn-red{background:var(--red)}
    .msg{padding:10px 14px;border-radius:8px;font-size:13px;margin-top:12px;display:none}
    .msg.ok{background:rgba(59,165,93,.12);border:1px solid rgba(59,165,93,.3);color:var(--green)}
    .msg.err{background:rgba(235,64,52,.1);border:1px solid rgba(235,64,52,.25);color:var(--red)}

    /* REPO INFO */
    .info-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:20px}
    .info-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
    .info-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
    .info-value{font-size:13px;color:var(--text);font-weight:500;word-break:break-all}
    .info-value.code{font-family:monospace;font-size:12px;color:var(--yellow)}
    .note-box{background:rgba(240,177,50,.06);border:1px solid rgba(240,177,50,.2);border-radius:var(--radius);padding:14px 16px;font-size:13px;color:var(--yellow);line-height:1.6}

    /* SIDEBAR */
    .sidebar{background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column}
    .sidebar-hdr{padding:14px 16px 10px;border-bottom:1px solid var(--border);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;justify-content:space-between}
    .lcount{background:var(--accent);color:#fff;border-radius:10px;font-size:11px;padding:1px 7px;font-weight:700}
    #log-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px}
    #log-list::-webkit-scrollbar{width:3px}
    #log-list::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
    .log-item{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:12px;animation:fadeIn .3s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
    .log-ev{font-weight:600;color:var(--accent);margin-bottom:2px}
    .log-nm{color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
    .log-tm{color:var(--muted);font-size:10px}
    .log-empty{color:var(--muted);text-align:center;padding:30px 10px;font-size:12px}

    /* MODAL */
    #modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:200;align-items:center;justify-content:center;padding:20px}
    #modal-overlay.open{display:flex}
    #modal-box{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:100%;max-width:560px;overflow:hidden;position:relative}
    #modal-hdr{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
    #modal-title{font-weight:700;font-size:15px;flex:1}
    #modal-viewers{font-size:12px;color:var(--muted)}
    .btn-close{background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;width:30px;height:30px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .15s}
    .btn-close:hover{background:var(--red);border-color:var(--red)}
    #modal-note{padding:10px 16px 14px;font-size:12px;color:var(--muted);border-top:1px solid var(--border)}
    #modal-note a{color:var(--accent);text-decoration:none}
    .video-js{width:100%!important}
    .vjs-big-play-button{top:50%!important;left:50%!important;transform:translate(-50%,-50%)!important}
  </style>
</head>
<body>

<header>
  <div class="logo"><div class="live-dot"></div>GoParty Admin</div>
  <div class="header-right">
    <div class="badge">Repo: <span>FERPUTRAA/Hui-hatanoka</span></div>
    <div class="badge"><span id="stream-count">—</span> Live</div>
    <div id="conn-status" class="status-no">Belum Terhubung</div>
    <button class="btn btn-sm" id="btn-refresh" onclick="loadStreams()" style="width:auto" disabled>↺ Refresh</button>
  </div>
</header>

<div class="tabs">
  <div class="tab active" onclick="showTab('live')">📡 Live Streams</div>
  <div class="tab" onclick="showTab('connect')">🔗 Koneksi API</div>
  <div class="tab" onclick="showTab('repo')">🔍 Analisis Repository</div>
</div>

<div class="layout">
  <main>

    <!-- LIVE PANEL -->
    <div id="panel-live" class="panel active">
      <div class="sec">Semua Stream Aktif — GoParty / Vava</div>
      <div id="stream-grid"></div>
      <div id="empty-state">
        <h3 id="empty-title">Belum Terhubung</h3>
        <p id="empty-msg">Masuk ke tab <strong>Koneksi API</strong> dan masukkan token GoParty Anda untuk melihat live streams.</p>
      </div>
    </div>

    <!-- CONNECT PANEL -->
    <div id="panel-connect" class="panel">
      <div class="connect-box">
        <h2>Koneksi ke GoParty API</h2>
        <p>
          Masukkan kredensial GoParty Anda. Token bisa didapat dari sesi login di aplikasi
          GoParty (com.client.goparty). API menggunakan AWS Cognito sebagai autentikasi.
        </p>

        <div class="field">
          <label>API Base URL</label>
          <input id="inp-base" type="text" value="https://goparty.tech" placeholder="https://goparty.tech"/>
        </div>
        <div class="field">
          <label>Bearer Token</label>
          <input id="inp-token" type="password" placeholder="eyJhbGciOi... (token dari sesi login)"/>
        </div>
        <div class="field">
          <label>Username (opsional)</label>
          <input id="inp-user" type="text" placeholder="username GoParty Anda"/>
        </div>
        <button class="btn" id="btn-connect" onclick="doConnect()">Hubungkan ke GoParty API</button>
        <div id="msg-connect" class="msg"></div>

        <div id="session-info" style="display:none;margin-top:20px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--green)">✓ Terhubung</div>
          <div id="sess-detail" style="font-size:12px;color:var(--muted)"></div>
          <button class="btn btn-sm btn-red" onclick="doLogout()" style="margin-top:10px">Putus Koneksi</button>
        </div>
      </div>
    </div>

    <!-- REPO PANEL -->
    <div id="panel-repo" class="panel">
      <div class="sec">Hasil Analisis Repository — github.com/FERPUTRAA/Hui-hatanoka</div>
      <div id="repo-grid" class="info-grid"></div>
      <div id="repo-note" class="note-box" style="margin-top:4px"></div>
    </div>

  </main>

  <aside class="sidebar">
    <div class="sidebar-hdr">
      Activity Log <span class="lcount" id="log-count">0</span>
    </div>
    <div id="log-list">
      <div class="log-empty">Belum ada aktivitas.</div>
    </div>
  </aside>
</div>

<!-- Modal Player -->
<div id="modal-overlay">
  <div id="modal-box">
    <div id="modal-hdr">
      <div id="modal-title">—</div>
      <div id="modal-viewers"></div>
      <button class="btn-close" onclick="closeModal()">✕</button>
    </div>
    <div id="player-wrap">
      <video id="admin-player" class="video-js vjs-big-play-button" controls preload="auto" style="width:100%;max-height:400px"></video>
    </div>
    <div id="modal-note">
      Stream diproksikan via server. Jika tidak berputar, cek autentikasi GoParty.
      <br/><a href="#" id="stream-url-link" target="_blank">Buka URL stream langsung ↗</a>
    </div>
  </div>
</div>

<script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
<script>
const API = '/api';
let player = null;
let streams = [];
let logs = [];

/* ── Init ── */
window.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
  loadRepoInfo();
  loadLogs();
  showEmpty();
  if (document.getElementById('conn-status').classList.contains('status-ok')) {
    loadStreams();
  }
});

/* ── Tabs ── */
function showTab(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  event.currentTarget.classList.add('active');
}

/* ── Session ── */
async function checkSession() {
  try {
    const r = await fetch(API + '/vidiocall/session');
    const d = await r.json();
    if (d.connected) {
      setConnected(d.username, d.apiBase);
    } else {
      setDisconnected();
    }
  } catch { setDisconnected(); }
}

function setConnected(username, apiBase) {
  const s = document.getElementById('conn-status');
  s.textContent = '● Terhubung';
  s.className = 'status-ok';
  document.getElementById('btn-refresh').disabled = false;

  const info = document.getElementById('session-info');
  info.style.display = 'block';
  document.getElementById('sess-detail').innerHTML =
    '<strong>User:</strong> ' + (username || '—') + '<br/>' +
    '<strong>Base:</strong> ' + apiBase;
}

function setDisconnected() {
  const s = document.getElementById('conn-status');
  s.textContent = '○ Belum Terhubung';
  s.className = 'status-no';
  document.getElementById('btn-refresh').disabled = true;
  document.getElementById('session-info').style.display = 'none';
}

/* ── Connect ── */
async function doConnect() {
  const btn  = document.getElementById('btn-connect');
  const msg  = document.getElementById('msg-connect');
  const apiBase = document.getElementById('inp-base').value.trim();
  const token   = document.getElementById('inp-token').value.trim();
  const username = document.getElementById('inp-user').value.trim();

  if (!token) { showMsg(msg, 'err', 'Masukkan token terlebih dahulu.'); return; }
  btn.disabled = true;
  btn.textContent = 'Menghubungkan…';
  msg.style.display = 'none';

  try {
    const res = await fetch(API + '/vidiocall/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiBase, token, username }),
    });
    const data = await res.json();

    if (data.success) {
      showMsg(msg, 'ok', 'Berhasil terhubung ke GoParty API! Endpoint: ' + data.endpoint);
      await checkSession();
      setTimeout(() => { showTab('live'); loadStreams(); }, 1000);
    } else {
      const errDetail = data.errors ? data.errors.slice(0,3).join(' | ') : JSON.stringify(data).slice(0,200);
      showMsg(msg, 'err', 'Gagal terhubung. ' + errDetail);
    }
  } catch (e) {
    showMsg(msg, 'err', 'Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hubungkan ke GoParty API';
  }
}

async function doLogout() {
  await fetch(API + '/vidiocall/logout', { method: 'POST' });
  setDisconnected();
  showEmpty();
  document.getElementById('stream-count').textContent = '—';
  document.getElementById('stream-grid').innerHTML = '';
}

/* ── Load Streams ── */
async function loadStreams() {
  const btn = document.getElementById('btn-refresh');
  const grid = document.getElementById('stream-grid');
  btn.disabled = true;

  grid.innerHTML = Array(12).fill('<div class="skeleton"></div>').join('');
  document.getElementById('empty-state').style.display = 'none';

  try {
    const res  = await fetch(API + '/vidiocall/rooms');
    const data = await res.json();

    if (!data.success) {
      grid.innerHTML = '';
      showEmpty(data.error || 'Gagal mengambil data dari GoParty API.');
      document.getElementById('stream-count').textContent = '—';
    } else {
      // extract rooms from various possible response shapes
      const rooms = extractRooms(data.data);
      streams = rooms;
      if (rooms.length) {
        renderGrid(rooms);
        document.getElementById('stream-count').textContent = rooms.length;
        document.getElementById('empty-state').style.display = 'none';
      } else {
        grid.innerHTML = '';
        showEmpty('Tidak ada live room aktif saat ini di GoParty.');
        document.getElementById('stream-count').textContent = '0';
      }
    }
  } catch (e) {
    grid.innerHTML = '';
    showEmpty('Network error: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function extractRooms(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const keys = ['rooms','list','records','data','items','liveList','liveRooms'];
  for (const k of keys) {
    if (data[k] && Array.isArray(data[k])) return data[k];
  }
  // search nested
  for (const val of Object.values(data)) {
    if (Array.isArray(val) && val.length > 0) return val;
    if (val && typeof val === 'object') {
      const nested = extractRooms(val);
      if (nested.length) return nested;
    }
  }
  return [];
}

function renderGrid(rooms) {
  const grid = document.getElementById('stream-grid');
  const coverKeys = ['cover','coverUrl','coverImage','thumbnail','snapshot','image','avatar','anchorAvatar'];
  const nameKeys  = ['name','nickname','anchorName','anchorNickname','username','title','liveName'];
  const viewKeys  = ['viewers','viewerCount','onlineCount','watchCount','viewer','online'];
  const idKeys    = ['id','roomId','liveId','streamId'];

  grid.innerHTML = rooms.map(r => {
    const cover = coverKeys.map(k => r[k]).find(v => v && typeof v === 'string') || '';
    const name  = nameKeys.map(k => r[k]).find(v => v && typeof v === 'string') || 'GoParty Live';
    const views = viewKeys.map(k => r[k]).find(v => v !== undefined) || 0;
    const id    = idKeys.map(k => r[k]).find(v => v) || '';
    const rStr  = JSON.stringify(r).replace(/"/g,'&quot;');
    return \`
      <div class="card" onclick="openStream(\${rStr})">
        \${cover
          ? \`<img class="card-thumb" src="\${cover}" alt="\${name}" loading="lazy" onerror="this.style.display='none'">\`
          : \`<div class="card-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:32px">📡</div>\`}
        <div class="live-badge">LIVE</div>
        <div class="card-body">
          <div class="card-name" title="\${name}">\${name}</div>
          <div class="card-viewers"><span class="vdot"></span>\${fmtNum(views)} penonton</div>
        </div>
      </div>
    \`;
  }).join('');
}

function fmtNum(n) {
  if (!n) return '0';
  const num = Number(n);
  if (num >= 1000) return (num/1000).toFixed(1)+'K';
  return String(num);
}

function showEmpty(msg) {
  const el = document.getElementById('empty-state');
  el.style.display = 'block';
  if (msg) document.getElementById('empty-msg').textContent = msg;
}

/* ── Player ── */
function initPlayer() {
  if (player) return;
  player = videojs('admin-player', {
    fluid:true, aspectRatio:'16:9', controls:true, autoplay:true, muted:true,
    techOrder:['html5'],
  });
}

async function openStream(room) {
  initPlayer();
  const nameKeys = ['name','nickname','anchorName','anchorNickname','username','title','liveName'];
  const viewKeys = ['viewers','viewerCount','onlineCount','watchCount'];
  const streamKeys = ['streamUrl','pullUrl','playUrl','flvUrl','liveUrl','hlsUrl','rtmpUrl','pullAddr','pullAddress'];
  const idKeys   = ['id','roomId','liveId','streamId'];

  const name  = nameKeys.map(k => room[k]).find(v => v && typeof v === 'string') || 'GoParty Live';
  const views = viewKeys.map(k => room[k]).find(v => v !== undefined) || 0;
  const sid   = idKeys.map(k => room[k]).find(v => v) || '';
  let streamUrl = streamKeys.map(k => room[k]).find(v => v && typeof v === 'string') || '';

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-title').textContent = name;
  document.getElementById('modal-viewers').textContent = fmtNum(views) + ' penonton';

  if (streamUrl) {
    document.getElementById('stream-url-link').href = streamUrl;
    const mime = streamUrl.includes('.m3u8') ? 'application/x-mpegURL'
               : streamUrl.includes('.flv') ? 'video/x-flv' : 'video/mp4';
    player.src({ type: mime, src: streamUrl });
    player.play().catch(() => {});
  } else {
    document.getElementById('stream-url-link').href = '#';
    document.getElementById('stream-url-link').textContent = 'URL stream tidak tersedia';
  }

  await logActivity('admin_viewed_stream', String(sid), name);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  if (player) { player.pause(); player.src(''); }
}

/* ── Repo Info ── */
async function loadRepoInfo() {
  try {
    const r = await fetch(API + '/vidiocall/repo-info');
    const d = await r.json();
    if (!d.success) return;
    const a = d.analysis;
    const grid = document.getElementById('repo-grid');
    const fields = [
      ['Nama Aplikasi', a.appName, false],
      ['Package ID', a.appPackage, true],
      ['Versi', a.version, false],
      ['Domain', a.domain, true],
      ['Firebase Project', a.firebase, true],
      ['SDK Chat', a.nimSdk, false],
      ['SDK Auth', a.auth, false],
      ['Streaming', a.streaming, false],
    ];
    grid.innerHTML = fields.map(([lbl, val, isCode]) =>
      \`<div class="info-card">
        <div class="info-label">\${lbl}</div>
        <div class="info-value \${isCode ? 'code' : ''}">\${val}</div>
      </div>\`
    ).join('');
    document.getElementById('repo-note').textContent = '⚠️  ' + a.note;
  } catch { /* ignore */ }
}

/* ── Logs ── */
async function logActivity(event, stream_id, stream_name) {
  try {
    const r = await fetch(API + '/vidiocall/log', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ event, stream_id, stream_name }),
    });
    const d = await r.json();
    if (d.success) prependLog(d.log);
  } catch { /* ignore */ }
}

function prependLog(log) { logs.unshift(log); renderLogs(); }

async function loadLogs() {
  try {
    const r = await fetch(API + '/vidiocall/logs');
    const d = await r.json();
    if (d.success) { logs = d.logs; renderLogs(); }
  } catch { /* ignore */ }
}

function renderLogs() {
  const el = document.getElementById('log-list');
  document.getElementById('log-count').textContent = logs.length;
  if (!logs.length) {
    el.innerHTML = '<div class="log-empty">Belum ada aktivitas.</div>';
    return;
  }
  el.innerHTML = logs.map(l => {
    const t = new Date(l.timestamp);
    const time = t.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const date = t.toLocaleDateString('id-ID', { day:'2-digit', month:'short' });
    return \`<div class="log-item">
      <div class="log-ev">\${l.event}</div>
      <div class="log-nm" title="\${l.stream_name || l.stream_id}">\${l.stream_name || ('ID: '+l.stream_id)}</div>
      <div class="log-tm">\${date}, \${time}</div>
    </div>\`;
  }).join('');
}

function showMsg(el, type, txt) {
  el.className = 'msg ' + type;
  el.textContent = txt;
  el.style.display = 'block';
}

/* ── Events ── */
document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
</script>
</body>
</html>`);
});

export default vidiocallRouter;
