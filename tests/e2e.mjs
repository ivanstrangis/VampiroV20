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
page.on("pageerror", e => { errores.push("pageerror: " + e.message); if (process.env.DBG) console.log("PAGEERROR", e.message); });
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
  assert.match(cuerpos[0].messages.at(-1).content, /Recordatorio del Director: narrá solo lo que el jugador/);
  assert.match(cuerpos[0].messages[0].content, /FIDELIDAD A LA ACCIÓN/);
  assert.match(cuerpos[0].messages[0].content, /RELOJ: toda acción gasta tiempo/);
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

// Respuestas simuladas de Groq para las pruebas de tiradas.
const sseGroq = (...trozos) => trozos.map(c => "data: " + JSON.stringify(c)).join("\n\n") + "\n\ndata: [DONE]\n\n";
const corsGroq = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-expose-headers": "retry-after" };
const pedirTiradaGroq = sseGroq({ choices: [{ delta: { content: "Te acercás sin hacer ruido. " } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "tirada_jugador", arguments: JSON.stringify({ motivo: "resistir la tentación", rasgo: "fuerza_de_voluntad", dificultad: 6 }) } }] } }] });
const textoGroq = t => sseGroq({ choices: [{ delta: { content: t } }] });
const hayResultado = body => String(body.messages?.at(-1)?.content || "").includes("Resultado de la tirada");
const prepararIA = () => page.evaluate(() => { try { cerrarSheet(); } catch(_) {} MUNDO.modo = "ia"; MUNDO.cronica_id = PJ; GUIA = { premisa: "p", pnj: [] }; CRON = { nombre: "Prueba", tipo: "libre" }; aplicarModo(); mostrarPestana("chat"); });

await prueba("una tirada pedida por el Narrador cierra el turno y se tira sin tocar Detener", async () => {
  let llamadas = 0;
  await ctx.unroute("https://api.groq.com/**");
  await ctx.route("https://api.groq.com/**", async route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsGroq });
    const body = JSON.parse(req.postData() || "{}"); llamadas++;
    if (llamadas === 1) return route.fulfill({ status: 200, headers: { ...corsGroq, "content-type": "text/event-stream" }, body: pedirTiradaGroq });
    if (hayResultado(body)) return route.fulfill({ status: 200, headers: { ...corsGroq, "content-type": "text/event-stream" }, body: textoGroq("Resistís y seguís de largo.") });
    // Una vuelta extra sin resultado de la tirada no debería pedirse: con Groq real se queda esperando el límite por minuto.
    return route.fulfill({ status: 429, headers: { ...corsGroq, "retry-after": "30" }, contentType: "application/json", body: '{"error":{"message":"Please try again in 30s."}}' });
  });
  await prepararIA();
  await page.evaluate(() => { narrar("Me acerco despacio"); });
  await page.waitForFunction(() => !running, null, { timeout: 5000 });
  assert.equal(llamadas, 1, "el turno debía terminar sin pedir otra vuelta al motor");
  assert.equal(await page.evaluate(() => document.querySelector("#btn-send").textContent.trim()), "Enviar");
  const tirar = page.locator("#chat .dice button").last();
  await tirar.click();
  await page.waitForFunction(() => document.querySelector("#chat").textContent.includes("Resistís y seguís de largo."), null, { timeout: 15000 });
  await page.waitForFunction(() => !running, null, { timeout: 5000 });
  assert.ok(!(await page.textContent("#chat")).includes("Narración detenida"), "no hizo falta detener nada");
  await foto("13-tirada");
});

await prueba("si el Narrador todavía está escribiendo, tirar lo detiene solo y sigue", async () => {
  let colgadas = 0;
  await ctx.unroute("https://api.groq.com/**");
  await ctx.route("https://api.groq.com/**", async route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsGroq });
    const body = JSON.parse(req.postData() || "{}");
    if (String(body.messages?.at(-1)?.content || "").includes("Resultado de la tirada «contener la sed»")) return route.fulfill({ status: 200, headers: { ...corsGroq, "content-type": "text/event-stream" }, body: textoGroq("Tu sed cede un instante.") });
    colgadas++; await new Promise(r => setTimeout(r, 6000)); await route.abort().catch(() => {});
  });
  await prepararIA();
  await page.evaluate(() => { nuevoMsg({ rol: "pedido", datos: { motivo: "contener la sed", rasgo: "fuerza_de_voluntad", dificultad: 6 }, resuelto: false }); narrar("Sigo caminando"); });
  await page.waitForFunction(() => !!running, null, { timeout: 5000 });
  for (let i = 0; i < 100 && !colgadas; i++) await page.waitForTimeout(50);  // el pedido ya está en el motor, sin respuesta
  assert.ok(colgadas >= 1, "el Narrador debía estar esperando respuesta");
  await page.locator("#chat .dice button").last().click();
  await page.waitForFunction(() => document.querySelector("#chat").textContent.includes("Tu sed cede un instante."), null, { timeout: 15000 });
  await page.waitForFunction(() => !running, null, { timeout: 5000 });
  const chatTxt = await page.textContent("#chat");
  assert.ok(!chatTxt.includes("Narración detenida"), "el corte automático no debe mostrar «Narración detenida»");
  assert.ok(!chatTxt.includes("Esperá a que el Narrador termine"), "no debe pedir esperar");
  assert.ok(colgadas >= 1);
});

const crearConRefugios = async (nombre, refugio) => {
  await page.evaluate(() => { abrirCreacion(); });
  await page.evaluate(([nombre, refugio]) => {
    Object.assign(W, {
      nombre, concepto: "Tester nocturno", clan: "brujah",
      atr: { fuerza: 4, destreza: 3, resistencia: 3, carisma: 3, manipulacion: 3, apariencia: 2, percepcion: 2, inteligencia: 2, astucia: 2 },
      hab: { alerta: 3, atletismo: 3, pelea: 3, intimidacion: 2, callejeo: 2, armas_de_fuego: 3, conducir: 3, sigilo: 3, ocultismo: 3, investigacion: 2 },
      dis: { celeridad: 1, potencia: 1, presencia: 1 }, tras: { recursos: 3, contactos: 2 }, vir: { conciencia: 4, autocontrol: 3, coraje: 3 },
      grat: { "fuerza_voluntad:": 7, "humanidad:": 2, "habilidad:pelea": 1, "trasfondo:recursos": 1, "trasfondo:contactos": 1 },
      sangre: 6, refugio, equipo: "Navaja\nCelular", dinero: 5000, step: 9 });
    renderWz();
  }, [nombre, refugio]);
  assert.equal(await page.evaluate(() => primerPasoInvalido()), -1, "el personaje de prueba no pasa la validación");
  await page.click("#wz-crear");
  await page.waitForFunction(n => F && F.nombre === n, nombre, { timeout: 15000 });
};
await prueba("creación: un personaje puede tener cero, uno o varios refugios", async () => {
  await crearConRefugios("Sin Refugio", "");
  assert.equal(await page.evaluate(() => INV.refugios.length), 0);
  assert.equal(await page.evaluate(() => CON.hechos.length), 0, "no debería anotar un refugio que no existe");
  await crearConRefugios("Dos Refugios", "Un PH en Boedo\n  \nUn depósito en Barracas");
  assert.deepEqual(await page.evaluate(() => INV.refugios.map(r => r.nombre)), ["Un PH en Boedo", "Un depósito en Barracas"]);
  assert.equal(await page.evaluate(() => new Set(INV.refugios.map(r => r.id)).size), 2, "los refugios necesitan ids distintos");
});
await prueba("modo mesa: agregar, editar, anotar y borrar refugios desde el inventario", async () => {
  await page.click('#tabs [data-t="inv"]');
  await page.waitForSelector("#ref-nuevo");
  await page.click("#ref-nuevo");
  await page.fill("#rf-n", "Una casa en San Telmo");
  await page.fill("#rf-d", "Planta baja, dos puertas");
  await page.fill("#rf-t", "La vecina sospecha.\nHay un túnel al sótano.");
  await foto("13-refugio-editor");
  await page.click("#rf-ok");
  await page.waitForFunction(() => INV.refugios.length === 3);
  assert.match(await page.textContent("#s-inv"), /Una casa en San Telmo/);
  assert.match(await page.textContent("#s-inv"), /Hay un túnel al sótano/);
  await foto("14-refugios-inventario");
  // editar el primero y guardar un objeto adentro
  await page.click('[data-ref]');
  await page.fill("#rf-n", "Un PH en Boedo (principal)");
  await page.click("#rf-ok");
  await page.waitForFunction(() => INV.refugios[0].nombre === "Un PH en Boedo (principal)");
  await page.evaluate(() => { INV.items.find(o => o.nombre === "Navaja").lugar = INV.refugios[0].id; renderInv(); });
  // nombre repetido: no deja
  await page.click("#ref-nuevo"); await page.fill("#rf-n", "un depósito en barracas"); await page.click("#rf-ok");
  assert.match(await page.textContent("#rf-err"), /Ya tenés un refugio/);
  await page.click("#rf-x");
  // borrar el primero: pide confirmar y el objeto pasa a Encima
  await page.click('[data-ref]');
  await page.click("#rf-del");
  assert.equal(await page.evaluate(() => INV.refugios.length), 3, "borró sin confirmar");
  await page.click("#rf-del");
  await page.waitForFunction(() => INV.refugios.length === 2);
  assert.equal(await page.evaluate(() => INV.items.find(o => o.nombre === "Navaja").lugar), "encima");
  // sigue ahí después de recargar
  await page.reload(); await esperarListo();
  assert.deepEqual(await page.evaluate(() => INV.refugios.map(r => r.nombre)), ["Un depósito en Barracas", "Una casa en San Telmo"]);
  assert.equal(await page.evaluate(() => INV.refugios[1].notas), "La vecina sospecha.\nHay un túnel al sótano.");
  // y se pueden borrar todos
  await page.click('#tabs [data-t="inv"]');
  for (let i = 0; i < 2; i++) { await page.click('[data-ref]'); await page.click("#rf-del"); await page.click("#rf-del"); await page.waitForFunction(n => INV.refugios.length === n, 1 - i); }
  assert.match(await page.textContent("#s-inv"), /No tiene refugios/);
  await page.evaluate(id => cambiarPersonaje(id), idPrincipal);
  await page.waitForFunction(() => F && F.nombre === "Test Vampiro", null, { timeout: 15000 });
});

