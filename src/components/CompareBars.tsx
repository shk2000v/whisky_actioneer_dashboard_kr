import type { LotView, MyBid, ProductAuctionPoint } from "../api";
import { bidLabel } from "../myBids";
import { effectivePounds } from "../format";

function niceTop(max: number) {
  if (max <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(max)));
  const f = max / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

const money = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: v < 1000 ? 2 : 0, maximumFractionDigits: v < 1000 ? 2 : 0 })}`;
const tickMoney = (v: number) => (v >= 1000 ? `£${v / 1000}k` : `£${v}`);

/**
 * "Right now" comparison. One horizontal bar per lot: product on the vertical axis, current bid on
 * the horizontal axis (shared, zero-based). Each row is a button that selects the lot.
 * My max bid = dark tick, reserve = violet tick, both only when they fall inside the scale.
 */
export function CompareBars({ lots, selected, onSelect, bids }: { lots: LotView[]; selected: string | null; onSelect: (sku: string) => void; bids?: Map<number, MyBid> }) {
  const rows = lots
    .map((l) => ({
      lot: l,
      value: effectivePounds(l),
      hasBid: (l.price?.currentBidPence ?? 0) > 0,
      myMax: l.myMaxGbp && l.myMaxGbp > 0 ? l.myMaxGbp : null,
      reserve: l.reservePence && l.reservePence > 0 ? l.reservePence / 100 : null,
    }))
    .sort((a, b) => b.value - a.value);
  const dataMax = Math.max(1, ...rows.map((r) => Math.max(r.value, r.myMax ?? 0)));
  const top = niceTop(dataMax * 1.04);
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;

  return (
    <div className="bars">
      <div className="bars-axis" aria-hidden="true">
        <span />
        <div className="bars-ticks">
          {ticks.map((t) => (
            <span key={t} style={{ left: pct(t) }}>{tickMoney(t)}</span>
          ))}
        </div>
      </div>
      <ul className="bars-list">
        {rows.map(({ lot, value, hasBid, myMax, reserve }) => {
          const over = myMax != null && value > myMax;
          const labelAt = Math.max(value, myMax != null && myMax <= top ? myMax : 0, reserve != null && reserve <= top ? reserve : 0);
          const spoken = [
            `${hasBid ? "현재가" : "시작가"} ${money(value)}`,
            myMax != null ? `내 최대 ${money(myMax)}${over ? ", 초과" : ""}` : null,
            reserve != null ? `reserve ${money(reserve)}` : null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={lot.sku}>
              <button className={`bar-row${selected === lot.sku ? " is-selected" : ""}`} aria-pressed={selected === lot.sku} onClick={() => onSelect(lot.sku)}>
                <span className="bar-name">
                  <span className="bar-title">{lot.title}</span>
                  <span className="bar-meta">
                    {lot.size && <span>{lot.size}</span>}
                    {lot.location && <span>{lot.location}</span>}
                    {(() => {
                      const b = lot.entityId != null ? bids?.get(lot.entityId) : undefined;
                      if (b) return <span className={`pill ${b.winning ? "good-pill" : "warn-pill"}`}>{bidLabel(b)}</span>;
                      return lot.participating && <span className="pill">참여 중</span>;
                    })()}
                  </span>
                </span>
                <span className="sr-only">{spoken}</span>
                <span className="bar-track" aria-hidden="true">
                  <span className="bar-plot">
                    {ticks.slice(1).map((t) => (
                      <i key={t} className="bar-grid" style={{ left: pct(t) }} />
                    ))}
                    <span className={`bar-fill${hasBid ? "" : " is-start"}`} style={{ width: pct(value) }} />
                    {reserve != null && reserve <= top && <i className="bar-reserve" style={{ left: pct(reserve) }} />}
                    {myMax != null && myMax <= top && <i className="bar-max" style={{ left: pct(myMax) }} />}
                    <span className="bar-value" style={{ left: pct(labelAt) }}>
                      <b>{money(value)}</b>
                      {!hasBid && <span>시작가</span>}
                      {over && <span className="over">내 최대 넘음</span>}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="bars-legend" aria-hidden="true">
        <span><i className="key-fill" />현재가</span>
        <span><i className="key-start" />입찰 없음 (시작가)</span>
        <span><i className="key-max" />내 최대 입찰가</span>
        <span><i className="key-reserve" />reserve</span>
      </div>
    </div>
  );
}

/** Same product in earlier auctions: one column per auction, last recorded bid. */
export function AuctionColumns({ points, currentSku }: { points: ProductAuctionPoint[]; currentSku: string }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.lastBidPence / 100));
  const top = niceTop(max * 1.1);
  return (
    <ul className="cols" aria-label="경매별 마지막 입찰가">
      {points.map((p) => {
        const v = p.lastBidPence / 100;
        const label = (p.auctionTitle ?? p.auctionSlug).replace(/ Auction$/i, "");
        const current = p.sku === currentSku;
        return (
          <li key={p.sku} className={`col${current ? " is-current" : ""}`}>
            <span className="col-value">{money(v)}</span>
            <span className="col-track" aria-hidden="true">
              <span className="col-fill" style={{ height: `${(v / top) * 100}%` }} />
            </span>
            <span className="col-label">
              {label}
              {current && <span className="sr-only"> (이번 경매)</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
