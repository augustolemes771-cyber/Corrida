// Contas com usuário e senha. Senha guardada com PBKDF2 e sessão por cookie.

const ITER = 100000; // máximo aceito pelo PBKDF2 nos Workers
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await derive(password, salt, ITER))}`;
}

export async function checkPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored).split("$");
  if (kind !== "pbkdf2") return false;
  const got = new Uint8Array(await derive(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

const SESSION_DAYS = 60;

export async function createSession(env, userId, secure) {
  const token = b64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await env.DB.prepare(`INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)`).bind(token, userId, expires).run();
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
}

export const clearCookie = (secure) => `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

const tokenFrom = (req) => (req.headers.get("cookie") || "").match(/(?:^|;\s*)sid=([A-Za-z0-9_-]+)/)?.[1];

export async function currentUser(env, req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id,u.username,u.role,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`
  ).bind(token).first();
  if (!row || row.expires < Date.now()) return null;
  return { id: row.id, username: row.username, role: row.role, token };
}

export async function endSession(env, req) {
  const token = tokenFrom(req);
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token=?`).bind(token).run();
}

// Pedidos que mudam algo precisam vir do próprio site (proteção contra CSRF).
export function sameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  return origin === new URL(req.url).origin;
}