await prueba("creación: la cabecera es del personaje nuevo y muestra los puntos por repartir", async () => {
  await page.evaluate(() => { abrirCreacion(); });
  assert.equal((await page.textContent("#pj-nombre")).trim(), "Nuevo personaje", "muestra el nombre del último personaje abierto");
  assert.equal((await page.textContent("#n-blood")).trim(), "–");
  assert.equal((await page.textContent("#n-fv")).trim(), "–");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#m-xp")).visibility), "hidden", "PX no tiene sentido en un personaje nuevo");
  await page.fill("#w-nombre", "Lucía"); await page.fill("#w-apodo", "La Gata");
  assert.equal((await page.textContent("#pj-nombre")).trim(), "Lucía «La Gata»");
  await page.evaluate(() => { W.clan = "brujah"; W.step = 2; renderWz(); });
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "Por repartir");
  assert.equal((await page.textContent("#n-xp")).replace(/\s/g, ""), "15/15");
  await page.click('[data-pick="atr:fuerza"] button[data-v="5"]');
  assert.equal((await page.textContent("#n-xp")).replace(/\s/g, ""), "11/15");
  await page.evaluate(() => { W.atr.fuerza = 5; W.atr.destreza = 5; W.atr.resistencia = 5; renderWz(); });
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "Te pasaste");
  assert.equal(await page.evaluate(() => document.querySelector("#n-xp").classList.contains("sobra")), true);
  await foto("15-cabecera-creacion");
  await page.evaluate(() => { W.step = 6; W.vir = { conciencia: 3, autocontrol: 3, coraje: 4 }; renderWz(); });
  assert.equal((await page.textContent("#n-fv")).replace(/\s/g, ""), "4/4");
  await page.evaluate(() => mostrarPestana("chat"));
  assert.equal((await page.textContent("#pj-nombre")).trim(), "Test Vampiro", "no restauró la cabecera");
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "PX");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#m-salud")).display !== "none"), true);
});
await prueba("puntos gratuitos: círculos de otro color que se pueden sumar y sacar", async () => {
  await page.evaluate(() => {
    abrirCreacion();
    Object.assign(W, {
      nombre: "Círculos", concepto: "x", clan: "brujah",
      atr: { fuerza: 4, destreza: 3, resistencia: 3, carisma: 3, manipulacion: 3, apariencia: 2, percepcion: 2, inteligencia: 2, astucia: 2 },
      hab: { alerta: 3, atletismo: 3, pelea: 3, intimidacion: 2, callejeo: 2, armas_de_fuego: 3, conducir: 3, sigilo: 3, ocultismo: 3, investigacion: 2 },
      dis: { celeridad: 1, potencia: 1, presencia: 1 }, tras: { recursos: 3, contactos: 2 }, vir: { conciencia: 4, autocontrol: 3, coraje: 3 },
      grat: { "fuerza_voluntad:": 7, "humanidad:": 2, "habilidad:pelea": 1, "trasfondo:recursos": 1, "trasfondo:contactos": 1 }, step: 7 });
    renderWz();
  });
  const c = (id, n) => `[data-dp="${id}"] button[data-v="${n}"]`;
  const clase = async (id, n) => (await page.getAttribute(c(id, n), "class")) || "";
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "Listo");
  assert.equal((await page.textContent("#n-xp")).replace(/\s/g, ""), "0/15");
  // Fuerza: 4 iniciales (color base), el 5º vacío
  assert.equal(await clase("atributo:fuerza", 4), "on"); assert.equal(await clase("atributo:fuerza", 5), "");
  // sin puntos iniciales libres en su grupo, un círculo vacío suma un gratuito (de otro color)
  await page.click(c("atributo:fuerza", 5));
  assert.equal(await page.evaluate(() => W.grat["atributo:fuerza"]), 1);
  assert.equal(await clase("atributo:fuerza", 5), "fr");
  assert.equal(await clase("atributo:fuerza", 4), "on", "los iniciales no deben cambiar de color");
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "Te pasaste");
  assert.equal((await page.textContent("#n-xp")).replace(/\s/g, ""), "−5/15");
  await foto("16-circulos-gratuitos");
  // tocar el círculo gratuito lo saca
  await page.click(c("atributo:fuerza", 5));
  assert.equal(await page.evaluate(() => W.grat["atributo:fuerza"]), undefined);
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "Listo");
  await page.evaluate(() => document.querySelectorAll("#s-crear details").forEach(d => d.open = true));
  // se puede sumar varios de una vez y el costo se refleja (Habilidad = 2 c/u): Alerta 3 → 5
  await page.click(c("habilidad:alerta", 5));
  assert.equal(await page.evaluate(() => W.grat["habilidad:alerta"]), 2);
  assert.equal(await clase("habilidad:alerta", 4), "fr"); assert.equal(await clase("habilidad:alerta", 5), "fr");
  assert.equal((await page.textContent("#n-xp")).replace(/\s/g, ""), "−4/15");
  // tocar el 4º gratuito lo deja en 4 (saca uno)
  await page.click(c("habilidad:alerta", 4));
  assert.equal(await page.evaluate(() => W.grat["habilidad:alerta"]), 1);
  await page.click(c("habilidad:alerta", 4));
  assert.equal(await page.evaluate(() => W.grat["habilidad:alerta"]), undefined);
  // mover un punto inicial dentro de su grupo: sacar uno de Fuerza y ponerlo en Destreza (queda inicial, no gratuito)
  await page.click(c("atributo:fuerza", 4));
  assert.equal(await page.evaluate(() => W.atr.fuerza), 3);
  await page.click(c("atributo:destreza", 4));
  assert.equal(await page.evaluate(() => W.atr.destreza), 4);
  assert.equal(await page.evaluate(() => W.grat["atributo:destreza"]), undefined, "debió usar el punto inicial libre, no uno gratuito");
  assert.equal(await clase("atributo:destreza", 4), "on");
  assert.equal((await page.textContent("#m-xp .stat-l")).trim(), "Listo");
  // Humanidad y Fuerza de Voluntad: los círculos de las Virtudes no se tocan, los gratuitos sí
  assert.equal(await page.evaluate(() => document.querySelector('[data-dp="humanidad:"] button[data-v="1"]').disabled), true);
  await page.click(c("humanidad:", 10));
  assert.equal(await page.evaluate(() => W.grat["humanidad:"]), 3);
  await page.evaluate(() => mostrarPestana("chat"));
});

await prueba("armas especiales: material, dados extra y tipo de daño propios; el cambio de modelo actualiza el nombre", async () => {
  await page.evaluate(() => mostrarPestana("inv"));
  await page.evaluate(() => abrirObjeto(null, "cc"));
  await page.selectOption("#ob-modc", { index: 1 });
  const n1 = await page.inputValue("#ob-n");
  assert.ok(n1, "el modelo debía completar el nombre");
  await page.selectOption("#ob-modc", { index: 2 });
  const n2 = await page.inputValue("#ob-n");
  assert.notEqual(n2, n1, "al cambiar de modelo el nombre debía cambiar");
  assert.ok(await page.$eval("#ob-modc", e => e.value), "el modelo elegido debía quedar marcado");
  await page.fill("#ob-n", "Daga de plata");
  await page.selectOption("#ob-modc", { index: 3 });
  assert.equal(await page.inputValue("#ob-n"), "Daga de plata", "un nombre escrito a mano no se pisa");
  await page.selectOption("#ob-modc", "");   // las propiedades especiales solo aparecen en «Personalizada»
  await page.evaluate(() => document.querySelector(".esp-arma").open = true);
  await page.selectOption("#ob-mat", "Plata");
  await page.fill("#ob-bono", "2");
  await page.selectOption("#ob-tesp", "A");
  await page.fill("#ob-prop", "mágica, brilla ante bestias");
  await foto("17-arma-especial-editor");
  await page.click("#ob-ok");
  const a = await page.evaluate(() => INV.items.find(o => o.nombre === "Daga de plata"));
  assert.equal(a.material, "Plata"); assert.equal(a.bono_dano, 2); assert.equal(a.tipo_esp, "A"); assert.equal(a.propiedades, "mágica, brilla ante bestias");
  assert.match(await page.textContent("#s-inv"), /Plata · \+2 dados de daño · daño agravado · mágica/);
  assert.match(await page.evaluate(() => contexto()), /ESPECIAL: Plata/, "el Narrador debe saber que es especial");
  // el ataque suma los dados extra y el daño sale agravado
  const out = await page.evaluate(id => {
    const o = INV.items.find(x => x.id === id); JA[id] ||= {dif:"6", out:""};
    resultadoAtaque(o, tirar(5, 2, {auto: 3}), ""); const base = JA[id].dano; return base; }, a.id);
  assert.ok(out >= 2 + (a.dano_fuerza || 0), "el daño debía incluir los 2 dados extra");
  await page.evaluate(id => tirarDanoArma(id), a.id);
  assert.match(await page.evaluate(id => JA[id].out, a.id), /agravado/);
  // un arma común no muestra nada especial y no guarda campos vacíos
  await page.evaluate(() => abrirObjeto(null, "cc")); await page.fill("#ob-n", "Palo"); await page.click("#ob-ok");
  const c = await page.evaluate(() => INV.items.find(o => o.nombre === "Palo"));
  assert.ok(!("material" in c) && !("bono_dano" in c) && !("tipo_esp" in c) && !("propiedades" in c));
});

