import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { gateTone } from './evaluation-ui';

const tick = { fontSize: 11, fill: 'var(--muted-foreground)' };
const tip = { background: 'var(--card)', borderColor: 'var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--foreground)' };
const TONE = { good: 'var(--success)', warn: 'var(--warning)', bad: 'var(--danger)', neutral: 'var(--muted-foreground)' } as const;
const toneColor = (label: string) => TONE[gateTone(label)];

/** Eligibility tests: how each test splits into pass, hold and fail, as shares of the clusters assessed. */
export function TestsChart({ tests }: { tests: Array<{ test: string; label: string; pass: number; hold: number; fail: number }> }) {
  const data = tests.map((t) => ({ name: `${t.test}  ${t.label}`, Pass: t.pass, Hold: t.hold, Fail: t.fail }));
  return (
    <div style={{ height: data.length * 31 + 56 }} role="img" aria-label="Pass, hold and fail counts for each eligibility test">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" stackOffset="expand" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={7}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={tick} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={158} tick={tick} tickLine={false} axisLine={false} interval={0} />
          <Tooltip contentStyle={tip} cursor={{ fill: 'var(--muted)' }} formatter={(v: number, n: string) => [`${v} clusters`, n]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          {([['Pass', 'var(--success)'], ['Hold', 'var(--warning)'], ['Fail', 'var(--danger)']] as const).map(([k, c]) => (
            <Bar key={k} dataKey={k} stackId="t" fill={c} stroke="var(--card)" strokeWidth={2} barSize={16}>
              <LabelList dataKey={k} position="center" fill="#fff" fontSize={10} formatter={(v: number) => (v >= 6 ? v : '')} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Part-to-whole donut with the total in the centre and a legend that carries the counts. */
export function ResultsDonut({ items, total, centreLabel }: { items: Array<{ name: string; value: number }>; total: number; centreLabel: string }) {
  return (
    <div className="donut-layout">
      <div className="donut-box" role="img" aria-label={`${centreLabel}: ${items.map((i) => `${i.name} ${i.value}`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="var(--card)" strokeWidth={2} startAngle={90} endAngle={-270}>
              {items.map((i) => <Cell key={i.name} fill={toneColor(i.name)} />)}
            </Pie>
            <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [`${v} clusters (${Math.round((v / total) * 100)}%)`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-centre"><strong>{total}</strong><span>{centreLabel}</span></div>
      </div>
      <ul className="donut-legend">
        {items.map((i) => (
          <li key={i.name}>
            <i style={{ background: toneColor(i.name) }} aria-hidden="true" />
            <span>{i.name}</span>
            <strong>{i.value}</strong>
            <small>{Math.round((i.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars with the value at the end of each bar. */
export function RankedBars({ items, color = 'var(--chart-1)', labelWidth = 200 }: { items: Array<{ name: string; value: number }>; color?: string; labelWidth?: number }) {
  return (
    <div style={{ height: items.length * 30 + 12 }} role="img" aria-label={items.map((i) => `${i.name}: ${i.value}`).join('; ')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={items} layout="vertical" margin={{ top: 0, right: 34, left: 0, bottom: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="name" width={labelWidth} tick={tick} tickLine={false} axisLine={false} interval={0} />
          <Tooltip contentStyle={tip} cursor={{ fill: 'var(--muted)' }} formatter={(v: number) => [`${v} clusters`, '']} separator="" />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} barSize={14}>
            <LabelList dataKey="value" position="right" fill="var(--foreground)" fontSize={11} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type Group = { name: string; count: number; average_score: number | null; eligible: number };

/** Average score per group against the 50 and 70 score lines; the tooltip carries cluster and eligible counts. */
export function GroupScoreChart({ rows, format = (s: string) => s, initial = 10, noun }: { rows: Group[]; format?: (s: string) => string; initial?: number; noun: string }) {
  const [all, setAll] = useState(false);
  const scored = rows.filter((r) => r.average_score != null);
  // the groups with the most clusters first (their averages mean the most), then ordered by score
  const shown = (all ? scored : [...scored].sort((a, b) => b.count - a.count || (b.average_score ?? 0) - (a.average_score ?? 0)).slice(0, initial))
    .sort((a, b) => (b.average_score ?? 0) - (a.average_score ?? 0))
    .map((r) => ({ ...r, label: `${format(r.name)} (${r.count})` }));
  return (
    <div>
      <div style={{ height: shown.length * 28 + 40 }} role="img" aria-label={`Average evaluation score by ${noun}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 30, left: 0, bottom: 0 }} barCategoryGap={6}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 70, 100]} tick={tick} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={138} tick={tick} tickLine={false} axisLine={false} interval={0} />
            <ReferenceLine x={50} stroke="var(--warning)" strokeDasharray="4 3" />
            <ReferenceLine x={70} stroke="var(--success)" strokeDasharray="4 3" />
            <Tooltip
              contentStyle={tip} cursor={{ fill: 'var(--muted)' }}
              formatter={(v: number, _n: string, p: { payload?: Group }) => [`${v} average · ${p.payload?.count ?? 0} clusters · ${p.payload?.eligible ?? 0} eligible`, '']}
              separator="" labelFormatter={(l: string) => l}
            />
            <Bar dataKey="average_score" radius={[0, 4, 4, 0]} barSize={14}>
              {shown.map((r) => <Cell key={r.name} fill={(r.average_score ?? 0) >= 70 ? 'var(--success)' : (r.average_score ?? 0) >= 50 ? 'var(--chart-1)' : 'var(--danger)'} />)}
              <LabelList dataKey="average_score" position="right" fill="var(--foreground)" fontSize={11} fontWeight={600} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="ev-legend">
        <i className="tone-good" /> 70 or more <i style={{ background: 'var(--chart-1)' }} /> 50 to 69 <i className="tone-bad" /> below 50
        <span style={{ marginLeft: 'auto' }}>Number of clusters in brackets</span>
      </p>
      {scored.length > initial && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAll(!all)}>
          {all ? `Show the ${initial} with most clusters` : `Show all ${scored.length} ${noun}s`}
        </Button>
      )}
    </div>
  );
}
