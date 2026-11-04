# -*- coding: utf-8 -*-
"""生成托盘/窗口图标：深蓝圆角牌 + 白色鲸鱼剪影（比单露一个头更好认）。"""
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 512  # 先大后缩，保证边缘平滑


def rounded_card(size=S):
    card = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    r = int(size * 0.23)
    # 竖向渐变底
    grad = Image.new("RGB", (1, size))
    gp = grad.load()
    top = (36, 50, 88)
    bot = (13, 19, 34)
    for y in range(size):
        t = y / (size - 1)
        gp[0, y] = (
            int(top[0] + (bot[0] - top[0]) * t),
            int(top[1] + (bot[1] - top[1]) * t),
            int(top[2] + (bot[2] - top[2]) * t),
        )
    grad = grad.resize((size, size))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    card.paste(grad, (0, 0), mask)

    # 金色细边
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, outline=(230, 192, 137, 110), width=max(2, size // 128))
    return card


def whale_layer(size=S):
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = size / 512.0

    def P(pts):
        return [(x * s, y * s) for x, y in pts]

    white = (245, 248, 255, 255)

    # 身体：圆润的水滴形（左侧圆、右侧收窄）
    d.ellipse([46 * s, 120 * s, 300 * s, 300 * s], fill=white)
    d.polygon(P([(250, 205), (300, 150), (300, 265)]), fill=white)
    # 尾巴（分叉，含与身体的连接块）
    d.polygon(P([(284, 190), (302, 208), (284, 228)]), fill=white)
    d.polygon(P([(292, 206), (392, 140), (370, 208)]), fill=white)
    d.polygon(P([(292, 210), (392, 276), (370, 208)]), fill=white)
    # 腹部鳍
    d.polygon(P([(150, 286), (196, 336), (214, 288)]), fill=white)
    # 眼睛
    d.ellipse([92 * s, 178 * s, 128 * s, 214 * s], fill=(16, 24, 42, 255))
    d.ellipse([99 * s, 185 * s, 110 * s, 196 * s], fill=(255, 255, 255, 255))
    # 喷水
    for (x1, y1, x2, y2) in ((126, 116, 114, 80), (152, 110, 152, 70), (178, 116, 190, 80)):
        d.line([(x1 * s, y1 * s), (x2 * s, y2 * s)], fill=(206, 224, 255, 240), width=int(6 * s))
        d.ellipse([(x2 - 4) * s, (y2 - 4) * s, (x2 + 4) * s, (y2 + 4) * s], fill=(206, 224, 255, 240))
    return layer


def build():
    card = rounded_card(S)
    whale = whale_layer(S)
    # 轻微投影，让鲸鱼从牌子里"浮"出来
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 110), (0, 0), whale.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(S / 64))
    out = card.copy()
    out.alpha_composite(shadow, (0, int(S / 90)))
    out.alpha_composite(whale)

    icon = out.resize((256, 256), Image.LANCZOS)
    icon.save(os.path.join(ROOT, "assets", "icon.png"))
    icon.save(
        os.path.join(ROOT, "assets", "icon.ico"),
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    # 托盘：给 64px，系统会自行缩放到 16/20
    out.resize((64, 64), Image.LANCZOS).save(os.path.join(ROOT, "assets", "tray.png"))

    # 预览条：模拟任务栏背景
    strip = Image.new("RGB", (520, 90), (32, 32, 32))
    x = 12
    for px in (16, 20, 24, 32, 48, 64):
        im = out.resize((px, px), Image.LANCZOS)
        strip.paste(im, (x, (90 - px) // 2), im)
        x += px + 16
    strip.save(os.path.join(ROOT, "assets", "icon_preview.png"))
    print("icon ok")


if __name__ == "__main__":
    build()
