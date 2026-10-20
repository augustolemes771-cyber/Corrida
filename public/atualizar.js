// Aviso de atualização do app Android: o APK informa a versão no user agent (DriverHubApp/N).
// Se o GitHub tiver uma versão mais nova, mostra "Atualizar" e abre o download do APK (o Android pede pra instalar).
(function () {
  var m = navigator.userAgent.match(/DriverHubApp\/(\d+)/);
  if (!m) return;
  var mine = Number(m[1]);
  fetch("/api/app-versao", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.android || j.android <= mine) return;
    try { if (localStorage.getItem("apkDispensado") === String(j.android)) return; } catch (e) {}
    var bar = document.createElement("div");
    bar.setAttribute("role", "status"); bar.id = "dhUpd";
    bar.style.cssText = "position:fixed;left:12px;right:12px;top:calc(76px + env(safe-area-inset-top,0px));z-index:80;display:flex;align-items:center;gap:10px;" +
      "background:#eef0fa;color:#0c0e1a;border-radius:16px;padding:10px 10px 10px 16px;box-shadow:0 12px 30px rgba(0,0,0,.5);font:600 15px/1.3 Figtree,system-ui,sans-serif";
    bar.innerHTML = '<span style="flex:1">Nova versão do app disponível</span>' +
      '<a href="' + j.url + '" style="background:#ffb347;color:#1b1206;border-radius:10px;padding:9px 14px;font-weight:800;text-decoration:none">Atualizar</a>' +
      '<button type="button" aria-label="Agora não" style="border:0;background:none;font-size:22px;line-height:1;padding:4px 6px;color:#555;cursor:pointer">×</button>';
    bar.lastChild.addEventListener("click", function () { try { localStorage.setItem("apkDispensado", String(j.android)); } catch (e) {} bar.remove(); });
    document.body.appendChild(bar);
  }).catch(function () {});
})();
