import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PricePoint } from "../api";
import { dateTime } from "../format";
import { offsetSec, parts } from "../time";

/**
 * Step chart of one lot's current bid over time (hand-built SVG).
 *
 * - Bids move in discrete steps, so the line is step-after, extended to "now".
 * - When the auction end is known, the x-domain runs to the end: the empty space on the
 *   right is the time left, with "now" and "end" marked.
 * - Reserve and the user's max bid are reference lines (reserve is only drawn when it is
 *   within 2x of the plotted prices, otherwise noted in the caption so the line keeps its scale).
 * - Crosshair snaps to the step under the pointer; arrow keys move it when focused.
 */
export interface PriceChartProps {
  points: PricePoint[];
  endUnix?: number | null;
  reservePence?: number | null;
  myMaxGbp?: number | null;
  height?: number;
  compact?: boolean;
  label: string;
}

const PAD = { top: 18, right: 64, bottom: 26, left: 52 };
const PAD_COMPACT = { top: 10, right: 46, bottom: 20, left: 40 };

function niceStep(raw: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function yTicks(max: number, count: number) {
  const step = niceStep(max / count);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(v);
  return { ticks: out, top };
}

const money = (v: number) => (v >= 10000 ? `£${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : `£${v % 1 === 0 ? v : v.toFixed(2)}`);
const moneyFull = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function xTicks(t0: number, t1: number, maxTicks: number) {
  const span = t1 - t0;
  const hour = 3600;
  const steps = [hour, 3 * hour, 6 * hour, 12 * hour, 86400, 2 * 86400, 3 * 86400, 4 * 86400, 5 * 86400, 7 * 86400];
  const step = steps.find((s) => span / s <= maxTicks) ?? 14 * 86400;
  // Align to midnight / whole hours in the display zone (Korea or UK).
  const off = offsetSec(t0);
  let t = step >= 86400 ? t0 - ((((t0 + off) % 86400) + 86400) % 86400) : Math.floor(t0 / 3600) * 3600;
  while (t < t0) t += step;
  const out: number[] = [];
  for (; t <= t1; t += step) out.push(t);
  return { ticks: out, daily: step >= 86400 };
}

function fmtTick(t: number, daily: boolean) {
  const k = parts(t);
  return daily ? `${k.mo}/${k.d}` : `${k.h}시`;
}

const fmtWhen = dateTime;

export function PriceChart({ points, endUnix, reservePence, myMaxGbp, height = 260, compact = false, label }: PriceChartProps) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  // Callback ref: re-attach the observer whenever the plot element mounts (e.g. empty -> data).
  const wrap = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
    ro.current = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);

  const pts = useMemo(() => [...points].sort((a, b) => a.ts - b.ts), [points]);
  useEffect(() => setHover(null), [pts.length]);

  if (pts.length === 0) {
    return (
      <div ref={wrap} className="chart-empty" style={{ height: compact ? 80 : 140 }}>
        가격 기록이 아직 없습니다. 다음 갱신부터 쌓입니다.
      </div>
    );
  }

  const pad = compact ? PAD_COMPACT : PAD;
  const now = Math.floor(Date.now() / 1000);
  const last = pts[pts.length - 1];
  const tNow = Math.max(now, last.ts);
  const t0 = pts[0].ts;
  const showFuture = !!endUnix && endUnix > tNow && !compact;
  let t1 = showFuture ? endUnix! : tNow;
  if (t1 - t0 < 3600) t1 = t0 + 3600;

  const values = pts.map((p) => p.currentBidPence / 100);
  const dataMax = Math.max(...values, 1);
  const reserve = reservePence && reservePence > 0 ? reservePence / 100 : null;
  const reserveInRange = reserve != null && reserve <= dataMax * 2;
  const myMax = myMaxGbp && myMaxGbp > 0 ? myMaxGbp : null;
  const myMaxInRange = myMax != null && myMax <= dataMax * 3;
  const yMaxRaw = Math.max(dataMax, reserveInRange ? reserve! : 0, myMaxInRange ? myMax! : 0) * 1.08;
  const { ticks: yt, top } = yTicks(yMaxRaw, compact ? 2 : 4);

  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const x = (t: number) => pad.left + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => pad.top + ih - (v / top) * ih;
  const xNow = x(tNow);

  // Step-after path through every snapshot, extended to now.
  let line = `M${x(pts[0].ts)},${y(values[0])}`;
  for (let i = 1; i < pts.length; i++) line += `H${x(pts[i].ts)}V${y(values[i])}`;
  line += `H${xNow}`;
  const area = `${line}V${y(0)}H${x(pts[0].ts)}Z`;

  const { ticks: xt, daily } = xTicks(t0, t1, compact ? 3 : Math.max(3, Math.floor(iw / 64)));
  const lastV = values[values.length - 1];

  const idxAt = (px: number) => {
    const t = t0 + ((px - pad.left) / iw) * (t1 - t0);
    let i = 0;
    while (i + 1 < pts.length && pts[i + 1].ts <= t) i++;
    return i;
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < pad.left || px > Math.min(xNow, pad.left + iw) + 8) return setHover(null);
    setHover(idxAt(px));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? pts.length) - 1));
    else if (e.key === "ArrowRight") setHover((h) => Math.min(pts.length - 1, (h ?? -1) + 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };

  const hp = hover != null ? pts[hover] : null;
  const hx = hp ? x(hp.ts) : 0;
  const tipLeft = hp ? Math.min(Math.max(hx + 10, 4), width - 170) : 0;

  const refLines: { v: number; text: string; cls: string }[] = [];
  if (reserveInRange) refLines.push({ v: reserve!, text: `reserve ${money(reserve!)}`, cls: "ref-reserve" });
  if (myMaxInRange) refLines.push({ v: myMax!, text: `내 최대 ${money(myMax!)}`, cls: "ref-max" });

  return (
    <figure className={`price-chart${compact ? " compact" : ""}`}>
      <div ref={wrap} className="price-chart-plot" style={{ minHeight: height }}>
        {width > 0 && <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} 현재가 추이. 최근 ${moneyFull(lastV)}. 좌우 화살표로 기록을 하나씩 확인할 수 있습니다.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {showFuture && (
            <g className="future">
              <rect x={xNow} y={pad.top} width={x(t1) - xNow} height={ih} />
              <line x1={x(t1)} x2={x(t1)} y1={pad.top} y2={pad.top + ih} className="end-line" />
              {x(t1) - xNow > 120 && <text x={xNow + 8} y={pad.top + 14} className="axis-note">지금부터 마감까지</text>}
            </g>
          )}
          {yt.map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={pad.left + iw} y1={y(v)} y2={y(v)} className={v === 0 ? "baseline" : "grid"} />
              <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="tick">
                {money(v)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={t} x={x(t)} y={height - 8} textAnchor="middle" className="tick">
              {fmtTick(t, daily)}
            </text>
          ))}
          {!compact &&
            refLines.map((r) => (
              <g key={r.cls} className={r.cls}>
                <line x1={pad.left} x2={pad.left + iw} y1={y(r.v)} y2={y(r.v)} />
                <text x={pad.left + iw} y={y(r.v) - 5} textAnchor="end">{r.text}</text>
              </g>
            ))}
          <path d={area} className="area" />
          <path d={line} className="line" />
          {!showFuture && <line x1={xNow} x2={xNow} y1={pad.top} y2={pad.top + ih} className="now-line" />}
          <circle cx={xNow} cy={y(lastV)} r={4.5} className="end-dot" />
          <text x={xNow + 9} y={y(lastV)} dy="0.32em" className="end-label">
            {money(lastV)}
          </text>
          {hp && (
            <g className="crosshair">
              <line x1={hx} x2={hx} y1={pad.top} y2={pad.top + ih} />
              <circle cx={hx} cy={y(hp.currentBidPence / 100)} r={4.5} />
            </g>
          )}
        </svg>}
        {hp && width > 0 && (
          <div className="chart-tip" style={{ left: tipLeft, top: pad.top }}>
            <strong>{moneyFull(hp.currentBidPence / 100)}</strong>
            <span>{fmtWhen(hp.ts)}</span>
            <span>입찰 {hp.bids}회</span>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {hp ? `${fmtWhen(hp.ts)}, ${moneyFull(hp.currentBidPence / 100)}, 입찰 ${hp.bids}회` : ""}
      </p>
      {!compact && reserve != null && !reserveInRange && (
        <figcaption>reserve {moneyFull(reserve)}는 현재가보다 훨씬 높아 그래프 범위 밖에 있습니다.</figcaption>
      )}
      {!compact && (
        <details className="disclosure chart-table">
          <summary>기록을 표로 보기</summary>
          <table>
            <caption className="sr-only">{label} 가격 기록</caption>
            <thead>
              <tr>
                <th scope="col">시각</th>
                <th scope="col" className="num">현재가</th>
                <th scope="col" className="num">입찰</th>
              </tr>
            </thead>
            <tbody>
              {[...pts].reverse().map((p) => (
                <tr key={p.ts}>
                  <td>{fmtWhen(p.ts)}</td>
                  <td className="num">{moneyFull(p.currentBidPence / 100)}</td>
                  <td className="num">{p.bids}회</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
