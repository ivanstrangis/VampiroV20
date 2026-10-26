"""Genera dist/artifact.html: la misma app, lista para publicarla como artefacto dentro de Claude.

index.html es la fuente. Este script le saca lo que solo sirve en el sitio web (manifest, íconos, service worker)
y la envuelve en el esqueleto que usa Claude para sus artefactos.

Uso:  python tools/build-artifact.py
"""
import os
import re

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(raiz, "index.html"), encoding="utf-8").read()

web = re.compile(r"<!--web:inicio-->.*?<!--web:fin-->\n?|/\* web:inicio \*/.*?/\* web:fin \*/\n?", re.S)
reset = re.search(r'<style id="reset">(.*?)</style>', src, re.S).group(1)
src = web.sub("", src)

cabeza = re.search(r"<head>\n(.*?)</head>", src, re.S).group(1)
cuerpo = re.search(r"<body>(.*)</body>", src, re.S).group(1)
cabeza = re.sub(r'<meta charset="utf-8">\n|<meta name="viewport"[^>]*>\n', "", cabeza)

esqueleto = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
             "<style>" + reset + "</style></head><body>\n")
pagina = esqueleto + cabeza.replace("</title>\n", '</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n', 1) + cuerpo + "</body></html>"

destino = os.path.join(raiz, "dist")
os.makedirs(destino, exist_ok=True)
ruta = os.path.join(destino, "artifact.html")
open(ruta, "w", encoding="utf-8").write(pagina)
print("listo:", ruta, len(pagina), "bytes")
