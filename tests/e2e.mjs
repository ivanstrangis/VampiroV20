// Pruebas de punta a punta de VampiroV20 como sitio estático.
// Uso: cd tests && npm install && node e2e.mjs
// Usa el Edge/Chrome instalado (no baja ningún navegador). Levanta un servidor local en el puerto 8123.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");
const caps = join(aqui, "screenshots");
const tmp = join(aqui, ".tmp");
mkdirSync(caps, { recursive: true });
mkdirSync(tmp, { recursive: true });
const BASE = "http://localhost:8123/";

const servidor = spawn("python", ["-m", "http.server", "8123", "--directory", raiz], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 1500));

let navegador;
for (const canal of ["msedge", "chrome"]) {
  try { navegador = await chromium.launch({ channel: canal, headless: true }); console.log("navegador:", canal); break; } catch (e) { console.log("sin", canal); }
}
if (!navegador) { servidor.kill(); throw new Error("No encontré Edge ni Chrome instalado."); }

const resultados = [];
const prueba = async (nombre, fn) => {
  try { await fn(); resultados.push([true, nombre]); console.log("OK   ", nombre); }
  catch (e) { resultados.push([false, nombre + " -> " + e.message.split("\n")[0]]); console.log("FALLA", nombre, "\n     ", e.message.split("\n").slice(0, 4).join("\n      ")); }
};

const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: "es-AR" });
const page = await ctx.newPage();
const errores = [];
page.on("pageerror", e => errores.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errores.push("console: " + m.text()); });

const esperarListo = () => page.waitForFunction(() => document.querySelector("#pj-nombre") && document.querySelector("#pj-nombre").textContent !== "Cargando…", null, { timeout: 15000 });
const foto = n => page.screenshot({ path: join(caps, n + ".png") });
const abrirMenu = async () => { await page.waitForTimeout(300); const x = await page.$("#pm-x"); if(x) await x.click(); await page.click("#btn-menu"); await page.waitForSelector("#mi-x"); };
const idsPj = () => page.evaluate(() => listarPersonajes().then(l => l.map(p => p.id).sort()));
const bajar = async (selector) => {
  await abrirMenu();
  const [d] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
  const ruta = join(tmp, d.suggestedFilename());
  await d.saveAs(ruta);
  return { ruta, nombre: d.suggestedFilename(), json: JSON.parse(readFileSync(ruta, "utf8")) };
};

await prueba("arranca como sitio local, registra el service worker y no hay errores en consola", async () => {
  await page.goto(BASE);
  await esperarListo();
  assert.equal(await page.evaluate(() => PLATAFORMA), "local");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await esperarListo();
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), "el service worker no controla la página");
  const manifest = await page.evaluate(() => fetch(document.querySelector('link[rel="manifest"]').href).then(r => r.json()));
  assert.equal(manifest.name, "VampiroV20");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#0e0e10");
  await foto("01-inicio");
  const utiles = errores.filter(e => !/fonts\.(googleapis|gstatic)|net::ERR/i.test(e));
  assert.deepEqual(utiles, []);
});

let idPrincipal = "";
await prueba("se crea un personaje y sigue ahí después de recargar", async () => {
  await page.evaluate(() => { abrirCreacion(); });
  await page.evaluate(() => {
    Object.assign(W, {
      nombre: "Test Vampiro", concepto: "Tester nocturno", clan: "brujah",
      atr: { fuerza: 4, destreza: 3, resistencia: 3, carisma: 3, manipulacion: 3, apariencia: 2, percepcion: 2, inteligencia: 2, astucia: 2 },
      hab: { alerta: 3, atletismo: 3, pelea: 3, intimidacion: 2, callejeo: 2, armas_de_fuego: 3, conducir: 3, sigilo: 3, ocultismo: 3, investigacion: 2 },
      dis: { celeridad: 1, potencia: 1, presencia: 1 }, tras: { recursos: 3, contactos: 2 }, vir: { conciencia: 4, autocontrol: 3, coraje: 3 },
      grat: { "fuerza_voluntad:": 7, "humanidad:": 2, "habilidad:pelea": 1, "trasfondo:recursos": 1, "trasfondo:contactos": 1 },
      sangre: 6, refugio: "Sótano de prueba", equipo: "Navaja\nCelular", dinero: 5000, step: 9 });
    renderWz();
  });
  assert.equal(await page.evaluate(() => primerPasoInvalido()), -1, "el personaje de prueba no pasa la validación");
  await foto("02-creacion-resumen");
  await page.click("#wz-crear");
  await page.waitForFunction(() => F && F.nombre === "Test Vampiro", null, { timeout: 15000 });
  idPrincipal = await page.evaluate(() => PJ);
  await foto("03-personaje-creado");
  await page.reload(); await esperarListo();
  assert.equal(await page.evaluate(() => PJ), idPrincipal);
  assert.equal((await page.textContent("#pj-nombre")).trim(), "Test Vampiro");
  assert.equal(await page.evaluate(() => F.atributos.fuerza), 4);
  // y está en IndexedDB, no solo en memoria
  const enIDB = await page.evaluate(() => new Promise(ok => { const r = indexedDB.open("vampirov20"); r.onsuccess = () => { const q = r.result.transaction("docs").objectStore("docs").getAllKeys(); q.onsuccess = () => ok(q.result.filter(k => k.includes("personajes__")).length); }; }));
  assert.ok(enIDB >= 1, "no hay nada en IndexedDB");
  await page.waitForTimeout(300);
});

