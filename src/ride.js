// Código da corrida: o motorista passa um código de 4 números pro passageiro.
// Com o código certo, o passageiro recebe um passe assinado que vale até o motorista trocar o código.

const PASS_HOURS = 6;
let secretKey = null;

async function key(env) {
  if (secretKey) return secretKey;
  let raw = await env.RESPOSTAS.get("cfg:ride-secret");
  if (!raw) {
    raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    await env.RESPOSTAS.put("cfg:ride-secret", raw);
  }
  secretKey = await crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return secretKey;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");

export async function makePass(env, userId, version) {
  const exp = Date.now() + PASS_HOURS * 3600 * 1000;
  const sig = await crypto.subtle.sign("HMAC", await key(env), new TextEncoder().encode(`${userId}.${version}.${exp}`));
  return `${version}.${exp}.${hex(sig)}`;
}

export async function checkPass(env, userId, version, pass) {
  const [v, exp, sig] = String(pass || "").split(".");
  if (Number(v) !== version || !(Number(exp) > Date.now()) || !/^[0-9a-f]{64}$/.test(sig || "")) return false;
  const bytes = Uint8Array.from(sig.match(/../g).map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await key(env), bytes, new TextEncoder().encode(`${userId}.${v}.${exp}`));
}

// O código é obrigatório quando está ligado e definido
export const codeRequired = (p) => !!(p.rideCode && p.rideCode.on && p.rideCode.code);
