# -*- coding: utf-8 -*-
"""从 Q 版立绘裁出托盘/窗口图标（圆形头像）。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, "assets", "chibi.png")).convert("RGBA")
w, h = src.size
# 头部大致在上方 8%~38% 区域
head_w = int(w * 0.56)
head_h = int(h * 0.34)
box = ((w - head_w) // 2, int(h * 0.06), (w + head_w) // 2, int(h * 0.06) + head_h)
face = src.crop(box)

S = 256
face = face.resize((S, S), Image.LANCZOS)

mask = Image.new("L", (S * 4, S * 4), 0)
ImageDraw.Draw(mask).ellipse((0, 0, S * 4 - 1, S * 4 - 1), fill=255)
mask = mask.resize((S, S), Image.LANCZOS)

out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
out.paste(face, (0, 0), mask)
out.save(os.path.join(ROOT, "assets", "icon.png"))
for size in (16, 20, 24, 32, 64):
    out.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, "assets", "tray.png"))
print("icons ok")
