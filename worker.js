// Corrida do Augusto — Cloudflare Worker
// Serve a página do passageiro e conversa com o Spotify usando a SUA conta.
import PAGE from "./page.html";

const SCOPES = "user-modify-playback-state user-read-playback-state user-read-currently-playing";
let cache = { token: null, exp: 0 };
const hits = new Map(); // limite por IP (melhor esforço)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const html = (body) =>
  new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
      `<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>` +
      `</head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );

async function refreshToken(env) {
  const saved = env.RESPOSTAS ? await env.RESPOSTAS.get("cfg:refresh") : null;
  return saved || env.SPOTIFY_REFRESH_TOKEN || null;
}

async function accessToken(env) {
  if (cache.token && Date.now() < cache.exp) return cache.token;
  const rt = await refreshToken(env);
  if (!rt) throw new Error("Spotify não conectado");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Falha ao renovar token do Spotify: " + JSON.stringify(j));
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  if (j.refresh_token && env.RESPOSTAS) await env.RESPOSTAS.put("cfg:refresh", j.refresh_token);
  return cache.token;
}

async function spotify(env, path, init = {}) {
  const t = await accessToken(env);
  return fetch("https://api.spotify.com/v1" + path, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: "Bearer " + t },
  });
}

const slim = (t) => ({
  uri: t.uri,
  name: t.name,
  artists: (t.artists || []).map((a) => a.name).join(", "),
  img: (t.album?.images || []).slice(-1)[0]?.url || "",
});

function tooMany(key, max) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(key, list);
  return false;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    try {
      if (p === "/" || p === "/index.html") return html(PAGE);

      if (p === "/api/config")
        return json({
          driver: env.DRIVER_NAME,
          instagram: env.INSTAGRAM,
          whatsapp: env.WHATSAPP,
          pixKey: env.PIX_KEY,
          pixName: env.PIX_NAME,
          pixCity: env.PIX_CITY,
        });

      if (p === "/api/search") {
        const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
        if (q.length < 2) return json({ tracks: [] });
        const r = await spotify(env, `/search?type=track&limit=10&market=BR&q=${encodeURIComponent(q)}`);
        const j = await r.json();
        return json({ tracks: (j.tracks?.items || []).map(slim) }, r.ok ? 200 : 502);
      }

      if (p === "/api/now") {
        const r = await spotify(env, "/me/player?market=BR");
        if (r.status === 204) return json({});
        const j = await r.json();
        if (!j.item) return json({});
        return json({ ...slim(j.item), playing: !!j.is_playing, volume: j.device?.volume_percent ?? null });
      }

      if (p === "/api/control" && req.method === "POST") {
        const ip = req.headers.get("cf-connecting-ip") || "x";
        if (tooMany("c" + ip, 120)) return json({ error: "Calma! Muitos toques seguidos. Espere um pouco." }, 429);
        const { action, value } = await req.json().catch(() => ({}));
        const routes = {
          play: ["PUT", "/me/player/play"],
          pause: ["PUT", "/me/player/pause"],
          next: ["POST", "/me/player/next"],
          prev: ["POST", "/me/player/previous"],
          volume: ["PUT", "/me/player/volume?volume_percent=" + Math.max(0, Math.min(100, Math.round(Number(value) || 0)))],
        };
        const rt = routes[action];
        if (!rt) return json({ error: "Comando inválido." }, 400);
        const r = await spotify(env, rt[1], { method: rt[0] });
        if (r.ok) return json({ ok: true });
        if (r.status === 404) return json({ error: "O Spotify do motorista está fechado agora." }, 409);
        if (r.status === 403 && action === "volume") return json({ error: "Este aparelho não deixa mudar o volume pelo Spotify." }, 409);
        return json({ error: "O Spotify não aceitou o comando. Tente de novo." }, 502);
      }

      if (p === "/api/queue" && req.method === "POST") {
        const ip = req.headers.get("cf-connecting-ip") || "x";
        if (tooMany("q" + ip, 40)) return json({ error: "Muitos pedidos seguidos. Espere alguns minutos." }, 429);
        const { uri } = await req.json().catch(() => ({}));
        if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri || "")) return json({ error: "Música inválida." }, 400);
        const r = await spotify(env, `/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: "POST" });
        if (r.ok) return json({ ok: true });
        if (r.status === 404) return json({ error: "O Spotify do motorista está pausado agora. Tente daqui a pouco." }, 409);
        return json({ error: "O Spotify não aceitou o pedido. Tente outra música." }, 502);
      }

      if (p === "/api/feedback" && req.method === "POST") {
        const ip = req.headers.get("cf-connecting-ip") || "x";
        if (tooMany("f" + ip, 5)) return json({ error: "Você já enviou. Valeu!" }, 429);
        if (!env.RESPOSTAS) return json({ error: "O questionário ainda não está pronto." }, 503);
        const b = await req.json().catch(() => ({}));
        const cut = (v, n) => String(v || "").trim().slice(0, n);
        const r = {
          quando: new Date().toISOString(),
          nome: cut(b.nome, 60),
          fone: cut(b.fone, 20),
          avisar: !!b.avisar,
          dores: (Array.isArray(b.dores) ? b.dores : []).slice(0, 6).map((d) => cut(d, 30)),
          ideia: cut(b.ideia, 500),
          usaria: cut(b.usaria, 10),
        };
        if (!r.dores.length && !r.ideia && !r.usaria) return json({ error: "Responda pelo menos uma pergunta." }, 400);
        if (r.fone.replace(/\D/g, "").length < 10) return json({ error: "Coloque seu WhatsApp com DDD." }, 400);
        await env.RESPOSTAS.put("r:" + Date.now() + ":" + Math.random().toString(36).slice(2, 8), JSON.stringify(r));
        return json({ ok: true });
      }

      if (p === "/respostas" || p === "/respostas.csv") {
        if (url.searchParams.get("senha") !== env.ADMIN_PASSWORD) return new Response("Senha errada.", { status: 403 });
        if (!env.RESPOSTAS) return new Response("Ligue o KV RESPOSTAS no Cloudflare primeiro.", { status: 503 });
        const rows = [];
        let cursor;
        do {
          const l = await env.RESPOSTAS.list({ prefix: "r:", cursor });
          for (const k of l.keys) { const v = await env.RESPOSTAS.get(k.name); if (v) rows.push(JSON.parse(v)); }
          cursor = l.list_complete ? null : l.cursor;
        } while (cursor);
        rows.sort((a, b) => b.quando.localeCompare(a.quando));
        const when = (q) => new Date(q).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        if (p === "/respostas.csv") {
          const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
          const csv = ["Data;Nome;WhatsApp;Avisar;Incomoda;Ideia;Usaria"]
            .concat(rows.map((r) => [when(r.quando), r.nome, r.fone, r.avisar ? "sim" : "não", r.dores.join(", "), r.ideia, r.usaria].map(q).join(";")))
            .join("\n");
          return new Response("\ufeff" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=respostas.csv" } });
        }
        const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
        const count = {};
        rows.forEach((r) => r.dores.forEach((d) => (count[d] = (count[d] || 0) + 1)));
        const top = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([d, n]) => `<li>${esc(d)}: <b>${n}</b></li>`).join("");
        const us = { Sim: 0, Talvez: 0, "Não": 0 };
        rows.forEach((r) => { if (r.usaria in us) us[r.usaria]++; });
        const cards = rows.map((r) => `<div style="border:1px solid #2a2e48;border-radius:12px;padding:12px;margin:10px 0">
          <div style="color:#9097b8;font-size:13px">${when(r.quando)}${r.usaria ? " · usaria: " + esc(r.usaria) : ""}</div>
          <div style="font-weight:600;margin-top:4px">${esc(r.nome || "Sem nome")}${r.fone ? ` · <a style="color:#ffb347" href="https://wa.me/55${esc(r.fone.replace(/\D/g, "").replace(/^55/, ""))}">${esc(r.fone)}</a>` : ""}</div>
          ${r.dores.length ? `<div style="font-size:14px;margin-top:4px">Incomoda: ${esc(r.dores.join(", "))}</div>` : ""}
          ${r.ideia ? `<div style="margin-top:6px">“${esc(r.ideia)}”</div>` : ""}</div>`).join("");
        return html(`<div style="font-family:system-ui;background:#0c0e1a;color:#eef0fa;min-height:100vh;padding:20px 16px"><div style="max-width:560px;margin:0 auto">
          <h2 style="margin:0 0 6px">Respostas: ${rows.length}</h2>
          <div style="color:#9097b8">Usaria o app: Sim ${us.Sim} · Talvez ${us.Talvez} · Não ${us["Não"]}</div>
          ${top ? `<h3>O que mais incomoda</h3><ul>${top}</ul>` : ""}
          <a style="color:#ffb347" href="/respostas.csv?senha=${encodeURIComponent(url.searchParams.get("senha"))}">Baixar planilha (CSV)</a>
          ${cards || "<p>Nenhuma resposta ainda.</p>"}</div></div>`);
      }

      // ---- Área do motorista ----
      if (p === "/api/admin" && req.method === "POST") {
        const ip = req.headers.get("cf-connecting-ip") || "x";
        if (tooMany("a" + ip, 10)) return json({ error: "Muitas tentativas. Espere alguns minutos." }, 429);
        const { senha } = await req.json().catch(() => ({}));
        if (!env.ADMIN_PASSWORD || senha !== env.ADMIN_PASSWORD) return json({ error: "Senha errada." }, 403);
        let conectado = false, tocando = "";
        try {
          const r = await spotify(env, "/me/player?market=BR");
          conectado = r.ok || r.status === 204;
          if (r.status === 200) { const j = await r.json(); if (j.item) tocando = j.item.name; }
        } catch (e) { conectado = false; }
        let respostas = 0;
        if (env.RESPOSTAS) {
          let cursor;
          do { const l = await env.RESPOSTAS.list({ prefix: "r:", cursor }); respostas += l.keys.length; cursor = l.list_complete ? null : l.cursor; } while (cursor);
        }
        return json({ ok: true, conectado, tocando, respostas, banco: !!env.RESPOSTAS });
      }

      if (p === "/login") {
        if (url.searchParams.get("senha") !== env.ADMIN_PASSWORD) return new Response("Senha errada.", { status: 403 });
        const state = crypto.randomUUID();
        if (env.RESPOSTAS) await env.RESPOSTAS.put("state:" + state, "1", { expirationTtl: 600 });
        const a = new URL("https://accounts.spotify.com/authorize");
        a.search = new URLSearchParams({
          response_type: "code",
          client_id: env.SPOTIFY_CLIENT_ID,
          scope: SCOPES,
          redirect_uri: url.origin + "/callback",
          state,
        });
        return Response.redirect(a.toString(), 302);
      }

      if (p === "/callback") {
        const page = (title, text) => html(`<div style="font-family:system-ui;background:#0c0e1a;color:#eef0fa;min-height:100vh;padding:40px 20px;text-align:center">
          <h2 style="margin:0 0 10px">${title}</h2><p style="color:#9097b8">${text}</p>
          <a href="/" style="display:inline-block;margin-top:16px;background:#ffb347;color:#1b1206;border-radius:12px;padding:14px 24px;font-weight:800;text-decoration:none">Voltar pro app</a></div>`);
        if (url.searchParams.get("error")) return page("Conexão cancelada", "Você não autorizou no Spotify. Tente de novo pela área do motorista.");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") || "";
        if (!code) return page("Algo deu errado", "O Spotify não mandou o código. Tente de novo.");
        if (env.RESPOSTAS) {
          if (!(await env.RESPOSTAS.get("state:" + state))) return page("Link expirado", "Abra a área do motorista e toque em Conectar Spotify de novo.");
          await env.RESPOSTAS.delete("state:" + state);
        }
        const r = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: url.origin + "/callback" }),
        });
        const j = await r.json();
        if (!r.ok) return page("Algo deu errado", "O Spotify recusou a conexão. Tente de novo em instantes.");
        if (!env.RESPOSTAS)
          return html(`<div style="font-family:system-ui;padding:20px"><h2>Salve este código como segredo SPOTIFY_REFRESH_TOKEN no Cloudflare</h2><textarea style="width:100%;height:140px">${j.refresh_token}</textarea></div>`);
        await env.RESPOSTAS.put("cfg:refresh", j.refresh_token);
        cache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
        return page("Spotify conectado ✓", "Pronto! Os passageiros já podem controlar a música.");
      }

      return new Response("Não encontrado", { status: 404 });
    } catch (e) {
      return json({ error: "Algo deu errado do nosso lado. Tente de novo." }, 500);
    }
  },
};
