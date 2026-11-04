# -*- coding: utf-8 -*-
"""把白底插画抠成透明 PNG，并输出用于目检的深色底对照图。"""
import sys, os
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

SRC = {
    "chibi":  r"C:\Users\15831\.workbuddy\clipboard-images\clipboard-2026-10-29T04-18-46-589Z-1099f69e.png",
    "normal": r"C:\Users\15831\.workbuddy\clipboard-images\clipboard-2026-10-29T04-18-46-591Z-634ecfeb.jpg",
}
OUT = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(OUT), "assets")

T_MINCH = 236   # 背景要求：三通道最小值 >= 236
T_SAT   = 18    # 且饱和度 <= 18（避免吃掉淡蓝高光）


def remove_white(path, name):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    mn = a.min(axis=2)
    mx = a.max(axis=2)
    bg_like = (mn >= T_MINCH) & ((mx - mn) <= T_SAT)

    # 从四边泛洪，只吃掉与画布边界连通的白色区域
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg_like[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg_like[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bg_like[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    alpha = np.where(visited, 0, 255).astype(np.uint8)
    am = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.7))
    alpha = np.asarray(am).astype(np.uint8)
    # 完全透明区域保持 0，避免灰边
    alpha[visited] = 0

    rgba = np.dstack([np.asarray(im).astype(np.uint8), alpha])
    out = Image.fromarray(rgba, "RGBA")

    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)

    # 去掉边缘残留的近白像素（半透明像素按白底反解，抑制白边）
    arr = np.asarray(out).astype(np.float32)
    rgb, al = arr[..., :3], arr[..., 3:4] / 255.0
    # 只在半透明/边缘带上做轻微去白
    band = (al > 0.02) & (al < 0.98)
    if band.any():
        safe = np.where(band, al, 1.0)
        un = (rgb - 255.0 * (1.0 - safe)) / np.maximum(safe, 0.05)
        arr[..., :3] = np.where(band, np.clip(un, 0, 255), rgb)
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")

    target_h = 760 if name == "chibi" else 1000
    if out.height > target_h:
        ratio = target_h / out.height
        out = out.resize((max(1, round(out.width * ratio)), target_h), Image.LANCZOS)

    dst = os.path.join(ASSETS, f"{name}.png")
    out.save(dst, optimize=True)

    # 目检图：深灰底
    bgc = Image.new("RGBA", out.size, (24, 26, 33, 255))
    bgc.alpha_composite(out)
    bgc.convert("RGB").save(os.path.join(OUT, f"check_{name}.png"))
    print(f"{name}: {im.size} -> {out.size}  saved {dst}")
    return out


if __name__ == "__main__":
    os.makedirs(ASSETS, exist_ok=True)
    for k, v in SRC.items():
        remove_white(v, k)