await prueba("armas especiales: característica condicional (hoja en llamas) que se activa a mano y por el Narrador", async () => {
  await page.evaluate(() => mostrarPestana("inv"));
  await page.evaluate(() => abrirObjeto(null, "cc"));
  await page.fill("#ob-n", "Espada de llamas");
  await page.evaluate(() => document.querySelector(".esp-arma").open = true);
  await page.click("#ef-add");
  await page.fill('[data-ef="0:nombre"]', "Hoja en llamas");
  await page.fill('[data-ef="0:texto"]', "la hoja arde y prende lo que toca");
  await page.fill('[data-ef="0:dados"]', "2");
  await page.selectOption('[data-ef="0:tipo"]', "A");
  await page.selectOption('[data-efm="0"]', "mano");
  await foto("18-arma-condicional-editor");
  await page.click("#ob-ok");
  const id = await page.evaluate(() => INV.items.find(o => o.nombre === "Espada de llamas").id);
  const dano = () => page.evaluate(id => { const o = INV.items.find(x => x.id === id); return [bonoEsp(o), tipoEsp(o)]; }, id);
  assert.deepEqual(await dano(), [0, ""], "apagada no suma nada");
  assert.match(await page.textContent("#s-inv"), /Hoja en llamas: inactiva/);
  await page.click(`[data-efon$="|${await page.evaluate(id => INV.items.find(x => x.id === id).extras[0].id, id)}"]`);
  assert.deepEqual(await dano(), [2, "A"], "prendida suma 2 dados y es agravado");
  assert.match(await page.textContent("#s-inv"), /Hoja en llamas: activa/);
  assert.match(await page.evaluate(() => contexto()), /Hoja en llamas \(ACTIVA/);
  // el Narrador la apaga con la herramienta del inventario
  const r = await page.evaluate(async () => { turnoActual = {agregar(){ return {}; }, cortar(){}};
    const t = herramientas().find(x => x.name === "inventario");
    return await t.execute({accion: "desactivar", nombre: "espada de llamas", propiedad: "llamas"}); });
  assert.equal(r.activa, false);
  assert.deepEqual(await dano(), [0, ""]);
  const e = await page.evaluate(async () => { const t = herramientas().find(x => x.name === "inventario");
    try { await t.execute({accion: "activar", nombre: "espada de llamas", propiedad: "hielo"}); return ""; } catch(x){ return x.message; } });
  assert.match(e, /no tiene una propiedad/);
  await page.evaluate(async () => { const t = herramientas().find(x => x.name === "inventario"); await t.execute({accion: "activar", nombre: "espada de llamas", propiedad: "llamas"}); });
  assert.deepEqual(await dano(), [2, "A"]);
  await page.reload(); await esperarListo();
  assert.deepEqual(await dano(), [2, "A"], "el estado queda guardado");
  await page.evaluate(id => { const o = INV.items.find(x => x.id === id); o.extras[0].activo = false; guardarInv(); }, id);
});

await prueba("armas especiales: requisito para empuñar y características que se activan solas según la ficha", async () => {
  await page.evaluate(() => mostrarPestana("inv"));
  await page.evaluate(() => abrirObjeto(null, "cc"));
  await page.fill("#ob-n", "Hacha rúnica");
  await page.evaluate(() => document.querySelector(".esp-arma").open = true);
  await page.selectOption("#rq-r", "fuerza");
  await page.fill("#rq-v", "9");
  await page.click("#ef-add");
  await page.fill('[data-ef="0:nombre"]', "Furia de pura sangre");
  await page.fill('[data-ef="0:dados"]', "2");
  await page.click('[data-efca="0"]');                       // una condición: Humanidad ≥ 10
  await page.fill('[data-efc="0:0:valor"]', "10");
  await page.click("#ef-add");
  await page.fill('[data-ef="1:nombre"]', "Sed de sangre");
  await page.fill('[data-ef="1:dados"]', "1");
  await page.click('[data-efca="1"]');
  await page.selectOption('[data-efc="1:0:rasgo"]', "salud_pct");
  await page.selectOption('[data-efc="1:0:op"]', "<=");
  await page.fill('[data-efc="1:0:valor"]', "50");
  await page.click("#ef-add");                               // a voluntad, pero solo disponible con DOS condiciones («y»)
  await page.fill('[data-ef="2:nombre"]', "Pureza");
  await page.fill('[data-ef="2:dados"]', "3");
  await page.selectOption('[data-efm="2"]', "mano");
  await page.click('[data-efca="2"]'); await page.click('[data-efca="2"]');
  await page.selectOption('[data-efc="2:1:rasgo"]', "sangre");
  await page.selectOption('[data-efc="2:1:op"]', "<=");
  await page.fill('[data-efc="2:1:valor"]', "5");
  await foto("19-arma-condiciones");
  await page.click("#ob-ok");
  const id = await page.evaluate(() => INV.items.find(o => o.nombre === "Hacha rúnica").id);
  const o = () => page.evaluate(id => INV.items.find(x => x.id === id), id);
  assert.deepEqual((await o()).requisito, { rasgo: "fuerza", op: ">=", valor: 9 });
  // requisito: con Fuerza baja no se puede empuñar, salvo «Empuñarla igual»
  const empuna = () => page.evaluate(id => { try { exigirEmpunable(INV.items.find(x => x.id === id)); return ""; } catch (e) { return e.message; } }, id);
  assert.match(await empuna(), /no puede empuñar «Hacha rúnica»: pide Fuerza ≥ 9/);
  await page.evaluate(id => { INV.items.find(x => x.id === id).forzada = true; }, id);
  assert.equal(await empuna(), "");
  await page.evaluate(id => { INV.items.find(x => x.id === id).forzada = false; }, id);
  assert.deepEqual((await o()).extras[2].conds.map(c => c.rasgo), ["humanidad", "sangre"]);
  await page.evaluate(id => { INV.items.find(x => x.id === id).extras[2].activo = true; }, id);   // «Pureza» prendida a voluntad
  const bono = (hum, salud, sangre) => page.evaluate(([id, hum, salud, sangre]) => { const f0 = [F.humanidad, F.salud, F.sangre]; F.humanidad = hum; F.salud = salud; F.sangre = sangre;
    const r = [bonoEsp(INV.items.find(x => x.id === id)), valorCond("salud_pct")]; [F.humanidad, F.salud, F.sangre] = f0; return r; }, [id, hum, salud, sangre]);
  assert.deepEqual(await bono(7, [], 6), [0, 100], "ninguna se cumple");
  assert.equal((await bono(10, [], 6))[0], 2, "Humanidad 10 activa la primera; Pureza pide también Sangre ≤ 5");
  assert.equal((await bono(10, [], 5))[0], 5, "con las dos condiciones de Pureza (y), se suma");
  assert.equal((await bono(7, [], 5))[0], 0, "con una sola de las dos condiciones no alcanza");
  assert.deepEqual(await bono(7, ["L", "L", "L", "L"], 6), [1, 43], "con menos del 50% de salud se activa la segunda");
  assert.equal((await bono(10, ["L", "L", "L", "L"], 6))[0], 3, "se suman");
  assert.match(await page.evaluate(() => contexto()), /Requiere Fuerza ≥ 9 \(NO lo cumple/);
  assert.match(await page.evaluate(() => contexto()), /Pureza \(no disponible: pide Humanidad ≥ 10 y Sangre actual ≤ 5/);
  assert.match(await page.textContent("#s-inv"), /Pureza: pide Humanidad ≥ 10 y Sangre actual ≤ 5/, "el interruptor aparece bloqueado y dice qué pide");
  // el Narrador no puede activar «Pureza» si no se cumplen las condiciones, ni activar a mano una que depende solo de la ficha
  const e = await page.evaluate(async () => { turnoActual = { agregar() { return {}; }, cortar() {} };
    const t = herramientas().find(x => x.name === "inventario");
    try { await t.execute({ accion: "activar", nombre: "hacha runica", propiedad: "pureza" }); return ""; } catch (x) { return x.message; } });
  assert.match(e, /no se puede activar ahora: pide Humanidad ≥ 10 y Sangre actual ≤ 5/);
  const e2 = await page.evaluate(async () => { const t = herramientas().find(x => x.name === "inventario");
    try { await t.execute({ accion: "activar", nombre: "hacha runica", propiedad: "furia" }); return ""; } catch (x) { return x.message; } });
  assert.match(e2, /no tiene una propiedad/);

});
await prueba("armas especiales: los dados extra con su propio tipo mezclan el daño (parte letal, parte agravada)", async () => {
  const r = await page.evaluate(() => {
    const o = {id:"mezcla_t", nombre:"Daga ardiente", tipo:"arma_cc", dano_fuerza:2, tipo_dano:"L", lugar:"encima", extras:[{id:"e1", nombre:"Fuego", dados:2, tipo_extra:"A"}]};
    INV.items = INV.items.filter(x => x.id !== o.id); INV.items.push(o); JA[o.id] ||= {dif:"6", out:""};
    resultadoAtaque(o, tirar(5, 2, {auto:3}), "");
    const antes = [JA[o.id].dano, JSON.stringify(JA[o.id].danoExtra), bonoEsp(o)];
    tirarDanoArma(o.id);
    return {antes, out:JA[o.id].out, info:infoEsp(o)};
  });
  assert.deepEqual(r.antes.slice(1), ['{"A":2}', 2]);
  assert.ok((r.out.match(/class="res good"/g) || []).length >= 2, "debe haber dos tiradas de daño");
  assert.match(r.out, /daño letal/); assert.match(r.out, /daño agravado \(dados extra\)/);
  assert.match(r.info, /\+2 dados de daño agravado/);
  await page.evaluate(() => { INV.items = INV.items.filter(x => x.id !== "mezcla_t"); });
});
await prueba("tirar dados: el dado más alto se ve como 10, nunca como 0", async () => {
  await page.evaluate(() => abrirDadoRapido());
  await page.evaluate(() => { DR.dados = [{v:10, desc:false, par:null, usado:false, extra:false}, {v:7, desc:false, par:null, usado:false, extra:false}, {v:1, desc:false, par:null, usado:false, extra:false}]; pintarRapida(); });
  assert.deepEqual(await page.$$eval("#dr-res .d10", els => els.map(e => e.textContent)), ["10", "7", "1"]);
  assert.equal((await page.textContent("#dr-dieces")).trim(), "10");
  assert.doesNotMatch(await page.textContent("#dr-res"), /un 0|Dado 0/);
  await foto("22-dados-rapidos");
  await page.evaluate(() => cerrarSheet());
});
await prueba("Disciplinas que suman dados: botón para sumarlas o no (tirada, arma, absorción, Narrador) y para sumar o no los éxitos extra en el daño", async () => {
  await page.evaluate(() => { window.__d0 = JSON.stringify(F.disciplinas || {}); F.disciplinas = {...(F.disciplinas || {}), celeridad: 2, fortaleza: 1}; JT.celAcc = 0; });
  await page.evaluate(() => { mostrarPestana("juego"); J.esp = null; J.atajo = null; J.a = "destreza"; J.b = "atletismo"; J.sumaDisc = true; renderJuegoConservando(); });
  const n = () => page.evaluate(() => reservaJ().n);
  const con = await n();
  assert.equal((await page.textContent("#j-disc")).trim(), "Cel");
  assert.match(await page.getAttribute("#j-disc", "aria-label"), /Celeridad \+2/);
  await page.click("#j-disc");
  assert.equal(await n(), con - 2, "sin Celeridad la reserva baja 2");
  assert.equal(await page.getAttribute("#j-disc", "aria-pressed"), "false");
  await foto("23-boton-disciplina");
  await page.click("#j-disc");
  assert.equal(await n(), con);
  // absorción con Fortaleza
  await page.evaluate(() => atajo("absorcion"));
  const abs = await n();
  await page.click("#j-disc");
  assert.equal(await n(), abs - 1, "sin Fortaleza baja 1");
  await page.evaluate(() => { J.sumaDisc = true; J.esp = null; J.atajo = null; });
  // tirada pedida por el Narrador
  const pe = await page.evaluate(() => { const p = {atributo:"destreza", habilidad:"atletismo", dificultad:6}; return [reservaTirada(p).reserva, reservaTirada({...p, sin_disciplina:true}).reserva]; });
  assert.equal(pe[0] - pe[1], 2);
  // daño: elegir si se suman los éxitos extra y la Potencia
  const r = await page.evaluate(() => {
    const o = {id:"disc_t", nombre:"Maza", tipo:"arma_cc", dano_fuerza:1, tipo_dano:"C", lugar:"encima"};
    INV.items = INV.items.filter(x => x.id !== o.id); INV.items.push(o); const s = JA[o.id] = {dif:"6", out:"", dano:null};
    resultadoAtaque(o, tirar(8, 2, {auto:4}), "");
    const todo = dadosDano(s), masEx = s.masEx, html = controlesDano(o, s);
    s.sumaEx = false; const sin = dadosDano(s);
    return {todo, masEx, sin, html};
  });
  assert.ok(r.masEx > 0, "la tirada de prueba debía tener éxitos extra");
  assert.match(r.html, /data-jdx/); assert.equal(r.todo - r.sin, r.masEx);
  await page.evaluate(() => { JA["disc_t"].sumaEx = true; renderJuegoConservando(); });
  await (await page.$(".tcard.armas")).screenshot({ path: join(caps, "24-tarjeta-arma.png") });
  await page.evaluate(() => { JA["disc_t"].sumaEx = false; });
  const dados = await page.evaluate(() => { const s = JA["disc_t"]; const antes = (s.out.match(/class="d10/g) || []).length; tirarDanoArma("disc_t"); return (s.out.match(/class="d10/g) || []).length - antes; });
  assert.equal(dados, r.sin, "tira solo los dados elegidos");
  assert.match(await page.evaluate(() => JA["disc_t"].out), /sin sumar \d+ éxito/);
  await page.evaluate(() => { INV.items = INV.items.filter(x => x.id !== "disc_t"); F.disciplinas = JSON.parse(window.__d0); });
  // si el personaje cambia y la tirada a medida quedó con una Disciplina que el otro no tiene, la pantalla no se rompe
  await page.evaluate(() => { J.a = "destreza"; J.b = "fortaleza"; });
  assert.equal(await page.evaluate(() => { try { renderJuegoConservando(); return reservaJ().n >= 0; } catch(e){ return e.message; } }), true);
  await page.evaluate(() => { J.b = "atletismo"; });
});
await prueba("menús: arrastrar hacia abajo estando arriba de todo cierra la hoja; a mitad de contenido solo desplaza", async () => {
  const cdp = await ctx.newCDPSession(page);
  const deslizar = async (x, y1, y2) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y1 }] });
    const pasos = 12;
    for (let i = 1; i <= pasos; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y1 + (y2 - y1) * i / pasos }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(450);
  };
  const largo = () => page.evaluate(() => { abrirSheet("<h2>Prueba</h2>" + '<p class="pen">línea</p>'.repeat(90) + '<button id="pr-x" class="btn">x</button>', () => {}); });
  const caja = () => page.evaluate(() => { const r = document.querySelector(".sheet").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 120, scroll: document.querySelector(".sheet").scrollTop }; });
  // 1) arriba de todo: un gesto corto no cierra y la hoja vuelve a su lugar
  await largo(); let c = await caja();
  await deslizar(c.x, c.y, c.y + 50);
  assert.equal(await page.$$eval(".sheet", e => e.length), 1, "un gesto corto no debía cerrarla");
  assert.equal(await page.$eval(".sheet", e => e.style.transform), "", "la hoja debe volver a su lugar");
  // 2) arriba de todo: arrastrar bastante la cierra
  await deslizar(c.x, c.y, c.y + 260);
  assert.equal(await page.$$eval(".sheet", e => e.length), 0, "arrastrar hacia abajo desde el tope debía cerrar el menú");
  // 3) a mitad del contenido: arrastrar hacia abajo solo desplaza hacia arriba, no cierra
  await largo();
  await page.evaluate(() => { document.querySelector(".sheet").scrollTop = 600; });
  c = await caja();
  await deslizar(c.x, c.y, c.y + 200);
  assert.equal(await page.$$eval(".sheet", e => e.length), 1, "con el menú a mitad de scroll no debía cerrarse");
  assert.ok((await caja()).scroll < 600, "debía desplazarse hacia arriba");
  await page.evaluate(() => cerrarSheet());
  // 4) el menú principal también
  await page.evaluate(() => document.querySelector("#btn-menu").click());
  await page.waitForSelector("#mi-x");
  await page.evaluate(() => { document.querySelector(".sheet").scrollTop = 0; });
  c = await caja();
  await deslizar(c.x, c.y, c.y + 300);
  assert.equal(await page.$("#mi-x"), null, "el menú principal debía cerrarse");
});
await prueba("deslizar de lado cambia de pestaña, sin dar la vuelta en las puntas", async () => {
  const cdp = await ctx.newCDPSession(page);
  const lado = async (dx) => {
    const x0 = dx < 0 ? 300 : 90, y = 400;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + dx * i / 8, y: y + 4 }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(550);
  };
  const actual = () => page.$eval('#tabs [aria-selected="true"]', b => b.dataset.t);
  await page.evaluate(() => { cerrarSheet(); mostrarPestana("chat"); });
  assert.equal(await actual(), "chat");
  // la pantalla sigue al dedo mientras se arrastra
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y: 400 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 300 - 12 * i, y: 402 }] }); await page.waitForTimeout(60); }
  const sigue = await page.$eval(".screen:not([hidden])", e => e.style.transform);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(550);
  assert.match(sigue, /translateX\(-\d+/, "la pantalla debía acompañar al dedo");
  assert.equal(await actual(), "chat", "un arrastre corto y lento vuelve a su lugar");
  await lado(-200); assert.equal(await actual(), "ficha");
  await lado(-200); assert.equal(await actual(), "inv");
  if (process.env.DBG) console.log(await page.evaluate(() => { const el = document.elementFromPoint(300, 400), out = []; for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); out.push(n.tagName + "." + n.className + " ox=" + cs.overflowX + " sw=" + n.scrollWidth + " cw=" + n.clientWidth); } return out.join(" | "); }));
  await lado(-200); assert.equal(await actual(), "notas");
  await lado(-200); assert.equal(await actual(), "notas", "en la última pestaña no da la vuelta");
  await lado(200); assert.equal(await actual(), "inv");
  await lado(200); assert.equal(await actual(), "ficha");
  await lado(200); assert.equal(await actual(), "chat");
  await lado(200); assert.equal(await actual(), "chat", "en la primera pestaña no da la vuelta");
  // un gesto más vertical que horizontal no cambia de pestaña
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 300 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200 - 10 * i, y: 300 + 40 * i }] }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(550);
  assert.equal(await actual(), "chat");
  // con un menú abierto no cambia de pestaña
  await page.evaluate(() => abrirSheet("<h2>x</h2>", () => {}));
  await lado(-200); assert.equal(await actual(), "chat");
  await page.evaluate(() => cerrarSheet());
});
await prueba("el doble toque no hace zoom (touch-action: manipulation en todo)", async () => {
  const r = await page.evaluate(() => ["body", "#app", "button", ".screen", "input"].map(q => { const e = document.querySelector(q); return e ? getComputedStyle(e).touchAction : "manipulation"; }));
  assert.deepEqual([...new Set(r)], ["manipulation"]);
});
await prueba("Salud y Sangre: la hoja queda abierta, marca lo nuevo y lo curado, y se puede deshacer", async () => {
  await page.evaluate(() => { cerrarSheet(); mostrarPestana("chat"); F.salud = ["L", "L"]; F.sangre = 3; guardarFicha(); });
  // Salud: un toque = un nivel, sin elegir cantidad
  await page.evaluate(() => abrirSalud());
  assert.equal(await page.$("#hs-mas"), null, "ya no hay selector de cantidad");
  await page.click('[data-hr="C"]'); await page.click('[data-hr="C"]');
  assert.equal(await page.evaluate(() => F.salud.length), 4);
  assert.equal(await page.$("#hs-body") !== null, true, "la hoja sigue abierta");
  assert.equal(await page.$$eval(".hb.nuevo", e => e.length), 2, "dos niveles nuevos en rojo");
  await page.click('[data-hc="L"]');
  assert.equal(await page.evaluate(() => F.salud.filter(x => x === "L").length), 1);
  assert.equal(await page.$$eval(".hb.curado", e => e.length), 1, "el nivel curado queda en gris");
  assert.equal(await page.evaluate(() => F.sangre), 2, "curar paga 1 Sangre");
  await foto("25-salud-en-vivo");
  // «Deshacer» dentro de la hoja
  await page.click("#hs-deshacer");
  assert.deepEqual(await page.evaluate(() => [F.salud.join(""), F.sangre]), ["LL", 3]);
  assert.equal(await page.$$eval(".hb.nuevo,.hb.curado", e => e.length), 0);
  // al cerrar queda el aviso de Deshacer
  await page.click('[data-hr="A"]'); await page.click("#hs-listo");
  assert.equal(await page.$("#hs-body"), null);
  assert.match(await page.textContent("#undo-txt"), /Salud: \+1 agravado/);
  assert.equal(await page.isVisible("#undo"), true);
  await page.click("#undo-btn");
  assert.equal(await page.evaluate(() => F.salud.join("")), "LL");
  // Sangre: cantidades rápidas, la hoja sigue abierta
  await page.evaluate(() => abrirRecurso("sangre"));
  await page.click('[data-cant="3"]'); await page.click("#rs-recibir");
  assert.equal(await page.evaluate(() => F.sangre), 6);
  assert.equal(await page.$$eval(".barra i.nuevo", e => e.length), 3);
  await page.click('[data-cant="2"]'); await page.click("#rs-gastar");
  assert.equal(await page.evaluate(() => F.sangre), 4);
  assert.equal(await page.$$eval(".barra i.gastado", e => e.length), 0, "se gastó parte de lo recién ganado: no queda nada gris respecto de cuando se abrió");
  await page.click("#rs-deshacer");
  assert.equal(await page.evaluate(() => F.sangre), 3);
  await page.click("#rs-gastar");   // 2 gastados desde 3
  assert.equal(await page.$$eval(".barra i.gastado", e => e.length), 2);
  await page.evaluate(() => cerrarSheet());   // cerrar de cualquier forma deja el aviso
  assert.match(await page.textContent("#undo-txt"), /Sangre: 3 → 1/);
  await page.click("#undo-btn");
  assert.equal(await page.evaluate(() => F.sangre), 3);
  await page.evaluate(() => { F.salud = []; F.sangre = 6; guardarFicha(); });
});
await prueba("experiencia: se puede restar con un número negativo para corregir un error", async () => {
  await page.evaluate(() => { F.xp = 5; F.xp_total = 9; abrirSumarXP(); });
  await page.fill("#xp-n", "-2"); await page.fill("#xp-m", "corrección: me equivoqué");
  assert.equal((await page.textContent("#xp-ok")).trim(), "Restar");
  await page.click("#xp-ok");
  assert.deepEqual(await page.evaluate(() => [F.xp, F.xp_total]), [3, 7]);
  assert.match(await page.evaluate(() => MUNDO.registro_mesa[0].texto), /−2 PX/);
  await page.evaluate(() => abrirSumarXP());
  await page.fill("#xp-n", "-9"); await page.fill("#xp-m", "x"); await page.click("#xp-ok");
  assert.match(await page.textContent("#xp-err"), /Solo hay 3 PX/);
  assert.equal(await page.evaluate(() => F.xp), 3, "no deja pasar a negativo");
  await page.fill("#xp-n", "0"); await page.click("#xp-ok");
  assert.match(await page.textContent("#xp-err"), /distinto de cero/);
  await page.evaluate(() => { cerrarSheet(); F.xp = 0; F.xp_total = 0; guardarFicha(); });
});
await prueba("modelos de armas guardados: aparecen en «Otros modelos», ocultan lo especial en los básicos y viajan en la exportación y el respaldo", async () => {
  await page.evaluate(() => mostrarPestana("inv"));
  await page.evaluate(() => abrirObjeto(null, "cc"));
  await page.selectOption("#ob-modc", { index: 1 });
  assert.equal(await page.$("#ob-mat"), null, "con un modelo básico no se muestran las propiedades especiales");
  assert.equal(await page.$("#ob-gm"), null);
  await page.selectOption("#ob-modc", "");
  await page.fill("#ob-n", "Daga de plata bendita");
  await page.evaluate(() => document.querySelector(".esp-arma").open = true);
  await page.selectOption("#ob-mat", "Plata");
  await page.fill("#ob-bono", "1");
  await page.click("#ob-gm");
  await page.waitForFunction(() => /guardado/.test(document.querySelector("#ob-info")?.textContent || ""));
  assert.equal(await page.evaluate(() => MODELOS_USR.length), 1);
  assert.equal(await page.evaluate(() => leerDoc("modelos_armas/lista").then(d => d.items.length)), 1, "queda guardado en la base");
  await page.click("#ob-x");
  // en un arma nueva aparece entre «Otros modelos» y completa todo
  await page.evaluate(() => abrirObjeto(null, "cc"));
  assert.match(await page.textContent("#ob-modc"), /Daga de plata bendita/);
  await page.selectOption("#ob-modc", { label: "Daga de plata bendita" });
  assert.equal(await page.inputValue("#ob-n"), "Daga de plata bendita");
  assert.equal(await page.inputValue("#ob-mat"), "Plata");
  assert.equal(await page.inputValue("#ob-bono"), "1");
  await foto("20-modelo-guardado");
  await page.click("#ob-x");
  // viaja en la exportación del personaje y en el respaldo completo
  const ex = await bajar("#mi-exp");
  assert.equal(ex.json.modelos_armas.length, 1);
  assert.equal(ex.json.modelos_armas[0].nombre, "Daga de plata bendita");
  const rs = await bajar("#mi-resp");
  assert.equal(rs.json.modelos_armas.length, 1);
  const ctx2 = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE);
  await p2.waitForFunction(() => document.querySelector("#pj-nombre") && document.querySelector("#pj-nombre").textContent !== "Cargando…");
  assert.equal(await p2.evaluate(() => MODELOS_USR.length), 0);
  await p2.setInputFiles("#f-importar", ex.ruta);
  await p2.waitForFunction(() => F && F.nombre, null, { timeout: 15000 });
  assert.equal(await p2.evaluate(() => MODELOS_USR.map(m => m.nombre).join()), "Daga de plata bendita", "la exportación del personaje trae los modelos");
  await ctx2.close();
  const ctx3 = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, acceptDownloads: true });
  const p3 = await ctx3.newPage();
  await p3.goto(BASE);
  await p3.waitForFunction(() => document.querySelector("#pj-nombre") && document.querySelector("#pj-nombre").textContent !== "Cargando…");
  await p3.setInputFiles("#f-importar", rs.ruta);
  await p3.waitForSelector("#rb-ok"); await p3.click("#rb-ok");
  await p3.waitForFunction(() => F && F.nombre, null, { timeout: 15000 });
  assert.equal(await p3.evaluate(() => MODELOS_USR.length), 1, "el respaldo trae los modelos");
  await ctx3.close();
  // borrar el modelo guardado
  await page.evaluate(() => abrirObjeto(null, "cc"));
  await page.selectOption("#ob-modc", { label: "Daga de plata bendita" });
  await page.click("#ob-bm"); await page.click("#ob-bm");
  await page.waitForFunction(() => MODELOS_USR.length === 0);
  await page.click("#ob-x");
});

