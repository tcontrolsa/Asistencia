import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error

TARGET_URL = "http://192.168.10.129:2785"
PORT = 2786

class CorsBridgeHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
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

    def do_GET(self):
        self._proxy('GET')

    def do_POST(self):
        self._proxy('POST')

    def do_PUT(self):
        self._proxy('PUT')

    def do_DELETE(self):
        self._proxy('DELETE')

    def do_PATCH(self):
        self._proxy('PATCH')

    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), CorsBridgeHandler)
    print(f"WhatsApp CORS Bridge listening on http://127.0.0.1:{PORT} forwarding to {TARGET_URL}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