let exportado;
await prueba("exportar y luego importar devuelve los mismos datos", async () => {
  // un par de mensajes de chat para comprobar que viajan
  await page.evaluate(() => { nuevoMsg({ rol: "jugador", texto: "Hola, mundo" }); nuevoMsg({ rol: "narrador", texto: "La noche cae sobre Buenos Aires." }); });
  await page.waitForTimeout(400);
  exportado = await bajar("#mi-exp");
  const d = exportado.json;
  assert.equal(d.formato, "bbn-personaje");
  assert.equal(d.version, 2);
  assert.ok(Array.isArray(d.mensajes) && d.mensajes.length >= 2, "el chat no está en el archivo");
  assert.equal(d.ficha.nombre, "Test Vampiro");
  assert.ok(!JSON.stringify(d).includes("gsk_"), "hay una clave en el archivo");
  await page.setInputFiles("#f-importar", exportado.ruta);
  await page.waitForFunction(id => PJ !== id, idPrincipal, { timeout: 15000 });
  await esperarListo();
  const nuevo = await page.evaluate(() => ({ id: PJ, ficha: F, inv: INV, con: CON, n: MSGS.length, textos: MSGS.map(m => m.texto).filter(Boolean) }));
  const a = { ...d.ficha }, b = { ...nuevo.ficha }; delete b.importado;
  assert.deepEqual(b, a);
  assert.deepEqual(nuevo.inv, d.inventario);
  assert.deepEqual(nuevo.con, d.conocimiento);
  assert.ok(nuevo.textos.includes("Hola, mundo") && nuevo.textos.includes("La noche cae sobre Buenos Aires."), "el chat no se restauró");
  assert.equal((await idsPj()).length, 2);
  await foto("04-importado");
});

await prueba("un archivo viejo «bbn-personaje» se importa bien", async () => {
  const viejo = JSON.parse(JSON.stringify(exportado.json));
  delete viejo.version; delete viejo.mensajes; delete viejo.cronica_meta;
  viejo.ficha.nombre = "Vampiro Viejo"; viejo.ficha.nombre_real = "Vampiro Viejo";
  const ruta = join(tmp, "viejo.json"); writeFileSync(ruta, JSON.stringify(viejo));
  const antes = await page.evaluate(() => PJ);
  await page.setInputFiles("#f-importar", ruta);
  await page.waitForFunction(id => PJ !== id, antes, { timeout: 15000 });
  await esperarListo();
  assert.equal(await page.evaluate(() => F.nombre), "Vampiro Viejo");
  assert.equal((await idsPj()).length, 3);
});

await prueba("«Respaldar todo» exporta todo y se restaura en un dispositivo vacío", async () => {
  const r = await bajar("#mi-resp");
  assert.equal(r.json.formato, "vampirov20-respaldo");
  assert.equal(r.json.personajes.length, 3);
  assert.ok(!JSON.stringify(r.json).includes("bbn_ia"), "el respaldo no debe incluir la configuración del motor");
  const ctx2 = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE);
  await p2.waitForFunction(() => document.querySelector("#pj-nombre") && document.querySelector("#pj-nombre").textContent !== "Cargando…");
  assert.equal(await p2.evaluate(() => listarPersonajes().then(l => l.length)), 0);
  await p2.setInputFiles("#f-importar", r.ruta);
  await p2.waitForSelector("#rb-ok");
  await p2.click("#rb-ok");
  await p2.waitForFunction(() => F && F.nombre, null, { timeout: 15000 });
  assert.equal(await p2.evaluate(() => listarPersonajes().then(l => l.length)), 3);
  await ctx2.close();
});

