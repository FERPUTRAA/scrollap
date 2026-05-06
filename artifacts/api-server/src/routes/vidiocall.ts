import { Router, type Request, type Response } from "express";

const vidiocallRouter = Router();

interface ActivityLog {
  id: string;
  event: string;
  stream_id: string;
  stream_name: string;
  timestamp: string;
}

const activityLogs: ActivityLog[] = [];
const MAX_LOGS = 100;

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

/** POST /api/vidiocall/log */
vidiocallRouter.post("/vidiocall/log", (req: Request, res: Response) => {
  const { event = "admin_viewed_stream", stream_id = "", stream_name = "" } = req.body as {
    event?: string;
    stream_id?: string;
    stream_name?: string;
  };
  const log = addLog(event, stream_id, stream_name);
  res.json({ success: true, log });
});

/** GET /api/vidiocall/logs */
vidiocallRouter.get("/vidiocall/logs", (_req: Request, res: Response) => {
  res.json({ success: true, logs: activityLogs });
});

/** GET /vidiocall — Admin Dashboard HTML */
vidiocallRouter.get("/vidiocall", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Dashboard — Video Live</title>
  <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d0f14;
      --surface: #161b24;
      --surface2: #1e2533;
      --border: #2a3348;
      --accent: #5865f2;
      --accent2: #eb4034;
      --text: #e8eaf0;
      --muted: #8b92a5;
      --live: #eb4034;
      --success: #3ba55d;
      --radius: 12px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
    }

    /* ── HEADER ── */
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .logo-dot {
      width: 10px; height: 10px;
      background: var(--live);
      border-radius: 50%;
      animation: pulse 1.4s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.5; transform: scale(1.4); }
    }
    .header-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    #stream-count {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 4px 14px;
      font-size: 13px;
      color: var(--muted);
    }
    #stream-count span { color: var(--text); font-weight: 600; }
    .btn-refresh {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity .15s;
    }
    .btn-refresh:hover { opacity: .85; }
    .btn-refresh:disabled { opacity: .4; cursor: not-allowed; }

    /* ── LAYOUT ── */
    .layout {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 0;
      min-height: calc(100vh - 57px);
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { border-left: none; border-top: 1px solid var(--border); }
    }

    /* ── MAIN ── */
    main { padding: 20px; overflow: hidden; }

    .section-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 14px;
    }

    /* ── GRID ── */
    #stream-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 14px;
    }

    .stream-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      cursor: pointer;
      transition: transform .18s, border-color .18s, box-shadow .18s;
      position: relative;
    }
    .stream-card:hover {
      transform: translateY(-3px);
      border-color: var(--accent);
      box-shadow: 0 6px 24px rgba(88,101,242,.18);
    }
    .stream-card-thumb {
      width: 100%;
      aspect-ratio: 9/16;
      object-fit: cover;
      display: block;
      background: var(--surface2);
    }
    .live-badge {
      position: absolute;
      top: 8px; left: 8px;
      background: var(--live);
      color: #fff;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .5px;
      padding: 2px 7px;
      border-radius: 4px;
    }
    .stream-card-body {
      padding: 10px 12px;
    }
    .stream-name {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }
    .stream-viewers {
      font-size: 11px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .viewer-dot { width: 6px; height: 6px; background: var(--success); border-radius: 50%; }

    /* ── SKELETON ── */
    .skeleton {
      background: linear-gradient(90deg, var(--surface2) 25%, #252d3d 50%, var(--surface2) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s infinite;
      border-radius: var(--radius);
      aspect-ratio: 9/16;
    }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── ERROR STATE ── */
    #error-state {
      display: none;
      text-align: center;
      padding: 60px 20px;
      color: var(--muted);
    }
    #error-state h3 { color: var(--text); margin-bottom: 8px; }

    /* ── SIDEBAR ── */
    .sidebar {
      background: var(--surface);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      padding: 16px 18px 12px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .log-count {
      background: var(--accent);
      color: #fff;
      border-radius: 10px;
      font-size: 11px;
      padding: 1px 7px;
      font-weight: 700;
    }
    #log-list {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    #log-list::-webkit-scrollbar { width: 4px; }
    #log-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

    .log-item {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 12px;
      animation: fadeIn .3s ease;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    .log-event {
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 3px;
    }
    .log-stream { color: var(--text); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .log-time { color: var(--muted); font-size: 10px; }
    .log-empty { color: var(--muted); text-align: center; padding: 30px 10px; font-size: 13px; }

    /* ── MODAL ── */
    #modal-overlay {
      display: none;
      position: fixed; inset: 0;
      background: rgba(0,0,0,.85);
      z-index: 200;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    #modal-overlay.open { display: flex; }
    #modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 100%;
      max-width: 560px;
      overflow: hidden;
      position: relative;
    }
    #modal-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #modal-title { font-weight: 700; font-size: 15px; flex: 1; }
    #modal-viewers { font-size: 12px; color: var(--muted); }
    .btn-close {
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 6px;
      width: 30px; height: 30px;
      cursor: pointer;
      font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s;
    }
    .btn-close:hover { background: var(--accent2); border-color: var(--accent2); }
    #player-wrap {
      position: relative;
      background: #000;
    }
    #modal-note {
      padding: 10px 18px 14px;
      font-size: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }
    #modal-note a { color: var(--accent); text-decoration: none; }
    #modal-note a:hover { text-decoration: underline; }

    /* Video.js overrides */
    .video-js { width: 100% !important; max-height: 400px; }
    .vjs-big-play-button { top: 50% !important; left: 50% !important; transform: translate(-50%,-50%) !important; }
  </style>
</head>
<body>

<header>
  <div class="logo">
    <div class="logo-dot"></div>
    Admin Dashboard
  </div>
  <div class="header-right">
    <div id="stream-count"><span id="count-num">—</span> Live Streams</div>
    <button class="btn-refresh" id="btn-refresh" onclick="loadStreams()">↺ Refresh</button>
  </div>
</header>

<div class="layout">
  <main>
    <div class="section-title">Semua Stream Aktif</div>
    <div id="stream-grid"></div>
    <div id="error-state">
      <h3 id="error-title">Gagal memuat data</h3>
      <p id="error-msg"></p>
    </div>
  </main>

  <aside class="sidebar">
    <div class="sidebar-header">
      Activity Log
      <span class="log-count" id="log-count">0</span>
    </div>
    <div id="log-list">
      <div class="log-empty">Belum ada aktivitas.<br/>Klik stream untuk mulai.</div>
    </div>
  </aside>
</div>

<!-- Modal Player -->
<div id="modal-overlay">
  <div id="modal-box">
    <div id="modal-header">
      <div id="modal-title">—</div>
      <div id="modal-viewers"></div>
      <button class="btn-close" onclick="closeModal()">✕</button>
    </div>
    <div id="player-wrap">
      <video
        id="admin-player"
        class="video-js vjs-theme-city vjs-big-play-button"
        controls
        preload="auto"
        style="width:100%;max-height:400px;"
      ></video>
    </div>
    <div id="modal-note">
      Stream FLV diproksikan melalui server lokal. 
      Jika tidak berputar, pastikan IP server di-allowlist oleh CDN.
      <br/>
      <a href="#" id="stream-url-link" target="_blank">Buka URL stream langsung ↗</a>
    </div>
  </div>
</div>

<script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
<script>
  const BASE = '/api';
  let player = null;
  let allStreams = [];
  let logs = [];

  /* ── Video.js player init ── */
  function initPlayer() {
    if (player) return;
    player = videojs('admin-player', {
      fluid: true,
      aspectRatio: '16:9',
      techOrder: ['html5'],
      html5: { hls: { overrideNative: true } },
      controls: true,
      autoplay: true,
      muted: true,
    });
  }

  /* ── Load streams ── */
  async function loadStreams() {
    const btn = document.getElementById('btn-refresh');
    const grid = document.getElementById('stream-grid');
    const err  = document.getElementById('error-state');
    btn.disabled = true;
    err.style.display = 'none';

    // show skeletons
    grid.innerHTML = Array(12).fill('<div class="skeleton"></div>').join('');

    try {
      const res  = await fetch(BASE + '/live-rooms?limit=60');
      const data = await res.json();

      if (!data.success) throw new Error(data.error || 'API error');
      allStreams = data.rooms || [];
      renderGrid(allStreams);
      document.getElementById('count-num').textContent = allStreams.length;
    } catch (e) {
      grid.innerHTML = '';
      document.getElementById('error-title').textContent = 'Gagal memuat stream';
      document.getElementById('error-msg').textContent   = e.message;
      err.style.display = 'block';
      document.getElementById('count-num').textContent = '—';
    } finally {
      btn.disabled = false;
    }
  }

  function renderGrid(rooms) {
    const grid = document.getElementById('stream-grid');
    if (!rooms.length) {
      grid.innerHTML = '';
      document.getElementById('error-title').textContent = 'Tidak ada stream aktif';
      document.getElementById('error-msg').textContent   = 'Semua live room sedang offline atau API tidak tersedia.';
      document.getElementById('error-state').style.display = 'block';
      return;
    }
    grid.innerHTML = rooms.map(r => \`
      <div class="stream-card" onclick="openStream(\${JSON.stringify(r).replace(/"/g, '&quot;')})">
        \${r.cover
          ? \`<img class="stream-card-thumb" src="\${r.cover}" alt="\${r.name}" loading="lazy" onerror="this.style.display='none'">\`
          : \`<div class="stream-card-thumb" style="display:flex;align-items:center;justify-content:center;color:#8b92a5;font-size:30px">📡</div>\`
        }
        <div class="live-badge">LIVE</div>
        <div class="stream-card-body">
          <div class="stream-name" title="\${r.name}">\${r.name}</div>
          <div class="stream-viewers">
            <span class="viewer-dot"></span>
            \${formatNum(r.viewers)} penonton
          </div>
        </div>
      </div>
    \`).join('');
  }

  function formatNum(n) {
    if (!n) return '0';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return String(n);
  }

  /* ── Open stream modal ── */
  async function openStream(room) {
    initPlayer();
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('modal-title').textContent   = room.name;
    document.getElementById('modal-viewers').textContent = formatNum(room.viewers) + ' penonton';

    const proxyUrl = BASE + '/stream-proxy?roomId=' + room.id + '&anchorId=' + room.anchorId + '&liveId=' + room.liveId;
    document.getElementById('stream-url-link').href = proxyUrl;
    document.getElementById('stream-url-link').textContent = 'Buka URL stream langsung ↗';

    player.src({ type: 'video/x-flv', src: proxyUrl });
    player.play().catch(() => {});

    await logActivity('admin_viewed_stream', room.id, room.name);
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    if (player) { player.pause(); player.src(''); }
  }

  /* ── Log activity ── */
  async function logActivity(event, stream_id, stream_name) {
    try {
      const res = await fetch(BASE + '/vidiocall/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, stream_id, stream_name }),
      });
      const data = await res.json();
      if (data.success) prependLog(data.log);
    } catch {
      // fail silently — main function still works
    }
  }

  function prependLog(log) {
    logs.unshift(log);
    renderLogs();
  }

  async function loadLogs() {
    try {
      const res  = await fetch(BASE + '/vidiocall/logs');
      const data = await res.json();
      if (data.success) {
        logs = data.logs;
        renderLogs();
      }
    } catch { /* ignore */ }
  }

  function renderLogs() {
    const el = document.getElementById('log-list');
    document.getElementById('log-count').textContent = logs.length;

    if (!logs.length) {
      el.innerHTML = '<div class="log-empty">Belum ada aktivitas.<br/>Klik stream untuk mulai.</div>';
      return;
    }

    el.innerHTML = logs.map(l => {
      const t = new Date(l.timestamp);
      const time = t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const date = t.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      return \`
        <div class="log-item">
          <div class="log-event">\${l.event}</div>
          <div class="log-stream" title="\${l.stream_name || l.stream_id}">\${l.stream_name || ('ID: ' + l.stream_id)}</div>
          <div class="log-time">\${date}, \${time}</div>
        </div>
      \`;
    }).join('');
  }

  /* ── Close modal on overlay click ── */
  document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  /* ── Close modal on Escape ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  /* ── Init ── */
  loadStreams();
  loadLogs();
</script>
</body>
</html>`);
});

export default vidiocallRouter;
