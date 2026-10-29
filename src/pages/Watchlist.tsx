import { useEffect, useMemo, useState } from "react";
import { api, errMsg, isDemo, type AuctionOverview, type BasketResult, type CalcResult, type FxRecord, type LotView, type PollerStatus, type PricePoint, type ProductAuctionPoint } from "../api";
import { CalcBreakdown, ExemptNote } from "../components/CalcBreakdown";
import { ExternalLink } from "../components/ExternalLink";
import { hideBroken } from "../components/LotTable";
import { AuctionColumns, CompareBars } from "../components/CompareBars";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/PageHead";
import { PriceChart } from "../components/PriceChart";
import { changeSinceFirst, duration, effectivePounds, gbp, krw, reserveState, timeAgo } from "../format";
import { Sheet, useSize } from "../layout";
import { bidLabel, useMyBids } from "../myBids";
import type { MyBid } from "../api";

type Scope = "all" | "participating" | "winning" | "noOutliers";

/** Lots priced over 10x the median dwarf everything else on a shared zero-based scale. */
function outlierCut(lots: LotView[]) {
  const vs = lots.map(effectivePounds).filter((v) => v > 0).sort((a, b) => a - b);
  if (vs.length < 3) return null;
  const cut = vs[Math.floor(vs.length / 2)] * 10;
  return vs[vs.length - 1] > cut ? cut : null;
}

