import React from 'react'
import { primary } from './genres.js'

// Spoke labels use a dimension's first signal, shortened where BGG's official
// name is too long to sit beside the chart.
const SHORT = {
  'Deck, Bag, and Pool Building': 'Deck Building',
  'Network and Route Building': 'Route Building',
  'Variable Player Powers': 'Player Powers',
  'Simultaneous Action Selection': 'Simultaneous',
  'Cooperative Game': 'Co-op',
  'Area Majority / Influence': 'Area Majority',
  'Card Play Conflict Resolution': 'Card Combat',
  'Abstract Strategy': 'Abstract',
}
const label = (dim) => {
  const first = primary(dim)
  return SHORT[first] || first
}

// Labels wrap so they stay inside the viewBox. Genre axes are named after BGG's
// own tags now, which are phrases ("Action / Dexterity", "Pick-up and Deliver")
// rather than the single words a latent factor used to be named with — set on
// one line they ran past the chart and into whatever sits beside it. The most
// horizontal spoke's label starts at 0.9 of the width, so a line has about 0.1
// to live in; ten characters at the label font is just under, eleven is just
// over ("Pick-up and" spilled by 0.015).
const WRAP = 10
const wrap = (text) => {
  const lines = []
  for (let word of text.split(' ')) {
    // A single word longer than the line has to be broken, or it hangs off the
    // chart however the rest is wrapped. Genre names come from the data, so the
    // long ones cannot all be anticipated by hand ("Simultaneous").
    while (word.length > WRAP) {
      lines.push(`${word.slice(0, WRAP - 1)}-`)
      word = word.slice(WRAP - 1)
    }
    const last = lines.length - 1
    if (last >= 0 && lines[last].length + 1 + word.length <= WRAP && !lines[last].endsWith('-')) {
      lines[last] += ` ${word}`
    } else lines.push(word)
  }
  return lines
}

// A polar bar chart in a donut: each genre dimension owns an angular sector,
// and a value fills that sector as an annular bar out to an arc at its
// radius — bars, not a connected polygon, so a shape covering two distant
// genres reads as two solid bars instead of spikes through the middle.
// Adjacent sectors touch; the shared radial edges keep the categories
// legible. `series` are drawn back to front; each is {values, base,
// className, style, outline} — `base` gives each bar's inner edge (default
// the hole's rim), so series can stack as segments of one bar, and `outline`
// renders only the top arc (used for dashed references and faded games)
// instead of a filled bar.
export default function Radar({ dimensions, series }) {
  const n = dimensions.length
  const cx = 0.5, cy = 0.5, R = 0.33, HOLE = 0.06
  const half = Math.PI / n
  const angle = (i) => (2 * Math.PI * i) / n - Math.PI / 2
  // 0 sits on the hole's rim, 1 on the outer rim — but the radial axis is
  // deliberately NOT linear. A wedge's area is (theta/2)(r_out^2 - r_in^2), so a
  // linear radius would make drawn area go as the square of the value: Ark Nova
  // and SCOUT carry identical coverage mass yet drew at 1.9:1, and a ten-genre
  // game drew 38% of a specialist's ink. Square-rooting makes area linear in the
  // value, so equal coverage draws equal ink however it is spread. Same reason a
  // pie chart's radius scales with the root of its value. The rings and the
  // stacked-segment bars both go through here, so they stay honest too.
  const rad = (v) => Math.sqrt(HOLE ** 2 + (R ** 2 - HOLE ** 2) * v)
  const pt = (a, r) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`

  const arc = (i, v) =>
    `M ${pt(angle(i) - half, rad(v))} A ${rad(v)} ${rad(v)} 0 0 1 ${pt(angle(i) + half, rad(v))}`
  const bar = (i, v0, v1) => {
    const a0 = angle(i) - half, a1 = angle(i) + half
    const r0 = rad(v0), r1 = rad(v1)
    return `M ${pt(a0, r0)} L ${pt(a0, r1)} A ${r1} ${r1} 0 0 1 ${pt(a1, r1)} ` +
      `L ${pt(a1, r0)} A ${r0} ${r0} 0 0 0 ${pt(a0, r0)} Z`
  }

  return (
    <svg className="radar" viewBox="0 0 1 1">
      {/* the hole's rim, then rings at 25/50/75/100% coverage */}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <circle key={r} cx={cx} cy={cy} r={rad(r)} className="radar__ring" />
      ))}

      {series.map(({ key, values, base, className, style, outline }) => (
        <g key={key} className={className} style={style}>
          {values.map((v, i) => {
            const v0 = base?.[i] ?? 0
            if (outline) return v > 0.01 ? <path key={i} d={arc(i, v)} /> : null
            return v - v0 > 0.005 ? <path key={i} d={bar(i, v0, v)} /> : null
          })}
        </g>
      ))}

      {dimensions.map((dim, i) => {
        const x = cx + R * 1.22 * Math.cos(angle(i))
        const y = cy + R * 1.22 * Math.sin(angle(i))
        const lines = wrap(label(dim))
        // dominant-baseline centres one line; lift the block by half its extra
        // height so a two-line label straddles the spoke the same way.
        const lead = 0.024
        return (
          <text key={dim} x={x} y={y} className="radar__label"
            textAnchor={Math.abs(Math.cos(angle(i))) < 0.3 ? 'middle' : Math.cos(angle(i)) > 0 ? 'start' : 'end'}>
            {lines.map((line, l) => (
              <tspan key={line} x={x} dy={l === 0 ? -((lines.length - 1) * lead) / 2 : lead}>
                {line}
              </tspan>
            ))}
          </text>
        )
      })}
    </svg>
  )
}
