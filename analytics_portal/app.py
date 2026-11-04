"""Standalone SAHARA analytics dashboard. Render this as a separate web service."""
import hmac
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

app = FastAPI(title='SAHARA Live Analytics Portal', docs_url=None, redoc_url=None)
basic = HTTPBasic(auto_error=False)
ROOT = Path(__file__).resolve().parent


def require_login(credentials: HTTPBasicCredentials | None = Depends(basic)):
    username = os.environ.get('DASHBOARD_USER', '')
    password = os.environ.get('DASHBOARD_PASSWORD', '')
    if not username or not password:
        raise HTTPException(503, 'Dashboard login is not configured')
    if (credentials is None or
        not hmac.compare_digest(credentials.username.encode(), username.encode()) or
        not hmac.compare_digest(credentials.password.encode(), password.encode())):
        raise HTTPException(401, 'Authentication required', headers={'WWW-Authenticate': 'Basic realm="SAHARA Analytics"'})
    return True


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'analytics-portal'}


@app.get('/')
def page(_: bool = Depends(require_login)):
    return FileResponse(ROOT / 'index.html', media_type='text/html', headers={'Cache-Control': 'no-store'})


@app.get('/api/metrics')
def metrics(_: bool = Depends(require_login)):
    upstream = os.environ.get('SAHARA_BASE_URL', 'https://sahara-rescue-platform-v3.onrender.com').rstrip('/')
    key = os.environ.get('ANALYTICS_SHARED_KEY', '').strip()
    parsed = urlparse(upstream)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or not key:
        raise HTTPException(503, 'Analytics upstream configuration incomplete')
    req = Request(upstream + '/analytics/summary', headers={'X-Analytics-Key': key, 'Accept': 'application/json'})
    try:
        with urlopen(req, timeout=18) as response:
            payload = response.read(512_000)
            return JSONResponse(__import__('json').loads(payload), headers={'Cache-Control': 'no-store'})
    except HTTPError as e:
        # Do not leak upstream error bodies or credentials.
        raise HTTPException(502, f'SAHARA analytics API returned HTTP {e.code}')
    except (URLError, TimeoutError, ValueError):
        raise HTTPException(502, 'SAHARA analytics API is temporarily unavailable')
