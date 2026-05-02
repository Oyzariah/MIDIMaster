from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from monitorcontrol import get_monitors

# Grab monitors once on startup to prevent DDC/CI lag
monitors = get_monitors()

class BrightnessHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        if 'val' in query:
            try:
                brightness = int(query['val'][0])
                
                for monitor in monitors:
                    try:
                        with monitor:
                            monitor.set_luminance(brightness)
                    except Exception:
                        pass # Ignore hardware bus timeouts
                
                # Send success response back to the JS Plugin
                self.send_response(200)
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(b"OK")
                return
            except ValueError:
                pass
                
        self.send_response(400)
        self.end_headers()

    def log_message(self, format, *args):
        # Keep the terminal completely silent
        pass

if __name__ == "__main__":
    server = HTTPServer(('127.0.0.1', 8999), BrightnessHandler)
    server.serve_forever()