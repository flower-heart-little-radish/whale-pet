# -*- coding: utf-8 -*-
"""从「蓝色大肥鱼」图库抓 DeepSeek 娘（大肥鱼）素材原图。

路径规则：预览图 .../submissions/previews/deepseek/<hash>.webp
         原图   raw.githubusercontent.com/lmy414/ai-girl-stickers/main/dist/submissions/originals/deepseek/<hash>.png
所以从角色页收集 hash 即可。
"""
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW_DIR = os.path.join(ROOT, "assets", "poses_raw")
BASE = "https://xn--pssy23gqgbz2d718b.com"
ORIGIN = "https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/dist/submissions/originals/deepseek/"
PREVIEW = "https://xn--pssy23gqgbz2d718b.com/submissions/previews/deepseek/"

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
UA = {"User-Agent": "Mozilla/5.0"}


def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=timeout, context=CTX).read()


def collect_hashes(max_pages=8):
    hashes = []
    for page in range(1, max_pages + 1):
        url = BASE + "/characters/deepseek.html" if page == 1 else BASE + "/characters/deepseek/page/%d.html" % page
        try:
            html = get(url).decode("utf-8", "ignore")
        except Exception as e:
            print("stop at page %d: %s" % (page, e))
            break
        found = re.findall(r"previews/deepseek/([0-9a-f]{16})\.webp", html)
        new = [h for h in dict.fromkeys(found) if h not in hashes]
        hashes.extend(new)
        print("page %d: +%d (total %d)" % (page, len(new), len(hashes)))
        if not new:
            break
    return hashes


def fetch_one(h):
    os.makedirs(RAW_DIR, exist_ok=True)
    for ext in ("png", "jpg"):
        dst = os.path.join(RAW_DIR, h + "." + ext)
        if os.path.isfile(dst):
            return dst
        try:
            data = get(ORIGIN + h + "." + ext)
            if len(data) < 2000:
                continue
            with open(dst, "wb") as f:
                f.write(data)
            return dst
        except urllib.error.HTTPError:
            continue
        except Exception:
            continue
    # 退化为预览图
    try:
        data = get(PREVIEW + h + ".webp")
        dst = os.path.join(RAW_DIR, h + ".webp")
        with open(dst, "wb") as f:
            f.write(data)
        return dst
    except Exception:
        return None


def report():
    files = sorted(os.listdir(RAW_DIR))
    print("\n%-24s %-10s %-5s %s" % ("file", "size", "alpha", "bbox/aspect"))
    for fn in files:
        p = os.path.join(RAW_DIR, fn)
        try:
            im = Image.open(p)
            alpha = "A" if im.mode in ("RGBA", "LA") or "transparency" in im.info else "-"
            print("%-24s %-10s %-5s %s" % (fn, "x".join(map(str, im.size)), alpha, im.mode))
        except Exception as e:
            print(fn, "ERR", e)


if __name__ == "__main__":
    if "--report" in sys.argv:
        report()
        raise SystemExit(0)
    hs = collect_hashes()
    print("total hash:", len(hs))
    with ThreadPoolExecutor(max_workers=8) as ex:
        paths = list(ex.map(fetch_one, hs))
    ok = sum(1 for p in paths if p)
    print("downloaded:", ok, "/", len(hs))
    report()