function LotDetail({
  lot,
  overview,
  onUpdate,
  onRemove,
  headingLevel,
  bid,
}: {
  bid?: MyBid;
  lot: LotView;
  overview: AuctionOverview | null;
  onUpdate: (l: LotView, patch: Partial<Pick<LotView, "participating" | "myMaxGbp" | "note">>) => void;
  onRemove: (l: LotView) => void;
  headingLevel: "h2" | "none";
}) {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [productHist, setProductHist] = useState<ProductAuctionPoint[]>([]);
  const [single, setSingle] = useState<CalcResult | null>(null);
  const [example, setExample] = useState(false);
  useEffect(() => {
    if (isDemo()) import("../demo/backend").then((m) => setExample(m.exampleHistoryOn()));
  }, []);
  const toggleExample = (on: boolean) =>
    import("../demo/backend").then((m) => {
      m.setExampleHistory(on);
      setExample(on);
    });

  useEffect(() => {
    api.history(lot.sku).then(setHistory).catch(() => setHistory([]));
    api.productHistory(lot.sku).then(setProductHist).catch(() => setProductHist([]));
    api
      .calculateEach([{ label: lot.title, hammerGbp: effectivePounds(lot), bottles: lot.bottles ?? 1, volumeMl: lot.volumeMl ?? 700 }])
      .then((r) => setSingle(r.results[0]))
      .catch(() => setSingle(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lot.sku, lot.price?.fetchedAt, example]);

  const change = changeSinceFirst(history);
  const reserve = reserveState(lot);
  const hasBid = (lot.price?.currentBidPence ?? 0) > 0;

  return (
    <article className="detail" aria-label={headingLevel === "none" ? undefined : lot.title}>
      <div className="detail-head">
        {lot.image ? <img src={lot.image} alt="" className="detail-img" onError={hideBroken} /> : <span className="detail-img" aria-hidden="true" />}
        <div>
          {headingLevel === "h2" && <h2>{lot.title}</h2>}
          <p className="lot-meta">
            <span>#{lot.sku}</span>
            {lot.subtitle && <span>{lot.subtitle}</span>}
            {lot.bottled && <span>{lot.bottled}</span>}
            {lot.size && <span>{lot.size}</span>}
            {lot.abv && <span>{lot.abv}</span>}
            {lot.location && <span>{lot.location}</span>}
          </p>
        </div>
      </div>

      <div className="price-line">
        <div>
          <span className="label">{hasBid ? "현재가" : "시작가"}</span>
          <span className="figure figure-xl">{gbp(lot.price ? lot.price.currentBidPence || lot.price.nextBidPence : null)}</span>
        </div>
        <dl className="price-facts">
          <div><dt>입찰</dt><dd>{lot.price ? `${lot.price.bids}회` : "-"}</dd></div>
          <div><dt>다음 최소</dt><dd>{gbp(lot.price?.nextBidPence)}</dd></div>
          <div><dt>추적 후 변화</dt><dd>{change == null ? "-" : `${change >= 0 ? "+" : "−"}${gbp(Math.abs(change))}`}</dd></div>
          <div><dt>reserve</dt><dd className={`reserve-${reserve.tone}`}>{reserve.label}</dd></div>
        </dl>
        {lot.price && <p className="hint">{timeAgo(lot.price.fetchedAt)} 조회</p>}
        {bid && (
          <p className="my-bid-line">
            <span className={`pill ${bid.winning ? "good-pill" : "warn-pill"}`}>{bidLabel(bid)}</span>
            사이트 내 입찰 {gbp(bid.bidPence)}, 최대 {gbp(bid.maxPence)}
          </p>
        )}
      </div>

      <section className="detail-section">
        <h3 className="section-title">가격 흐름</h3>
        {isDemo() && (
          <label className="check demo-example">
            <input type="checkbox" checked={example} onChange={(e) => toggleExample(e.target.checked)} />
            예시 흐름으로 보기
            {example && <span className="pill warn-pill">예시 데이터, 실제 기록 아님</span>}
          </label>
        )}
        <PriceChart
          points={history}
          endUnix={lot.auctionId === overview?.active?.auctionId ? overview?.active?.closeUnix ?? overview?.active?.endUnix : null}
          reservePence={lot.reservePence}
          myMaxGbp={lot.myMaxGbp}
          label={lot.title}
        />
      </section>

      {productHist.length > 1 && (
        <section className="detail-section">
          <h3 className="section-title">같은 상품, 경매별 마지막 입찰가</h3>
          <AuctionColumns points={productHist} currentSku={lot.sku} />
          <p className="hint">앱이 경매 중에 지켜본 lot만 나옵니다. 지난 경매 낙찰가는 사이트에 로그인해야 공개됩니다.</p>
        </section>
      )}

      <section className="my-bid" aria-label="내 입찰 정보">
        <label className="switch">
          <input type="checkbox" checked={lot.participating} onChange={(e) => onUpdate(lot, { participating: e.target.checked })} />
          <span>입찰 참여 중</span>
        </label>
        <label className="field">
          <span>내 최대 입찰가</span>
          <span className="input-affix">
            <i aria-hidden="true">£</i>
            <input
              key={lot.sku + "max"}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              defaultValue={lot.myMaxGbp ?? ""}
              onBlur={(e) => onUpdate(lot, { myMaxGbp: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </span>
        </label>
        <label className="field grow">
          <span>메모</span>
          <input key={lot.sku + "note"} defaultValue={lot.note ?? ""} onBlur={(e) => onUpdate(lot, { note: e.target.value || null })} />
        </label>
      </section>

      {single && (
        <section className="single-cost" aria-label="이 lot만 받을 때 비용">
          <span className="label">이 lot만 한국으로 받으면</span>
          <span className="figure">{krw(single.totalKrw)}</span>
          <ExemptNote r={single} />
          <details className="disclosure">
            <summary>계산 내역</summary>
            <CalcBreakdown r={single} hero={false} />
          </details>
        </section>
      )}

      <div className="detail-actions">
        <ExternalLink href={lot.url} className="btn">
          <Icon name="external" size={16} />
          사이트에서 보기
          <span className="sr-only"> (새 창)</span>
        </ExternalLink>
        <button className="btn btn-quiet" onClick={() => onRemove(lot)}>
          관심 목록에서 빼기
        </button>
      </div>
    </article>
  );
}

export function WatchlistPage({
  overview,
  reloadKey,
  status,
}: {
  overview: AuctionOverview | null;
  reloadKey: number;
  status: { fx: FxRecord | null; poller: PollerStatus | null };
}) {
  const size = useSize();
  const [lots, setLots] = useState<LotView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [basket, setBasket] = useState<BasketResult | null>(null);
  const [scope, setScope] = useState<Scope>("all");
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bids = useMyBids(reloadKey);
  const isWinning = (l: LotView) => l.entityId != null && !!bids.get(l.entityId)?.winning;

  const load = async () => {
    try {
      const ls = await api.watchlist();
      setLots(ls);
      setSelected((s) => (s && ls.some((l) => l.sku === s) ? s : ls[0]?.sku ?? null));
      setBasket(ls.some((l) => l.participating) ? await api.basket() : null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void load();
  }, [reloadKey]);

  const cut = useMemo(() => outlierCut(lots), [lots]);
  const shown = useMemo(() => {
    if (scope === "participating") return lots.filter((l) => l.participating);
    if (scope === "winning") return lots.filter(isWinning);
    if (scope === "noOutliers" && cut != null) return lots.filter((l) => effectivePounds(l) <= cut);
    return lots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lots, scope, cut, bids]);
  const lot = lots.find((l) => l.sku === selected) ?? null;

  const update = async (l: LotView, patch: Partial<Pick<LotView, "participating" | "myMaxGbp" | "note">>) => {
    const next = { ...l, ...patch };
    const all = lots.map((x) => (x.sku === l.sku ? next : x));
    setLots(all);
    try {
      await api.watchUpdate(l.sku, next.participating, next.myMaxGbp, next.note);
      if ("participating" in patch || "myMaxGbp" in patch) setBasket(all.some((x) => x.participating) ? await api.basket() : null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const remove = async (l: LotView) => {
    await api.watchRemove(l.sku).catch((e) => setError(errMsg(e)));
    setSheetOpen(false);
    setSelected(null);
    setAnnounce(`${l.title}을 관심 목록에서 뺐습니다.`);
    void load();
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const rep = await api.pollNow();
      if (rep.polled === 0) await api.refreshPrices(lots.filter((l) => l.entityId).map((l) => l.sku));
      else if (rep.errors.length) setError(rep.errors.join("\n"));
      await load();
      setAnnounce(rep.polled > 0 ? `${rep.polled}건 갱신, ${rep.changed.length}건 가격 변동` : "가격을 갱신했습니다.");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const select = (sku: string) => {
    setSelected(sku);
    if (size !== "wide") setSheetOpen(true);
  };

  const statusLine = (
    <p className="status-line">
      {status.fx && <span>£1 = {status.fx.gbpKrw.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}원{status.fx.stale ? " (이전 환율)" : ""}</span>}
      {status.poller && <span>다음 가격 갱신 {duration(status.poller.nextPollInSecs)} 후</span>}
      {status.poller?.error && <span className="tone-warn" title={status.poller.error}>마지막 갱신에 오류가 있었습니다</span>}
    </p>
  );

  if (loaded && lots.length === 0) {
    return (
      <div className="page">
        <PageHead title="관심 목록" />
        {statusLine}
        <div className="empty-state">
          <p>아직 지켜보는 술이 없어요.</p>
          <p className="hint">검색이나 프리셋 결과에서 별을 누르면 여기에 모입니다. 진행 중인 경매의 lot은 정해 둔 간격으로 가격을 다시 확인합니다.</p>
        </div>
      </div>
    );
  }

  const scopes: [Scope, string][] = [
    ["all", `전체 ${lots.length}`],
    ["participating", `참여 중 ${lots.filter((l) => l.participating).length}`],
  ];
  const winningCount = lots.filter(isWinning).length;
  if (winningCount > 0) scopes.push(["winning", `최고가 입찰 ${winningCount}`]);
  if (cut != null) scopes.push(["noOutliers", `£${Math.round(cut).toLocaleString()} 이하`]);

  return (
    <div className="page">
      <PageHead title="관심 목록">
        <button className="btn" disabled={busy} onClick={refresh}>
          <Icon name="refresh" size={16} />
          {busy ? "갱신 중" : "지금 갱신"}
        </button>
      </PageHead>
      {statusLine}
      <p className="sr-only" role="status">{announce}</p>
      {error && <div className="notice is-error" role="alert">{error}</div>}

      <div className="watch-layout">
        <section className="panel watch-compare" aria-labelledby="now-title">
          <div className="panel-head">
            <h2 id="now-title" className="section-title">지금 가격</h2>
            <div className="seg-control" role="group" aria-label="비교할 lot">
              {scopes.map(([k, label]) => (
                <button key={k} aria-pressed={scope === k} className={scope === k ? "on" : undefined} onClick={() => setScope(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length > 0 ? (
            <CompareBars lots={shown} selected={size === "wide" ? selected : null} onSelect={select} bids={bids} />
          ) : (
            <p className="hint">참여 중으로 표시한 lot이 없습니다. lot을 고른 뒤 "입찰 참여 중"을 켜세요.</p>
          )}
          {cut != null && scope === "all" && (
            <p className="hint">£{Math.round(cut).toLocaleString()}를 넘는 lot 때문에 나머지 막대가 짧게 보여요. "£{Math.round(cut).toLocaleString()} 이하"로 좁혀 보세요.</p>
          )}

          {basket && (
            <section className="basket" aria-labelledby="basket-title">
              <h2 id="basket-title" className="section-title">참여 중인 lot을 한 번에 받으면</h2>
              <div className="basket-figures">
                <div>
                  <span className="label">지금 가격 기준</span>
                  <span className="figure">{krw(basket.atCurrent.totalKrw)}</span>
                </div>
                <div>
                  <span className="label">내 최대 입찰가 기준</span>
                  <span className="figure is-quiet">{krw(basket.atMyMax.totalKrw)}</span>
                </div>
              </div>
              <ExemptNote r={basket.atCurrent} />
              <details className="disclosure">
                <summary>계산 내역</summary>
                <CalcBreakdown r={basket.atCurrent} hero={false} />
              </details>
            </section>
          )}
        </section>

        {size === "wide" && lot && (
          <section className="panel watch-detail" aria-label="고른 lot">
            <LotDetail lot={lot} overview={overview} onUpdate={update} onRemove={remove} headingLevel="h2" bid={lot.entityId != null ? bids.get(lot.entityId) : undefined} />
          </section>
        )}
      </div>

      {size !== "wide" && (
        <Sheet open={sheetOpen && !!lot} onClose={() => setSheetOpen(false)} title={lot?.title ?? ""}>
          {lot && <LotDetail lot={lot} overview={overview} onUpdate={update} onRemove={remove} headingLevel="none" bid={lot.entityId != null ? bids.get(lot.entityId) : undefined} />}
        </Sheet>
      )}
    </div>
  );
}
