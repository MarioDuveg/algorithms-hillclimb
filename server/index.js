import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Room } from './room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin2026';
const TICK_MS = Math.max(100, Math.min(3000, Number(process.env.TICK_MS) || 450));
const MAX_BODY = 8192;
const sessions = new Map();
const streams = new Map();
const loginFailures = new Map();
let room;

function sendJSON(res, code, obj, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function fail(res, status, message) { sendJSON(res, status, { error: message }); }
function cookies(req) {
  const result = {};
  for (const segment of (req.headers.cookie || '').split(';')) {
    const pos = segment.indexOf('=');
    if (pos > 0) result[segment.slice(0, pos).trim()] = segment.slice(pos + 1).trim();
  }
  return result;
}
function getSession(req) {
  const sid = cookies(req).sid;
  const session = sid ? sessions.get(sid) : null;
  if (!session || !room.players.has(sid)) return null;
  return { sid, session, player: room.players.get(sid) };
}
function cookieHeader(req, sid, maxAge = 60 * 60 * 24) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto']?.split(',')[0] === 'https';
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function removeSession(sid) {
  const connections = streams.get(sid);
  if (connections) {
    for (const conn of connections) conn.end();
    streams.delete(sid);
  }
  sessions.delete(sid);
  room.remove(sid);
}
function safeEqual(given, actual) {
  const x = crypto.createHash('sha256').update(given).digest();
  const y = crypto.createHash('sha256').update(actual).digest();
  return crypto.timingSafeEqual(x, y);
}
function checkOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; }
  catch { return false; }
}
async function jsonBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Se necesita JSON'), { code: 415 });
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw Object.assign(new Error('Solicitud demasiado grande'), { code: 413 });
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw Object.assign(new Error('JSON no válido'), { code: 400 }); }
}
function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(room.snapshot())}\n\n`;
  for (const [sid, conns] of streams) {
    if (!sessions.has(sid)) continue;
    for (const res of conns) {
      if (!res.destroyed && !res.writableEnded) res.write(payload);
    }
  }
}

room = new Room(broadcast);

async function serveStatic(urlPath, res) {
  let resolved;
  if (urlPath === '/shared/terrain.js') resolved = path.join(ROOT, 'shared', 'terrain.js');
  else if (urlPath === '/shared/algorithms.js') resolved = path.join(ROOT, 'shared', 'algorithms.js');
  else {
    let name;
    try { name = decodeURIComponent(urlPath); } catch { return fail(res, 400, 'Ruta inválida'); }
    name = name === '/' ? '/index.html' : name;
    resolved = path.resolve(CLIENT, `.${name}`);
    if (!resolved.startsWith(CLIENT + path.sep)) return fail(res, 403, 'Ruta no permitida');
  }
  try {
    const content = await fs.readFile(resolved);
    const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, {
      'content-type': mime[path.extname(resolved)] || 'application/octet-stream',
      'cache-control': 'public, max-age=180',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'x-frame-options': 'DENY',
    });
    res.end(content);
  } catch (error) { fail(res, error.code === 'ENOENT' ? 404 : 500, 'Archivo no disponible'); }
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJSON(res, 200, { status: 'ok', phase: room.phase, uptime: Math.floor(process.uptime()) });
  }
  if (req.method === 'GET' && pathname === '/api/me') {
    const auth = getSession(req);
    return auth ? sendJSON(res, 200, { player: { id: auth.sid, name: auth.player.name, isAdmin: auth.player.isAdmin }, state: room.snapshot() })
      : fail(res, 401, 'Sesión no iniciada');
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    const auth = getSession(req);
    if (!auth) return fail(res, 401, 'Debes iniciar sesión');
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': stream abierto\n\n');
    let clients = streams.get(auth.sid);
    if (!clients) { clients = new Set(); streams.set(auth.sid, clients); }
    clients.add(res);
    room.setOnline(auth.sid, true);
    res.write(`event: state\ndata: ${JSON.stringify(room.snapshot())}\n\n`);
    res.on('close', () => {
      clients.delete(res);
      if (!clients.size) { streams.delete(auth.sid); room.setOnline(auth.sid, false); }
    });
    return;
  }
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    if (!checkOrigin(req)) return fail(res, 403, 'Origen de solicitud no permitido');
    if (pathname === '/api/logout') {
      const auth = getSession(req);
      if (auth) removeSession(auth.sid);
      return sendJSON(res, 200, { ok: true }, { 'set-cookie': cookieHeader(req, '', 0) });
    }
    const body = await jsonBody(req);
    if (pathname === '/api/login') {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (name.length < 2 || name.length > 24 || !/^[\p{L}\p{N}_ .-]+$/u.test(name)) return fail(res, 400, 'Usa un nombre de 2 a 24 caracteres (letras, números, espacios, _, . o -).');
      const admin = name.toLocaleLowerCase('es') === 'admin';
      if (admin) {
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
        const info = loginFailures.get(ip) || { fails: 0, until: Date.now() + 10 * 60 * 1000 };
        if (info.until < Date.now()) { info.fails = 0; info.until = Date.now() + 10 * 60 * 1000; }
        if (info.fails >= 8) return fail(res, 429, 'Demasiados intentos de administrador. Vuelve a intentarlo más tarde.');
        if (typeof body.password !== 'string' || !safeEqual(body.password, ADMIN_PASSWORD)) {
          info.fails++;
          loginFailures.set(ip, info);
          return fail(res, 403, 'Contraseña de administrador incorrecta');
        }
        loginFailures.delete(ip);
      }
      const existing = getSession(req);
      if (existing) removeSession(existing.sid);
      const sid = crypto.randomBytes(24).toString('hex');
      try {
        const player = room.join(sid, name, admin);
        sessions.set(sid, { createdAt: Date.now() });
        return sendJSON(res, 200, { player: { id: sid, name: player.name, isAdmin: admin }, state: room.snapshot() }, { 'set-cookie': cookieHeader(req, sid) });
      } catch (e) { return fail(res, 409, e.message); }
    }
    const auth = getSession(req);
    if (!auth) return fail(res, 401, 'Debes iniciar sesión');
    if (pathname === '/api/select') {
      room.select(auth.sid, body.algorithm, body.params);
      return sendJSON(res, 200, { ok: true, state: room.snapshot() });
    }
    if (pathname === '/api/start') {
      const count = room.start(auth.sid);
      return sendJSON(res, 200, { ok: true, count, state: room.snapshot() });
    }
    if (pathname === '/api/reset') {
      room.reset(auth.sid);
      return sendJSON(res, 200, { ok: true, state: room.snapshot() });
    }
    return fail(res, 404, 'Acción desconocida');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(pathname, res);
  return fail(res, 405, 'Método no permitido');
}

export function createServer() {
  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((error) => {
      if (!res.headersSent) fail(res, error.code && Number.isInteger(error.code) ? error.code : 400, error.message || 'Error de servidor');
      else res.end();
    });
  });
  const ticker = setInterval(() => room.tick(), TICK_MS);
  const heartbeat = setInterval(() => {
    for (const clients of streams.values()) for (const res of clients) if (!res.destroyed) res.write(': ping\n\n');
    // Las sesiones sin stream se mantienen unos segundos para reconexión transitoria.
    for (const [sid, session] of sessions) {
      const player = room.players.get(sid);
      if (player && !player.online) {
        if (!session.offlineSince) session.offlineSince = Date.now();
        if (Date.now() - session.offlineSince > 90_000) removeSession(sid);
      } else session.offlineSince = null;
      if (Date.now() - session.createdAt > 24 * 60 * 60 * 1000) removeSession(sid);
    }
  }, 12_000);
  server.on('close', () => { clearInterval(ticker); clearInterval(heartbeat); });
  return { server, room };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 10000;
  const { server } = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Summit Lab 3D disponible en http://localhost:${port}`);
    if (!process.env.ADMIN_PASSWORD) console.warn('ATENCIÓN: contraseña admin de demostración. Configura ADMIN_PASSWORD en Render.');
  });
}