await prueba("paquete de crónica: se previsualiza, trae personajes y armas, y la parte del Director solo entra si se elige Narrador IA", async () => {
  const base = (await bajar("#mi-exp")).json;
  const ficha = JSON.parse(JSON.stringify(base.ficha)); ficha.nombre = "Elena del Paquete"; ficha.concepto = "Archivista";
  const paquete = { formato: "vampirov20-paquete", version: 1, meta: { nombre: "La noche del Faro", autor: "Un Director", tipo: "misterio" },
    jugadores: { premisa: "Un faro abandonado atrae a los Condenados.",
      personajes: [{ ficha, inventario: { items: [{ nombre: "Linterna", tipo: "equipo", lugar: "encima" }], refugios: [] } }],
      modelos_armas: [{ clase: "cc", nombre: "Espada del Alba", dano_fuerza: 2, tipo_dano: "L", material: "Plata", extras: [{ id: "e1", nombre: "Hoja en llamas", condicional: true, activo: true, dados: 2, tipo: "A" }] }] },
    director: { cuaderno: { premisa: "El Príncipe oculta el faro.", ciudad: "Mar del Plata", pnj: [{ nombre: "La Madrina", rol: "Prínceps", quiere: "Callar el faro", esconde: "Lo encendió ella" }], misterios: [], frentes: [], ganchos: [] },
      cronica: { noches: [{ noche: 1, resumen: "Llegó al puerto." }] }, estado: { noche: 2, historia: "Noche 1: llegó al puerto." } } };
  const ruta = join(tmp, "paquete-faro.json"); writeFileSync(ruta, JSON.stringify(paquete));
  // 1) vista previa y modo en mesa: no entra nada del Director
  await page.setInputFiles("#f-importar", ruta);
  await page.waitForSelector("[data-pp]");
  const previa = await page.textContent("#sheet-root");
  assert.match(previa, /La noche del Faro/); assert.match(previa, /Un faro abandonado/); assert.match(previa, /Elena del Paquete/); assert.match(previa, /Espada del Alba/);
  await foto("21-paquete-vista-previa");
  await page.click('[data-pp="0"]');
  await page.waitForFunction(() => F && F.nombre === "Elena del Paquete", null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => MUNDO.modo), "mesa");
  assert.ok(!(await page.evaluate(() => MUNDO.cronica_id)), "en mesa no se importa la crónica");
  assert.equal(await page.evaluate(() => MODELOS_USR.some(m => m.nombre === "Espada del Alba" && idValido(m.id))), true, "las armas del paquete quedan guardadas como modelos");
  assert.equal(await page.evaluate(() => INV.items.some(o => o.nombre === "Linterna" && o.id)), true);
  // 2) con Narrador IA: entra el cuaderno del Director, marcado como importado
  await page.evaluate(() => { document.querySelector("#f-importar").value = ""; });
  await page.setInputFiles("#f-importar", ruta);
  await page.waitForSelector("[data-pq-modo]");
  await page.click('[data-pq-modo="ia"]');
  await page.click('[data-pp="0"]');
  await page.waitForFunction(() => MUNDO.cronica_id && GUIA?.importado, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => MUNDO.modo), "ia");
  assert.equal(await page.evaluate(() => GUIA.pnj[0].nombre), "La Madrina");
  assert.equal(await page.evaluate(() => CRON?.nombre), "La noche del Faro");
  assert.match(await page.evaluate(() => bloqueDirector()), /autor externo/);
  // 3) archivos que no valen
  const mal = (obj, rx) => page.evaluate(([o, rx]) => { const r = leerPaquete(o); return r.error && new RegExp(rx).test(r.error); }, [obj, rx]);
  assert.equal(await mal({ formato: "otra-cosa" }, "no es un paquete"), true);
  assert.equal(await mal({ formato: "vampirov20-paquete", version: 9, jugadores: {} }, "versión más nueva"), true);
  assert.equal(await mal({ formato: "vampirov20-paquete", version: 1, jugadores: { personajes: [{ ficha: {} }] } }, "vacío"), true);
  // 4) el contenido se acota y no deja colar claves peligrosas
  const a = await page.evaluate(() => { const o = acotar(JSON.parse('{"__proto__":{"x":1},"b":"' + "z".repeat(9000) + '","c":[' + Array(400).fill(1).join(",") + ']}')); return [Object.keys(o).join(), o.b.length, o.c.length]; });
  assert.deepEqual(a, ["b,c", 8000, 300]);
  await page.evaluate(id => cambiarPersonaje(id), idPrincipal);
  await page.waitForFunction(() => F && F.nombre === "Test Vampiro", null, { timeout: 15000 });
});

