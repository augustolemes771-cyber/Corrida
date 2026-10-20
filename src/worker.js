// Corrida — Cloudflare Worker
// Perfis públicos dos motoristas (QR/NFC), painel do motorista e área do dono.
import PERFIL from "../pages/perfil.html";
import PAINEL from "../pages/painel.html";
import { json, htmlResponse, notice, esc, cut, digits, tooMany, ip, body, validUsername } from "./util.js";
import { ensureDb, getUserByName, getProfile, saveProfile, ownerWhatsapp } from "./db.js";
import { hashPassword, checkPassword, createSession, clearCookie, currentUser, endSession, sameOrigin } from "./auth.js";
import { mergeProfile, publicProfile, defaultProfile, TAGS } from "./profile.js";
import {
  SCOPES, getApp, getLink, appsWithUsage, freeSlotsLeft, requestSlot, setLink, removeLink,
  exchangeCode, rememberToken, spotifyApi, slimTrack,
} from "./spotify.js";

export default {
  async fetch(req, env) {
    try {
      await ensureDb(env);
      return await route(req, env);
    } catch (e) {
      console.error(e);
      return json({ error: "Algo deu errado do nosso lado. Tente de novo." }, 500);
    }
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  const secure = url.protocol === "https:";

  if (m !== "GET" && m !== "HEAD" && !sameOrigin(req)) return json({ error: "Origem não permitida." }, 403);

  // ---------- Páginas ----------
  if (p === "/") {
    const owner = env.OWNER_USERNAME && (await getUserByName(env, env.OWNER_USERNAME));
    if (owner) return renderProfile(env, owner, url);
    return Response.redirect(url.origin + "/painel", 302);
  }
  if (p === "/painel" || p === "/entrar" || p === "/cadastro") return htmlResponse(PAINEL, 200, { "cache-control": "no-store" });
  if (p === "/editar") {
    const me = await currentUser(env, req);
    if (!me) return Response.redirect(url.origin + "/painel", 302);
    return renderProfile(env, me, url, true);
  }

  // ---------- Conta ----------
  if (p === "/api/cadastro" && m === "POST") {
    if (tooMany("signup" + ip(req), 20, 60 * 60 * 1000)) return json({ error: "Muitos cadastros seguidos. Tente mais tarde." }, 429);
    const b = await body(req);
    const username = cut(b.username, 20).toLowerCase().replace(/^@/, "");
    const password = String(b.password || "");
    const name = cut(b.name, 40);
    const whatsapp = digits(b.whatsapp);
    if (!validUsername(username)) return json({ error: "Usuário precisa ter de 3 a 20 letras minúsculas, números, ponto ou _." , field: "username" }, 400);
    if (password.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres.", field: "password" }, 400);
    if (!name) return json({ error: "Coloque seu nome.", field: "name" }, 400);
    if (whatsapp.length < 10) return json({ error: "Coloque seu WhatsApp com DDD.", field: "whatsapp" }, 400);
    if (await getUserByName(env, username)) return json({ error: "Esse usuário já existe. Escolha outro.", field: "username" }, 409);
    const res = await env.DB.prepare(`INSERT OR IGNORE INTO users(username,pass,role,created_at) VALUES(?,?,'driver',?)`)
      .bind(username, await hashPassword(password), Date.now()).run();
    if (!res.meta.changes) return json({ error: "Esse usuário já existe. Escolha outro.", field: "username" }, 409);
    const id = res.meta.last_row_id;
    const wa = whatsapp.length <= 11 ? "55" + whatsapp : whatsapp;
    const prof = defaultProfile({ name, whatsapp: wa });
    prof.waMsg = `Oi ${name.split(" ")[0]}, vim pelo QR da corrida!`;
    await saveProfile(env, id, prof);
    return json({ ok: true }, 200, { "set-cookie": await createSession(env, id, secure) });
  }

  if (p === "/api/entrar" && m === "POST") {
    if (tooMany("login" + ip(req), 10)) return json({ error: "Muitas tentativas. Espere alguns minutos." }, 429);
    const b = await body(req);
    const username = cut(b.username, 20).toLowerCase().replace(/^@/, "");
    const row = await env.DB.prepare(`SELECT id,pass FROM users WHERE username=?`).bind(username).first();
    if (!row || !(await checkPassword(String(b.password || ""), row.pass)))
      return json({ error: "Usuário ou senha errados." }, 403);
    return json({ ok: true }, 200, { "set-cookie": await createSession(env, row.id, secure) });
  }

  if (p === "/api/sair" && m === "POST") {
    await endSession(env, req);
    return json({ ok: true }, 200, { "set-cookie": clearCookie(secure) });
  }

  // ---------- Imagens ----------
  const img = p.match(/^\/img\/(\d+)\/(avatar|fundo)$/);
  if (img) {
    const v = await env.RESPOSTAS.get(`img:${img[1]}:${img[2]}`, "arrayBuffer");
    if (!v) return new Response("Não encontrado", { status: 404 });
    return new Response(v, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
  }

  // ---------- API pública do perfil ----------
  const pub = p.match(/^\/api\/p\/([a-z0-9._]{3,20})\/(now|control|queue|search|pedido|feedback)$/);
  if (pub) return publicApi(req, env, url, pub[1], pub[2]);

  // ---------- Spotify: conectar ----------
  if (p === "/spotify/conectar") return spotifyConnect(req, env, url);
  if (p === "/callback") return spotifyCallback(req, env, url);

  // ---------- Painel do motorista ----------
  if (p.startsWith("/api/")) {
    const me = await currentUser(env, req);
    if (!me) return json({ error: "Entre na sua conta de novo." }, 401);
    return driverApi(req, env, url, p, me, secure);
  }

  if (p === "/respostas.csv") {
    const me = await currentUser(env, req);
    if (!me) return Response.redirect(url.origin + "/painel", 302);
    return feedbackCsv(env, me, url.searchParams.get("todos") === "1" && me.role === "admin");
  }

  // ---------- Perfil público: /usuario ----------
  const prof = p.match(/^\/@?([a-z0-9._]{3,20})$/i);
  if (prof && m === "GET") {
    const user = await getUserByName(env, prof[1]);
    if (user) return renderProfile(env, user, url);
  }

  return notice("Página não encontrada", "Confira o link ou escaneie o QR de novo.", "/", "Ir pro início", 404);
}

// ======================= Perfil público =======================

async function musicState(env, userId, p) {
  const link = await getLink(env, userId);
  const connected = link?.status === "connected";
  return { mode: connected ? "control" : "pedido", control: connected && p.music.control, service: p.music.service };
}

async function renderProfile(env, user, url, edit = false) {
  const p = await getProfile(env, user.id);
  const data = publicProfile(user, p, await musicState(env, user.id, p));
  // Modo edição: o dono do perfil mexe direto na página
  if (edit) { data.preview = true; data.edit = { profile: p, tags: TAGS, uid: user.id }; }
  data.owner = user.username === String(env.OWNER_USERNAME || "").toLowerCase();
  const title = `${data.name} · Driver Hub`;
  const desc = data.modules.includes("musica") ? `Escolha a música da corrida com ${data.name}.` : `Perfil de ${data.name} no Driver Hub.`;
  const page = PERFIL
    .replace("<!--HEAD-->",
      `<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">` +
      `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">` +
      (data.avatar ? `<meta property="og:image" content="${esc(url.origin + data.avatar)}">` : ""))
    .replace("/*DATA*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
  return htmlResponse(page, 200, { "cache-control": "no-store" });
}

async function publicApi(req, env, url, username, action) {
  const user = await getUserByName(env, username);
  if (!user) return json({ error: "Motorista não encontrado." }, 404);
  const p = await getProfile(env, user.id);
  const music = await musicState(env, user.id, p);
  const who = ip(req);

  if (action === "feedback" && req.method === "POST") {
    if (!p.modules.find((x) => x.id === "pesquisa")?.on) return json({ error: "Questionário desligado." }, 404);
    if (tooMany("f" + who, 5)) return json({ error: "Você já enviou. Valeu!" }, 429);
    const b = await body(req);
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
    if (digits(r.fone).length < 10) return json({ error: "Coloque seu WhatsApp com DDD." }, 400);
    await env.DB.prepare(`INSERT INTO feedback(user_id,data,created_at) VALUES(?,?,?)`).bind(user.id, JSON.stringify(r), Date.now()).run();
    return json({ ok: true });
  }

  if (!p.modules.find((x) => x.id === "musica")?.on) return json({ error: "Música desligada neste perfil." }, 404);

  // Busca: com Spotify conectado usa o Spotify do motorista; sem, usa a busca do iTunes (grátis, sem limite de contas).
  if (action === "search") {
    const q = cut(url.searchParams.get("q"), 80);
    if (q.length < 2) return json({ tracks: [] });
    if (tooMany("s" + who, 120)) return json({ error: "Muitas buscas seguidas. Espere um pouco." }, 429);
    if (music.mode === "control") {
      try {
        const r = await spotifyApi(env, user.id, `/search?type=track&limit=10&market=BR&q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (r.ok) return json({ tracks: (j.tracks?.items || []).map(slimTrack) });
      } catch {}
    }
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=BR&media=music&entity=song&limit=12`);
    const j = await r.json().catch(() => ({}));
    return json({
      tracks: (j.results || []).map((t) => ({
        uri: "", name: t.trackName, artists: t.artistName,
        img: (t.artworkUrl100 || "").replace("100x100", "120x120"), link: t.trackViewUrl || "",
      })),
    });
  }

  if (action === "pedido" && req.method === "POST") {
    if (tooMany("p" + who, 15)) return json({ error: "Muitos pedidos seguidos. Espere alguns minutos." }, 429);
    const b = await body(req);
    const title = cut(b.name, 120);
    if (!title) return json({ error: "Música inválida." }, 400);
    const link = /^https:\/\/music\.apple\.com\//.test(b.link || "") ? cut(b.link, 300) : "";
    await env.DB.prepare(`INSERT INTO song_requests(user_id,title,artist,img,link,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(user.id, title, cut(b.artists, 120), /^https:\/\//.test(b.img || "") ? cut(b.img, 300) : "", link, Date.now()).run();
    return json({ ok: true });
  }

  if (music.mode !== "control") return json({ error: "O motorista não está com o Spotify conectado agora." }, 409);

  try {
    if (action === "now") {
      const r = await spotifyApi(env, user.id, "/me/player?market=BR");
      if (r.status === 204) return json({});
      const j = await r.json();
      if (!j.item) return json({});
      return json({ ...slimTrack(j.item), playing: !!j.is_playing, volume: j.device?.volume_percent ?? null });
    }

    if (action === "queue" && req.method === "POST") {
      if (tooMany("q" + who, 40)) return json({ error: "Muitos pedidos seguidos. Espere alguns minutos." }, 429);
      const { uri } = await body(req);
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri || "")) return json({ error: "Música inválida." }, 400);
      const r = await spotifyApi(env, user.id, `/me/player/queue?uri=${encodeURIComponent(uri)}`, { method: "POST" });
      if (r.ok) return json({ ok: true });
      if (r.status === 404) return json({ error: "O Spotify do motorista está pausado agora. Tente daqui a pouco." }, 409);
      return json({ error: "O Spotify não aceitou o pedido. Tente outra música." }, 502);
    }

    if (action === "control" && req.method === "POST") {
      if (!music.control) return json({ error: "O motorista deixou só os pedidos liberados." }, 403);
      if (tooMany("c" + who, 120)) return json({ error: "Calma! Muitos toques seguidos. Espere um pouco." }, 429);
      const { action: a, value } = await body(req);
      const routes = {
        play: ["PUT", "/me/player/play"],
        pause: ["PUT", "/me/player/pause"],
        next: ["POST", "/me/player/next"],
        prev: ["POST", "/me/player/previous"],
        volume: ["PUT", "/me/player/volume?volume_percent=" + Math.max(0, Math.min(100, Math.round(Number(value) || 0)))],
      };
      const rt = routes[a];
      if (!rt) return json({ error: "Comando inválido." }, 400);
      const r = await spotifyApi(env, user.id, rt[1], { method: rt[0] });
      if (r.ok) return json({ ok: true });
      if (r.status === 404) return json({ error: "O Spotify do motorista está fechado agora." }, 409);
      if (r.status === 403 && a === "volume") return json({ error: "Este aparelho não deixa mudar o volume pelo Spotify." }, 409);
      return json({ error: "O Spotify não aceitou o comando. Tente de novo." }, 502);
    }
  } catch {
    return json({ error: "O Spotify do motorista está desconectado agora." }, 409);
  }
  return json({ error: "Não encontrado." }, 404);
}

// ======================= Spotify: conexão =======================

async function spotifyConnect(req, env, url) {
  const me = await currentUser(env, req);
  if (!me) return Response.redirect(url.origin + "/painel", 302);
  const link = await getLink(env, me.id);
  if (!link || !["approved", "connected"].includes(link.status))
    return notice("Ainda não liberado", "Seu acesso ao Spotify ainda não foi liberado. Acompanhe pelo painel.");
  const app = await getApp(env, link.app_id);
  if (!app || !app.secret) return notice("App do Spotify incompleto", "Fale com o administrador para revisar o app do Spotify.");
  const state = crypto.randomUUID();
  await env.RESPOSTAS.put("state:" + state, String(me.id), { expirationTtl: 600 });
  const a = new URL("https://accounts.spotify.com/authorize");
  a.search = new URLSearchParams({ response_type: "code", client_id: app.client_id, scope: SCOPES, redirect_uri: url.origin + "/callback", state });
  return Response.redirect(a.toString(), 302);
}

async function spotifyCallback(req, env, url) {
  if (url.searchParams.get("error")) return notice("Conexão cancelada", "Você não autorizou no Spotify. Tente de novo pelo painel.");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const userId = Number(await env.RESPOSTAS.get("state:" + state));
  if (!code || !userId) return notice("Link expirado", "Abra o painel e toque em Conectar Spotify de novo.");
  await env.RESPOSTAS.delete("state:" + state);
  const link = await getLink(env, userId);
  const app = link && (await getApp(env, link.app_id));
  if (!app) return notice("Algo deu errado", "Seu acesso ao Spotify mudou. Confira no painel.");
  const r = await exchangeCode(app, code, url.origin + "/callback");
  if (!r.ok) return notice("O Spotify recusou", "Confira se o e-mail da sua conta do Spotify é o mesmo que você informou no painel e tente de novo.");
  await setLink(env, userId, { status: "connected", refresh: r.data.refresh_token });
  rememberToken(userId, r.data.access_token, r.data.expires_in);
  return notice("Spotify conectado ✓", "Pronto! Os passageiros já podem escolher a música no seu perfil.");
}

// ======================= Painel do motorista =======================

async function driverApi(req, env, url, p, me, secure) {
  const m = req.method;

  if (p === "/api/me" && m === "GET") {
    const prof = await getProfile(env, me.id);
    const link = await getLink(env, me.id);
    const app = link?.app_id ? await getApp(env, link.app_id) : null;
    const pend = await env.DB.prepare(`SELECT COUNT(*) n FROM song_requests WHERE user_id=? AND done=0`).bind(me.id).first();
    const fb = await env.DB.prepare(`SELECT COUNT(*) n FROM feedback WHERE user_id=?`).bind(me.id).first();
    return json({
      user: { id: me.id, username: me.username, role: me.role },
      profile: prof,
      tags: TAGS,
      spotify: {
        status: link?.status || "none",
        email: link?.email || "",
        app: app ? app.label : "",
        freeLeft: await freeSlotsLeft(env),
        ownerWhatsapp: ownerWhatsapp(env),
        ownerName: env.DRIVER_NAME || "o administrador",
      },
      pendingRequests: pend?.n || 0,
      feedbackCount: fb?.n || 0,
    });
  }

  if (p === "/api/perfil" && m === "POST") {
    const cur = await getProfile(env, me.id);
    const next = mergeProfile(cur, await body(req));
    await saveProfile(env, me.id, next);
    return json({ ok: true, profile: next });
  }

  if (p === "/api/imagem" && m === "POST") {
    const b = await body(req);
    const kind = b.kind === "fundo" ? "fundo" : "avatar";
    const cur = await getProfile(env, me.id);
    const key = `img:${me.id}:${kind}`;
    if (b.remove) {
      await env.RESPOSTAS.delete(key);
      if (kind === "avatar") cur.hasAvatar = false;
      else { cur.bgVersion = 0; if (cur.theme.bg === "foto") cur.theme.bg = "nenhum"; }
    } else {
      const m64 = String(b.data || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!m64) return json({ error: "Imagem inválida." }, 400);
      const bytes = Uint8Array.from(atob(m64[1]), (c) => c.charCodeAt(0));
      if (bytes.length > (kind === "avatar" ? 250_000 : 700_000)) return json({ error: "Imagem grande demais." }, 413);
      await env.RESPOSTAS.put(key, bytes);
      if (kind === "avatar") { cur.hasAvatar = true; cur.avatarVersion = Date.now(); }
      else { cur.bgVersion = Date.now(); cur.theme.bg = "foto"; }
    }
    await saveProfile(env, me.id, cur);
    return json({ ok: true, profile: cur });
  }

  if (p === "/api/senha" && m === "POST") {
    const b = await body(req);
    const row = await env.DB.prepare(`SELECT pass FROM users WHERE id=?`).bind(me.id).first();
    if (!(await checkPassword(String(b.atual || ""), row.pass))) return json({ error: "Senha atual errada." }, 403);
    if (String(b.nova || "").length < 6) return json({ error: "A nova senha precisa ter pelo menos 6 caracteres." }, 400);
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET pass=? WHERE id=?`).bind(await hashPassword(String(b.nova)), me.id),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND token<>?`).bind(me.id, me.token),
    ]);
    return json({ ok: true });
  }

  // ---- Pedidos de música (modo sem Spotify conectado)
  if (p === "/api/pedidos" && m === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id,title,artist,img,link,created_at,done FROM song_requests WHERE user_id=? AND created_at>? ORDER BY id DESC LIMIT 40`
    ).bind(me.id, Date.now() - 24 * 3600 * 1000).all();
    return json({ pedidos: results });
  }
  const done = p.match(/^\/api\/pedidos\/(\d+)\/feito$/);
  if (done && m === "POST") {
    await env.DB.prepare(`UPDATE song_requests SET done=1 WHERE id=? AND user_id=?`).bind(Number(done[1]), me.id).run();
    return json({ ok: true });
  }
  if (p === "/api/pedidos/limpar" && m === "POST") {
    await env.DB.prepare(`UPDATE song_requests SET done=1 WHERE user_id=?`).bind(me.id).run();
    return json({ ok: true });
  }

  // ---- Spotify: pedir vaga / desconectar
  if (p === "/api/spotify/vaga" && m === "POST") {
    const email = cut((await body(req)).email, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Coloque o e-mail da sua conta do Spotify." }, 400);
    const cur = await getLink(env, me.id);
    if (cur && ["requested", "approved", "connected"].includes(cur.status)) {
      await setLink(env, me.id, { email });
      return json({ ok: true, status: cur.status });
    }
    return json({ ok: true, status: await requestSlot(env, me.id, email) });
  }
  if (p === "/api/spotify/cancelar" && m === "POST") {
    await removeLink(env, me.id);
    return json({ ok: true });
  }
  if (p === "/api/spotify/desconectar" && m === "POST") {
    const cur = await getLink(env, me.id);
    if (cur?.status === "connected") await setLink(env, me.id, { status: "approved", refresh: null });
    return json({ ok: true });
  }
  if (p === "/api/spotify/status" && m === "GET") {
    const link = await getLink(env, me.id);
    if (link?.status !== "connected") return json({ conectado: false });
    try {
      const r = await spotifyApi(env, me.id, "/me/player?market=BR");
      const j = r.status === 200 ? await r.json() : null;
      return json({ conectado: r.ok || r.status === 204, tocando: j?.item?.name || "" });
    } catch {
      return json({ conectado: false });
    }
  }

  // ---- Respostas do questionário
  if (p === "/api/respostas" && m === "GET") {
    const all = url.searchParams.get("todos") === "1" && me.role === "admin";
    const { results } = await (all
      ? env.DB.prepare(`SELECT f.data,f.created_at,u.username FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 500`)
      : env.DB.prepare(`SELECT data,created_at FROM feedback WHERE user_id=? ORDER BY created_at DESC LIMIT 500`).bind(me.id)
    ).all();
    return json({ respostas: results.map((r) => ({ ...JSON.parse(r.data), via: r.username })) });
  }

  // ---- Área do dono
  if (p.startsWith("/api/admin/")) {
    if (me.role !== "admin") return json({ error: "Só o administrador." }, 403);
    return adminApi(req, env, p);
  }

  return json({ error: "Não encontrado." }, 404);
}

async function adminApi(req, env, p) {
  const m = req.method;
  if (p === "/api/admin/resumo" && m === "GET") {
    const apps = await appsWithUsage(env);
    const { results: links } = await env.DB.prepare(
      `SELECT l.user_id,l.app_id,l.email,l.status,l.updated_at,u.username FROM spotify_links l JOIN users u ON u.id=l.user_id ORDER BY l.updated_at DESC`
    ).all();
    const { results: users } = await env.DB.prepare(
      `SELECT u.id,u.username,u.role,u.created_at,p.data FROM users u LEFT JOIN profiles p ON p.user_id=u.id ORDER BY u.id DESC LIMIT 300`
    ).all();
    return json({
      apps: apps.map((a) => ({ ...a, free: !!a.free })),
      links,
      users: users.map((u) => {
        const d = u.data ? JSON.parse(u.data) : {};
        return { id: u.id, username: u.username, role: u.role, created_at: u.created_at, name: d.name || "", whatsapp: d.whatsapp || "" };
      }),
    });
  }

  if (p === "/api/admin/app" && m === "POST") {
    const b = await body(req);
    const label = cut(b.label, 40);
    const clientId = cut(b.client_id, 64);
    const secret = cut(b.client_secret, 64);
    if (!label || !/^[0-9a-f]{32}$/i.test(clientId) || !/^[0-9a-f]{32}$/i.test(secret))
      return json({ error: "Confira o nome, o Client ID e o Client Secret (32 caracteres cada)." }, 400);
    await env.DB.prepare(`INSERT INTO spotify_apps(label,client_id,client_secret,capacity,free,created_at) VALUES(?,?,?,5,?,?)`)
      .bind(label, clientId, secret, b.free ? 1 : 0, Date.now()).run();
    return json({ ok: true });
  }

  const appEdit = p.match(/^\/api\/admin\/app\/(\d+)$/);
  if (appEdit && m === "POST") {
    const b = await body(req);
    const id = Number(appEdit[1]);
    if (b.remove) {
      const used = await env.DB.prepare(`SELECT COUNT(*) n FROM spotify_links WHERE app_id=?`).bind(id).first();
      if (used.n) return json({ error: "Tire os motoristas deste app antes de apagar." }, 409);
      if (id === 1) return json({ error: "O app principal não pode ser apagado." }, 409);
      await env.DB.prepare(`DELETE FROM spotify_apps WHERE id=?`).bind(id).run();
      return json({ ok: true });
    }
    if ("free" in b) await env.DB.prepare(`UPDATE spotify_apps SET free=? WHERE id=?`).bind(b.free ? 1 : 0, id).run();
    return json({ ok: true });
  }

  if (p === "/api/admin/vaga" && m === "POST") {
    const b = await body(req);
    const userId = Number(b.user_id);
    const link = await getLink(env, userId);
    if (!link) return json({ error: "Pedido não encontrado." }, 404);
    if (b.action === "liberar") {
      if (!link.app_id) return json({ error: "Escolha um app para este motorista primeiro." }, 400);
      await setLink(env, userId, { status: link.status === "connected" ? "connected" : "approved" });
      return json({ ok: true });
    }
    if (b.action === "atribuir") {
      const apps = await appsWithUsage(env);
      const app = apps.find((a) => a.id === Number(b.app_id));
      if (!app) return json({ error: "App não encontrado." }, 404);
      if (app.used >= app.capacity && link.app_id !== app.id) return json({ error: "Esse app já está com as 5 vagas ocupadas." }, 409);
      await setLink(env, userId, { app_id: app.id, status: "requested", refresh: null });
      return json({ ok: true });
    }
    if (b.action === "remover") {
      await removeLink(env, userId);
      return json({ ok: true });
    }
    return json({ error: "Ação inválida." }, 400);
  }

  return json({ error: "Não encontrado." }, 404);
}

async function feedbackCsv(env, me, all) {
  const { results } = await (all
    ? env.DB.prepare(`SELECT f.data,u.username FROM feedback f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC`)
    : env.DB.prepare(`SELECT data FROM feedback WHERE user_id=? ORDER BY created_at DESC`).bind(me.id)
  ).all();
  const when = (q) => new Date(q).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const head = ["Data", "Nome", "WhatsApp", "Avisar", "Incomoda", "Ideia", "Usaria"].concat(all ? ["Motorista"] : []);
  const rows = results.map((row) => {
    const r = JSON.parse(row.data);
    return [when(r.quando), r.nome, r.fone, r.avisar ? "sim" : "não", (r.dores || []).join(", "), r.ideia, r.usaria]
      .concat(all ? [row.username] : []).map(q).join(";");
  });
  return new Response("﻿" + [head.join(";")].concat(rows).join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=respostas.csv" },
  });
}
