import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(ROOT, '.vendor')
if VENDOR not in sys.path:
    sys.path.insert(0, VENDOR)

os.environ.setdefault(
    'WKHTMLTOPDF_PATH',
    os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'cmd.exe'),
)

import proxy

port = 18080
if len(sys.argv) > 1:
    port = int(sys.argv[1])
else:
    port = int(os.environ.get('PORT', '18080'))

proxy.app.run(host='127.0.0.1', port=port, debug=False)