await prueba("creador: clan y Disciplinas quedan arriba en los pasos y su detalle se lee bien", async () => {
  await page.evaluate(() => { abrirCreacion(); W.nombre = "X Y"; W.concepto = "c"; W.clan = "ventrue"; W.dis = {dominacion: 2}; W.step = 3; renderWz(); });
  assert.equal(await page.locator(".wz-ref .ref-chip").count(), 4, "clan + 3 Disciplinas");
  await page.evaluate(() => { document.querySelector("#s-crear").scrollTop = 500; });
  const top = await page.evaluate(() => document.querySelector(".wz-ref").getBoundingClientRect().top - document.querySelector("#s-crear").getBoundingClientRect().top);
  assert.ok(top < 12, "la barra queda fija arriba al scrollear: " + top);
  await page.click('.wz-ref [data-info="dominacion"]');
  await page.waitForSelector(".niveles li");
  const ancho = await page.evaluate(() => document.querySelector(".niveles li > span:last-child, .niveles li summary > span:last-child").getBoundingClientRect().width);
  assert.ok(ancho > 200, "el texto del poder no se aprieta a la izquierda: " + ancho);
  assert.match(await page.textContent(".niveles li"), /Manipulación \+ Intimidación/);
  await page.click(".niveles .pdet summary");
  const ancho2 = await page.evaluate(() => document.querySelector(".niveles .pdet p").getBoundingClientRect().width);
  assert.ok(ancho2 > 200, "la descripción abierta tiene ancho: " + ancho2);
  await page.evaluate(() => cerrarSheet()); await page.waitForTimeout(400);
  await page.click(".wz-ref [data-refclan]");
  assert.match(await page.textContent("#sheet-root"), /Debilidad/);
  await page.evaluate(() => cerrarSheet()); await page.waitForTimeout(400);
  await page.evaluate(() => { W.step = 1; renderWz(); });
  assert.equal(await page.locator(".wz-ref").count(), 0, "en el paso del clan no hace falta");
  await page.evaluate(() => { W = nuevoW(); mostrarPestana("chat"); });
});

