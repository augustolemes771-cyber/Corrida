// Modelo do perfil do motorista: valores padrão e limpeza do que vem do painel.
import { cut, digits } from "./util.js";

export const MODULES = ["musica", "pix", "whatsapp", "instagram", "links", "pesquisa"];
export const THEMES = ["noite", "grafite", "floresta", "vinho", "oceano", "claro"];
export const FONTS = ["poster", "redonda", "classica"];
export const BACKGROUNDS = ["nenhum", "lobo", "foto"];
export const SERVICES = ["spotify", "ytmusic", "apple", "deezer"];
export const TAGS = [
  "Ar-condicionado", "Carregador de celular", "Água", "Bala", "Wi-Fi", "Pode comer", "Aceita pet",
  "Cadeirinha", "Carro silencioso", "Porta-malas livre",
];

export function defaultProfile({ name = "", whatsapp = "" } = {}) {
  return {
    name,
    city: "",
    car: "",
    since: "",
    bio: "",
    tags: [],
    instagram: "",
    whatsapp: digits(whatsapp),
    waMsg: "",
    pixKey: "",
    pixName: "",
    pixCity: "",
    links: [],
    theme: { preset: "noite", accent: "", font: "poster", bg: "nenhum", headline: "O som é *seu*", sub: "Escolhe a música e curte a corrida." },
    modules: [
      { id: "whatsapp", on: true },
      { id: "musica", on: true },
      { id: "pix", on: false },
      { id: "instagram", on: false },
      { id: "links", on: false },
      { id: "pesquisa", on: false },
    ],
    music: { service: "spotify", control: true },
    hasAvatar: false,
    bgVersion: 0,
    avatarVersion: 0,
  };
}

const pick = (v, list, def) => (list.includes(v) ? v : def);
const color = (v) => (/^#[0-9a-fA-F]{6}$/.test(v || "") ? v.toLowerCase() : "");
const url = (v) => {
  const s = cut(v, 300);
  if (!s) return "";
  const withProto = /^https?:\/\//i.test(s) ? s : "https://" + s;
  try {
    const u = new URL(withProto);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
};

// Junta o que veio do painel com o perfil salvo, aceitando só campos conhecidos.
export function mergeProfile(saved, input) {
  const p = structuredClone(saved);
  const i = input || {};
  const text = (k, n) => { if (k in i) p[k] = cut(i[k], n); };
  text("name", 40);
  text("city", 40);
  text("car", 60);
  text("since", 4);
  text("bio", 280);
  text("waMsg", 120);
  text("pixName", 25);
  text("pixCity", 15);
  text("pixKey", 77);
  if ("instagram" in i) p.instagram = cut(i.instagram, 30).replace(/^@/, "").replace(/[^A-Za-z0-9._]/g, "");
  if ("whatsapp" in i) p.whatsapp = digits(i.whatsapp).slice(0, 15);
  if ("since" in i && !/^(19|20)\d\d$/.test(p.since)) p.since = "";
  if (Array.isArray(i.tags)) p.tags = [...new Set(i.tags.filter((t) => TAGS.includes(t)))];
  if (Array.isArray(i.links))
    p.links = i.links
      .slice(0, 6)
      .map((l) => ({ label: cut(l?.label, 30), url: url(l?.url) }))
      .filter((l) => l.label && l.url);
  if (i.theme) {
    const t = i.theme;
    p.theme = {
      preset: pick(t.preset, THEMES, p.theme.preset),
      accent: "accent" in t ? color(t.accent) : p.theme.accent,
      font: pick(t.font, FONTS, p.theme.font),
      bg: pick(t.bg, BACKGROUNDS, p.theme.bg),
      headline: "headline" in t ? cut(t.headline, 40) : p.theme.headline,
      sub: "sub" in t ? cut(t.sub, 90) : p.theme.sub,
    };
  }
  if (Array.isArray(i.modules)) {
    const seen = new Set();
    const list = [];
    for (const m of i.modules) {
      if (MODULES.includes(m?.id) && !seen.has(m.id)) { seen.add(m.id); list.push({ id: m.id, on: !!m.on }); }
    }
    for (const id of MODULES) if (!seen.has(id)) list.push({ id, on: false });
    p.modules = list;
  }
  if (i.music) {
    p.music = {
      service: pick(i.music.service, SERVICES, p.music.service),
      control: "control" in i.music ? !!i.music.control : p.music.control,
    };
  }
  return p;
}

// Versão pública: só o que o passageiro pode ver.
export function publicProfile(user, p, music) {
  const on = (id) => p.modules.find((m) => m.id === id)?.on;
  return {
    username: user.username,
    name: p.name || user.username,
    city: p.city,
    car: p.car,
    since: p.since,
    bio: p.bio,
    tags: p.tags,
    avatar: p.hasAvatar ? `/img/${user.id}/avatar?v=${p.avatarVersion}` : "",
    bgImage: p.theme.bg === "foto" && p.bgVersion ? `/img/${user.id}/fundo?v=${p.bgVersion}` : "",
    theme: p.theme,
    modules: p.modules.filter((m) => m.on).map((m) => m.id),
    instagram: on("instagram") || on("pesquisa") ? p.instagram : "",
    whatsapp: on("whatsapp") || on("instagram") ? p.whatsapp : "",
    waMsg: p.waMsg,
    pix: on("pix") && p.pixKey ? { key: p.pixKey, name: p.pixName || p.name, city: p.pixCity || p.city } : null,
    links: on("links") ? p.links : [],
    music, // { mode: "control" | "pedido", control: bool, service }
  };
}
