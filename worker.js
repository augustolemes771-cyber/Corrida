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

async function accessToken(env) {
  if (cache.token && Date.now() < cache.exp) return cache.token;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: env.SPOTIFY_REFRESH_TOKEN }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Falha ao renovar token do Spotify: " + JSON.stringify(j));
  cache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
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

      // ---- Configuração única (só você usa) ----
      if (p === "/login") {
        if (url.searchParams.get("senha") !== env.ADMIN_PASSWORD) return new Response("Senha errada.", { status: 403 });
        const a = new URL("https://accounts.spotify.com/authorize");
        a.search = new URLSearchParams({
          response_type: "code",
          client_id: env.SPOTIFY_CLIENT_ID,
          scope: SCOPES,
          redirect_uri: url.origin + "/callback",
        });
        return Response.redirect(a.toString(), 302);
      }

      if (p === "/callback") {
        const code = url.searchParams.get("code");
        if (!code) return new Response("Sem código do Spotify.", { status: 400 });
        const r = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: url.origin + "/callback" }),
        });
        const j = await r.json();
        if (!r.ok) return new Response("Erro: " + JSON.stringify(j), { status: 400 });
        return html(
          `<div style="font-family:system-ui;padding:20px;max-width:640px">` +
            `<h2>Pronto! Copie o refresh token abaixo</h2>` +
            `<p>No Cloudflare: Workers → corrida → Configurações → Variáveis e segredos → Adicionar → tipo Segredo, nome <b>SPOTIFY_REFRESH_TOKEN</b>, e cole isto:</p>` +
            `<textarea style="width:100%;height:140px">${j.refresh_token}</textarea>` +
            `<p>Não mostre esse código pra ninguém.</p></div>`
        );
      }

      return new Response("Não encontrado", { status: 404 });
    } catch (e) {
      return json({ error: "Algo deu errado do nosso lado. Tente de novo." }, 500);
    }
  },
};
