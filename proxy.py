import json
import re
import string
import random
import base64
import hashlib
import shutil
import io
import zipfile
import threading
import atexit
import queue
from bs4 import BeautifulSoup
import requests
from requests.adapters import HTTPAdapter
import time
import os
import mimetypes
import pdfkit
import aiohttp
import asyncio
import tempfile
import markdown
from urllib import parse
from urllib import parse as _parse
from Crypto.Cipher import AES
from playwright.sync_api import sync_playwright
from flask import Flask, request, Response, redirect, send_from_directory, make_response, jsonify

TARGET_URL = os.environ.get('TARGET_URL', 'https://bdfz.xnykcxt.com:5002')
TARGET_URL_PARTS = parse.urlsplit(TARGET_URL)
TARGET_ORIGIN = f'{TARGET_URL_PARTS.scheme}://{TARGET_URL_PARTS.netloc}'
REQUEST_TIMEOUT = int(os.environ.get('REQUEST_TIMEOUT', '120'))
STREAM_TIMEOUT = (10, REQUEST_TIMEOUT)
UPSTREAM_POOL_CONNECTIONS = int(os.environ.get('UPSTREAM_POOL_CONNECTIONS', '64'))
UPSTREAM_POOL_MAXSIZE = int(os.environ.get('UPSTREAM_POOL_MAXSIZE', '64'))
STREAM_CHUNK_SIZE = 64 * 1024

app = Flask(__name__)
ATTACHMENT_KEY = os.environ.get('ATTACHMENT_AES_KEY', '348ebfa6d1f9708310cb8a7f88367bc5').encode('utf-8')
ATTACHMENT_PATH_RE = re.compile(r'^[A-Za-z0-9+/=]+$')
ENHANCE_ASSET_VERSION = '20260312-speedup2'

DEFAULT_CJK_SANS_FONT_STACK = (
    '"Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", '
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", '
    '"WenQuanYi Micro Hei", "SimHei", sans-serif'
)

PDF_HTML_STYLE = """<style>
img { max-width: 100%; height: auto; }
body { margin: 0; color: #16313a; }
body, table, td, th { __DEFAULT_CJK_FONT_DECL__ }
p, li { line-height: 1.75; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #d9e2e8; padding: 6px 8px; }
</style>""".replace('__DEFAULT_CJK_FONT_DECL__', f'font-family: {DEFAULT_CJK_SANS_FONT_STACK};')
PDFKIT_CONFIG = None
PDFKIT_READY = False

THREAD_LOCAL = threading.local()
HOP_BY_HOP_HEADERS = {
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
}


def resolve_wkhtmltopdf_path():
    explicit = os.environ.get('WKHTMLTOPDF_PATH', '').strip()
    candidates = []
    if explicit and os.path.basename(explicit).lower().startswith('wkhtmltopdf'):
        candidates.append(explicit)
    candidates.extend([
        '/usr/bin/wkhtmltopdf',
        r'C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe',
        r'C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe',
    ])
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return explicit or '/usr/bin/wkhtmltopdf'


WKHTMLTOPDF_BIN = resolve_wkhtmltopdf_path()


def resolve_playwright_chromium_path():
    explicit = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '').strip()
    candidates = []
    if explicit:
        candidates.append(explicit)
    candidates.extend([
        shutil.which('chromium'),
        shutil.which('chromium-browser'),
        shutil.which('google-chrome'),
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files\Chromium\Application\chrome.exe',
    ])
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return explicit or '/usr/bin/chromium'


PLAYWRIGHT_CHROMIUM_BIN = resolve_playwright_chromium_path()
PLAYWRIGHT_RENDER_LOCK = threading.Lock()
PLAYWRIGHT_WORKER_LOCK = threading.Lock()
MARKDOWN_CACHE_LOCK = threading.Lock()
MARKDOWN_MAX_LENGTH = int(os.environ.get('MARKDOWN_MAX_LENGTH', '20000'))
MARKDOWN_CACHE_DIR = os.path.join(tempfile.gettempdir(), 'xny_markdown_answer_cache')
MARKDOWN_CACHE_KEY_RE = re.compile(r'^[a-f0-9]{64}$')
PLAYWRIGHT_RENDER_QUEUE = None
PLAYWRIGHT_RENDER_THREAD = None
PLAYWRIGHT_RENDER_STOP = object()
PLAYWRIGHT_RENDER_TIMEOUT = int(os.environ.get('PLAYWRIGHT_RENDER_TIMEOUT', str(max(REQUEST_TIMEOUT, 60))))
MARKDOWN_CAPTURE_STYLE = """<style>
html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
}
body {
  color: #0f172a;
  __DEFAULT_CJK_FONT_DECL__
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  background: #ffffff;
}
#capture {
  display: inline-block;
  max-width: 860px;
  padding: 22px 24px;
  box-sizing: border-box;
  background: #ffffff;
}
#capture,
#capture * {
  box-sizing: border-box;
}
#capture :first-child {
  margin-top: 0 !important;
}
#capture :last-child {
  margin-bottom: 0 !important;
}
#capture h1,
#capture h2,
#capture h3,
#capture h4,
#capture h5,
#capture h6 {
  margin: 0.25em 0 0.55em;
  color: #0b1220;
  font-weight: 700;
  line-height: 1.28;
}
#capture h1 { font-size: 2rem; }
#capture h2 { font-size: 1.7rem; }
#capture h3 { font-size: 1.42rem; }
#capture p,
#capture li,
#capture td,
#capture th,
#capture blockquote {
  font-size: 1.06rem;
  line-height: 1.82;
}
#capture p,
#capture ul,
#capture ol,
#capture blockquote,
#capture pre,
#capture table {
  margin: 0 0 0.9em;
}
#capture ul,
#capture ol {
  padding-left: 1.4em;
}
#capture a {
  color: #0d9488;
  text-decoration: none;
}
#capture strong {
  color: #08111f;
}
#capture img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.45em 0;
  border-radius: 14px;
}
#capture code {
  padding: 0.12em 0.38em;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.16);
  color: #0f172a;
  font-family: "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 0.94em;
}
#capture pre {
  overflow: auto;
  padding: 0.95em 1.05em;
  border-radius: 18px;
  background: rgba(241, 245, 249, 0.96);
}
#capture pre code {
  padding: 0;
  background: transparent;
}
#capture blockquote {
  padding: 0.15em 0 0.15em 1em;
  border-left: 4px solid rgba(13, 148, 136, 0.42);
  color: #334155;
}
#capture hr {
  margin: 1.1em 0;
  border: 0;
  border-top: 1px solid rgba(148, 163, 184, 0.34);
}
#capture table {
  width: 100%;
  border-collapse: collapse;
  overflow: hidden;
  border-radius: 14px;
}
#capture th,
#capture td {
  padding: 0.56em 0.72em;
  border: 1px solid rgba(148, 163, 184, 0.26);
  text-align: left;
  vertical-align: top;
}
#capture thead th {
  background: rgba(13, 148, 136, 0.1);
}
#capture .katex-display {
  margin: 0.9em 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.1em 0.02em;
}
</style>""".replace('__DEFAULT_CJK_FONT_DECL__', f'font-family: {DEFAULT_CJK_SANS_FONT_STACK};')


class MarkdownRenderJob:
    def __init__(self, document):
        self.document = document
        self.event = threading.Event()
        self.result = None
        self.error = None


def close_markdown_browser():
    global PLAYWRIGHT_RENDER_QUEUE, PLAYWRIGHT_RENDER_THREAD

    with PLAYWRIGHT_WORKER_LOCK:
        task_queue = PLAYWRIGHT_RENDER_QUEUE
        worker = PLAYWRIGHT_RENDER_THREAD
        PLAYWRIGHT_RENDER_QUEUE = None
        PLAYWRIGHT_RENDER_THREAD = None

    if task_queue is not None:
        try:
            task_queue.put_nowait(PLAYWRIGHT_RENDER_STOP)
        except Exception:
            pass

    if worker is not None and worker.is_alive():
        try:
            worker.join(timeout=2)
        except Exception:
            pass


