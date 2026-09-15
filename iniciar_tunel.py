# -*- coding: utf-8 -*-
"""
INICIADOR AUTOMÁTICO DE TÚNEL CLOUDFLARE + CORS BRIDGE — TCONTROL
- Levanta el CORS Bridge en el puerto 2786 (redirigiendo a http://192.168.10.129:2785).
- Inicia cloudflared tunnel hacia http://127.0.0.1:2786.
- Detecta automáticamente la URL generada en trycloudflare.com.
- Sincroniza la URL en tiempo real en Cloud Firestore (configuracion/whatsapp).
- Al cerrar (Ctrl+C), restaura la configuración en Firestore a la IP local (http://192.168.10.129:2785).
"""

import sys
import os
import re
import time
import signal
import threading
import subprocess
import urllib.request
import urllib.error
import json
from http.server import HTTPServer, BaseHTTPRequestHandler

TARGET_URL = "http://192.168.10.129:2785"
PORT_BRIDGE = 2786
FIRESTORE_URL = "https://firestore.googleapis.com/v1/projects/tcontrol-asistencia/databases/(default)/documents/configuracion/whatsapp?updateMask.fieldPaths=servidorUrl&key=AIzaSyDHAOvwmq4nt4IdalNdowYcak0clwEvFc4"
CLOUDFLARED_PATH = r"C:\Users\tcontrol\bin\cloudflared.exe"

class CorsBridgeHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors_headers()
        self.end_headers()

    def _proxy(self, method):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        target = f"{TARGET_URL}{self.path}"
        headers = {}
        for k, v in self.headers.items():
            if k.lower() not in ['host', 'connection', 'keep-alive', 'transfer-encoding', 'origin', 'referer']:
                headers[k] = v
        headers['Host'] = '192.168.10.129:2785'

        req = urllib.request.Request(target, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                resp_data = resp.read()
                self.send_response(resp.status)
                self._set_cors_headers()
                for k, v in resp.headers.items():
                    if k.lower() not in ['transfer-encoding', 'connection', 'content-length', 'access-control-allow-origin', 'access-control-allow-credentials']:
                        self.send_header(k, v)
                self.send_header('Content-Length', str(len(resp_data)))
                self.end_headers()
                self.wfile.write(resp_data)
        except urllib.error.HTTPError as e:
            err_data = e.read()
            self.send_response(e.code)
            self._set_cors_headers()
            for k, v in e.headers.items():
                if k.lower() not in ['transfer-encoding', 'connection', 'content-length', 'access-control-allow-origin', 'access-control-allow-credentials']:
                    self.send_header(k, v)
            self.send_header('Content-Length', str(len(err_data)))
            self.end_headers()
            self.wfile.write(err_data)
        except Exception as e:
            err_msg = str(e).encode('utf-8')
            self.send_response(502)
            self._set_cors_headers()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(err_msg)))
            self.end_headers()
            self.wfile.write(err_msg)

    def do_GET(self): self._proxy('GET')
    def do_POST(self): self._proxy('POST')
    def do_PUT(self): self._proxy('PUT')
    def do_DELETE(self): self._proxy('DELETE')
    def do_PATCH(self): self._proxy('PATCH')

    def log_message(self, format, *args):
        pass


def actualizar_firestore_url(servidor_url):
    try:
        payload = json.dumps({'fields': {'servidorUrl': {'stringValue': servidor_url}}}).encode('utf-8')
        req = urllib.request.Request(FIRESTORE_URL, data=payload, headers={'Content-Type': 'application/json'}, method='PATCH')
        with urllib.request.urlopen(req, timeout=8) as res:
            return res.status == 200
    except Exception as e:
        print(f"⚠️ [Firestore] Aviso actualizando URL en la nube: {e}")
        return False


def start_cors_server():
    server = HTTPServer(('127.0.0.1', PORT_BRIDGE), CorsBridgeHandler)
    server.serve_forever()


def main():
    print("================================================================")
    print("  INICIANDO SERVICIO DE TÚNEL WHATSAPP — TCONTROL S.A.")
    print(f"  Destino OpenWA: {TARGET_URL}")
    print(f"  CORS Bridge:    http://127.0.0.1:{PORT_BRIDGE}")
    print("================================================================")

    # 1. Iniciar CORS Bridge en hilo secundario
    try:
        t_bridge = threading.Thread(target=start_cors_server, daemon=True)
        t_bridge.start()
        print(" [1/3] CORS Bridge activo en http://127.0.0.1:2786 ✅")
    except Exception as e:
        print(f" ⚠️ Error levantando CORS Bridge: {e}")

    # 2. Localizar ejecutable de cloudflared
    cloudflared_bin = CLOUDFLARED_PATH
    if not os.path.exists(cloudflared_bin):
        # Intentar en PATH
        import shutil
        cloudflared_bin = shutil.which("cloudflared") or "cloudflared"

    print(f" [2/3] Levantando túnel con {cloudflared_bin}...")

    # 3. Lanzar subprocess
    cmd = [cloudflared_bin, "tunnel", "--url", f"http://127.0.0.1:{PORT_BRIDGE}"]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True
    )

    url_tunel = None
    url_regex = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    def limpiar_salida(signum=None, frame=None):
        print("\n🛑 Deteniendo túnel Cloudflare...")
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try: proc.kill()
            except Exception: pass
        print(f"🔄 Restaurando servidor en Firebase a: {TARGET_URL}...")
        actualizar_firestore_url(TARGET_URL)
        print("✅ Configuración restaurada. Servicio finalizado.")
        sys.exit(0)

    signal.signal(signal.SIGINT, limpiar_salida)
    signal.signal(signal.SIGTERM, limpiar_salida)

    try:
        for line in proc.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()

            if not url_tunel:
                match = url_regex.search(line)
                if match:
                    url_tunel = match.group(0)
                    print("\n" + "=" * 64)
                    print("  🎉 ¡TÚNEL CLOUDFLARE ESTABLECIDO CON ÉXITO! 🎉")
                    print(f"  URL Pública: {url_tunel}")
                    print("=" * 64)
                    print("  Sincronizando automáticamente con Firebase Firestore...")
                    if actualizar_firestore_url(url_tunel):
                        print("  ✅ ¡Firebase actualizado! Todos los supervisores están sincronizados.")
                    else:
                        print("  ⚠️ No se pudo sincronizar Firestore automáticamente.")
                    print("  Presiona Ctrl+C en cualquier momento para detener el túnel.")
                    print("=" * 64 + "\n")
    except KeyboardInterrupt:
        limpiar_salida()
    finally:
        limpiar_salida()


if __name__ == '__main__':
    main()
