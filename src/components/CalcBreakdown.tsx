import type { CalcResult } from "../api";
import { gbpN, krw, usd } from "../format";
import { Icon } from "./Icon";

/** Where the money goes: goods, shipping, tax as one stacked bar (2px surface gaps), then the itemised list. */
export function CostBar({ r }: { r: CalcResult }) {
  const parts = [
    { key: "goods", label: "물품", value: r.goodsKrw },
    { key: "ship", label: "배송", value: r.shippingKrw },
    { key: "tax", label: "세금", value: r.taxKrw + r.cardFeeKrw },
  ];
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="costbar">
      <div className="costbar-track" role="img" aria-label={parts.map((p) => `${p.label} ${krw(p.value)}`).join(", ")}>
        {parts.map((p) => (
          <span key={p.key} className={`seg seg-${p.key}`} style={{ flexGrow: p.value / total }} title={`${p.label} ${krw(p.value)}`} />
        ))}
      </div>
      <ul className="costbar-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i className={`key seg-${p.key}`} />
            <span>{p.label}</span>
            <b>{Math.round((p.value / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExemptNote({ r }: { r: CalcResult }) {
  return (
    <p className={`exempt ${r.exempt ? "is-exempt" : "is-taxed"}`}>
      <Icon name={r.exempt ? "check" : "alert"} size={15} />
      <span>
        <b>{r.exempt ? "면세 구간" : "과세 구간"}</b> {r.exemptReason}
      </span>
    </p>
  );
}

export function CalcBreakdown({ r, title, hero = true }: { r: CalcResult; title?: string; hero?: boolean }) {
  const rows: [string, string, boolean?][] = [
    ["낙찰가", gbpN(r.hammerGbp)],
    ["구매 수수료", gbpN(r.commissionGbp)],
    ["물품가격", `${krw(r.goodsKrw)}`],
    ["", `${gbpN(r.goodsGbp)}, ${usd(r.goodsUsd)}`],
    ["배송비", krw(r.shippingKrw)],
    ["과세가격", krw(r.cifKrw), true],
    ["관세", krw(r.dutyKrw)],
    ["주세", krw(r.liquorKrw)],
    ["교육세", krw(r.eduKrw)],
    ["부가세", krw(r.vatKrw)],
  ];
  if (r.cardFeeKrw > 0) rows.push(["카드 수수료", krw(r.cardFeeKrw)]);
  return (
    <section className="breakdown">
      {title && <h3>{title}</h3>}
      {hero && (
        <div className="landed">
          <span className="landed-label">한국 도착 총액</span>
          <span className="figure landed-value">{krw(r.totalKrw)}</span>
          {r.totalBottles > 1 && <span className="landed-sub">{r.totalBottles}병, 병당 {krw(r.perBottleKrw)}</span>}
        </div>
      )}
      <ExemptNote r={r} />
      <CostBar r={r} />
      <dl>
        {rows.map(([k, v, strong], i) => (
          <div key={i} className={`${strong ? "strong" : ""}${k === "" ? " cont" : ""}`}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className="strong">
          <dt>세금 합계</dt>
          <dd>{krw(r.taxKrw)}</dd>
        </div>
      </dl>
      <p className="hint">한 병만 살 때 면세가 유지되는 최대 낙찰가는 {gbpN(r.exemptHammerLimitGbp)}입니다.</p>
    </section>
  );
}
