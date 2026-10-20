// Mapa da cidade: lugares marcados pelos motoristas, parceiros (indicações) e postos com preço.
import { cut, digits } from "./util.js";

// Lugares que os motoristas marcam. passenger: aparece no mapa do passageiro. hours: some sozinho depois disso.
export const LUGAR = {
  mercado: { label: "Mercado", passenger: true },
  farmacia: { label: "Farmácia", passenger: true },
  turismo: { label: "Ponto turístico", passenger: true },
  restaurante: { label: "Restaurante e lanche", passenger: true },
  balada: { label: "Bar e balada", passenger: true },
  saude: { label: "Saúde", passenger: true },
  hotel: { label: "Hotel e pousada", passenger: true },
  apoio: { label: "Ponto de apoio", passenger: false },
  movimento: { label: "Movimento agora", passenger: false, hours: 4 },
  outro: { label: "Outro lugar", passenger: true },
};

// Empresas que o dono cadastra pra divulgar pros motoristas
export const PARCEIRO = {
  oficina: { label: "Oficina mecânica" },
  lavajato: { label: "Lava-jato" },
  estetica: { label: "Estética automotiva" },
  borracharia: { label: "Borracharia" },
  autopecas: { label: "Auto peças" },
  eletrica: { label: "Auto elétrica" },
  guincho: { label: "Guincho" },
  outro: { label: "Outro serviço" },
};

export const FUELS = ["gasolina", "etanol", "diesel", "gnv"];

export const cityOf = (env) => ({
  name: env.CITY_NAME || "Caldas Novas",
  lat: Number(env.CITY_LAT) || -17.7441,
  lng: Number(env.CITY_LNG) || -48.625,
});

const near = (env, lat, lng) => {
  const c = cityOf(env);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat - c.lat) < 0.6 && Math.abs(lng - c.lng) < 0.6;
};

const httpUrl = (v) => {
  const s = cut(v, 300);
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    return /^https?:$/.test(u.protocol) ? u.toString() : "";
  } catch {
    return "";
  }
};

// Limpa o que vem do formulário de lugar/parceiro
export function cleanPlace(env, b, kind, isAdmin) {
  const cats = kind === "parceiro" ? PARCEIRO : LUGAR;
  const category = cats[b.category] ? b.category : null;
  if (!category) return { error: "Escolha uma categoria." };
  const name = cut(b.name, 60);
  if (!name) return { error: "Coloque o nome do lugar." };
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!near(env, lat, lng)) return { error: "Marque um ponto dentro da cidade." };
  const data = {
    desc: cut(b.desc, 500),
    address: cut(b.address, 160),
    hours: cut(b.hours, 80),
    open24: !!b.open24,
    phone: digits(b.phone).slice(0, 13),
    whatsapp: digits(b.whatsapp).slice(0, 13),
    instagram: cut(b.instagram, 30).replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, ""),
    link: httpUrl(b.link),
  };
  if (kind === "parceiro" && isAdmin) data.discount = cut(b.discount, 120);
  const hours = cats[category].hours;
  return { category, name, lat, lng, data, expires: hours ? Date.now() + hours * 3600 * 1000 : null };
}

export function placeOut(row, prices) {
  const d = row.data ? JSON.parse(row.data) : {};
  return {
    id: row.id, kind: row.kind, category: row.category, name: row.name, lat: row.lat, lng: row.lng,
    ...d,
    photo: d.photoVersion ? `/img/p/${row.id}?v=${d.photoVersion}` : "",
    by: row.username || "", mine: false, expires: row.expires_at || null, updated: row.updated_at,
    prices: prices || undefined,
  };
}

// Preço mais recente de cada combustível por posto (últimos 30 dias)
export async function latestPrices(env) {
  const { results } = await env.DB.prepare(
    `SELECT f.place_id,f.fuel,f.cents,f.created_at,u.username FROM fuel_prices f
     LEFT JOIN users u ON u.id=f.user_id
     WHERE f.created_at>? AND f.created_at=(SELECT MAX(created_at) FROM fuel_prices g WHERE g.place_id=f.place_id AND g.fuel=f.fuel)`
  ).bind(Date.now() - 30 * 864e5).all();
  const map = {};
  for (const r of results) (map[r.place_id] ||= {})[r.fuel] = { cents: r.cents, at: r.created_at, by: r.username || "" };
  return map;
}

export async function listPlaces(env, kinds, me) {
  const marks = kinds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT p.*,u.username FROM places p LEFT JOIN users u ON u.id=p.user_id
     WHERE p.kind IN (${marks}) AND (p.expires_at IS NULL OR p.expires_at>?) ORDER BY p.name`
  ).bind(...kinds, Date.now()).all();
  const prices = kinds.includes("posto") ? await latestPrices(env) : {};
  return results.map((r) => {
    const o = placeOut(r, r.kind === "posto" ? prices[r.id] || {} : undefined);
    o.mine = !!me && r.user_id === me.id;
    return o;
  });
}

// Postos da cidade a partir do OpenStreetMap (nome, bandeira e localização)
export async function importFuelStations(env) {
  const c = cityOf(env);
  const d = 0.18; // ~20 km pra cada lado
  const q = `[out:json][timeout:50];nwr["amenity"="fuel"](${c.lat - d},${c.lng - d},${c.lat + d},${c.lng + d});out center tags;`;
  // O servidor principal às vezes fica sobrecarregado: tenta os espelhos em seguida
  let j = null, last = "";
  for (const host of ["https://overpass-api.de", "https://overpass.private.coffee"]) {
    try {
      const r = await fetch(host + "/api/interpreter", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "DriverHub/1.0 (corrida.augusto7.workers.dev)" },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(55000),
      });
      if (r.ok) { j = await r.json(); break; }
      last += host + " " + r.status + " " + (await r.text()).slice(0, 160) + " | ";
    } catch (e) { last += host + " " + e.message + " | "; }
  }
  if (!j) throw new Error("overpass " + last);
  const now = Date.now();
  const stmts = [];
  for (const e of j.elements || []) {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    if (!Number.isFinite(lat)) continue;
    const t = e.tags || {};
    const name = cut(t.name || (t.brand ? "Posto " + t.brand : "Posto sem nome"), 60);
    const data = JSON.stringify({ brand: cut(t.brand || "", 40), address: cut([t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", "), 160), open24: t.opening_hours === "24/7" });
    stmts.push(env.DB.prepare(
      `INSERT INTO places(kind,category,name,lat,lng,data,user_id,osm_id,created_at,updated_at) VALUES('posto','posto',?,?,?,?,NULL,?,?,?)
       ON CONFLICT(osm_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng`
    ).bind(name, lat, lng, data, `${e.type}/${e.id}`, now, now));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  await env.RESPOSTAS.put("cfg:postos-importados", String(now));
  return stmts.length;
}

export async function ensureFuelStations(env) {
  const last = Number(await env.RESPOSTAS.get("cfg:postos-importados")) || 0;
  if (Date.now() - last < 7 * 864e5) return;
  // Marca antes de começar: se falhar, tenta de novo amanhã (e evita buscas repetidas ao mesmo tempo)
  await env.RESPOSTAS.put("cfg:postos-importados", String(Date.now() - 6 * 864e5));
  try { await importFuelStations(env); } catch (e) { console.error("postos", e.message); }
}
