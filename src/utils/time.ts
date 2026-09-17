/**
 * 相对时间格式化：列表里"什么时候发生的"比"具体几点几分"更有用。
 *
 * <h3>为什么要手工解析后端的时间字符串</h3>
 * 后端的 `LocalDateTime` 序列化成 `2026-09-17T23:26:00.23495`——**没有时区标记**，
 * 且小数秒是 5 位（不是标准的 3 位毫秒）。
 * 直接丢给 `new Date()` 有一定风险：个别实现会对非 3 位小数秒返回 Invalid Date。
 * 所以这里显式拆分并截断到毫秒，按**本地时间**构造——
 * 后端存的就是本机时间，前端也在同一台机器上，语义一致。
 */
function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(value)
  if (!match) {
    return null
  }
  const [, year, month, day, hour, minute, second, fraction] = match
  const millisecond = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millisecond,
  )
}

/**
 * 生成相对时间文案。
 *
 * @param value 后端返回的时间字符串（缺时区，按本地时间解读）
 * @param now   当前时间；调用方传入响应式的时间基准，便于定时刷新
 */
export function formatRelativeTime(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) {
    return ''
  }
  const target = parseLocalDateTime(value)
  if (!target) {
    return ''
  }

  const diffMs = now.getTime() - target.getTime()
  // 时钟偏差（或后端时间略快）导致的"未来时间"按刚刚处理，不显示负数
  if (diffMs < 60_000) {
    return '刚刚'
  }

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days} 天前`
  }
  const months = Math.floor(days / 30)
  if (months < 12) {
    return `${months} 个月前`
  }
  return `${Math.floor(months / 12)} 年前`
}
