/** Minimal inline trend line for a stat tile. No axes/gridlines/legend — a single
 * series needs none (see dataviz skill: marks-and-anatomy). Color comes from the
 * parent's `currentColor` (pass a `text-*` className), matching the app's existing
 * chart token system rather than importing a separate palette. */
export default function Sparkline({ values, width = 72, height = 24 }: {
  values: number[]; width?: number; height?: number
}) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const stepX = width / (values.length - 1)
  const points = values.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible shrink-0">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