await prueba("creador: sin pestañas abajo, y al salir con algo cargado pide confirmar", async () => {
  await page.evaluate(() => abrirCreacion());
  assert.equal(await page.evaluate(() => document.querySelector("#tabs").hidden), true);
  await page.click("#wz-back");     // vacío: sale sin preguntar
  await page.waitForFunction(() => !document.querySelector("#tabs").hidden);
  await page.evaluate(() => abrirCreacion());
  await page.fill("#w-nombre", "Alguien");
  await page.click("#wz-back");
  await page.waitForSelector("#sc-si");
  await page.click("#sc-no"); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.querySelector("#tabs").hidden), true, "sigue creando");
  await page.click("#wz-back"); await page.click("#sc-si");
  await page.waitForFunction(() => !document.querySelector("#tabs").hidden);
});

await prueba("creador: Disciplinas comunes de otros clanes con puntos gratuitos (7 por círculo)", async () => {
  await page.evaluate(() => { abrirCreacion(); W.nombre = "X Y"; W.clan = "ventrue"; W.step = 7; renderWz(); });
  const extra = await page.evaluate(() => disExtra().join());
  assert.match(extra, /auspex/); assert.doesNotMatch(extra, /dominacion|fortaleza|presencia|taumaturgia|necromancia|protean/);
  await page.evaluate(() => { document.querySelectorAll("details.cat").forEach(d => d.open = true); });
  const antes = await page.evaluate(() => gastoGrat());
  await page.click('[data-dp="disciplina:auspex"] button[data-v="2"]');
  assert.equal(await page.evaluate(() => gastoGrat()) - antes, 14, "2 círculos x 7");
  assert.equal(await page.evaluate(() => armarFichaW().disciplinas.auspex), 2);
  assert.equal(await page.locator('.wz-ref [data-info="auspex"]').count(), 1, "aparece en la barra de arriba");
  await page.click('[data-dp="disciplina:auspex"] button[data-v="2"]');
  assert.equal(await page.evaluate(() => gastoGrat()) - antes, 7, "sacar uno devuelve 7");
  await page.evaluate(() => { W = nuevoW(); mostrarPestana("chat"); });
});

