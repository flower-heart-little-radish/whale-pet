# -*- coding: utf-8 -*-
"""从下载的图里筛出「单角色、透明底、可当桌宠立绘」的素材。

判据：
  1. 四角基本透明（说明是抠好的图，不是整幅插画）
  2. 最大的不透明连通块占全部不透明像素 >= 55%（漫画分格会碎成很多块）
  3. 该连通块的高度/宽度比 >= 1.15 或 <= 0.87（站姿或躺姿，排除正方形头像）
  4. 长边 >= 420px
输出：assets/poses_cand/ + 一张带编号的总览图
"""
import os
from collections import deque

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "assets", "poses_raw")
CAND = os.path.join(ROOT, "assets", "poses_cand")

ALPHA_T = 40          # 认为"不透明"的 alpha 阈值


def alpha_mask(im, w=96):
    a = im.getchannel("A")
    h = max(1, round(w * im.size[1] / im.size[0]))
    a = a.resize((w, h), Image.BILINEAR)
    return a, w, h


def largest_component_ratio(mask, w, h):
    px = mask.load()
    seen = bytearray(w * h)
    best = 0
    total = 0
    for x in range(w):
        for y in range(h):
            if px[x, y] >= ALPHA_T:
                total += 1
    if not total:
        return 0.0, 0, (0, 0, 0, 0)
    best_box = (0, 0, 0, 0)
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if seen[i] or px[sx, sy] < ALPHA_T:
                continue
            q = deque([(sx, sy)])
            seen[i] = 1
            n = 0
            minx, maxx, miny, maxy = sx, sx, sy, sy
            while q:
                cx, cy = q.popleft()
                n += 1
                if cx < minx: minx = cx
                if cx > maxx: maxx = cx
                if cy < miny: miny = cy
                if cy > maxy: maxy = cy
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and px[nx, ny] >= ALPHA_T:
                            seen[j] = 1
                            q.append((nx, ny))
            if n > best:
                best = n
                best_box = (minx, miny, maxx, maxy)
    return best / total, total, best_box


def evaluate(path):
    try:
        im = Image.open(path)
    except Exception:
        return None
    animated = getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1
    im = im.convert("RGBA")
    W, H = im.size
    if max(W, H) < 420:
        return None

    a = im.getchannel("A")
    corners = [a.getpixel(p) for p in ((0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1))]
    if max(corners) > 12:
        return None

    mask, mw, mh = alpha_mask(im)
    ratio, total, box = largest_component_ratio(mask, mw, mh)
    if ratio < 0.55:
        return None

    bw = (box[2] - box[0] + 1) / mw
    bh = (box[3] - box[1] + 1) / mh
    if bh <= 0 or bw <= 0:
        return None
    aspect = bh / bw
    if 0.87 < aspect < 1.15:
        return None

    bbox = im.getbbox()
    return {
        "path": path,
        "size": (W, H),
        "aspect": round(aspect, 2),
        "ratio": round(ratio, 2),
        "box": box,
        "bbox": bbox,
        "animated": animated,
        "frames": getattr(im, "n_frames", 1),
    }


def main():
    os.makedirs(CAND, exist_ok=True)
    files = sorted(os.listdir(RAW))
    cands = []
    for fn in files:
        r = evaluate(os.path.join(RAW, fn))
        if r:
            cands.append(r)
    print("candidates: %d / %d" % (len(cands), len(files)))

    COLS, CELL, PAD, LAB = 6, 200, 8, 22
    rows = (len(cands) + COLS - 1) // COLS or 1
    W = COLS * (CELL + PAD) + PAD
    H = rows * (CELL + LAB + PAD) + PAD
    sheet = Image.new("RGB", (W, H), (26, 30, 40))
    d = ImageDraw.Draw(sheet)

    for i, c in enumerate(cands):
        im = Image.open(c["path"]).convert("RGBA")
        im = im.crop(c["bbox"])
        th = im.copy()
        th.thumbnail((CELL, CELL), Image.LANCZOS)
        col = i % COLS
        row = i // COLS
        x = PAD + col * (CELL + PAD)
        y = PAD + row * (CELL + LAB + PAD)
        for yy in range(y, y + CELL, 20):
            for xx in range(x, x + CELL, 20):
                cc = (54, 60, 76) if ((xx - x) // 20 + (yy - y) // 20) % 2 == 0 else (40, 45, 58)
                d.rectangle([xx, yy, min(xx + 19, x + CELL - 1), min(yy + 19, y + CELL - 1)], fill=cc)
        sheet.paste(th, (x + (CELL - th.width) // 2, y + (CELL - th.height) // 2), th)
        d.text((x + 2, y + CELL + 4), "%02d %s %s" % (i, c["aspect"], "GIF" if c["animated"] else ""), fill=(205, 215, 240))
        c["idx"] = i
        c["thumb"] = os.path.basename(c["path"])

    sheet.save(os.path.join(ROOT, "assets", "poses_cand_sheet.png"))
    print("sheet:", sheet.size)
    for c in cands:
        print("%02d  %-26s %-12s aspect=%.2f ratio=%.2f frames=%s" % (
            c["idx"], c["thumb"], "x".join(map(str, c["size"])), c["aspect"], c["ratio"], c["frames"]))


if __name__ == "__main__":
    main()