def markdown_render_worker(task_queue):
    playwright = None
    browser = None

    def close_runtime():
        nonlocal playwright, browser
        if browser is not None:
            try:
                browser.close()
            except Exception:
                pass
            browser = None
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:
                pass
            playwright = None

    def ensure_browser():
        nonlocal playwright, browser
        if browser is not None:
            try:
                if browser.is_connected():
                    return browser
            except Exception:
                pass
            close_runtime()

        if not os.path.exists(PLAYWRIGHT_CHROMIUM_BIN):
            raise RuntimeError(f'Chromium not found at {PLAYWRIGHT_CHROMIUM_BIN}')

        launch_args = ['--disable-dev-shm-usage']
        if os.name != 'nt':
            launch_args.append('--no-sandbox')

        playwright = sync_playwright().start()
        browser = playwright.chromium.launch(
            executable_path=PLAYWRIGHT_CHROMIUM_BIN,
            headless=True,
            args=launch_args,
        )
        return browser

    try:
        while True:
            job = task_queue.get()
            if job is PLAYWRIGHT_RENDER_STOP:
                break

            try:
                current_browser = ensure_browser()
                context = current_browser.new_context(
                    viewport={'width': 1280, 'height': 2400},
                    device_scale_factor=2,
                )
                try:
                    page = context.new_page()
                    page.set_content(job.document, wait_until='domcontentloaded')
                    page.evaluate('document.fonts.ready')
                    locator = page.locator('#capture')
                    locator.wait_for()
                    page.wait_for_timeout(120)
                    job.result = locator.screenshot(type='png')
                finally:
                    context.close()
            except Exception as exc:
                close_runtime()
                job.error = exc
            finally:
                job.event.set()
    finally:
        close_runtime()


def ensure_markdown_render_queue():
    global PLAYWRIGHT_RENDER_QUEUE, PLAYWRIGHT_RENDER_THREAD

    with PLAYWRIGHT_WORKER_LOCK:
        if (
            PLAYWRIGHT_RENDER_QUEUE is not None and
            PLAYWRIGHT_RENDER_THREAD is not None and
            PLAYWRIGHT_RENDER_THREAD.is_alive()
        ):
            return PLAYWRIGHT_RENDER_QUEUE

        PLAYWRIGHT_RENDER_QUEUE = queue.Queue()
        PLAYWRIGHT_RENDER_THREAD = threading.Thread(
            target=markdown_render_worker,
            args=(PLAYWRIGHT_RENDER_QUEUE,),
            name='markdown-render-worker',
            daemon=True,
        )
        PLAYWRIGHT_RENDER_THREAD.start()
        return PLAYWRIGHT_RENDER_QUEUE


atexit.register(close_markdown_browser)


def get_http_session():
    session = getattr(THREAD_LOCAL, 'http_session', None)
    if session is not None:
        return session

    session = requests.Session()
    session.trust_env = False
    adapter = HTTPAdapter(
        pool_connections=UPSTREAM_POOL_CONNECTIONS,
        pool_maxsize=UPSTREAM_POOL_MAXSIZE,
        max_retries=0,
        pool_block=False,
    )
    session.mount('http://', adapter)
    session.mount('https://', adapter)
    THREAD_LOCAL.http_session = session
    return session


def upstream_request(
    method,
    url,
    *,
    headers=None,
    data=None,
    files=None,
    cookies=None,
    allow_redirects=False,
    stream=False,
    timeout=None,
):
    session = get_http_session()
    # IMPORTANT: this proxy serves multiple users, while worker threads are reused.
    # requests.Session keeps an internal cookie jar by default; if we leave it as-is,
    # cookies from a previous user can be reused on later requests handled by the
    # same thread, causing account/session crossover.
    session.cookies.clear()
    return session.request(
        method=method,
        url=url,
        headers=headers,
        data=data,
        files=files,
        cookies=cookies,
        verify=False,
        allow_redirects=allow_redirects,
        stream=stream,
        timeout=timeout or REQUEST_TIMEOUT,
    )


def get_request_headers(exclude=None):
    exclude = {h.lower() for h in (exclude or set())}
    headers = {key: value for key, value in request.headers if key.lower() not in exclude}

    if 'origin' not in exclude:
        headers['Origin'] = TARGET_ORIGIN

    if 'referer' not in exclude:
        referer = request.headers.get('Referer', '').strip()
        if referer:
            parsed = parse.urlsplit(referer)
            if parsed.scheme and parsed.netloc:
                referer = parse.urlunsplit((
                    TARGET_URL_PARTS.scheme,
                    TARGET_URL_PARTS.netloc,
                    parsed.path or '/',
                    parsed.query,
                    parsed.fragment,
                ))
            else:
                referer = f'{TARGET_ORIGIN}/stu/'
        else:
            referer = f'{TARGET_ORIGIN}/stu/'
        headers['Referer'] = referer

    if 'accept' not in exclude and request.path.startswith('/exam/') and '/api/' in request.path:
        headers.setdefault('Accept', 'application/json, text/plain, */*')

    return headers


def filter_upstream_headers(headers, excluded=None):
    excluded_headers = {h.lower() for h in (excluded or [])}
    filtered = []
    for name, value in headers.items():
        lower_name = name.lower()
        if lower_name in excluded_headers or lower_name == 'set-cookie':
            continue
        if lower_name == 'content-disposition':
            value = normalize_content_disposition(value)
        filtered.append((name, value))
    return filtered


def set_requests_cookies(response, upstream_response):
    for key, value in upstream_response.cookies.get_dict().items():
        response.set_cookie(key, value)
    return response


def set_aiohttp_cookies(response, upstream_response):
    for morsel in upstream_response.cookies.values():
        response.set_cookie(morsel.key, morsel.value)
    return response


def build_streaming_response(upstream_response, *, extra_headers=None, cache_disabled=False):
    headers = filter_upstream_headers(upstream_response.headers, excluded=HOP_BY_HOP_HEADERS)

    if extra_headers:
        overwrite_keys = {k.lower() for k, _ in extra_headers}
        headers = [(k, v) for k, v in headers if k.lower() not in overwrite_keys]
        headers.extend(extra_headers)

    if request.method == 'HEAD':
        upstream_response.close()
        response = Response(status=upstream_response.status_code, headers=headers)
    else:
        def generate():
            try:
                for chunk in upstream_response.raw.stream(STREAM_CHUNK_SIZE, decode_content=False):
                    if chunk:
                        yield chunk
            finally:
                upstream_response.close()

        response = Response(generate(), status=upstream_response.status_code, headers=headers)
        response.direct_passthrough = True

    if cache_disabled:
        response.headers['Cache-Control'] = 'no-store, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    return set_requests_cookies(response, upstream_response)


async def get(session, url, headers=None):
    async with session.get(url, headers=headers) as response:
        return await response.json(content_type=None)


def getName():
    timestamp = int(time.time() * 1000)
    random_letters = ''.join(random.choices(string.ascii_letters, k=10))
    return f"{timestamp}{random_letters}"


def build_export_html(html_content):
    html_content = (html_content or '').strip()
    soup = BeautifulSoup('<meta charset="UTF-8">\n' + PDF_HTML_STYLE + html_content, 'html.parser')

    for img in soup.find_all('img'):
        src = img.get('src')
        if not src or src.startswith(('http://', 'https://', 'data:')):
            continue
        img['src'] = TARGET_URL + src if src.startswith('/') else f"{TARGET_URL}/{src.lstrip('/')}"

    return '<!doctype html><html><head><meta charset="UTF-8"></head><body>%s</body></html>' % str(soup)


def get_pdfkit_config():
    global PDFKIT_CONFIG
    global PDFKIT_READY

    if PDFKIT_READY:
        return PDFKIT_CONFIG

    PDFKIT_READY = True
    try:
        PDFKIT_CONFIG = pdfkit.configuration(wkhtmltopdf=WKHTMLTOPDF_BIN)
    except Exception as exc:
        app.logger.warning('wkhtmltopdf unavailable at %s: %s', WKHTMLTOPDF_BIN, exc)
        PDFKIT_CONFIG = None
    return PDFKIT_CONFIG


