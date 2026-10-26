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
