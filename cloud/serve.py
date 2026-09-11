"""Supervise the local collector and a token-protected HTTP/WebSocket gateway.

The collector and VNC/CDP ports stay loopback-only. Only the private Sites
Worker knows the gateway token. No account credentials are embedded here.
"""
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def nginx_config(token, site_origin, port):
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
        raise ValueError('AWARD_GATEWAY_TOKEN must be a random URL-safe secret of at least 32 characters')
    parsed = urlparse(site_origin)
    if parsed.scheme != 'https' or not re.fullmatch(r'[a-zA-Z0-9.-]+', parsed.netloc) or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('AWARD_SITE_ORIGIN must be the HTTPS Sites origin')
    if not 1024 <= port <= 65535:
        raise ValueError('PORT must be between 1024 and 65535')
    return '''pid /tmp/awards-nginx.pid;
events { worker_connections 256; }
http {
  access_log off;
  error_log /dev/stderr warn;
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  map $http_x_award_gateway_token $gateway_allowed { default 0; "TOKEN" 1; }
  map $http_origin $origin_allowed { default 0; "" 1; "ORIGIN" 1; }
  server {
    listen PORT;
    server_tokens off;
    client_max_body_size 8k;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header X-Frame-Options DENY always;
    location = /healthz {
      proxy_pass http://127.0.0.1:8765/api/health;
      proxy_set_header Host 127.0.0.1:8765;
      proxy_set_header Sec-Fetch-Site same-origin;
    }
    location /browser/ {
      if ($gateway_allowed = 0) { return 403; }
      if ($origin_allowed = 0) { return 403; }
      proxy_pass http://127.0.0.1:6080/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_set_header Host 127.0.0.1:6080;
      proxy_set_header Authorization "";
      proxy_set_header Cookie "";
      proxy_set_header X-Award-Gateway-Token "";
      proxy_buffering off;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
    }
    location / {
      if ($gateway_allowed = 0) { return 403; }
      if ($origin_allowed = 0) { return 403; }
      proxy_pass http://127.0.0.1:8765;
      proxy_set_header Host 127.0.0.1:8765;
      proxy_set_header Origin http://127.0.0.1:8765;
      proxy_set_header Sec-Fetch-Site same-origin;
      proxy_set_header Authorization "";
      proxy_set_header Cookie "";
      proxy_set_header X-Award-Gateway-Token "";
      proxy_buffering off;
      proxy_read_timeout 200s;
    }
  }
}
'''.replace('TOKEN', token).replace('ORIGIN', site_origin.rstrip('/')).replace('PORT', str(port))


def wait_port(port, child, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError('A required service failed to start')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.25):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError('A required service did not become ready')


def main():
    os.chdir(ROOT)
    os.umask(0o077)
    token = os.environ.get('AWARD_GATEWAY_TOKEN', '')
    origin = os.environ.get('AWARD_SITE_ORIGIN', '')
    config = nginx_config(token, origin, int(os.environ.get('PORT', '8080')))
    config_path = Path('/tmp/awards-nginx.conf')
    config_path.write_text(config)
    # A Railway volume mounted at /data keeps the source's existing storage paths.
    data = Path(os.environ.get('AWARD_DATA_DIR', '/data'))
    data.mkdir(parents=True, exist_ok=True)
    for name in ('data', 'artifacts'):
        target = data if name == 'data' else data / 'artifacts'
        target.mkdir(parents=True, exist_ok=True)
        local = ROOT / name
        if not local.exists() and not local.is_symlink():
            local.symlink_to(target, target_is_directory=True)
        if not local.is_symlink():
            raise RuntimeError('Refusing to hide an existing application data directory')
    # These locks only describe the previous container, never a running replica.
    for profile in ('partner-chrome-profile', 'sas-chrome-profile'):
        for lock in ('SingletonLock', 'SingletonSocket', 'SingletonCookie'):
            (data / profile / lock).unlink(missing_ok=True)
    children = []
    stop = False

    def request_stop(*_args):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    def start(args, quiet=False):
        child = subprocess.Popen(args, stdout=subprocess.DEVNULL if quiet else None,
                                 stderr=subprocess.DEVNULL if quiet else None)
        children.append(child)
        return child

    try:
        x = start(['Xvfb', ':99', '-screen', '0', '1366x900x24', '-nolisten', 'tcp'])
        for _ in range(100):
            if Path('/tmp/.X11-unix/X99').exists():
                break
            if x.poll() is not None:
                raise RuntimeError('Display failed to start')
            time.sleep(0.1)
        start(['fluxbox'], quiet=True)
        vnc = start(['x11vnc', '-display', ':99', '-localhost', '-rfbport', '5900', '-forever', '-shared', '-nopw', '-quiet'], quiet=True)
        wait_port(5900, vnc)
        ws = start(['websockify', '--web=/usr/share/novnc', '127.0.0.1:6080', '127.0.0.1:5900'], quiet=True)
        wait_port(6080, ws)
        app = start(['python3', 'local_app.py', '--port', '8765'])
        wait_port(8765, app)
        subprocess.run(['nginx', '-t', '-c', str(config_path)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        start(['nginx', '-c', str(config_path), '-g', 'daemon off;'])
        print('Private award service ready', flush=True)
        while not stop:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('A required service exited; restarting the container')
            time.sleep(0.5)
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in reversed(children):
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
        config_path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