def render_pdf_bytes(rendered_html):
    pdf_config = get_pdfkit_config()
    if pdf_config is None:
        raise RuntimeError('wkhtmltopdf is unavailable')

    tmp_html = tempfile.NamedTemporaryFile(delete=False, suffix='.html')
    try:
        tmp_html.write(rendered_html.encode('utf-8'))
        tmp_html.flush()
        tmp_html.close()

        options = {
            'page-size': 'A4',
            'margin-top': '0.75in',
            'margin-right': '0.75in',
            'margin-bottom': '0.75in',
            'margin-left': '0.75in',
            'encoding': 'UTF-8',
            'custom-header': [('Accept-Encoding', 'gzip')],
            'enable-local-file-access': None,
        }
        pdf_bytes = pdfkit.from_file(tmp_html.name, False, options=options, configuration=pdf_config)
        if not pdf_bytes:
            raise RuntimeError('wkhtmltopdf returned empty output')
        if not isinstance(pdf_bytes, (bytes, bytearray)) or not bytes(pdf_bytes).startswith(b'%PDF'):
            raise RuntimeError('wkhtmltopdf did not return a valid PDF')
        return bytes(pdf_bytes)
    finally:
        try:
            os.unlink(tmp_html.name)
        except Exception:
            pass


def build_attachment_headers(name, extension, content_type):
    base_name = sanitize_download_name(name or 'export', 'export')
    filename = f'{base_name}.{extension}'
    return [
        ('Content-Disposition', build_content_disposition(filename)),
        ('Content-Type', content_type),
    ]


def build_export_response(name, html_content):
    rendered_html = build_export_html(html_content)
    try:
        pdf_data = render_pdf_bytes(rendered_html)
        headers = build_attachment_headers(name, 'pdf', 'application/pdf')
        return Response(pdf_data, 200, headers=headers)
    except Exception as exc:
        app.logger.warning('PDF export failed for %s, falling back to HTML: %s', name or 'export', exc)
        headers = build_attachment_headers(name, 'html', 'text/html; charset=utf-8')
        headers.append(('X-Export-Fallback', 'html'))
        return Response(rendered_html, 200, headers=headers)


def is_escaped(value, index):
    slashes = 0
    cursor = index - 1
    while cursor >= 0 and value[cursor] == '\\':
        slashes += 1
        cursor -= 1
    return slashes % 2 == 1


def looks_like_math(value):
    stripped = (value or '').strip()
    if not stripped:
        return False
    if re.fullmatch(r'[\d\s,.$%]+', stripped):
        return False
    return bool(re.search(r'[A-Za-z\\^_=+\-*/{}[\]()]', stripped))


def wrap_inline_katex(value):
    stripped = (value or '').strip()
    if not looks_like_math(stripped):
        return None
    return f"$`{stripped}`$"


def find_inline_math_end(value, start_index):
    cursor = start_index
    while cursor < len(value):
        if value[cursor] == '$' and not is_escaped(value, cursor):
            prev_char = value[cursor - 1] if cursor > 0 else ''
            next_char = value[cursor + 1] if cursor + 1 < len(value) else ''
            if prev_char != '$' and next_char != '$':
                return cursor
        cursor += 1
    return -1


def normalize_inline_math(line):
    result = []
    index = 0
    in_code = False
    code_ticks = 0

    while index < len(line):
        if line[index] == '`':
            tick_start = index
            while index < len(line) and line[index] == '`':
                index += 1
            tick_count = index - tick_start
            if not in_code:
                in_code = True
                code_ticks = tick_count
            elif tick_count == code_ticks:
                in_code = False
                code_ticks = 0
            result.append('`' * tick_count)
            continue

        if in_code:
            result.append(line[index])
            index += 1
            continue

        if line.startswith(r'\(', index):
            end_index = line.find(r'\)', index + 2)
            if end_index != -1:
                wrapped = wrap_inline_katex(line[index + 2:end_index])
                if wrapped:
                    result.append(wrapped)
                    index = end_index + 2
                    continue

        if line[index] == '$' and not is_escaped(line, index):
            next_char = line[index + 1] if index + 1 < len(line) else ''
            if next_char not in {'$', '`'}:
                end_index = find_inline_math_end(line, index + 1)
                if end_index != -1:
                    wrapped = wrap_inline_katex(line[index + 1:end_index])
                    if wrapped:
                        result.append(wrapped)
                        index = end_index + 1
                        continue

        result.append(line[index])
        index += 1

    return ''.join(result)


