import { Fragment, useEffect, useState } from "react";
import { api, errMsg, type CalcItem, type CalcResult, type FxRecord, type TaxSettings } from "../api";
import { CalcBreakdown } from "../components/CalcBreakdown";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { dateTime, effectivePounds } from "../format";
import { useMyBids } from "../myBids";

export function CalculatorPage({ fx, onFx }: { fx: FxRecord | null; onFx: (f: FxRecord) => void }) {
  const [items, setItems] = useState<CalcItem[]>([{ hammerGbp: 20, bottles: 1, volumeMl: 700 }]);
  const [tax, setTax] = useState<TaxSettings | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState({ krw: "", usd: "" });
  const [note, setNote] = useState<string | null>(null);
  const bids = useMyBids();
  const winning = [...bids.values()].filter((b) => b.winning);

  // If the auction closed now: each lot I'm winning at its current bid (what I'd pay as hammer).
  const fillFromWins = async () => {
    try {
      const ids = new Set(winning.map((b) => b.entityId));
      const lots = (await api.watchlist()).filter((l) => l.entityId != null && ids.has(l.entityId));
      if (lots.length === 0) return setNote("최고가 입찰 lot의 상품 정보가 관심 목록에 없습니다. 설정에서 계정을 다시 불러오세요.");
      setItems(lots.map((l) => ({ label: l.title, hammerGbp: effectivePounds(l), bottles: l.bottles ?? 1, volumeMl: l.volumeMl ?? 700 })));
      setNote(`최고가 입찰 ${lots.length}건을 현재가 기준으로 담았습니다.${lots.length < winning.length ? ` ${winning.length - lots.length}건은 상품 정보가 없어 빠졌습니다.` : ""}`);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  useEffect(() => {
    api.settings().then((s) => setTax(s.tax)).catch((e) => setError(errMsg(e)));
  }, []);

  useEffect(() => {
    if (!tax) return;
    api
      .calculate(items.filter((i) => i.hammerGbp >= 0), tax)
      .then((r) => {
        setResult(r.result);
        onFx(r.fx);
        setError(null);
      })
      .catch((e) => setError(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), JSON.stringify(tax)]);

  const setItem = (i: number, patch: Partial<CalcItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="page">
      <PageHead title="배송비 계산" />
      {error && <div className="notice is-error" role="alert">{error}</div>}
      <div className="calc-layout">
          <section className="calc-items" aria-labelledby="items-title">
            <h2 id="items-title" className="section-title">한 상자에 담을 술</h2>
            {winning.length > 0 && (
              <div className="btn-row">
                <button className="btn btn-primary" onClick={fillFromWins}>내 최고가 입찰 {winning.length}건으로 계산</button>
              </div>
            )}
            {note && <p className="hint" role="status">{note}</p>}
            <table className="item-table">
              <thead>
                <tr>
                  <th>낙찰가</th>
                  <th>병 수</th>
                  <th>병당 용량</th>
                  <th><span className="sr-only">삭제</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <Fragment key={i}>
                  {it.label && (
                    <tr className="item-label-row">
                      <td colSpan={4}>{it.label}</td>
                    </tr>
                  )}
                  <tr>
                    <td><span className="input-affix"><i aria-hidden="true">£</i><input aria-label="낙찰가" type="number" inputMode="decimal" min={0} step={1} value={it.hammerGbp} onChange={(e) => setItem(i, { hammerGbp: num(e.target.value) })} /></span></td>
                    <td><input aria-label="병 수" type="number" min={1} step={1} value={it.bottles} onChange={(e) => setItem(i, { bottles: Math.max(1, num(e.target.value)) })} /></td>
                    <td><span className="input-affix"><input aria-label="병당 용량" type="number" min={1} step={10} value={it.volumeMl} onChange={(e) => setItem(i, { volumeMl: num(e.target.value) })} /><i aria-hidden="true">ml</i></span></td>
                    <td>
                      {items.length > 1 && (
                        <button className="icon-btn" aria-label="이 술 빼기" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                          <Icon name="close" size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
            <button className="btn" onClick={() => setItems((xs) => [...xs, { hammerGbp: 20, bottles: 1, volumeMl: 700 }])}>술 추가</button>
          </section>

          <div className="calc-result" aria-live="polite">{result ? <CalcBreakdown r={result} /> : <p className="hint">계산 중입니다.</p>}</div>

          {tax && (
            <section className="calc-conds">
              <h2 className="section-title">이번 계산 조건</h2>
              <div className="form-grid">
                <label className="field">
                  <span>구매 수수료</span>
                  <span className="input-affix"><input type="number" step={0.5} value={+(tax.commissionRate * 100).toFixed(2)} onChange={(e) => setTax({ ...tax, commissionRate: num(e.target.value) / 100 })} /><i aria-hidden="true">%</i></span>
                </label>
                <label className="field">
                  <span>DHL 배송비</span>
                  <span className="input-affix"><i aria-hidden="true">$</i><input type="number" step={1} value={tax.shippingUsd} onChange={(e) => setTax({ ...tax, shippingUsd: num(e.target.value) })} /></span>
                </label>
                <label className="check"><input type="checkbox" checked={tax.cardSurcharge} onChange={(e) => setTax({ ...tax, cardSurcharge: e.target.checked })} /> 한국 카드로 결제 (+{(tax.cardRate * 100).toFixed(1)}%)</label>
                <label className="check"><input type="checkbox" checked={tax.fta} onChange={(e) => setTax({ ...tax, fta: e.target.checked })} /> 한-영 FTA 원산지 증명으로 관세 0%</label>
                <label className="check"><input type="checkbox" checked={tax.includeShippingInLimit} onChange={(e) => setTax({ ...tax, includeShippingInLimit: e.target.checked })} /> $150 면세 판정에 배송비 포함</label>
              </div>
              <p className="hint">여기서 바꾼 값은 이 화면에서만 쓰입니다. 기본값은 설정에서 바꿉니다.</p>
            </section>
          )}

          <section className="calc-fx">
            <h2 className="section-title">환율</h2>
            {fx ? (
              <p className="fx-line">
                <span className="figure">£1 = {fx.gbpKrw.toFixed(2)}원</span>
                <span className="figure is-quiet">${fx.gbpUsd.toFixed(4)}</span>
              </p>
            ) : (
              <p className="hint">환율을 불러오는 중입니다.</p>
            )}
            {fx && (
              <p className="hint">
                {fx.source === "manual" ? "직접 입력한 값" : `${fx.source}, 제공처 갱신 ${fx.sourceUpdated}`}. 앱에서 {dateTime(fx.fetchedAt)}에 받음.
                {fx.stale && " 오늘 갱신에 실패해 이전 값을 쓰고 있습니다."}
              </p>
            )}
            <div className="row-inline">
              <button className="btn" onClick={() => api.fx(true).then(onFx).catch((e) => setError(errMsg(e)))}>
                <Icon name="refresh" />
                지금 갱신
              </button>
              <input className="w-120" aria-label="1파운드당 원" placeholder="원 / £" value={manual.krw} onChange={(e) => setManual({ ...manual, krw: e.target.value })} />
              <input className="w-120" aria-label="1파운드당 달러" placeholder="$ / £" value={manual.usd} onChange={(e) => setManual({ ...manual, usd: e.target.value })} />
              <button className="btn" disabled={!manual.krw || !manual.usd} onClick={() => api.setFxManual(Number(manual.krw), Number(manual.usd)).then(onFx).catch((e) => setError(errMsg(e)))}>
                직접 입력한 환율 쓰기
              </button>
            </div>
            <p className="hint">실제 세금은 관세청 고시환율로 매겨져 조금 다를 수 있습니다.</p>
          </section>
      </div>
    </div>
  );
}
