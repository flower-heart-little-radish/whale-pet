/* DeepSeek 峰谷定价 —— 官方规则（2026-08-23 起）
 * 工作日：高峰 09:00-12:00、14:00-18:00，其余为空闲（谷）时段
 * 周末：周六、周日全天按低谷价计费
 * 谷价 = 峰价 × 50%
 */
(function () {
  const PEAK_WINDOWS = [
    [9, 12],
    [14, 18]
  ];

  function isWeekend(d) {
    const w = d.getDay();
    return w === 0 || w === 6;
  }

  function isPeakTime(d) {
    if (isWeekend(d)) return false;
    const h = d.getHours() + d.getMinutes() / 60;
    return PEAK_WINDOWS.some(([a, b]) => h >= a && h < b);
  }

  /* 相位真正发生翻转的时刻：c 与 c-1min 的相位不同 */
  function isBoundary(c) {
    const before = new Date(c.getTime() - 60000);
    return isPeakTime(c) !== isPeakTime(before);
  }

  function boundaryList(now) {
    const list = [];
    for (let d = -3; d <= 9; d++) {
      for (const h of [9, 12, 14, 18]) {
        list.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, 0, 0, 0));
      }
    }
    return list.filter(isBoundary).sort((a, b) => a - b);
  }

  /** 当前所处时段：{ peak, weekend, prev, next } */
  function phaseSegment(now) {
    const t = (now || new Date()).getTime();
    const base = now || new Date();
    const boundaries = boundaryList(base);
    let prev = null;
    let next = null;
    for (const b of boundaries) {
      if (b.getTime() <= t) prev = b;
      else {
        next = b;
        break;
      }
    }
    return { peak: isPeakTime(base), weekend: isWeekend(base), prev, next };
  }

  function fmtDuration(ms) {
    if (ms == null || ms < 0) return '—';
    const totalMin = Math.floor(ms / 60000);
    const d = Math.floor(totalMin / 1440);
    const h = Math.floor((totalMin % 1440) / 60);
    const m = totalMin % 60;
    if (d > 0) return d + ' 天 ' + h + ' 小时';
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    return Math.max(1, m) + ' 分钟';
  }

  window.DSPricing = { phaseSegment, isPeakTime, isWeekend, fmtDuration };
})();