def normalize_markdown_math(markdown_text):
    lines = (markdown_text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')
    normalized = []
    in_code_fence = False
    fence_marker = ''
    in_math_block = False
    math_delimiter = ''
    math_lines = []

    for line in lines:
        stripped = line.strip()
        fence_match = re.match(r'^(```+|~~~+)', stripped)
        if not in_math_block and fence_match:
            marker = fence_match.group(1)
            if not in_code_fence:
                in_code_fence = True
                fence_marker = marker
            elif stripped.startswith(fence_marker[0]):
                in_code_fence = False
                fence_marker = ''
            normalized.append(line)
            continue

        if not in_code_fence and in_math_block:
            if (math_delimiter == '$$' and stripped == '$$') or (math_delimiter == r'\[' and stripped == r'\]'):
                normalized.append('```math')
                normalized.extend(math_lines)
                normalized.append('```')
                in_math_block = False
                math_delimiter = ''
                math_lines = []
            else:
                math_lines.append(line)
            continue

        if not in_code_fence:
            if stripped == '$$':
                in_math_block = True
                math_delimiter = '$$'
                math_lines = []
                continue

            if stripped == r'\[':
                in_math_block = True
                math_delimiter = r'\['
                math_lines = []
                continue

            single_dollar = re.match(r'^\s*\$\$(.+?)\$\$\s*$', line)
            if single_dollar:
                normalized.append('```math')
                normalized.append(single_dollar.group(1).strip())
                normalized.append('```')
                continue

            single_bracket = re.match(r'^\s*\\\[(.+?)\\\]\s*$', line)
            if single_bracket:
                normalized.append('```math')
                normalized.append(single_bracket.group(1).strip())
                normalized.append('```')
                continue

            line = normalize_inline_math(line)

        normalized.append(line)

    if in_math_block:
        normalized.append(math_delimiter)
        normalized.extend(math_lines)

    return '\n'.join(normalized)


def sanitize_markdown_html(value):
    soup = BeautifulSoup(value or '', 'html.parser')
    for tag in soup.find_all(['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select']):
        tag.decompose()

    for tag in soup.find_all(True):
        for attr_name in list(tag.attrs):
            lowered = attr_name.lower()
            if lowered.startswith('on'):
                del tag.attrs[attr_name]
                continue

            if lowered not in {'href', 'src'}:
                continue

            raw_value = tag.attrs.get(attr_name)
            values = raw_value if isinstance(raw_value, list) else [raw_value]
            cleaned = []
            for item in values:
                item_text = str(item).strip()
                if item_text.lower().startswith('javascript:'):
                    continue
                cleaned.append(item)

            if not cleaned:
                del tag.attrs[attr_name]
            elif isinstance(raw_value, list):
                tag.attrs[attr_name] = cleaned
            else:
                tag.attrs[attr_name] = cleaned[0]

    return str(soup)


def build_markdown_capture_html(html_body):
    return """<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    %s
  </head>
  <body>
    <div id="capture">%s</div>
  </body>
</html>""" % (MARKDOWN_CAPTURE_STYLE, html_body or '<p></p>')


def build_markdown_cache_key(normalized_markdown):
    return hashlib.sha256((normalized_markdown or '').encode('utf-8')).hexdigest()


def ensure_markdown_cache_dir():
    os.makedirs(MARKDOWN_CACHE_DIR, exist_ok=True)
    return MARKDOWN_CACHE_DIR


def get_markdown_cache_path(cache_key):
    ensure_markdown_cache_dir()
    return os.path.join(MARKDOWN_CACHE_DIR, f'{cache_key}.png')


def get_cached_markdown_png(cache_key):
    if not cache_key or not MARKDOWN_CACHE_KEY_RE.fullmatch(cache_key):
        return None
    cache_path = get_markdown_cache_path(cache_key)
    if not os.path.exists(cache_path):
        return None
    with open(cache_path, 'rb') as cached_file:
        return cached_file.read()


def store_cached_markdown_png(cache_key, image_bytes):
    if not cache_key or not MARKDOWN_CACHE_KEY_RE.fullmatch(cache_key):
        raise ValueError('Invalid markdown cache key')
    cache_path = get_markdown_cache_path(cache_key)
    tmp_path = f'{cache_path}.tmp'
    with open(tmp_path, 'wb') as cache_file:
        cache_file.write(image_bytes)
    os.replace(tmp_path, cache_path)
    return cache_path


def get_or_render_markdown_png(markdown_text, normalized_markdown=None):
    normalized = normalized_markdown if normalized_markdown is not None else normalize_markdown_math(markdown_text or '')
    cache_key = build_markdown_cache_key(normalized)

    with MARKDOWN_CACHE_LOCK:
        cached_bytes = get_cached_markdown_png(cache_key)
        if cached_bytes is not None:
            return cache_key, cached_bytes, True

        image_bytes = render_markdown_png(markdown_text, normalized_markdown=normalized)
        store_cached_markdown_png(cache_key, image_bytes)
        return cache_key, image_bytes, False


def render_markdown_html(markdown_text, normalized_markdown=None):
    normalized = normalized_markdown if normalized_markdown is not None else normalize_markdown_math(markdown_text or '')
    rendered = markdown.markdown(
        normalized,
        extensions=['extra', 'sane_lists', 'nl2br', 'markdown_katex'],
        extension_configs={
            'markdown_katex': {
                'insert_fonts_css': True,
                'no_inline_svg': False,
            }
        },
    )
    rendered = rewrite_html_assets(rendered)
    return sanitize_markdown_html(rendered)


def render_markdown_png(markdown_text, normalized_markdown=None):
    html_body = render_markdown_html(markdown_text, normalized_markdown=normalized_markdown)
    document = build_markdown_capture_html(html_body)

    with PLAYWRIGHT_RENDER_LOCK:
        job = MarkdownRenderJob(document)
        ensure_markdown_render_queue().put(job)
        if not job.event.wait(PLAYWRIGHT_RENDER_TIMEOUT):
            close_markdown_browser()
            raise RuntimeError('Markdown render timed out')
        if job.error is not None:
            raise job.error
        return job.result


def build_student_question_url(entity_type, entity_id, suffix):
    return f'{TARGET_URL}/exam/api/student/{entity_type}/entity/{entity_id}/{suffix.lstrip("/")}'


def get_student_question_entry(entity_type, entity_id, question_id):
    resp = upstream_request(
        method='GET',
        url=build_student_question_url(entity_type, entity_id, 'question'),
        headers=get_request_headers({'host'}),
        cookies=request.cookies,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        payload = resp.json()
    finally:
        resp.close()

    if payload.get('code') not in {0, 33333}:
        raise RuntimeError(payload.get('message') or 'Failed to load question answers')

    entries = payload.get('extra') or []
    for entry in entries:
        if str(entry.get('questionId')) == str(question_id):
            return entry
    return None


def find_existing_markdown_attachment(attachments, filename):
    for item in attachments or []:
        if not isinstance(item, dict):
            continue
        try:
            question_attachment_type = int(item.get('questionAttachmentType'))
        except (TypeError, ValueError):
            question_attachment_type = None
        try:
            extra_tag = int(item.get('extraTag', 0))
        except (TypeError, ValueError):
            extra_tag = 0

        if question_attachment_type != 5:
            continue
        if extra_tag != 0:
            continue
        names = {
            str(item.get('attachmentName') or '').strip(),
            str(item.get('name') or '').strip(),
        }
        if filename in names:
            return item
    return None


def upload_generated_attachment(filename, content_bytes, content_type='image/png'):
    upload_headers = get_request_headers({'host', 'content-length', 'content-type'})
    resp = upstream_request(
        method='POST',
        url=f'{TARGET_URL}/exam/api/atta/upload',
        headers=upload_headers,
        files={'uploadFile': (filename, content_bytes, content_type)},
        cookies=request.cookies,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        payload = resp.json()
    finally:
        resp.close()

    if payload.get('code') not in {0, 33333} or not isinstance(payload.get('extra'), dict):
        raise RuntimeError(payload.get('message') or 'Markdown image upload failed')

    attachment_id = payload['extra'].get('id')
    if attachment_id is None:
        raise RuntimeError('Upload did not return an attachment id')
    return attachment_id


def attach_uploaded_file_to_question(entity_type, entity_id, question_id, attachment_id):
    attach_headers = get_request_headers({'host', 'content-length', 'content-type'})
    resp = upstream_request(
        method='POST',
        url=build_student_question_url(
            entity_type,
            entity_id,
            f'question/{question_id}/attachment/{attachment_id}',
        ),
        headers=attach_headers,
        cookies=request.cookies,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        payload = resp.json()
    finally:
        resp.close()

    if payload.get('code') not in {0, 33333}:
        raise RuntimeError(payload.get('message') or 'Failed to attach Markdown image to the question')
    return payload


def build_markdown_download_url(cache_key, filename):
    quoted_name = parse.quote(filename or f'md-answer-{cache_key[:16]}.png')
    return f'/exam/api/markdown-answer/cache/{cache_key}.png?name={quoted_name}'


def decode_percent_escapes(value, max_rounds=2):
    decoded = str(value or '')
    for _ in range(max_rounds):
        if '%' not in decoded:
            break
        try:
            next_value = _parse.unquote(decoded)
        except Exception:
            break
        if next_value == decoded:
            break
        decoded = next_value
    return decoded


def sanitize_download_name(value, default='file'):
    name = decode_percent_escapes(value or '').strip()
    name = re.sub(r'[<>:"/\\|?*]+', '-', name)
    name = re.sub(r'\s+', ' ', name).strip(' .')
    return name or default


def build_content_disposition(filename, disposition='attachment'):
    clean_name = sanitize_download_name(filename or '', 'download')
    stem, ext = os.path.splitext(clean_name)
    ascii_stem = re.sub(r'[^A-Za-z0-9._ -]+', '_', stem).strip(' ._') or 'download'
    ascii_ext = re.sub(r'[^A-Za-z0-9.]+', '', ext)
    ascii_name = f'{ascii_stem}{ascii_ext}'
    quoted_name = parse.quote(clean_name)
    return f'{disposition}; filename="{ascii_name}"; filename*=UTF-8\'\'{quoted_name}'


def normalize_content_disposition(value):
    header_value = str(value or '').strip()
    if not header_value:
        return header_value

    filename = ''
    encoded_match = re.search(r"filename\*\s*=\s*(?:UTF-8'')?([^;]+)", header_value, re.IGNORECASE)
    if encoded_match:
        filename = decode_percent_escapes(encoded_match.group(1).strip().strip('"'))

    if not filename:
        plain_match = re.search(r'filename\s*=\s*"?(?P<name>[^";]+)"?', header_value, re.IGNORECASE)
        if plain_match:
            filename = decode_percent_escapes(plain_match.group('name').strip())

    clean_name = sanitize_download_name(filename, '')
    if not clean_name:
        return header_value

    disposition = 'inline' if header_value.lower().startswith('inline') else 'attachment'
    return build_content_disposition(clean_name, disposition=disposition)


def extract_download_name(payload, default='attachment'):
    candidates = []

    def walk(value):
        if isinstance(value, dict):
            for key in ('attachmentName', 'attachmentExtraName', 'fileName', 'filename', 'name', 'title'):
                raw = value.get(key)
                if isinstance(raw, str) and raw.strip():
                    candidates.append(raw.strip())
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(payload)

    for raw in candidates:
        clean_name = sanitize_download_name(raw, '')
        if clean_name:
            return clean_name
    return default


def extract_download_url(payload):
    """Best-effort extraction of attachment URL from API JSON payload."""
    candidates = []

    def walk(value):
        if isinstance(value, dict):
            for key in (
                'attachmentLinkAddress',
                'attachmentUrl',
                'videoFile',
                'fileUrl',
                'ossUrl',
                'url',
                'path',
            ):
                raw = value.get(key)
                if isinstance(raw, str) and raw.strip():
                    candidates.append(raw.strip())
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(payload)

    for raw in candidates:
        normalized = build_upstream_attachment_url(raw)
        parsed = _parse.urlsplit(normalized)
        if parsed.scheme in {'http', 'https'} and parsed.netloc:
            return normalized
    return None


def unique_download_name(name, used_names):
    stem, ext = os.path.splitext(name)
    candidate = name
    counter = 2
    lowered = candidate.lower()
    while lowered in used_names:
        candidate = f"{stem} ({counter}){ext}"
        lowered = candidate.lower()
        counter += 1
    used_names.add(lowered)
    return candidate


def build_upstream_attachment_url(value):
    raw = (value or '').strip()
    if not raw:
        return ''

    parsed = _parse.urlsplit(raw)
    if parsed.scheme and parsed.netloc:
        if parsed.path.endswith('/pdf/web/viewer.html'):
            viewer_file = (_parse.parse_qs(parsed.query).get('file') or [''])[0]
            return build_upstream_attachment_url(viewer_file)
        if not parsed.path.startswith('/exam/'):
            return raw
        raw = parsed.path

    if raw.startswith('/exam/pdf/web/viewer.html') or raw.startswith('exam/pdf/web/viewer.html'):
        viewer_file = (_parse.parse_qs(_parse.urlsplit(raw).query).get('file') or [''])[0]
        return build_upstream_attachment_url(viewer_file)

    raw = _parse.unquote(raw).replace(' ', '+').lstrip('/')
    normalized = rewrite_exam_attachment_path(raw if raw.startswith('exam/') else f'exam/{raw}')
    return f'{TARGET_URL}/{normalized.lstrip("/")}'


def guess_download_name(preferred_name, source_url, content_type, index):
    cleaned = sanitize_download_name(preferred_name or '', '')
    path_name = sanitize_download_name(os.path.basename(_parse.urlsplit(source_url).path), '')
    path_ext = os.path.splitext(path_name)[1]
    if not path_ext:
        mime_type = (content_type or '').split(';', 1)[0].strip().lower()
        path_ext = mimetypes.guess_extension(mime_type) or ''
        if mime_type == 'audio/mp3':
            path_ext = '.mp3'

    if cleaned:
        if os.path.splitext(cleaned)[1]:
            return cleaned
        return f'{cleaned}{path_ext}' if path_ext else cleaned

    if path_name:
        return path_name
    if path_ext:
        return f'file-{index:02d}{path_ext}'
    return f'file-{index:02d}'


def normalize_remote_url(value):
    if not value:
        return value
    if value.startswith(('http://', 'https://', 'data:', 'blob:')):
        return value
    if value.startswith('//'):
        return 'https:' + value
    if value.startswith('/'):
        return TARGET_URL + value
    return f"{TARGET_URL}/{value.lstrip('/')}"


def decrypt_attachment_path(value):
    try:
        encrypted = (_parse.unquote(value or '')).strip().strip('/')
        if not encrypted or not ATTACHMENT_PATH_RE.fullmatch(encrypted):
            return value
        cipher = AES.new(ATTACHMENT_KEY, AES.MODE_ECB)
        decrypted = cipher.decrypt(base64.b64decode(encrypted))
        pad_size = decrypted[-1]
        if pad_size < 1 or pad_size > AES.block_size:
            return value
        if decrypted[-pad_size:] != bytes([pad_size]) * pad_size:
            return value
        plain = decrypted[:-pad_size].decode('utf-8').strip()
        if not plain or 'uploadFile/' not in plain:
            return value
        return plain
    except Exception:
        return value


def rewrite_exam_attachment_path(path):
    if not path.startswith('exam/'):
        return path
    raw_target = path[5:].strip('/')
    if not raw_target:
        return path

    def normalize_decoded_target(decoded_target, prefix_segments=None):
        decoded_target = (decoded_target or '').strip()
        if not decoded_target:
            return path
        decoded_target = decoded_target.lstrip('/')
        if decoded_target.startswith('exam/'):
            return decoded_target
        prefix_path = '/'.join(segment.strip('/') for segment in (prefix_segments or []) if segment.strip('/'))
        if prefix_path:
            if decoded_target.startswith(prefix_path + '/'):
                return f'exam/{decoded_target}'
            return f'exam/{prefix_path}/{decoded_target}'
        return f'exam/{decoded_target}'

    decoded_target = decrypt_attachment_path(raw_target)
    if decoded_target != raw_target:
        return normalize_decoded_target(decoded_target)

    segments = [segment for segment in raw_target.split('/') if segment]
    for index in range(len(segments) - 1, -1, -1):
        decoded_segment = decrypt_attachment_path(segments[index])
        if decoded_segment == segments[index]:
            continue
        return normalize_decoded_target(decoded_segment, prefix_segments=segments[:index])

    return path


def rewrite_html_assets(value):
    soup = BeautifulSoup(value, 'html.parser')

    for tag in soup.find_all(['img', 'source', 'audio', 'video']):
        candidate = tag.get('data-href') or tag.get('data-src') or tag.get('src')
        normalized = build_upstream_attachment_url(candidate)
        if normalized:
            tag['src'] = normalized
            if tag.has_attr('data-href'):
                tag['data-href'] = normalized
            if tag.has_attr('data-src'):
                tag['data-src'] = normalized

    for tag in soup.find_all('a'):
        href = tag.get('href')
        normalized = build_upstream_attachment_url(href)
        if normalized and href != '#':
            tag['href'] = normalized

    return str(soup)


def extract_catalog_names(data, result_list, subject_map):
    for i in data:
        subject_name = subject_map.get(i.get("creator"), '')
        result_list.append({"id": i["id"], "name": f"{subject_name}/{i['catalogNamePath']}"})
        if 'childList' in i and i['childList']:
            extract_catalog_names(i['childList'], result_list, subject_map)


def api(path):
    resp = upstream_request(
        method=request.method,
        url=f'{TARGET_URL}/{path}',
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        stream=True,
        timeout=REQUEST_TIMEOUT,
    )
    return build_streaming_response(resp)


def raw_proxy(path):
    proxied_path = rewrite_exam_attachment_path(path)
    resp = upstream_request(
        method=request.method,
        url=f'{TARGET_URL}/{proxied_path}',
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        stream=True,
        timeout=REQUEST_TIMEOUT,
    )
    return build_streaming_response(resp, cache_disabled=True)


def static(file_path):
    file_path = file_path or ''
    normalized_path = os.path.normpath(file_path)
    if normalized_path.startswith('..') or '..' in normalized_path.split(os.path.sep):
        return Response("Not Found", mimetype='text/html; charset=utf-8', status=404)

    if file_path.endswith('/'):
        local_file_path = os.path.join(normalized_path.lstrip('/\\'), 'index.html')
    elif len(file_path.split(".")) == 1:
        local_file_path = os.path.join(normalized_path.lstrip('/\\'), 'index.html')
    else:
        local_file_path = os.path.join(normalized_path.lstrip('/\\'))

    local_file_path = os.path.normpath(local_file_path).replace('\\', '/')
    if local_file_path == '.':
        local_file_path = 'index.html'
    elif local_file_path.startswith('./'):
        local_file_path = local_file_path[2:]

    static_root = os.path.abspath("static")
    cache_file_path = os.path.abspath(os.path.join(static_root, local_file_path))

    if not (cache_file_path == static_root or cache_file_path.startswith(static_root + os.sep)):
        return Response("Not Found", mimetype='text/html; charset=utf-8', status=404)

    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type is None:
        mime_type = 'text/html; charset=utf-8'

    if os.path.exists(cache_file_path):
        response = make_response(send_from_directory("static", local_file_path, as_attachment=False))
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    remote_url = f"{TARGET_URL}/{file_path.replace(os.path.sep, '/')}"
    upstream_response = upstream_request(
        method='GET',
        url=remote_url,
        headers=get_request_headers({'host'}),
        cookies=request.cookies,
        allow_redirects=False,
        stream=False,
        timeout=REQUEST_TIMEOUT,
    )

    try:
        if upstream_response.status_code // 100 < 4:
            content = upstream_response.content
            if len(content) < 5 * 1024 * 1024:
                cache_dir = os.path.dirname(cache_file_path)
                if cache_dir:
                    os.makedirs(cache_dir, exist_ok=True)
                with open(cache_file_path, 'wb') as file:
                    file.write(content)

            response = Response(content, mimetype=mime_type, status=upstream_response.status_code)
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return response

        error_response = Response(upstream_response.content, mimetype=mime_type, status=upstream_response.status_code)
        error_response.headers["Cache-Control"] = "no-store, max-age=0"
        error_response.headers["Pragma"] = "no-cache"
        error_response.headers["Expires"] = "0"
        return error_response
    finally:
        upstream_response.close()


@app.route("/exam/login/api/logout")
def logout():
    response = redirect('/stu/#/login')
    response.set_cookie('token', '', expires=0)
    return response


@app.route('/pdfproxy')
def _pdfproxy():
    raw = request.args.get('url', '')
    if not raw:
        return Response("missing url", 400)

    url = _parse.unquote(raw)
    if url.startswith('/'):
        upstream = f"{TARGET_URL}{url}"
    else:
        upstream = url

    resp = upstream_request(
        method='GET',
        url=upstream,
        headers=get_request_headers({'host'}),
        cookies=request.cookies,
        allow_redirects=True,
        stream=True,
        timeout=STREAM_TIMEOUT,
    )

    extra_headers = None
    if not resp.headers.get('Content-Type'):
        extra_headers = [('Content-Type', 'application/pdf')]

    return build_streaming_response(resp, extra_headers=extra_headers)


@app.route('/getWebFile')
def getWebFile():
    url = TARGET_URL + (request.args.get('url') or '')
    name = request.args.get('courseName') or 'course-export'

    res = upstream_request(
        method='GET',
        url=url,
        cookies=request.cookies,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        text = res.json()
    finally:
        res.close()

    data = []
    for i in text.get('extra') or []:
        if i.get('contentType') == 1:
            continue

        content = i.get('content') or {}
        data.append({
            'type': i.get('contentType'),
            'value': content.get('textContent', '') if i.get('contentType') == 0 else content.get('questionStem', '')
        })

    html_content = '\n<br><br><br><br><br><br>\n'.join([i['value'] for i in data if i.get('value')])
    return build_export_response(name, html_content)


@app.route("/downloadFile", methods=["GET"])
def downloadFile():
    raw_url = request.args.get('url') or ''
    url = parse.unquote(raw_url).strip()
    if not url:
        return jsonify({'message': 'missing url'}), 400

    name = sanitize_download_name(request.args.get('name') or '', '')
    upstream_url = build_upstream_attachment_url(url) or normalize_remote_url(url)

    r = upstream_request(
        method='GET',
        url=upstream_url,
        headers=get_request_headers({'host'}),
        cookies=request.cookies,
        allow_redirects=True,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        content = r.content
        parsed = _parse.urlsplit(upstream_url)
        ext = os.path.splitext(parsed.path)[1].lstrip('.')
        content_type = r.headers.get('Content-Type', '').split(';', 1)[0].strip() or 'application/octet-stream'

        if r.status_code >= 400:
            headers = [('Content-Type', r.headers.get('Content-Type', 'application/json; charset=utf-8'))]
            return Response(content, r.status_code, headers=headers)

        if not ext:
            guessed_ext = mimetypes.guess_extension(content_type) or ''
            ext = guessed_ext.lstrip('.')

        download_name = name or os.path.splitext(os.path.basename(parsed.path))[0] or 'download'
        filename = f'{download_name}.{ext}' if ext else download_name
        headers = [
            ("Content-Disposition", build_content_disposition(filename)),
            ("Content-Type", content_type or "application/octet-stream")
        ]
        return Response(content, 200, headers)
    finally:
        r.close()


@app.route('/downloadAnswers', methods=['GET', 'POST'])
def downloadAnswers():
    html = parse.unquote(request.values.get('html') or '')
    name = parse.unquote(request.values.get('name') or 'answer-export')
    return build_export_response(name, html)


@app.route('/downloadBundle', methods=['POST'])
def downloadBundle():
    payload = request.get_json(silent=True) or {}
    items = payload.get('items') or []
    if not isinstance(items, list) or not items:
        return jsonify({'message': 'No files were provided for bundling.'}), 400

    bundle_name = sanitize_download_name(_parse.unquote(str(payload.get('name') or 'page-files')), 'page-files')
    request_headers = {
        key: value for key, value in request.headers
        if key.lower() not in {'host', 'content-length', 'content-type'}
    }

    zip_buffer = io.BytesIO()
    used_names = set()
    downloaded = 0
    failures = []

    with zipfile.ZipFile(zip_buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for index, item in enumerate(items[:200], 1):
            if not isinstance(item, dict):
                continue

            source_url = build_upstream_attachment_url(item.get('url') or item.get('path') or '')
            if not source_url:
                failures.append(f'{index}. missing url')
                continue

            try:
                with upstream_request(
                    method='GET',
                    url=source_url,
                    headers=request_headers,
                    cookies=request.cookies,
                    allow_redirects=True,
                    stream=True,
                    timeout=STREAM_TIMEOUT,
                ) as upstream_response:
                    if upstream_response.status_code >= 400:
                        failures.append(f'{index}. HTTP {upstream_response.status_code}: {source_url}')
                        continue

                    content_type = upstream_response.headers.get('Content-Type', '')
                    source_ext = os.path.splitext(_parse.urlsplit(source_url).path)[1].lower()
                    if 'text/html' in content_type.lower() and source_ext not in {'.html', '.htm'}:
                        failures.append(f'{index}. unexpected html response: {source_url}')
                        continue

                    download_name = unique_download_name(
                        guess_download_name(item.get('name'), source_url, content_type, index),
                        used_names,
                    )
                    with archive.open(download_name, 'w') as target_file:
                        for chunk in upstream_response.iter_content(chunk_size=STREAM_CHUNK_SIZE):
                            if chunk:
                                target_file.write(chunk)
                    downloaded += 1
            except Exception as exc:
                failures.append(f'{index}. {type(exc).__name__}: {source_url}')
                app.logger.warning('bundle download failed for %s: %s', source_url, exc)

        report_lines = [
            f'Bundle: {bundle_name}.zip',
            f'Downloaded: {downloaded}',
            f'Failed: {len(failures)}',
            '',
            *failures[:80],
        ]
        archive.writestr('_bundle_report.txt', '\n'.join(report_lines).strip() + '\n')

    if downloaded == 0:
        return jsonify({'message': 'No files could be downloaded for this page.'}), 502

    zip_buffer.seek(0)
    headers = build_attachment_headers(bundle_name, 'zip', 'application/zip')
    headers.append(('X-Bundle-Count', str(downloaded)))
    return Response(zip_buffer.getvalue(), 200, headers=headers)


@app.route('/exam/api/markdown-answer/cache/<string:cache_key>.png', methods=['GET'])
def markdown_answer_cache_file(cache_key):
    if not MARKDOWN_CACHE_KEY_RE.fullmatch(cache_key):
        return jsonify({'message': 'Invalid cache key.'}), 400

    image_bytes = get_cached_markdown_png(cache_key)
    if image_bytes is None:
        return jsonify({'message': 'Cached image not found.'}), 404

    filename = sanitize_download_name(
        parse.unquote(request.args.get('name') or f'md-answer-{cache_key[:16]}.png'),
        f'md-answer-{cache_key[:16]}.png'
    )
    headers = [
        ('Content-Type', 'image/png'),
        ('Content-Disposition', build_content_disposition(filename)),
        ('Cache-Control', 'public, max-age=31536000, immutable'),
    ]
    return Response(image_bytes, 200, headers=headers)


@app.route('/exam/api/markdown-answer', methods=['POST'])
def markdown_answer():
    payload = request.get_json(silent=True) or {}
    entity_type = str(payload.get('entityType') or '').strip().lower()
    if entity_type not in {'course', 'paper'}:
        return jsonify({'message': 'Invalid entity type.'}), 400

    try:
        entity_id = int(payload.get('entityId'))
        question_id = int(payload.get('questionId'))
    except (TypeError, ValueError):
        return jsonify({'message': 'Invalid entity id or question id.'}), 400

    markdown_text = str(payload.get('markdown') or '')
    if not markdown_text.strip():
        return jsonify({'message': 'Markdown content cannot be empty.'}), 400
    if len(markdown_text) > MARKDOWN_MAX_LENGTH:
        return jsonify({'message': f'Markdown content exceeds the {MARKDOWN_MAX_LENGTH} character limit.'}), 400

    normalized_markdown = normalize_markdown_math(markdown_text)
    raw_filename = sanitize_download_name(
        parse.unquote(str(payload.get('filename') or f'md-answer-{build_markdown_cache_key(normalized_markdown)[:16]}')),
        'md-answer',
    )
    filename = raw_filename if raw_filename.lower().endswith('.png') else f'{raw_filename}.png'

    try:
        cache_key, image_bytes, cache_hit = get_or_render_markdown_png(markdown_text, normalized_markdown)
    except Exception as exc:
        app.logger.warning(
            'markdown render failed for %s/%s/%s: %s',
            entity_type,
            entity_id,
            question_id,
            exc,
        )
        return jsonify({'message': str(exc) or 'Markdown answer generation failed.'}), 502

    download_url = build_markdown_download_url(cache_key, filename)

    return jsonify({
        'code': 0,
        'message': 'Markdown 图片已生成。',
        'extra': {
            'cacheKey': cache_key,
            'cacheHit': cache_hit,
            'filename': filename,
            'downloadUrl': download_url,
            'questionId': question_id,
            'entityType': entity_type,
            'entityId': entity_id,
            'byteLength': len(image_bytes),
        }
    })


@app.route("/getAllCourses")
async def getAllCourses():
    req_headers = get_request_headers({'host'})
    connector = aiohttp.TCPConnector(ssl=False)
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
    session_cookies = dict(request.cookies)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout, cookies=session_cookies) as session:
        async with session.get(f"{TARGET_URL}/exam/api/student/teacher/entity", headers=req_headers) as res:
            try:
                teacher_payload = await res.json(content_type=None)
            except Exception:
                raw_text = await res.text()
                response = Response(
                    raw_text,
                    res.status,
                    headers=filter_upstream_headers(
                        res.headers,
                        excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
                    )
                )
                return set_aiohttp_cookies(response, res)

        info = teacher_payload.get("extra") or []
        subject_map = {i["id"]: i["subjectName"] for i in info}

        tasks = [
            asyncio.create_task(get(session, f"{TARGET_URL}/exam/api/student/catalog/entity/{subject_id}", req_headers))
            for subject_id in subject_map
        ]
        datas = await asyncio.gather(*tasks)

    courses = []
    for data in datas:
        extract_catalog_names(data.get("extra") or [], courses, subject_map)

    headers = {"content-type": "application/json"}
    return Response(json.dumps(courses), 200, headers=headers)


@app.route('/')
def redirect_to_login():
    return redirect('/stu/#/course?pageid=0', code=302)


@app.route('/stu/')
def _stu_root_redirect():
    return redirect('/stu/index.html', code=302)


@app.route('/stu/index.html')
def _stu_index_with_passive():
    resp = static('stu/index.html')
    try:
        resp.direct_passthrough = False
        body = resp.get_data(as_text=True)
        inj = ''.join([
            '<script>window.PASSIVE={passive:true};document.documentElement.classList.add(\'page-shell\');</script>',
            '<script>window.MathJax={startup:{typeset:false},svg:{fontCache:"local"},tex:{inlineMath:[["$","$"],["\\\\(","\\\\)"]],displayMath:[["$$","$$"],["\\\\[","\\\\]"]],processEscapes:true},options:{skipHtmlTags:["script","noscript","style","textarea","pre","code"]}};</script>',
            f'<link rel="preload" href="/stu/page-enhance.css?v={ENHANCE_ASSET_VERSION}" as="style">',
            f'<link rel="stylesheet" href="/stu/page-enhance.css?v={ENHANCE_ASSET_VERSION}">',
            f'<script defer src="/stu/vendor/markdown-it.min.js?v={ENHANCE_ASSET_VERSION}"></script>',
            f'<script defer src="/stu/vendor/html-to-image.js?v={ENHANCE_ASSET_VERSION}"></script>',
            f'<script defer src="/stu/vendor/signature_pad.umd.min.js?v={ENHANCE_ASSET_VERSION}"></script>',
            f'<script defer src="/stu/vendor/tex-svg.js?v={ENHANCE_ASSET_VERSION}"></script>',
            f'<script defer src="/stu/page-enhance.js?v={ENHANCE_ASSET_VERSION}"></script>',
        ])
        if '</head>' in body:
            body = body.replace('</head>', inj + '</head>', 1)
        else:
            body = inj + body
        excluded = {'content-length', 'transfer-encoding'}
        headers = [(k, v) for (k, v) in resp.headers.items() if k.lower() not in excluded]
        return Response(body, status=resp.status_code, headers=headers, mimetype='text/html; charset=utf-8')
    except Exception:
        return resp


@app.route('/exam/api/student/course/entity/catalog/<int:id>')
def get_course(id):
    resp = upstream_request(
        method=request.method,
        url=f'{TARGET_URL}/exam/api/student/course/entity/catalog/{id}',
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        headers = filter_upstream_headers(
            resp.raw.headers,
            excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        )
        data = resp.json()
        for i in data["extra"]:
            i["courseName"] = re.sub(r'^.+闂�?- (闂傚倷绀侀幉锟犲箹閳哄懎鍨傞柛妤冨剳閼�?)*', '', i["courseName"])
        response = Response(json.dumps(data), resp.status_code, headers)
        return set_requests_cookies(response, resp)
    finally:
        resp.close()


@app.route('/exam/api/student/<string:tp>/entity/<int:id>/content', methods=['GET'])
def forward_request(tp, id):
    url = f"{TARGET_URL}/exam/api/student/{tp}/entity/{id}/content"
    resp = upstream_request(
        method='GET',
        url=url,
        headers=get_request_headers({'host'}),
        cookies=request.cookies,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        data = resp.json()
    finally:
        resp.close()

    if 'extra' in data:
        for item in data['extra']:
            content = item.get('content') or {}
            if item.get('contentType') == 1 and isinstance(content, dict):
                content['downloadSwitch'] = 1
            for field in ['textContent', 'answer', 'questionAnalysis', 'questionStem']:
                value = content.get(field)
                if isinstance(value, str) and '<' in value and '>' in value:
                    content[field] = rewrite_html_assets(value)
    return jsonify(data)


@app.route('/exam/api/student/course/entity/<int:course_id>')
def get_course_detail(course_id):
    resp = upstream_request(
        method=request.method,
        url=f'{TARGET_URL}/exam/api/student/course/entity/{course_id}',
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        headers = filter_upstream_headers(
            resp.raw.headers,
            excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        )
        data = resp.json()
        extra = data.get('extra') or {}
        if extra.get('mappingStatus') == -1:
            extra['mappingStatus'] = 0
        response = Response(json.dumps(data), resp.status_code, headers)
        return set_requests_cookies(response, resp)
    finally:
        resp.close()


@app.route('/exam/api/student/paper/entity/catalog/<int:catalog_id>')
def get_exam(catalog_id):
    resp = upstream_request(
        method=request.method,
        url=f'{TARGET_URL}/exam/api/student/paper/entity/catalog/{catalog_id}',
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        headers = filter_upstream_headers(
            resp.raw.headers,
            excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        )
        data = resp.json()
        for i in data["extra"]:
            i["paperName"] = re.sub(r'^.+闂�?- (闂傚倷绀侀幉锟犲箹閳哄懎鍨傞柛妤冨剳閼�?)*', '', i["paperName"])
            if (1 or i["paperFinishTag"] == 1):
                i["openAnswer"] = 1
                i["openScore"] = 1
                i["paperIndex"] = 1
        response = Response(json.dumps(data), resp.status_code, headers)
        return set_requests_cookies(response, resp)
    finally:
        resp.close()


@app.route('/exam/api/student/paper/entity/<int:catalog_id>')
def get_exam2(catalog_id):
    resp = upstream_request(
        method=request.method,
        url=f'{TARGET_URL}/exam/api/student/paper/entity/{catalog_id}',
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        timeout=REQUEST_TIMEOUT,
    )
    try:
        headers = filter_upstream_headers(
            resp.raw.headers,
            excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        )
        data = resp.json()
        i = data["extra"]
        i["mappingStatus"] = 0 if i["mappingStatus"] == -1 else i["mappingStatus"]
        response = Response(json.dumps(data), resp.status_code, headers)
        return set_requests_cookies(response, resp)
    finally:
        resp.close()


@app.route('/exam/api/student/paper/entity/<int:entity_id>/statistics')
async def get_statistics(entity_id):
    req_headers = get_request_headers({'host'})
    connector = aiohttp.TCPConnector(ssl=False)
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
    session_cookies = dict(request.cookies)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout, cookies=session_cookies) as session:
        async with session.request(
            method=request.method,
            url=f'{TARGET_URL}/exam/api/student/paper/entity/{entity_id}/statistics',
            headers=req_headers,
            data=request.get_data(),
            allow_redirects=False
        ) as resp:
            headers = filter_upstream_headers(
                resp.headers,
                excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
            )
            status_code = resp.status
            try:
                data = await resp.json(content_type=None)
            except Exception:
                raw_text = await resp.text()
                response = Response(raw_text, status_code, headers)
                return set_aiohttp_cookies(response, resp)

            resp_cookie_holder = resp

        if data["code"] == 10001:
            data["code"] = 0
            data["message"] = "SUCCESS"
            data["extra"] = {
                "scoring": "",
                "scoringTotal": "",
                "scoringScoreMax": "114.514",
                "scoringScoreAvg": "1919.810",
                "paperBeginTime": None,
                "paperEndTime": None,
                "studentLibs": [],
                "studentPaperQuestions": [],
                "pointDTOList": [],
                "scoreRangeStudentCountsList": [None, None, None, None],
                "paperStudentScoreList": [],
                "paperCommentingTag": False
            }

            content, question = await asyncio.gather(
                get(session, f'{TARGET_URL}/exam/api/student/paper/entity/{entity_id}/content', headers=req_headers),
                get(session, f'{TARGET_URL}/exam/api/student/paper/entity/{entity_id}/question', headers=req_headers)
            )

            content = content["extra"]
            question = question["extra"]
            question = {i["questionId"]: i for i in question}

            score = 0
            err = 0
            for i in content:
                if i["contentType"] == 2:
                    try:
                        i["content"]["studentScore"] = question[i["content"]["id"]]["studentScore"]
                    except KeyError:
                        err = 1

                    try:
                        if len(i["content"]["childList"]) > 1:
                            for j in range(len(i["content"]["childList"])):
                                i["content"]["childList"][j]["studentSubmitTime"] = \
                                    question[i["content"]["childList"][j]["id"]]["studentSubmitTime"]
                                score += question[i["content"]["childList"][j]["id"]]["studentScore"]
                        else:
                            i["content"]["studentSubmitTime"] = question[i["content"]["id"]]["studentSubmitTime"]
                            score += question[i["content"]["id"]]["studentScore"]
                    except Exception:
                        pass

                    data["extra"]["studentPaperQuestions"].append(i["content"])

            if err == 1:
                score = 0
                for qid in question:
                    if question[qid]["studentScore"] is not None:
                        score += question[qid]["studentScore"]
                score = str(score) + " estimated"

            data["extra"]["scoring"] = str(score) + " (unpublished)"

    response = Response(json.dumps(data), status_code, headers)
    return set_aiohttp_cookies(response, resp_cookie_holder)


def normalize_pdf_viewer_file(file_value):
    value = (file_value or '').strip()
    if not value:
        return '/exam'

    if value.startswith(('http://', 'https://')):
        value = _parse.urlsplit(value).path or value

    value = value.lstrip('/').replace(' ', '+')
    normalized = rewrite_exam_attachment_path(value if value.startswith('exam/') else f'exam/{value}')
    return '/' + normalized.lstrip('/')


@app.route('/exam/pdf/web/viewer.html')
def redirect_pdf_viewer():
    params = []
    should_redirect = False

    for key in request.args.keys():
        for value in request.args.getlist(key):
            if key == 'file':
                parsed_file = _parse.urlsplit(value or '')
                if parsed_file.path != '/pdfproxy':
                    source_path = normalize_pdf_viewer_file(value)
                    value = f'/pdfproxy?url={parse.quote(source_path, safe="/:")}'
                    should_redirect = True
            params.append((key, value))

    if should_redirect:
        query = parse.urlencode(params, doseq=True, quote_via=parse.quote, safe='/:')
        target = '/exam/pdf/web/viewer.html'
        if query:
            target = f'{target}?{query}'
        return redirect(target, code=302)

    upstream_response = upstream_request(
        method='GET',
        url=f'{TARGET_URL}/exam/pdf/web/viewer.html',
        headers=get_request_headers({'host'}),
        cookies=request.cookies,
        allow_redirects=False,
        stream=True,
        timeout=REQUEST_TIMEOUT,
    )
    return build_streaming_response(upstream_response, cache_disabled=True)


@app.route('/stu/project.config.js')
def get_config():
    text = """(function (window) {
      window.$config = {
        BASE_API: window.location.origin,
        photoType: 2,
      };
    })(window);
    """
    response = Response(text, 200, {'Content-Type': 'application/javascript'})
    return response


def _proxy_attachment_api(tp, entity_id, question_id, attachment_id, extra_segment=''):
    base = f'{TARGET_URL}/exam/api/student/{tp}/entity/{entity_id}/question/{question_id}'
    extra = f'/{extra_segment}' if extra_segment else ''
    upstream_endpoint = f'{base}{extra}/attachment/{attachment_id}'

    upstream_resp = upstream_request(
        method=request.method,
        url=upstream_endpoint,
        headers=get_request_headers({'host'}),
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        timeout=REQUEST_TIMEOUT,
    )

    try:
        payload = upstream_resp.json()
    except Exception:
        headers = filter_upstream_headers(
            upstream_resp.raw.headers,
            excluded=['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        )
        response = Response(upstream_resp.content, upstream_resp.status_code, headers)
        return set_requests_cookies(response, upstream_resp)
    finally:
        upstream_resp.close()

    download_url = extract_download_url(payload)
    if not download_url:
        return jsonify(payload)

    file_resp = upstream_request(method='GET', url=download_url, cookies=request.cookies, timeout=REQUEST_TIMEOUT)
    try:
        content = file_resp.content
        parsed = _parse.urlsplit(download_url)
        ext = os.path.splitext(parsed.path)[1].lstrip('.')
        content_type = file_resp.headers.get('Content-Type', '').split(';', 1)[0].strip() or 'application/octet-stream'

        if not ext:
            guessed_ext = mimetypes.guess_extension(content_type) or ''
            ext = guessed_ext.lstrip('.')

        preferred_name = extract_download_name(payload, default='attachment')
        filename = guess_download_name(preferred_name, download_url, content_type, 1)
        headers = [
            ("Content-Disposition", build_content_disposition(filename)),
            ("Content-Type", "application/force-download")
        ]
        return Response(content, 200, headers)
    finally:
        file_resp.close()


@app.route('/exam/api/student/<string:tp>/entity/<int:entity_id>/question/<int:question_id>/attachment/<int:attachment_id>', methods=['GET', 'POST'])
def proxy_question_attachment(tp, entity_id, question_id, attachment_id):
    return _proxy_attachment_api(tp, entity_id, question_id, attachment_id)


@app.route('/exam/api/student/<string:tp>/entity/<int:entity_id>/question/<int:question_id>/extra/attachment/<int:attachment_id>', methods=['GET', 'POST'])
def proxy_question_extra_attachment(tp, entity_id, question_id, attachment_id):
    return _proxy_attachment_api(tp, entity_id, question_id, attachment_id, extra_segment='extra')


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def proxy(path):
    if re.match(r"exam/(login/)?api/", path):
        return api(path)

    if path.startswith('exam/'):
        return raw_proxy(path)

    return static(path)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=29719, debug=False)
