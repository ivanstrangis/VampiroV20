// Comprueba que la versión para artefacto (dist/artifact.html) sigue usando la base y el Narrador de Claude.
// Simula window.claude con una base en memoria; no habla con Claude de verdad.
// Uso: python ../tools/build-artifact.py && node claude-stub.mjs
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const servidor = spawn("python", ["-m", "http.server", "8124", "--directory", raiz], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));
const navegador = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await navegador.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errores = [];
page.on("pageerror", e => errores.push(e.message));

await page.addInitScript(() => {
  const mem = new Map(), copia = v => JSON.parse(JSON.stringify(v));
  const snap = p => { const v = mem.get(p); return { exists: v !== undefined, id: p.split("/").pop(), metadata: { fromCache: false }, data: () => v === undefined ? undefined : copia(v) }; };
  const db = {
    doc: p => ({ get: async () => snap(p), set: async d => { mem.set(p, copia(d)); }, update: async d => { mem.set(p, { ...(mem.get(p) || {}), ...d }); }, delete: async () => { mem.delete(p); },
      onSnapshot: fn => { Promise.resolve().then(() => fn(snap(p))); return () => {}; } }),
    collection: pre => ({ where: (c, o, val) => ({ get: async () => ({ docs: [...mem].filter(([k, v]) => k.startsWith(pre + "/") && v[c] === val).map(([k, v]) => ({ id: k.slice(pre.length + 1), data: () => copia(v) })) }) }) })
  };
  const sample = Object.assign(async () => ({ text: "ok" }), { json: async () => ({}), limits: async () => ({ maxPromptBytes: 262144 }) });
  window.claude = { use: async n => ({ db, user: { id: async () => "u1" }, downloads: { save: async () => {} }, sample })[n] || null };
});

const resultados = [];
const prueba = async (n, fn) => { try { await fn(); resultados.push([true, n]); console.log("OK   ", n); } catch (e) { resultados.push([false, n]); console.log("FALLA", n, "\n     ", e.message.split("\n")[0]); } };

await page.goto("http://localhost:8124/artifact.html");
await page.waitForFunction(() => document.querySelector("#btn-vacio"), null, { timeout: 15000 });

await prueba("dentro de Claude usa la plataforma de Claude y su Narrador", async () => {
  assert.equal(await page.evaluate(() => PLATAFORMA), "claude");
  assert.equal(await page.evaluate(() => HAY_IA()), true);
  assert.equal(await page.evaluate(() => MOTOR.tipo), "claude");
});
await prueba("la opción «Claude (tu cuenta)» está disponible y no se registra el service worker", async () => {
  await page.click("#btn-menu");
  if(await page.$("#mi-partida")){ await page.click("#mi-partida"); await page.click("#pm-motor"); } else await page.click("#mi-motor");
  await page.waitForSelector("#mo-tipo");
  const opciones = await page.$$eval("#mo-tipo option", o => o.map(x => ({ v: x.value, d: x.disabled })));
  assert.ok(opciones.some(o => o.v === "claude" && !o.d));
  assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length)), 0);
});
await prueba("sin errores de script", async () => assert.deepEqual(errores, []));

await navegador.close(); servidor.kill();
console.log(resultados.every(r => r[0]) ? "\nTodo bien" : "\nHay fallas");
process.exit(resultados.every(r => r[0]) ? 0 : 1);
