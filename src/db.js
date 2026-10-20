// Banco D1: cria as tabelas sozinho e prepara a conta do dono na primeira vez.
import { defaultProfile } from "./profile.js";
import { hashPassword } from "./auth.js";
import { digits } from "./util.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'driver', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS profiles(user_id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS spotify_apps(id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, client_id TEXT NOT NULL, client_secret TEXT, capacity INTEGER NOT NULL DEFAULT 5, free INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS spotify_links(user_id INTEGER PRIMARY KEY, app_id INTEGER, email TEXT, status TEXT NOT NULL, refresh TEXT, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS song_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT, artist TEXT, img TEXT, link TEXT, created_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, src TEXT UNIQUE, data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS places(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, data TEXT, user_id INTEGER, osm_id TEXT UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS fuel_prices(id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL, fuel TEXT NOT NULL, cents INTEGER NOT NULL, user_id INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,kind,ref))`,
  `CREATE INDEX IF NOT EXISTS idx_places_kind ON places(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_fuel_place ON fuel_prices(place_id, fuel, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_req_user ON song_requests(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_fb_user ON feedback(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id)`,
];

let ready = null;

export function ensureDb(env) {
  if (!ready) ready = setup(env).catch((e) => { ready = null; throw e; });
  return ready;
}

async function setup(env) {
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  await seedOwner(env);
}

// A conta do dono (Augusto) nasce com os dados que já estavam no wrangler.toml,
// a senha do ADMIN_PASSWORD e o Spotify que já estava conectado.
async function seedOwner(env) {
  const owner = (env.OWNER_USERNAME || "").toLowerCase();
  if (!owner || !env.ADMIN_PASSWORD) return;
  const now = Date.now();

  if (env.SPOTIFY_CLIENT_ID)
    await env.DB.prepare(
      `INSERT OR IGNORE INTO spotify_apps(id,label,client_id,client_secret,capacity,free,created_at) VALUES(1,?,?,NULL,5,1,?)`
    ).bind("Principal (" + (env.DRIVER_NAME || owner) + ")", env.SPOTIFY_CLIENT_ID, now).run();

  const exists = await env.DB.prepare(`SELECT id FROM users WHERE username=?`).bind(owner).first();
  if (exists) return;

  const pass = await hashPassword(env.ADMIN_PASSWORD);
  const res = await env.DB.prepare(`INSERT OR IGNORE INTO users(username,pass,role,created_at) VALUES(?,?,'admin',?)`)
    .bind(owner, pass, now).run();
  if (!res.meta.changes) return; // outra instância criou ao mesmo tempo
  const id = res.meta.last_row_id;

  const p = defaultProfile({ name: env.DRIVER_NAME || owner, whatsapp: env.WHATSAPP });
  p.instagram = env.INSTAGRAM || "";
  p.pixKey = env.PIX_KEY || "";
  p.pixName = env.PIX_NAME || "";
  p.pixCity = env.PIX_CITY || "";
  p.city = env.PIX_CITY ? env.PIX_CITY.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "";
  p.waMsg = `Oi ${env.DRIVER_NAME || ""}, vim pelo QR da corrida!`.replace("  ", " ");
  p.theme.bg = "lobo";
  p.theme.headline = "O som é *seu*";
  p.theme.sub = "Escolhe a música, pula, pausa e aumenta o volume. Tá liberado.";
  p.modules = ["whatsapp", "musica", "pix", "pesquisa", "instagram", "links"].map((m) => ({ id: m, on: m !== "links" }));
  await env.DB.prepare(`INSERT OR IGNORE INTO profiles(user_id,data,updated_at) VALUES(?,?,?)`)
    .bind(id, JSON.stringify(p), now).run();

  // Spotify que já estava ligado na versão antiga
  let refresh = env.SPOTIFY_REFRESH_TOKEN || null;
  if (env.RESPOSTAS) refresh = (await env.RESPOSTAS.get("cfg:refresh")) || refresh;
  if (env.SPOTIFY_CLIENT_ID)
    await env.DB.prepare(`INSERT OR IGNORE INTO spotify_links(user_id,app_id,email,status,refresh,updated_at) VALUES(?,1,'',?,?,?)`)
      .bind(id, refresh ? "connected" : "approved", refresh, now).run();

  // Respostas do questionário que estavam no KV
  if (env.RESPOSTAS) {
    let cursor;
    const stmts = [];
    do {
      const l = await env.RESPOSTAS.list({ prefix: "r:", cursor });
      for (const k of l.keys) {
        const v = await env.RESPOSTAS.get(k.name);
        if (!v) continue;
        let r;
        try { r = JSON.parse(v); } catch { continue; }
        stmts.push(
          env.DB.prepare(`INSERT OR IGNORE INTO feedback(user_id,src,data,created_at) VALUES(?,?,?,?)`)
            .bind(id, k.name, v, Date.parse(r.quando) || now)
        );
      }
      cursor = l.list_complete ? null : l.cursor;
    } while (cursor);
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  }
}

export async function getUserByName(env, username) {
  return env.DB.prepare(`SELECT id,username,role FROM users WHERE username=?`).bind(String(username).toLowerCase()).first();
}

export async function getProfile(env, userId) {
  const row = await env.DB.prepare(`SELECT data FROM profiles WHERE user_id=?`).bind(userId).first();
  return row ? { ...defaultProfile(), ...JSON.parse(row.data) } : defaultProfile();
}

export async function saveProfile(env, userId, p) {
  await env.DB.prepare(`INSERT INTO profiles(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at`)
    .bind(userId, JSON.stringify(p), Date.now()).run();
}

export const ownerWhatsapp = (env) => digits(env.WHATSAPP);
