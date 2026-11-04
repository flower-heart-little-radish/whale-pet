# -*- coding: utf-8 -*-
"""去掉额头上的符纸（橙色/黄色纸条）。

思路：
  1. 只在头部区域（上 42%）里找「暖色 + 低蓝」像素——皮肤是 (245,220,205)，B 很高，
     所以用 (R-B) 阈值能把符纸和皮肤分开
  2. 掩膜外扩 3px，然后用「邻域扩散」把周围颜色往里填，最后轻微模糊
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
POSES = os.path.join(os.path.dirname(HERE), "assets", "poses")


def find_talisman(arr):
    h, w = arr.shape[:2]
    r = arr[..., 0].astype(np.int16)
    g = arr[..., 1].astype(np.int16)
    b = arr[..., 2].astype(np.int16)
    warm = (r > 120) & ((r - b) > 50) & (g > 50)
    mask = np.zeros((h, w), bool)
    x0, x1 = int(w * 0.28), int(w * 0.72)
    y0, y1 = int(h * 0.03), int(h * 0.32)
    box = warm[y0:y1, x0:x1]
    # 只保留额头中间的连通块，避免误伤脸侧
    m = np.zeros_like(box)
    seen = np.zeros_like(box)
    bh, bw = box.shape
    best = None
    for sy in range(bh):
        for sx in range(bw):
            if box[sy, sx] and not seen[sy, sx]:
                stack = [(sy, sx)]
                seen[sy, sx] = True
                cells = []
                while stack:
                    cy, cx = stack.pop()
                    cells.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < bh and 0 <= nx < bw and box[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
                if best is None or len(cells) > len(best):
                    best = cells
    if best:
        for cy, cx in best:
            m[cy, cx] = True
    mask[y0:y1, x0:x1] = m
    return mask


def dilate(mask, k=3):
    m = mask.copy()
    for _ in range(k):
        n = m.copy()
        n[1:, :] |= m[:-1, :]
        n[:-1, :] |= m[1:, :]
        n[:, 1:] |= m[:, :-1]
        n[:, :-1] |= m[:, 1:]
        m = n
    return m


def inpaint(rgb, mask, iters=60):
    out = rgb.astype(np.float32)
    m = mask.copy()
    for _ in range(iters):
        # 用上下左右已知像素的均值填充（由外向内）
        acc = np.zeros_like(out)
        cnt = np.zeros(out.shape[:2], np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(out, (dy, dx), axis=(0, 1))
            ok = ~np.roll(m, (dy, dx), axis=(0, 1))
            acc += sh * ok[..., None]
            cnt += ok
        upd = (cnt > 0) & m
        if not upd.any():
            break
        out[upd] = (acc[upd] / cnt[upd][..., None])
        m = m & ~upd
    return np.clip(out, 0, 255).astype(np.uint8), m


def process(path):
    im = Image.open(path).convert("RGBA")
    arr = np.array(im)
    mask = find_talisman(arr[..., :3])
    if mask.sum() < 60:
        return 0
    grown = dilate(mask, 3)
    rgb, left = inpaint(arr[..., :3], grown)
    out = arr.copy()
    out[..., :3] = rgb
    res = Image.fromarray(out, "RGBA")
    # 只在补过的区域轻微模糊，别糊到整个人
    blur = res.filter(ImageFilter.GaussianBlur(1.2))
    mimg = Image.fromarray((grown * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1.4))
    res = Image.composite(blur, res, mimg)
    res.save(path)
    return int(mask.sum())


if __name__ == "__main__":
    targets = sys.argv[1:] or sorted(
        f for f in os.listdir(POSES) if f.lower().endswith(".png")
    )
    for t in targets:
        p = t if os.path.isabs(t) else os.path.join(POSES, t)
        n = process(p)
        print("%-22s talisman px=%d" % (os.path.basename(p), n))
