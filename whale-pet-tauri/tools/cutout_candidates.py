# -*- coding: utf-8 -*-
"""批量「白底 -> 透明」并从一堆插画里挑出可当桌宠姿态的图。

策略：
  1. 缩到长边 700px（桌宠显示 200-300px，够用且快）
  2. numpy 迭代膨胀做四边泛洪，吃掉与画布边界连通的白色
  3. 背景占比 > 22% → 说明确实是一张"白底立绘"
  4. 最大不透明连通块占比 >= 0.6（排除漫画分格/多角色）
  5. 长宽比不在 0.87~1.15 之间（排除正方形头像）
"""
import os
import json
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "assets", "poses_raw")
CAND = os.path.join(ROOT, "assets", "poses_cand")
MAX_SIDE = 700
T_MINCH = 232
T_SAT = 22


def flood_white(rgb):
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)
    bg_like = (mn >= T_MINCH) & ((mx - mn) <= T_SAT)
    h, w = bg_like.shape
    reach = np.zeros_like(bg_like)
    reach[0, :] = bg_like[0, :]
    reach[-1, :] = bg_like[-1, :]
    reach[:, 0] = bg_like[:, 0]
    reach[:, -1] = bg_like[:, -1]
    for _ in range(max(h, w)):
        new = reach.copy()
        new[1:, :] |= reach[:-1, :]
        new[:-1, :] |= reach[1:, :]
        new[:, 1:] |= reach[:, :-1]
        new[:, :-1] |= reach[:, 1:]
        new &= bg_like
        if np.array_equal(new, reach):
            break
        reach = new
    return reach


def largest_ratio(alpha):
    m = (alpha > 40)
    h, w = m.shape
    seen = np.zeros((h, w), bool)
    best = 0
    total = int(m.sum())
    if not total:
        return 0.0, (0, 0, 1, 1)
    best_box = (0, 0, 1, 1)
    ys, xs = np.nonzero(m)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        stack = [(sy, sx)]
        seen[sy, sx] = True
        n = 0
        minx = maxx = sx
        miny = maxy = sy
        while stack:
            cy, cx = stack.pop()
            n += 1
            if cx < minx: minx = cx
            if cx > maxx: maxx = cx
            if cy < miny: miny = cy
            if cy > maxy: maxy = cy
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if n > best:
            best = n
            best_box = (minx, miny, maxx, maxy)
    return best / total, best_box


def process(path):
    im = Image.open(path)
    if getattr(im, "is_animated", False):
        im.seek(0)
    im = im.convert("RGBA")
    W, H = im.size
    scale = min(1.0, MAX_SIDE / max(W, H))
    if scale < 1.0:
        im = im.resize((max(1, round(W * scale)), max(1, round(H * scale))), Image.LANCZOS)
    arr = np.asarray(im)
    rgb = arr[..., :3].astype(np.int16)
    bg = flood_white(rgb)
    bg_ratio = float(bg.mean())
    if bg_ratio < 0.22:
        return None

    alpha = np.where(bg, 0, 255).astype(np.uint8)
    am = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.6))
    alpha = np.asarray(am).astype(np.uint8)
    alpha[bg] = 0

    ratio, box = largest_ratio(alpha)
    if ratio < 0.6:
        return None
    bw = box[2] - box[0] + 1
    bh = box[3] - box[1] + 1
    if bw < 40 or bh < 40:
        return None
    aspect = bh / bw
    if 0.87 < aspect < 1.15:
        return None

    out = np.dstack([arr[..., :3], alpha])
    img = Image.fromarray(out, "RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    if max(img.size) < 260:
        return None
    return {"img": img, "bg_ratio": round(bg_ratio, 2), "ratio": round(ratio, 2), "aspect": round(aspect, 2)}


def main():
    os.makedirs(CAND, exist_ok=True)
    for f in os.listdir(CAND):
        try:
            os.remove(os.path.join(CAND, f))
        except Exception:
            pass
    results = []
    files = sorted(os.listdir(RAW))
    for i, fn in enumerate(files):
        try:
            r = process(os.path.join(RAW, fn))
        except Exception:
            r = None
        if r:
            name = "%02d_%s.png" % (len(results), os.path.splitext(fn)[0][:12])
            dst = os.path.join(CAND, name)
            r["img"].save(dst, optimize=True)
            r["name"] = name
            r["src"] = fn
            results.append(r)
        if (i + 1) % 40 == 0:
            print("scanned %d / %d, kept %d" % (i + 1, len(files), len(results)), flush=True)

    print("kept %d / %d" % (len(results), len(files)))

    COLS, CELL, PAD, LAB = 7, 190, 8, 20
    rows = max(1, (len(results) + COLS - 1) // COLS)
    W = COLS * (CELL + PAD) + PAD
    H = rows * (CELL + LAB + PAD) + PAD
    sheet = Image.new("RGB", (W, H), (26, 30, 40))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, r in enumerate(results):
        th = r["img"].copy()
        th.thumbnail((CELL, CELL), Image.LANCZOS)
        col, row = i % COLS, i // COLS
        x = PAD + col * (CELL + PAD)
        y = PAD + row * (CELL + LAB + PAD)
        for yy in range(y, y + CELL, 20):
            for xx in range(x, x + CELL, 20):
                cc = (56, 62, 78) if ((xx - x) // 20 + (yy - y) // 20) % 2 == 0 else (42, 47, 60)
                d.rectangle([xx, yy, min(xx + 19, x + CELL - 1), min(yy + 19, y + CELL - 1)], fill=cc)
        sheet.paste(th, (x + (CELL - th.width) // 2, y + (CELL - th.height) // 2), th)
        d.text((x + 2, y + CELL + 3), "%s  a%.2f" % (r["name"][:2], r["aspect"]), fill=(205, 215, 240))
    sheet.save(os.path.join(ROOT, "assets", "poses_cand_sheet.png"))
    print("sheet", sheet.size)
    with open(os.path.join(ROOT, "assets", "poses_cand.json"), "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in r.items() if k != "img"} for r in results], f, ensure_ascii=False, indent=1)
    for r in results:
        print(r["name"], r["img"].size, "bg", r["bg_ratio"], "ratio", r["ratio"], "aspect", r["aspect"])


if __name__ == "__main__":
    main()
