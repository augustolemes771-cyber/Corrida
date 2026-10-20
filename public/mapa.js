// Mapa do Driver Hub: base escura do OpenStreetMap (CARTO), ícones por categoria e cartões dos lugares.
// Usado pelo mapa do passageiro (/mapa) e pelo Pit Stop do motorista (/painel).
(function () {
  "use strict";
  var P = {
    mercado: "M3 4h2l2.2 10.5h10.6L20 7H6.4M9 19.5h.01M17 19.5h.01",
    farmacia: "M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z",
    turismo: "M3 20h18M5 20v-8M9.5 20v-8M14.5 20v-8M19 20v-8M2.5 10L12 4l9.5 6z",
    restaurante: "M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2.5 1.5-3.5 5-3.5 8H17",
    balada: "M6 3h12l-6 8zM12 11v8M8 21h8",
    saude: "M3 12h4l2.5-5 4 10 2.5-5H21",
    hotel: "M3 19V7M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6M7 11.5h.01",
    apoio: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3",
    movimento: "M13 2L5 13h6l-1 9 8-12h-6z",
    outro: "M12 21s-7-6.2-7-11.2a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12.3a2.3 2.3 0 1 0 0-.01",
    posto: "M5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16M3.5 21h12M5 10h9M14 8h1.5a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8.5L18 6",
    oficina: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3.5 17.5l3 3 5.8-5.8a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
    lavajato: "M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11zM9.5 14.5a2.5 2.5 0 0 0 2.5 2.5",
    estetica: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
    borracharia: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v5M12 16v5M3 12h5M16 12h5",
    autopecas: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
    eletrica: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
    guincho: "M2.5 16V6h11v10M13.5 9.5h4l3.5 3.5v3h-7.5M7 19.5a2 2 0 1 0 0-.01M17.5 19.5a2 2 0 1 0 0-.01"
  };
  var GROUP = {
    lugar: "#ffb347", parceiro: "#6cb2ff", posto: "#5fd39a", movimento: "#ff6b86", apoio: "#3fd6ea"
  };
  var FUEL_LABEL = { gasolina: "Gasolina", etanol: "Etanol", diesel: "Diesel", gnv: "GNV" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function icon(cat, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (P[cat] || P.outro) + '"/></svg>';
  }
  function colorOf(p) { return GROUP[p.category] || GROUP[p.kind] || GROUP.lugar; }
  function money(c) { return "R$ " + (c / 100).toFixed(2).replace(".", ","); }
  function ago(ts) {
    var m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return m <= 1 ? "agora" : "há " + m + " min";
    var h = Math.round(m / 60); if (h < 24) return "há " + h + "h";
    var d = Math.round(h / 24); return "há " + d + (d === 1 ? " dia" : " dias");
  }
  function fmtPhone(n) { n = String(n || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""); return n.length === 11 ? "(" + n.slice(0, 2) + ") " + n.slice(2, 7) + "-" + n.slice(7) : n.length === 10 ? "(" + n.slice(0, 2) + ") " + n.slice(2, 6) + "-" + n.slice(6) : n; }
  function directions(p) { return "https://www.google.com/maps/dir/?api=1&destination=" + p.lat + "," + p.lng; }
  function distKm(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function km(d) { return d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1).replace(".", ",") + " km"; }

  var css = [
    ".dh-pin{display:flex;flex-direction:column;align-items:center;gap:3px;transform:translate(-50%,-100%);position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer}",
    ".dh-dot{position:relative;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:#0c0e1a;border:2px solid #0c0e1a;box-shadow:0 4px 10px -4px rgba(0,0,0,.8)}",
    ".dh-photo{width:46px;height:46px;border-radius:50%;object-fit:cover;border:3px solid;box-shadow:0 4px 10px -4px rgba(0,0,0,.8);background:#151829}",
    ".dh-badge{position:absolute;top:-7px;right:-12px;font:800 10px/1 Figtree,system-ui,sans-serif;background:#0c0e1a;color:#fff;border-radius:6px;padding:3px 4px;border:1.5px solid currentColor}",
    ".dh-label{font:700 11px/1.15 Figtree,system-ui,sans-serif;color:#eef0fa;background:rgba(12,14,26,.86);border-radius:6px;padding:2px 6px;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}",
    ".dh-price{display:flex;align-items:center;gap:4px;font:800 13px/1 Figtree,system-ui,sans-serif;color:#0c0e1a;border-radius:10px;padding:6px 8px;border:2px solid #0c0e1a;box-shadow:0 4px 10px -4px rgba(0,0,0,.8);white-space:nowrap;font-variant-numeric:tabular-nums}",
    ".dh-price.best{outline:3px solid #fff;outline-offset:1px}",
    ".dh-dot.sm{width:26px;height:26px;border-width:1.5px}",
    ".dh-me{width:18px;height:18px;border-radius:50%;background:#3fa0ff;border:3px solid #fff;box-shadow:0 0 0 6px rgba(63,160,255,.25);transform:translate(-50%,-50%);position:absolute}",
    ".leaflet-container{background:#0c0e1a;font-family:Figtree,system-ui,sans-serif}",
    ".dh-tiles{filter:invert(1) hue-rotate(200deg) brightness(.82) contrast(.92) saturate(.55)}",
    ".leaflet-bottom.leaflet-right .leaflet-control-zoom{margin-bottom:82px}",
    ".leaflet-control-attribution{background:rgba(12,14,26,.75)!important;color:#9097b8!important;font-size:10px}",
    ".leaflet-control-attribution a{color:#cfd3ea!important}",
    ".leaflet-control-zoom a{background:#151829!important;color:#eef0fa!important;border-color:#2a2f4a!important}",
    /* Cartão de detalhes */
    ".pc-photo{display:block;width:100%;height:160px;object-fit:cover;border-radius:14px;margin-bottom:12px}",
    ".pc-head{display:flex;gap:12px;align-items:center}",
    ".pc-ico{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#0c0e1a;flex:none}",
    ".pc-t{min-width:0}.pc-t b{display:block;font-size:19px;font-weight:800;line-height:1.2}",
    ".pc-t small{display:block;color:var(--muted,#9097b8);font-size:14px}",
    ".pc-prices{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:14px}",
    ".pc-prices div{background:var(--bg,#0c0e1a);border-radius:10px;padding:8px;min-width:0}",
    ".pc-prices small{display:block;font-size:12px;color:var(--muted,#9097b8)}",
    ".pc-prices b{display:block;font-size:15px;font-variant-numeric:tabular-nums}",
    ".pc-prices em{display:block;font-style:normal;font-size:10.5px;line-height:1.25;color:var(--muted,#9097b8);margin-top:2px;overflow-wrap:anywhere}",
    ".pc-deal{margin:14px 0 0;padding:10px 12px;border-radius:10px;background:rgba(108,178,255,.13);color:#a9d0ff;font-weight:700}",
    ".pc-desc{margin:12px 0 0;white-space:pre-line}",
    ".pc-facts{display:grid;gap:8px;margin:12px 0 0}.pc-facts dt{font-size:12px;color:var(--muted,#9097b8)}.pc-facts dd{margin:0;font-weight:600}",
    ".pc-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}",
    ".pc-btn{flex:1 1 auto;text-align:center;text-decoration:none;border:1.5px solid var(--line,#2a2f4a);border-radius:12px;padding:12px 14px;font-weight:700;color:var(--fg,#eef0fa)}",
    ".pc-btn.primary{background:var(--accent,#ffb347);border-color:var(--accent,#ffb347);color:#1b1206}",
    ".pc-btn.wa{background:#3ddc84;border-color:#3ddc84;color:#06210f}"
  ].join("\n");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function create(el, city, opts) {
    opts = opts || {};
    var map = L.map(el, { zoomControl: false, attributionControl: true, tap: true }).setView([city.lat, city.lng], opts.zoom || 14);
    // Mapa padrão do OpenStreetMap (grátis, sem chave), escurecido por filtro pra combinar com o app
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "dh-tiles",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    // No celular o zoom é com dois dedos; botões só em tela grande
    if (window.matchMedia("(min-width: 760px)").matches) L.control.zoom({ position: "bottomright" }).addTo(map);
    return map;
  }

  // Marcador de um lugar. opts.fuel: combustível mostrado no posto; opts.best: id do posto mais barato
  function marker(p, opts) {
    opts = opts || {};
    var c = colorOf(p), html;
    if (p.kind === "posto") {
      var pr = p.prices && p.prices[opts.fuel || "gasolina"];
      // Sem preço: só a bomba, pequena, pra não poluir o mapa
      html = pr ? '<div class="dh-pin"><span class="dh-price' + (opts.best === p.id ? " best" : "") + '" style="background:' + c + '">' + icon("posto", 14) + money(pr.cents) + '</span></div>'
        : '<div class="dh-pin"><span class="dh-dot sm" style="background:#2a2f4a;color:' + c + '">' + icon("posto", 14) + '</span></div>';
    } else if (p.photo) {
      html = '<div class="dh-pin"><img class="dh-photo" src="' + esc(p.photo) + '" alt="" style="border-color:' + c + '"><span class="dh-label">' + esc(p.name) + '</span></div>';
    } else {
      html = '<div class="dh-pin"><span class="dh-dot" style="background:' + c + '">' + icon(p.category) +
        (p.open24 ? '<span class="dh-badge" style="color:' + c + '">24h</span>' : "") + '</span><span class="dh-label">' + esc(p.name) + '</span></div>';
    }
    return L.marker([p.lat, p.lng], { icon: L.divIcon({ html: html, className: "", iconSize: [0, 0] }), riseOnHover: true, keyboard: true, title: p.name });
  }

  function meMarker(lat, lng) { return L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="dh-me"></div>', className: "", iconSize: [0, 0] }), interactive: false, zIndexOffset: 1000 }); }

  // Conteúdo do cartão de detalhes
  function card(p, cats, opts) {
    opts = opts || {};
    var cat = (cats && cats[p.category] && cats[p.category].label) || (p.kind === "posto" ? "Posto" : "");
    var h = "";
    if (p.photo) h += '<img class="pc-photo" src="' + esc(p.photo) + '" alt="">';
    h += '<div class="pc-head"><span class="pc-ico" style="background:' + colorOf(p) + '">' + icon(p.kind === "posto" ? "posto" : p.category, 20) + '</span><div class="pc-t"><b>' + esc(p.name) + '</b><small>' + esc(cat) +
      (p.open24 ? " · 24 horas" : "") + (p.brand ? " · " + esc(p.brand) : "") + (opts.from ? " · " + km(distKm(opts.from, p)) : "") + '</small></div></div>';
    if (p.kind === "posto") {
      h += '<div class="pc-prices">' + ["gasolina", "etanol", "diesel", "gnv"].map(function (f) {
        var pr = p.prices && p.prices[f];
        return '<div><small>' + FUEL_LABEL[f] + '</small><b>' + (pr ? money(pr.cents) : "–") + '</b>' + (pr ? '<em>' + ago(pr.at) + (pr.by ? " · @" + esc(pr.by) : "") + '</em>' : "") + '</div>';
      }).join("") + '</div>';
    }
    if (p.discount) h += '<p class="pc-deal">' + esc(p.discount) + '</p>';
    if (p.desc) h += '<p class="pc-desc">' + esc(p.desc) + '</p>';
    var facts = [];
    if (p.hours && !p.open24) facts.push(["Horário", p.hours]);
    if (p.address) facts.push(["Endereço", p.address]);
    if (p.expires) facts.push(["Some", "em " + Math.max(1, Math.round((p.expires - Date.now()) / 60000)) + " min"]);
    if (p.by && p.kind === "lugar") facts.push(["Marcado por", "@" + p.by]);
    if (facts.length) h += '<dl class="pc-facts">' + facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join("") + '</dl>';
    var acts = '<a class="pc-btn primary" href="' + directions(p) + '" target="_blank" rel="noopener">Como chegar</a>';
    if (p.whatsapp) acts += '<a class="pc-btn wa" href="https://wa.me/' + (p.whatsapp.length <= 11 ? "55" : "") + esc(p.whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>';
    else if (p.phone) acts += '<a class="pc-btn" href="tel:' + esc(p.phone) + '">' + esc(fmtPhone(p.phone)) + '</a>';
    if (p.instagram) acts += '<a class="pc-btn" href="https://instagram.com/' + encodeURIComponent(p.instagram) + '" target="_blank" rel="noopener">@' + esc(p.instagram) + '</a>';
    if (p.link) acts += '<a class="pc-btn" href="' + esc(p.link) + '" target="_blank" rel="noopener">Site</a>';
    h += '<div class="pc-acts">' + acts + '</div>';
    return h;
  }

  window.DHMap = { create: create, marker: marker, meMarker: meMarker, card: card, icon: icon, colorOf: colorOf, money: money, ago: ago, distKm: distKm, km: km, directions: directions, FUEL_LABEL: FUEL_LABEL, esc: esc };
})();
