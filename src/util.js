// Utilitários comuns: respostas, limites por IP e validação.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export const htmlResponse = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const cut = (v, n) => String(v ?? "").trim().slice(0, n);

export const digits = (v) => String(v ?? "").replace(/\D/g, "");

// Página simples (callback do Spotify, erros, etc.)
export const notice = (title, text, link = "/painel", label = "Voltar pro painel", status = 200) =>
  htmlResponse(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0c0e1a;color:#eef0fa;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;text-align:center">
<div style="max-width:360px"><h2 style="margin:0 0 10px">${esc(title)}</h2><p style="color:#9097b8;margin:0">${esc(text)}</p>
<a href="${esc(link)}" style="display:inline-block;margin-top:20px;background:#ffb347;color:#1b1206;border-radius:12px;padding:14px 24px;font-weight:800;text-decoration:none">${esc(label)}</a></div></body></html>`, status);

// Limite por IP (melhor esforço, por instância do Worker)
const hits = new Map();
export function tooMany(key, max, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

export const ip = (req) => req.headers.get("cf-connecting-ip") || "local";

export async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Nomes de usuário que não podem virar perfil (são rotas do app)
export const RESERVED = new Set([
  "api", "painel", "admin", "entrar", "cadastro", "sair", "callback", "login", "spotify", "img", "respostas",
  "static", "public", "assets", "favicon", "robots", "sobre", "ajuda", "termos", "privacidade", "corrida", "motorista",
  "motoristas", "app", "www", "lobo", "index", "perfil", "config", "editar", "previa",
]);

export const validUsername = (u) => /^[a-z0-9][a-z0-9._]{2,19}$/.test(u) && !RESERVED.has(u);
