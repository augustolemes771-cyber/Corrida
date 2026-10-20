// Spotify de cada motorista. Cada app do Spotify (o do dono, o da mãe, etc.)
// aceita no máximo 5 contas no modo de desenvolvimento.

export const SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing";
// Status: requested (vaga reservada, esperando o dono liberar no site do Spotify),
// approved (liberado, falta o motorista conectar), connected, waitlist (sem vaga grátis).
const ACTIVE = "('requested','approved','connected')";

const tokens = new Map(); // userId -> { token, exp }

export async function getApp(env, appId) {
  const app = await env.DB.prepare(`SELECT * FROM spotify_apps WHERE id=?`).bind(appId).first();
  if (!app) return null;
  return { ...app, secret: app.client_secret || env.SPOTIFY_CLIENT_SECRET };
}

export async function getLink(env, userId) {
  return env.DB.prepare(`SELECT * FROM spotify_links WHERE user_id=?`).bind(userId).first();
}

export async function appsWithUsage(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.id,a.label,a.client_id,a.capacity,a.free,
       (SELECT COUNT(*) FROM spotify_links l WHERE l.app_id=a.id AND l.status IN ${ACTIVE}) AS used
     FROM spotify_apps a ORDER BY a.id`
  ).all();
  return results;
}

export async function freeSlotsLeft(env) {
  const apps = await appsWithUsage(env);
  return apps.filter((a) => a.free).reduce((n, a) => n + Math.max(0, a.capacity - a.used), 0);
}

// Reserva uma vaga grátis se tiver. Sem vaga, entra na lista de espera.
export async function requestSlot(env, userId, email) {
  const now = Date.now();
  const apps = await appsWithUsage(env);
  const app = apps.find((a) => a.free && a.used < a.capacity);
  const status = app ? "requested" : "waitlist";
  await env.DB.prepare(
    `INSERT INTO spotify_links(user_id,app_id,email,status,refresh,updated_at) VALUES(?,?,?,?,NULL,?)
     ON CONFLICT(user_id) DO UPDATE SET app_id=excluded.app_id, email=excluded.email, status=excluded.status, refresh=NULL, updated_at=excluded.updated_at`
  ).bind(userId, app ? app.id : null, email, status, now).run();
  tokens.delete(userId);
  return status;
}

export async function setLink(env, userId, fields) {
  const cur = (await getLink(env, userId)) || { app_id: null, email: "", status: "none", refresh: null };
  const next = { ...cur, ...fields };
  await env.DB.prepare(
    `INSERT INTO spotify_links(user_id,app_id,email,status,refresh,updated_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET app_id=excluded.app_id, email=excluded.email, status=excluded.status, refresh=excluded.refresh, updated_at=excluded.updated_at`
  ).bind(userId, next.app_id, next.email || "", next.status, next.refresh, Date.now()).run();
  tokens.delete(userId);
}

export async function removeLink(env, userId) {
  await env.DB.prepare(`DELETE FROM spotify_links WHERE user_id=?`).bind(userId).run();
  tokens.delete(userId);
}

const basic = (app) => "Basic " + btoa(app.client_id + ":" + app.secret);

export async function exchangeCode(app, code, redirectUri) {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basic(app), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

async function accessToken(env, userId) {
  const c = tokens.get(userId);
  if (c && Date.now() < c.exp) return c.token;
  const link = await getLink(env, userId);
  if (!link || link.status !== "connected" || !link.refresh) throw new Error("not-connected");
  const app = await getApp(env, link.app_id);
  if (!app) throw new Error("not-connected");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: basic(app), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: link.refresh }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Autorização revogada ou e-mail tirado do app: volta pra "liberado", precisa reconectar.
    if (j.error === "invalid_grant") await setLink(env, userId, { status: "approved", refresh: null });
    throw new Error("refresh-failed");
  }
  tokens.set(userId, { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 });
  if (j.refresh_token && j.refresh_token !== link.refresh) await setLink(env, userId, { refresh: j.refresh_token });
  return j.access_token;
}

export function rememberToken(userId, access, expiresIn) {
  tokens.set(userId, { token: access, exp: Date.now() + (expiresIn - 60) * 1000 });
}

export async function spotifyApi(env, userId, path, init = {}) {
  const t = await accessToken(env, userId);
  return fetch("https://api.spotify.com/v1" + path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: "Bearer " + t },
  });
}

export const slimTrack = (t) => ({
  uri: t.uri,
  name: t.name,
  artists: (t.artists || []).map((a) => a.name).join(", "),
  img: (t.album?.images || []).slice(-1)[0]?.url || "",
});