await prueba("sin clave, el narrador muestra el aviso y el resto de la app funciona", async () => {
  await page.evaluate(() => { localStorage.removeItem("bbn_ia"); });
  await page.reload(); await esperarListo();
  assert.equal(await page.evaluate(() => HAY_IA()), false);
  await abrirMenu();
  await foto("10-menu");
  await page.click("#mi-partida");
  await page.waitForSelector('[data-pm="ia"]');
  await foto("11-partida");
  await page.click('[data-pm="ia"]');
  await page.waitForSelector("#mo-aviso");
  const aviso = await page.textContent("#mo-aviso");
  assert.match(aviso, /console\.groq\.com\/keys/);
  assert.match(aviso, /mesa/);
  await foto("05-aviso-sin-clave");
  await page.click("#mo-x");
  await page.click('#tabs [data-t="ficha"]');
  await page.waitForSelector("#s-ficha:not([hidden])");
  await foto("06-ficha");
  await page.click('#tabs [data-t="inv"]');
  await page.waitForSelector("#s-inv:not([hidden])");
});

await prueba("la prueba de conexión con Groq arma bien la URL, los headers y el cuerpo", async () => {
  const visto = [];
  await ctx.route("https://api.groq.com/**", async route => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    visto.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || "{}") });
    await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" },
      body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' });
  });
  await abrirMenu();
  if(await page.$("#mi-partida")){ await page.click("#mi-partida"); await page.click("#pm-motor"); } else await page.click("#mi-motor");
  await page.waitForSelector("#mo-tipo");
  assert.equal(await page.inputValue("#mo-tipo"), "groq");
  assert.equal(await page.inputValue("#mo-base"), "https://api.groq.com/openai/v1");
  await page.fill("#mo-clave", "gsk_clave_de_prueba");
  await foto("07-motor");
  await page.click("#mo-ok");
  await page.waitForFunction(() => HAY_IA(), null, { timeout: 10000 });
  assert.equal(visto.length, 1);
  assert.equal(visto[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(visto[0].headers["authorization"], "Bearer gsk_clave_de_prueba");
  assert.equal(visto[0].headers["content-type"], "application/json");
  assert.equal(visto[0].body.model, "openai/gpt-oss-120b");
  assert.equal(visto[0].body.stream, true);
  assert.deepEqual(visto[0].body.messages, [{ role: "user", content: "Respondé solo con la palabra: ok" }]);
  const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem("bbn_ia")));
  assert.equal(guardado.clave, "gsk_clave_de_prueba");
  // y la clave no sale en una exportación
  const r = await bajar("#mi-exp");
  assert.ok(!JSON.stringify(r.json).includes("gsk_clave_de_prueba"));
});

