import gzip
import json
import urllib.request
import re

url = "http://172.18.20.200/library/library-map.js"
req = urllib.request.Request(url)
with urllib.request.urlopen(req, timeout=5) as resp:
    data = resp.read()
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    text = data.decode("utf-8", errors="ignore")

# Find all .js paths in library-map.js
js_files = re.findall(r'["\']([a-zA-Z0-9_\-\./]+\.js)["\']', text)
print(f"Found {len(js_files)} JS files in library-map.js:")
for f in sorted(set(js_files)):
    print(f)
