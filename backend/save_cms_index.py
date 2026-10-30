import urllib.request

url = "http://172.18.20.200/"
req = urllib.request.Request(url)
with urllib.request.urlopen(req, timeout=5) as resp:
    data = resp.read()
    with open("cms_index.html", "wb") as f:
        f.write(data)
    print("Wrote cms_index.html, length:", len(data))
