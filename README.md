# VampiroV20

Hoja de personaje de **Vampiro: La Mascarada V20** con Narrador IA. Es una sola página (`index.html`) que se instala en el celular como una app. Todo se guarda en tu dispositivo; no hay servidor ni cuentas.

- Sin clave de IA podés jugar igual en **modo mesa** (ficha, inventario, dados y notas).
- Para jugar con un **Narrador IA** necesitás una clave. Con Groq es gratis: <https://console.groq.com/keys>.

## 1. Publicarla en GitHub Pages

1. Creá un repositorio nuevo en GitHub (por ejemplo `VampiroV20`). Tiene que ser público para usar Pages gratis. El código no lleva ninguna clave, y los datos de cada jugador quedan en su dispositivo.
2. Subí esta carpeta (los comandos están más abajo).
3. En el repositorio: **Settings → Pages → Build and deployment**. En *Source* elegí **Deploy from a branch**, rama **main** y carpeta **/ (root)**. Guardá.
4. A los dos minutos la app está en `https://TU-USUARIO.github.io/VampiroV20/`.

Comandos, desde esta carpeta (cambiá `TU-USUARIO`):

```
git init
git add .
git commit -m "VampiroV20: primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/VampiroV20.git
git push -u origin main
```

Para publicar un cambio: `git add .`, `git commit -m "lo que cambió"` y `git push`. Quien tenga la app abierta recibe la versión nueva la próxima vez que la reabra.

## 2. Instalarla en el celular

**Android (Chrome):** abrí el link, tocá el menú ⋮ y elegí **Instalar app** (o *Agregar a la pantalla principal*).

**iPhone (Safari):** abrí el link en **Safari**, tocá el botón de compartir y elegí **Agregar a inicio**. Instalala siempre así: Safari puede borrar los datos de los sitios que no se abren por un tiempo, pero no los de una app instalada.

Una vez instalada funciona sin internet. Solo el Narrador IA necesita conexión.

## 3. El link no tiene que cambiar nunca

Los personajes se guardan **atados a la dirección** de la app. Si cambiás el nombre del repositorio o tu usuario de GitHub, o usás un dominio nuevo, la app abre vacía. Elegí bien el nombre antes de repartir el link. Si alguna vez hay que mudarla, se hace con un respaldo (ver abajo).

## 4. Respaldar y restaurar

Los datos viven solo en tu dispositivo: si borrás los datos del navegador o cambiás de celular, se pierden. Por eso:

- **Menú → Respaldar todo** guarda un archivo con todos los personajes, sus crónicas, el chat y las notas. Hacelo seguido y guardalo en un lugar seguro (el correo, la nube).
- **Menú → Importar personaje** y elegí ese archivo para **restaurar**. Si algún personaje ya existe, se reemplaza.
- **Exportar** un solo personaje (Menú → Exportar) sirve para pasárselo a otro jugador. También se importan los archivos `bbn-personaje` de la versión vieja.
- **Partida → Exportar crónica** guarda solo el universo (la historia, los PNJ, las noches). Otro jugador la importa con **Partida → Crónica → Importar** y sigue la historia con su propio personaje. Ojo: el archivo incluye los secretos del Director.

La clave del Narrador **nunca** va en un respaldo ni en una exportación. Se guarda solo en el dispositivo.

## 5. El Narrador IA

Menú → **Motor del Narrador**. Elegís un servicio, pegás tu clave y tocás **Probar y guardar**.

| Motor | Costo | Dónde sacar la clave |
|---|---|---|
| **Groq** (por defecto) | Gratis, con límites diarios | <https://console.groq.com/keys> |
| Gemini | Gratis, con límites que Google cambia seguido | <https://aistudio.google.com/apikey> |
| OpenRouter (modelos `:free`) | Gratis, pocos pedidos por día | <https://openrouter.ai/keys> |
| Claude (API de Anthropic) | De pago, por uso | <https://console.anthropic.com/settings/keys> |
| Grok (xAI) | De pago | <https://console.x.ai> |
| Otro compatible con OpenAI | Depende | Incluye Ollama en tu compu |

Los límites gratuitos cambian; los números vigentes están en la consola de cada servicio.

### ¿Y con mi cuenta de Claude, sin clave de API?

**Desde este sitio no se puede.** Una suscripción a Claude (Pro, Max) no da acceso a la API, y un sitio de GitHub Pages no tiene forma de usarla. La API de Anthropic se paga aparte, por uso.

Lo que sí se puede es publicar la misma app como **artefacto dentro de Claude**, donde el Narrador usa el plan de quien juega:

```
python tools/build-artifact.py
```

Eso genera `dist/artifact.html`, que se publica como artefacto desde Claude Code. En ese modo los datos se guardan en el espacio privado de cada persona dentro de Claude, y los personajes se pasan de un lado al otro con los archivos de exportación. Cada persona necesita una cuenta de Claude con permiso para usar el artefacto.

## 6. Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app entera (código fuente único) |
| `manifest.webmanifest`, `icon*.png`, `icon.svg`, `apple-touch-icon.png` | Instalación como app |
| `sw.js` | Funcionamiento sin internet y actualizaciones |
| `tools/build-artifact.py` | Genera la versión para el artefacto de Claude |
| `tests/` | Pruebas automáticas con Playwright |

## 7. Pruebas

Hace falta Node y Edge o Chrome instalado (no se baja ningún navegador).

```
cd tests
npm install
node e2e.mjs
python ../tools/build-artifact.py
node claude-stub.mjs
```

`e2e.mjs` abre la app en vista de celular y comprueba: crear un personaje y que siga ahí al recargar, exportar e importar, importar un archivo viejo, respaldar y restaurar, el aviso sin clave, la prueba de conexión con Groq y con Claude (con `fetch` simulado), una narración con herramientas, y el funcionamiento sin internet. Deja capturas en `tests/screenshots/`.
