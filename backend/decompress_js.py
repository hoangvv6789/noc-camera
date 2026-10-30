import urllib.request
import gzip
import re
import sys
sys.stdout.reconfigure(encoding='utf-8')

def get_decompressed(path):
    url = f"http://172.18.20.200/{path}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read()
            if data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            return data.decode('utf-8', errors='ignore')
    except Exception as e:
        return f"Error: {e}"

for name in ["library/library-map.js", "application/login.js"]:
    content = get_decompressed(name)
    print(f"=== {name} ===")
    print(content[:600])
    apis = set(re.findall(r'["\'](/Media/[^"\']+)["\']', content))
    print("APIs:", apis)