await prueba("Taumaturgia: Sendas secundarias con experiencia, límites del manual y poderes en la ficha", async () => {
  await page.evaluate(() => { F.disciplinas = {...F.disciplinas, taumaturgia: 1}; F.sendas = undefined; F.xp = 80; F.habilidades = {...F.habilidades, subterfugio: 1}; F.poderes = poderesDe(F.disciplinas, F.sendas); });
  const b = (k, a) => page.evaluate(([k, a]) => bloqueoSenda(F, "taumaturgia", k, a), [k, a]);
  assert.match(await b("conjuracion", 0), /al menos 2 niveles/);
  await page.evaluate(() => { F.disciplinas.taumaturgia = 3; });
  assert.equal(await b("conjuracion", 0), "");
  assert.equal(await b("conjuracion", 1), "");
  assert.match(await b("conjuracion", 2), /un punto por encima/);
  assert.equal(await page.evaluate(() => costoXP("senda", 0)), 7);
  assert.equal(await page.evaluate(() => costoXP("senda", 2)), 8);
  await page.evaluate(() => { F.disciplinas.taumaturgia = 5; });
  assert.equal(await b("conjuracion", 4), "", "con la Sangre en 5 puede llegar a 5");
  assert.match(await b("corrupcion", 1), /Subterfugio/);
  // por la hoja de experiencia
  await page.evaluate(() => { F.disciplinas.taumaturgia = 3; renderFicha(); abrirGastarXP(); });
  await page.selectOption("#gx-t", "senda"); await page.selectOption("#gx-r", "taumaturgia:conjuracion");
  await page.click("#gx-ok");
  assert.equal(await page.evaluate(() => F.sendas.taumaturgia.conjuracion), 1);
  assert.equal(await page.evaluate(() => F.xp), 73);
  assert.ok(await page.evaluate(() => F.poderes.some(p => p.senda === "conjuracion" && p.nombre === "Invocar la Forma Sencilla")));
  // el Narrador puede usar el poder, y no los de nivel que no tiene
  assert.equal(await page.evaluate(() => usarPoder("taumaturgia", 1, "Invocar la Forma Sencilla", 1, 0, "conjuracion").ok), true);
  assert.match(await page.evaluate(() => { try { usarPoder("taumaturgia", 2, "Permanencia", 1, 0, "conjuracion"); return "ok"; } catch(e){ return e.message; } }), /requiere nivel 2/);
  await page.evaluate(() => cerrarSheet()); await page.waitForTimeout(400);
  await page.evaluate(() => { F.disciplinas.taumaturgia = 0; delete F.disciplinas.taumaturgia; F.sendas = undefined; F.poderes = poderesDe(F.disciplinas, F.sendas); });
});

await prueba("Necromancia: Sendas secundarias (3 de Sepulcro, tercera Senda con Sepulcro 5) y creación con puntos gratuitos", async () => {
  const b = (d, k, a, ss) => page.evaluate(([d, k, a, ss]) => bloqueoSenda({disciplinas:{necromancia:ss.nec, taumaturgia:ss.tau||0}, sendas:ss.sendas||{}, habilidades:{subterfugio:1}}, d, k, a), [d, k, a, ss]);
  assert.match(await b("necromancia", "osario", 0, {nec:2}), /al menos 3 niveles/);
  assert.equal(await b("necromancia", "osario", 0, {nec:3}), "");
  assert.equal(await b("necromancia", "osario", 3, {nec:3, sendas:{necromancia:{osario:3}}}), "", "una secundaria puede subir sin tope relativo");
  assert.match(await b("necromancia", "cenizas", 0, {nec:3, sendas:{necromancia:{osario:1}}}), /tercera Senda/);
  assert.equal(await b("necromancia", "cenizas", 0, {nec:5, sendas:{necromancia:{osario:1}}}), "");
  // creación: Taumaturgia 2 (clan Tremere) + Fuego 1 con puntos gratuitos
  await page.evaluate(() => { abrirCreacion(); W.nombre = "X Y"; W.clan = "tremere"; W.dis = {taumaturgia: 2}; W.step = 7; renderWz(); document.querySelectorAll("details.cat").forEach(d => d.open = true); });
  const antes = await page.evaluate(() => gastoGrat());
  await page.click('[data-dp="senda:taumaturgia/llamas"] button[data-v="2"]');   // 2 > 2-1: no se puede
  assert.equal(await page.evaluate(() => gastoGrat()) - antes, 0, "no deja pasar la Sangre");
  assert.match(await page.textContent("details.cat .err"), /un punto por encima|Sangre/);
  await page.click('[data-dp="senda:taumaturgia/llamas"] button[data-v="1"]');
  assert.equal(await page.evaluate(() => gastoGrat()) - antes, 7);
  const f = await page.evaluate(() => armarFichaW());
  assert.equal(f.sendas.taumaturgia.llamas, 1);
  assert.ok(f.poderes.some(p => p.senda === "llamas" && p.nombre === "Vela"));
  assert.equal(await page.locator('[data-dp="senda:necromancia/osario"]').count(), 0, "sin Necromancia no aparece");
  // el Narrador usa un poder de Necromancia por Senda
  await page.evaluate(() => { F.disciplinas.necromancia = 3; F.sendas = {necromancia:{osario:2}}; F.sangre = 5; F.fv = 5; });
  assert.equal(await page.evaluate(() => usarPoder("necromancia", 2, "Escobas del Aprendiz", 1, 1, "osario").ok), true);
  assert.match(await page.evaluate(() => { try { usarPoder("necromancia", 3, "Hordas Tambaleantes", 1, 1, "osario"); return "ok"; } catch(e){ return e.message; } }), /requiere nivel 3/);
  assert.equal(await page.evaluate(() => usarPoder("necromancia", 2, "Invocar Alma", 1, 0).ok), true, "sin Senda = Sepulcro");
  await page.evaluate(() => { delete F.disciplinas.necromancia; F.sendas = undefined; W = nuevoW(); mostrarPestana("chat"); });
});

await prueba("Rituales en el Inventario: del manual con requisitos, propios de la crónica, creación y Narrador", async () => {
  await page.evaluate(() => { F.disciplinas = {...F.disciplinas, taumaturgia: 2}; F.rituales = []; F.clan = "tremere"; guardarFicha(); });
  await page.click('#tabs [data-t="inv"]');
  assert.equal(await page.locator("#rit-blk #rit-add").count(), 1);
  assert.match(await page.textContent("#rit-blk"), /Todavía no aprendiste/);
  // del manual: uno de nivel 1 sí; uno de nivel 3 pide Taumaturgia 3
  await foto("rit-1-inventario-vacio");
  await page.click("#rit-add");
  await page.waitForSelector("#rq-lista details");
  await foto("rit-2-manual");
  const n1 = await page.locator("#rq-lista details").count();
  assert.ok(n1 > 30, "lista de Taumaturgia: " + n1);
  await page.fill("#rq-q", "defensa del refugio");
  await page.click("#rq-lista summary");
  await page.click('[data-rq-a]');
  assert.deepEqual(await page.evaluate(() => F.rituales.map(r => r.nombre)), ["Defensa del Refugio Sagrado"]);
  await page.fill("#rq-q", "adherencia");
  await page.click("#rq-lista summary");
  assert.match(await page.textContent("#rq-lista .err"), /Taumaturgia 3 \(tenés 2\)/);
  assert.match(await page.textContent("[data-rq-a]"), /Aprender igual/);
  // propio de la crónica, con requisito de Senda y clan, guardado para otros
  await foto("rit-3-aprender-igual");
  await page.click('[data-rqv="nuevo"]');
  await foto("rit-4-formulario");
  await page.fill("#rf-nombre", "Sello del Sótano");
  await page.fill("#rf-efecto", "Sella una puerta hasta el amanecer.");
  await page.fill("#rf-nivel", "2");
  await page.click("#rf-req"); await page.selectOption("#rq-t0", "clan"); await page.selectOption("#rq-i0", "tremere");
  await page.click("#rf-ok");
  await page.waitForFunction(() => F.rituales.length === 2);
  assert.equal(await page.evaluate(() => RIT_USR.length), 1);
  assert.equal(await page.evaluate(() => F.rituales.find(r => r.origen === "propio").req[0].id), "tremere");
  await page.waitForTimeout(400);
  assert.match(await page.textContent("#rit-blk"), /Sello del Sótano/);
  assert.match(await page.textContent("#rit-blk"), /de la crónica/);
  // preparar tirada manda a Juego con Inteligencia + Ocultismo
  await page.click('#rit-blk details:has-text("Sello del Sótano") summary');
  await foto("rit-5-tarjeta");
  await page.click('#rit-blk details[open] [data-rit-t]');
  assert.deepEqual(await page.evaluate(() => [J.a, J.b, J.dif]), ["inteligencia", "ocultismo", "5"]);
  // olvidar pide confirmar
  await page.click('#tabs [data-t="inv"]');
  await page.click('#rit-blk details:has-text("Sello del Sótano") summary');
  await page.click('#rit-blk details[open] [data-rit-x]'); await page.click('#rit-blk details[open] [data-rit-x]');
  assert.equal(await page.evaluate(() => F.rituales.length), 1);
  // la biblioteca viaja en la exportación y se valida
  assert.equal(await page.evaluate(() => ritualValido({nombre:"x", efecto:""})), null);
  assert.equal(await page.evaluate(async () => { const n = await fusionarRituales([{nombre:"Otro", efecto:"algo", nivel:99, disc:"rara", id:"x1"}, {nombre:""}]); return n + ":" + RIT_USR.find(r => r.id === "x1").nivel + RIT_USR.find(r => r.id === "x1").disc; }), "1:10otra");
  // el Narrador aprende uno del manual y uno propio, y se le avisa si no cumple
  assert.equal(await page.evaluate(() => { aprenderRitual(RITUALES.find(r => r.nombre === "Éxtasis de Sangre")); return F.rituales.length; }), 2);
  // creación: ritual inicial
  await page.evaluate(() => { F.rituales = []; abrirCreacion(); W.nombre = "X Y"; W.clan = "tremere"; W.dis = {taumaturgia: 1}; W.step = 8; renderWz(); });
  await page.selectOption("#w-rit-taumaturgia", "tau_atar_la_lengua_acusadora");
  assert.equal(await page.evaluate(() => armarFichaW().rituales[0].nombre), "Atar la Lengua Acusadora");
  await page.selectOption("#w-rit-taumaturgia", "propio");
  assert.match(await page.textContent(".wz .err"), /nombre del ritual inicial/);
  await page.fill("#w-ritn-taumaturgia", "Sello Propio");
  assert.equal(await page.evaluate(() => armarFichaW().rituales[0].nombre), "Sello Propio");
  await page.evaluate(() => { W = nuevoW(); RIT_USR = []; mostrarPestana("chat"); });
});

