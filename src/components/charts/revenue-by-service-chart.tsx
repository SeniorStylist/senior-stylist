'use client'

// Phase 25 — the ONE place recharts is statically imported. Both report pages
// (analytics + super-admin reports) render this identical chart; they load it
// via next/dynamic so the ~400KB recharts bundle only downloads when a report
// actually renders a chart. Single-wrapper rule: never split recharts into
// per-export dynamic() calls — barrel resolution breaks (commit 6d2c300).

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const BAR_COLORS = ['#8B2E4A', '#C4687A', '#0a8f94', '#18b5a4', '#067073', '#1fc4b0']

export interface RevenueChartDatum {
  name: string
  revenue: number
  count: number
}

export default function RevenueByServiceChart({ data }: { data: RevenueChartDatum[] }) {
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 4, right: 4, left: 0, bottom: 4 }}
        >
          <XAxis
            dataKey="name"
            tick={{ fontSize: 11, fill: '#78716C' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#78716C' }}
            tickFormatter={(v: number) => `$${v}`}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Revenue']}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid #E7E5E4',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
