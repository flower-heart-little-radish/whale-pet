# -*- coding: utf-8 -*-
"""托盘/窗口图标：Q 版鲸鱼女仆娘的头像（圆形取景 + 深色细环，浅色任务栏也能看清）。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "chibi.png")
S = 512
RIM = 20
# 取景：脸 + 领口，头部上空留一点余量（对 454x604 的立绘调过）
CROP_SIZE = 392
CROP_Y = 56


def circle_mask(size, ss=4):
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def build():
    src = Image.open(SRC).convert("RGBA")
    W, H = src.size
    x0 = (W - CROP_SIZE) // 2
    y0 = CROP_Y
    crop = src.crop((x0, y0, x0 + CROP_SIZE, y0 + CROP_SIZE))

    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(base)
    d.ellipse([0, 0, S - 1, S - 1], fill=(15, 21, 38, 255))

    inner = S - RIM * 2
    av = crop.resize((inner, inner), Image.LANCZOS)
    base.paste(av, (RIM, RIM), circle_mask(inner))

    # 外圈高光 + 内圈暗边，避免浅底糊在一起
    d.ellipse([1, 1, S - 2, S - 2], outline=(198, 218, 255, 95), width=5)
    d.ellipse([RIM - 3, RIM - 3, S - RIM + 2, S - RIM + 2], outline=(10, 15, 28, 160), width=4)

    icon = base.resize((256, 256), Image.LANCZOS)
    icon.save(os.path.join(ROOT, "assets", "icon.png"))
    icon.save(
        os.path.join(ROOT, "assets", "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    base.resize((64, 64), Image.LANCZOS).save(os.path.join(ROOT, "assets", "tray.png"))

    # 预览：深/浅两种任务栏
    strip = Image.new("RGB", (520, 180), (32, 32, 32))
    d2 = ImageDraw.Draw(strip)
    d2.rectangle([0, 90, 520, 180], fill=(238, 240, 246))
    x = 14
    for px in (16, 20, 24, 32, 48, 64):
        im = base.resize((px, px), Image.LANCZOS)
        strip.paste(im, (x, 45 - px // 2), im)
        strip.paste(im, (x, 135 - px // 2), im)
        x += px + 16
    strip.save(os.path.join(ROOT, "assets", "icon_preview.png"))
    print("icon ok")


if __name__ == "__main__":
    build()