await prueba("munición: los repuestos van dentro del arma (Repuesto 1, 2…) y no como filas aparte", async () => {
  await page.evaluate(() => {
    INV.items = INV.items.filter(o => !["arma_fuego","cargador"].includes(o.tipo));
    INV.items.push({id:"glock_t", nombre:"Glock 17", tipo:"arma_fuego", dano:4, alcance:20, cadencia:4, mecanismo:"semiautomatica", capacidad_cargador:16, cargador:10, recamara:1, lugar:"encima"},
      {id:"glock_t_r1", nombre:"Cargador de repuesto 1", tipo:"cargador", para:"glock_t", balas:16, lugar:"encima"},
      {id:"glock_t_r2", nombre:"Cargador de repuesto 2", tipo:"cargador", para:"glock_t", balas:7, lugar:"encima"});
    renderInv(); });
  await page.click('#tabs [data-t="inv"]');
  const t = await page.textContent("#s-inv .item:has-text('Glock 17')");
  assert.match(t, /Repuesto 1/); assert.match(t, /16\/16/); assert.match(t, /Repuesto 2/); assert.match(t, /7\/16/);
  assert.equal(await page.locator("#s-inv .item.chico").count(), 0, "los cargadores equipados no son filas aparte");
  await foto("municion-repuestos");
  // se cambia el lugar de un repuesto desde la hoja del arma
  await page.evaluate(() => { (INV.refugios ||= []).push({id:"ref_t", nombre:"Refugio de Prueba"}); abrirObjeto("glock_t"); });
  await page.waitForSelector("#rep-l1");
  await page.selectOption("#rep-l1", "ref_t");
  await page.evaluate(() => document.querySelector("#rep-l0").scrollIntoView()); await foto("municion-editor");
  await page.click("#ob-ok");
  await page.waitForFunction(() => INV.items.find(o => o.para === "glock_t" && o.balas === 7)?.lugar === "ref_t");
  await page.waitForTimeout(500);
  assert.match(await page.textContent("#s-inv .item:has-text('Glock 17')"), /1 repuesto guardado en Refugio de Prueba/);
  await page.evaluate(() => { INV.items = INV.items.filter(o => !["glock_t","glock_t_r1"].includes(o.id) && o.para !== "glock_t"); INV.refugios = INV.refugios.filter(r => r.id !== "ref_t"); renderInv(); });
});

await prueba("editar personaje: Guardar y Cancelar flotan abajo, a la altura del dado y sin taparlo", async () => {
  await page.click('#tabs [data-t="ficha"]');
  await page.evaluate(() => { EDIT = clonar(F); renderFicha(); document.querySelector("#s-ficha").scrollTop = 0; });
  await page.waitForSelector("#ed-guardar");
  const r = await page.evaluate(() => { const b = document.querySelector(".barra-ed").getBoundingClientRect(), f = document.querySelector("#fab-dado").getBoundingClientRect(), v = innerHeight;
    return {bTop:b.top, bBot:b.bottom, bRight:b.right, fTop:f.top, fBot:f.bottom, fLeft:f.left, v}; });
  assert.ok(r.bBot <= r.v, "la barra está a la vista aunque no se haya scrolleado: " + JSON.stringify(r));
  assert.ok(Math.abs((r.bTop + r.bBot) / 2 - (r.fTop + r.fBot) / 2) < 16, "a la altura del dado: " + JSON.stringify(r));
  assert.ok(r.bRight <= r.fLeft, "no tapa el dado: " + JSON.stringify(r));
  await foto("edicion-flotante");
  await page.evaluate(() => { EDIT.atributos.fuerza = (EDIT.atributos.fuerza || 1) + 1; });
  await page.click("#ed-guardar");
  assert.match(await page.textContent("#ed-err"), /motivo/);
  await page.click("#ed-cancelar");
  assert.equal(await page.locator(".barra-ed").count(), 0);
  await page.click('#tabs [data-t="inv"]');
});

await prueba("dado rápido: «Personalizada» arma los dados con Atributo + Habilidad, Disciplina y heridas; Juego ya no tiene la tirada a medida", async () => {
  await page.click('#tabs [data-t="juego"], #tabs [data-t="chat"]');
  assert.equal(await page.locator("#j-medida").count(), 0, "la tirada a medida ya no está en Juego");
  await page.evaluate(() => { F.atributos.fuerza = 3; F.habilidades.pelea = 2; F.disciplinas = {...F.disciplinas, potencia: 1}; F.salud = []; });
  await page.click("#fab-dado");
  await page.waitForSelector("#dr-pers");
  assert.equal(await page.locator("#dp-caja").isHidden(), true);
  await page.click("#dr-pers");
  await page.selectOption("#dp-a", "fuerza"); await page.selectOption("#dp-b", "pelea");
  assert.equal(await page.textContent("#dr-n"), "6", "Fuerza 3 + Pelea 2 + Potencia 1");
  await page.click("#dp-disc");
  assert.equal(await page.textContent("#dr-n"), "5", "sin sumar la Disciplina");
  await page.click("#dp-mas"); await page.click("#dp-mas");
  assert.equal(await page.textContent("#dr-n"), "7");
  await foto("dado-personalizada");
  await page.evaluate(() => { F.salud = ["L","L"]; });
  await page.click("#dp-mas");   // refresca
  assert.ok(await page.locator("#dp-pen").count() === 1, "aparece el botón de heridas");
  const con = await page.textContent("#dr-n");
  await page.click("#dp-pen");
  assert.ok(Number(await page.textContent("#dr-n")) > Number(con), "sin restar heridas hay más dados");
  await page.click("#dr-tirar"); await page.waitForSelector("#dr-res .d10.dr");
  assert.ok(await page.locator("#dr-res .d10").count() >= 1);
  // cerrar tocando afuera conserva todo; «Cerrar» lo deja como al principio
  await page.evaluate(() => cerrarSheet()); await page.waitForTimeout(400);
  await page.click("#fab-dado");
  assert.equal(await page.locator("#dp-caja").isVisible(), true, "la personalizada sigue abierta");
  assert.ok(await page.locator("#dr-res .d10").count() >= 1, "siguen los dados");
  await page.click("#dr-x"); await page.waitForTimeout(400);
  await page.click("#fab-dado");
  assert.equal(await page.locator("#dp-caja").isHidden(), true, "personalizada cerrada");
  assert.equal(await page.locator("#dr-res .d10").count(), 0, "sin resultados anteriores");
  assert.equal(await page.textContent("#dr-n"), "5");
  await page.evaluate(() => cerrarSheet()); await page.waitForTimeout(400);
  await page.evaluate(() => { F.salud = []; });
});

await prueba("apariencia: la vela del menú alterna oscuro y claro", async () => {
  await abrirMenu();
  assert.equal(await page.locator("#btn-tema").getAttribute("aria-checked"), "true", "arranca oscuro, vela encendida");
  const caja = await page.evaluate(() => { const v = document.querySelector("#btn-tema").getBoundingClientRect(), t = document.querySelector(".menu-tit h2").getBoundingClientRect();
    return {vTop:v.top, vR:v.right, vW:v.width, tMid:(t.top + t.bottom) / 2, vMid:(v.top + v.bottom) / 2, ancho:innerWidth}; });
  assert.ok(Math.abs(caja.tMid - caja.vMid) < 8, "a la altura del título Menú");
  assert.ok(caja.vR > caja.ancho - 30 && caja.vW >= 44, "arriba a la derecha y fácil de tocar");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".vela .llama")).opacity), "1");
  await foto("vela-oscuro");
  await page.click("#btn-tema");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.equal(await page.locator("#btn-tema").getAttribute("aria-checked"), "false");
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".vela .llama")).opacity), "0", "vela apagada, sin llama");
  await foto("vela-claro");
  await page.click("#btn-tema");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  await page.evaluate(() => cerrarSheet());
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
