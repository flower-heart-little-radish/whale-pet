#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
credit_probe.py —— 取数脚本模板

主程序会这样调用本脚本：

    python engine/credit_probe.py            # 正常取数
    python engine/credit_probe.py --no-remote # 只读本地用量，不联网

然后从 **标准输出** 读取一段 JSON（不要打印别的任何东西，日志请写 stderr）。

────────────────────────────────────────────────────────
输出格式（缺字段也不会崩，只是对应区域留空）
────────────────────────────────────────────────────────

{
  "ok": true,                 # 是否成功；false 时卡片会显示 notes 里的原因
  "ts": 1730000000000,        # 毫秒时间戳
  "balance": 1234.56,         # ← 剩余积分，卡片最醒目的一行；拿不到就给 null
  "local": {
    "today": 12.34,           # ← 今日已用
    "week": 88.80,            # ← 近 7 日合计
    "by_day": [               # ← 7 日柱状图，按日期升序
      {"date": "2026-11-01", "used": 3.21},
      {"date": "2026-11-02", "used": 12.34}
    ]
  },
  "notes": "",                # 出错时的提示文案（会显示在卡片底部）
  "elapsed_ms": 120
}

峰段/谷段与倒计时由前端自己算（src/pricing.js），**不需要**脚本提供。

────────────────────────────────────────────────────────
怎么拿到这些数字
────────────────────────────────────────────────────────

三种做法，任选其一：

1. 自己填 token
   在下面 TOKEN 常量里写好你的访问令牌，直接调接口。
   注意令牌会过期，过期后需要更新。

2. 自己读本机登录态
   如果目标程序的登录态文件里有可用的令牌，自己解析它。
   请只读、只在本机、只用于自己的账号。

3. 让 AI 帮你改
   把这段说明和目标程序的信息丢给你的 AI 助手，让它按上面的格式实现。

把本文件重命名为 credit_probe.py 即可生效（或直接把逻辑写在这里）。
"""

import json
import sys
import time

# ─── 改这里 ────────────────────────────────────────────
TOKEN = ""          # 你的访问令牌
BASE_URL = ""       # 接口地址，例如 https://example.com/api
# ───────────────────────────────────────────────────────

# 演示数据：让界面先能正常显示。接上真实接口后删掉。
DEMO = True


def fetch_balance():
    """返回剩余积分（float），拿不到返回 None。"""
    if DEMO or not TOKEN:
        return 1234.56
    # 参考实现：
    # import urllib.request
    # req = urllib.request.Request(
    #     BASE_URL + "/your/endpoint",
    #     headers={"Authorization": "Bearer " + TOKEN},
    # )
    # with urllib.request.urlopen(req, timeout=8) as r:
    #     data = json.loads(r.read().decode("utf-8"))
    # return float(data["balance"])
    return None


def local_usage():
    """返回今日/近 7 日用量。没有本地数据就返回空列表，前端会隐藏柱状图。"""
    today = time.strftime("%Y-%m-%d")
    days = []
    for i in range(6, -1, -1):
        days.append({"date": time.strftime("%Y-%m-%d", time.localtime(time.time() - i * 86400)), "used": 0.0})
    days[-1]["date"] = today
    return {
        "today": 0.0,
        "week": 0.0,
        "by_day": days,
        "sessions": 0,
    }


def main():
    no_remote = "--no-remote" in sys.argv
    t0 = time.time()
    result = {
        "ok": False,
        "ts": int(t0 * 1000),
        "balance": None,
        "local": None,
        "notes": "",
        "elapsed_ms": 0,
    }

    try:
        result["local"] = local_usage()
    except Exception as e:
        result["notes"] = "本地用量读取失败: %s" % e

    if no_remote:
        result["ok"] = True
    else:
        try:
            result["balance"] = fetch_balance()
            result["ok"] = result["balance"] is not None
            if not result["ok"]:
                result["notes"] = "未配置取数逻辑：请编辑 engine/credit_probe.py"
        except Exception as e:
            result["notes"] = "在线积分获取失败: %s" % e

    result["elapsed_ms"] = int((time.time() - t0) * 1000)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