await prueba("Claude por API arma bien la URL, los headers y el cuerpo", async () => {
  const visto = [];
  await ctx.route("https://api.anthropic.com/**", async route => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    visto.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || "{}") });
    const ev = [
      'event: message_start\ndata: {"type":"message_start","message":{"role":"assistant","content":[]}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
      'event: message_stop\ndata: {"type":"message_stop"}'];
    await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: ev.join("\n\n") + "\n\n" });
  });
  await abrirMenu();
  if(await page.$("#mi-partida")){ await page.click("#mi-partida"); await page.click("#pm-motor"); } else await page.click("#mi-motor");
  await page.waitForSelector("#mo-tipo");
  await page.selectOption("#mo-tipo", "anthropic");
  assert.equal(await page.inputValue("#mo-modelo"), "claude-sonnet-5-5");
  await page.fill("#mo-clave", "sk-ant-prueba");
  await page.click("#mo-ok");
  await page.waitForFunction(() => MOTOR.tipo === "anthropic", null, { timeout: 10000 });
  assert.equal(visto.length, 1);
  assert.equal(visto[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(visto[0].headers["x-api-key"], "sk-ant-prueba");
  assert.equal(visto[0].headers["anthropic-version"], "2023-06-01");
  assert.equal(visto[0].headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(visto[0].body.model, "claude-sonnet-5-5");
  assert.equal(visto[0].body.stream, true);
  assert.ok(visto[0].body.max_tokens > 0);
});

await prueba("el Narrador usa una herramienta y sigue narrando (protocolo OpenAI)", async () => {
  // vuelve a Groq y simula: 1ª respuesta pide la herramienta "anotar"; 2ª, texto final
  await page.evaluate(() => guardarMotor({ tipo: "groq", base: "https://api.groq.com/openai/v1", modelo: "openai/gpt-oss-120b", clave: "gsk_clave_de_prueba" }));
  let llamada = 0; const cuerpos = [];
  await ctx.unroute("https://api.groq.com/**");
  await ctx.route("https://api.groq.com/**", async route => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    cuerpos.push(JSON.parse(req.postData() || "{}")); llamada++;
    const cuerpo = llamada === 1
      ? 'data: {"choices":[{"delta":{"content":"Mirás la puerta. "}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"anotar","arguments":"{\\"texto\\":\\"La puerta tiene una marca roja\\","}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"tema\\":\\"pistas\\"}"}}]}}]}\n\ndata: [DONE]\n\n'
      : 'data: {"choices":[{"delta":{"content":"Anotás la marca y esperás."}}]}\n\ndata: [DONE]\n\n';
    await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: cuerpo });
  });
  await page.evaluate(() => { MUNDO.cronica_id = null; });
  await page.evaluate(() => { MUNDO.modo = "ia"; MUNDO.cronica_id = PJ; GUIA = { premisa: "p", pnj: [] }; CRON = { nombre: "Prueba", tipo: "libre" }; aplicarModo(); });
  await page.evaluate(() => mostrarPestana("chat"));
  await page.evaluate(() => narrar("Miro la puerta"));
  await page.waitForFunction(() => document.querySelector("#chat").textContent.includes("Anotás la marca y esperás."), null, { timeout: 15000 });
  assert.equal(cuerpos.length, 2);
  assert.ok(cuerpos[0].tools.some(t => t.function.name === "anotar"));
  const ultimo = cuerpos[1].messages.at(-1);
  assert.equal(ultimo.role, "tool"); assert.equal(ultimo.tool_call_id, "c1"); assert.equal(ultimo.content, "ok");
  assert.ok(cuerpos[1].messages.some(m => m.role === "assistant" && m.tool_calls?.[0]?.function?.arguments === '{"texto":"La puerta tiene una marca roja","tema":"pistas"}'));
  assert.ok(await page.evaluate(() => CON.hechos.some(h => h.texto === "La puerta tiene una marca roja")), "la herramienta no se ejecutó");
  await foto("08-narrador");
});

await prueba("límite por minuto de Groq: espera lo que pide el servicio y reintenta solo; el diario avisa sin reintentar", async () => {
  let llamadas = 0, modo = "minuto";
  await ctx.unroute("https://api.groq.com/**");
  await ctx.route("https://api.groq.com/**", async route => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-expose-headers": "retry-after" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    llamadas++;
    if (modo === "diario") return route.fulfill({ status: 429, headers: cors, contentType: "application/json", body: '{"error":{"message":"Rate limit reached for model on tokens per day (TPD): Limit 200000. Please try again in 3h2m1s.","code":"rate_limit_exceeded"}}' });
    if (llamadas === 1) return route.fulfill({ status: 429, headers: { ...cors, "retry-after": "1" }, contentType: "application/json", body: '{"error":{"message":"Rate limit reached on tokens per minute (TPM): Limit 8000. Please try again in 1s.","code":"rate_limit_exceeded"}}' });
    await route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: 'data: {"choices":[{"delta":{"content":"Pasó el minuto y seguís."}}]}\n\ndata: [DONE]\n\n' });
  });
  await page.evaluate(() => { MUNDO.modo = "ia"; MUNDO.cronica_id = PJ; GUIA = { premisa: "p", pnj: [] }; CRON = { nombre: "Prueba", tipo: "libre" }; aplicarModo(); mostrarPestana("chat"); });
  await page.evaluate(() => narrar("Sigo adelante"));
  await page.waitForFunction(() => document.querySelector("#chat").textContent.includes("Pasó el minuto y seguís."), null, { timeout: 15000 });
  assert.equal(llamadas, 2, "debía reintentar una vez");
  modo = "diario"; llamadas = 0;
  await page.evaluate(() => narrar("Otra vez"));
  await page.waitForFunction(() => document.querySelector("#chat").textContent.includes("límite diario"), null, { timeout: 15000 });
  assert.equal(llamadas, 1, "el límite diario no se reintenta");
  await foto("12-limite");
});

await prueba("sin internet la app abre desde la copia guardada", async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload(); await esperarListo();
  assert.ok((await page.textContent("#pj-nombre")).trim().length > 0);
  await foto("09-sin-internet");
  await ctx.setOffline(false);
});

await navegador.close();
servidor.kill();
console.log("\nResumen");
for (const [ok, n] of resultados) console.log(ok ? "  ✔" : "  ✘", n);
process.exit(resultados.every(r => r[0]) ? 0 : 1);
