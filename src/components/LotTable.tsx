import type { LotView } from "../api";
import { ExternalLink } from "./ExternalLink";
import { gbp, reserveState, timeAgo } from "../format";
import { useSize } from "../layout";
import { Icon } from "./Icon";

interface Props {
  lots: LotView[];
  onToggleWatch?: (lot: LotView) => void;
  emptyText?: string;
}

/** Images that cannot load (offline, or blocked by the host) fall back to the plain placeholder box. */
export function hideBroken(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
}

function PriceCell({ l }: { l: LotView }) {
  if (l.price && l.price.currentBidPence === 0 && l.price.nextBidPence) {
    return (
      <>
        <span className="figure-sm is-quiet">{gbp(l.price.nextBidPence)}</span>
        <span className="cell-sub">시작가</span>
      </>
    );
  }
  return (
    <>
      <span className="figure-sm">{l.price ? gbp(l.price.currentBidPence) : l.entityId ? "미조회" : "-"}</span>
      {l.price && <span className="cell-sub">{timeAgo(l.price.fetchedAt)} 조회</span>}
    </>
  );
}

function WatchButton({ l, onToggle }: { l: LotView; onToggle: (l: LotView) => void }) {
  return (
    <button
      className={`icon-btn star${l.watched ? " on" : ""}`}
      aria-pressed={l.watched}
      aria-label={`${l.title} 관심 목록${l.watched ? "에서 빼기" : "에 추가"}`}
      onClick={() => onToggle(l)}
    >
      <Icon name="star" filled={l.watched} />
    </button>
  );
}

function OpenButton({ l }: { l: LotView }) {
  return (
    <ExternalLink href={l.url} className="icon-btn" label={`${l.title} Whisky Auctioneer에서 열기 (새 창)`}>
      <Icon name="external" />
    </ExternalLink>
  );
}

function Meta({ l, withSize }: { l: LotView; withSize?: boolean }) {
  return (
    <span className="lot-meta">
      <span>#{l.sku}</span>
      {withSize && l.size && <span>{l.size}</span>}
      {withSize && l.abv && <span>{l.abv}</span>}
      {withSize && l.location && <span>{l.location}</span>}
      {l.subtitle && <span>{l.subtitle}</span>}
      {l.bottled && <span>{l.bottled}</span>}
      {l.attributes.map((a) => (
        <span key={a} className="pill">{a}</span>
      ))}
    </span>
  );
}

/** Results: a table on wide/pad windows, cards on compact windows. */
export function LotTable({ lots, onToggleWatch, emptyText }: Props) {
  const size = useSize();
  if (lots.length === 0) return <p className="empty">{emptyText ?? "조건에 맞는 lot이 없습니다."}</p>;

  if (size === "compact") {
    return (
      <ul className="lot-cards">
        {lots.map((l) => {
          const r = reserveState(l);
          return (
            <li key={l.sku} className="lot-card">
              {l.image ? <img src={l.image} alt="" className="lot-thumb" loading="lazy" onError={hideBroken} /> : <span className="lot-thumb" aria-hidden="true" />}
              <div className="lot-card-main">
                <h2 className="lot-title">{l.title}</h2>
                <Meta l={l} withSize />
                <div className="lot-card-price">
                  {l.price && l.price.currentBidPence === 0 && l.price.nextBidPence ? (
                    <span className="figure-sm is-quiet">{gbp(l.price.nextBidPence)} <small>시작가</small></span>
                  ) : (
                    <span className="figure-sm">{l.price ? gbp(l.price.currentBidPence) : l.entityId ? "미조회" : "-"}</span>
                  )}
                  <span className="lot-meta">
                    <span className={`reserve-${r.tone}`}>reserve {r.label}</span>
                    {l.price && <span>입찰 {l.price.bids}회</span>}
                    {l.price && <span>{timeAgo(l.price.fetchedAt)} 조회</span>}
                  </span>
                </div>
              </div>
              <div className="lot-card-actions">
                {onToggleWatch && <WatchButton l={l} onToggle={onToggleWatch} />}
                <OpenButton l={l} />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const wide = size === "wide";
  return (
    <div className="table-wrap">
      <table className="lots">
        <thead>
          <tr>
            {onToggleWatch && <th scope="col" className="c-icon"><span className="sr-only">관심</span></th>}
            <th scope="col" className="c-img"><span className="sr-only">사진</span></th>
            <th scope="col">상품</th>
            {wide && <th scope="col">용량</th>}
            {wide && <th scope="col">위치</th>}
            <th scope="col">Reserve</th>
            <th scope="col" className="num">현재가</th>
            {wide && <th scope="col" className="num">입찰</th>}
            <th scope="col" className="c-icon"><span className="sr-only">사이트에서 열기</span></th>
          </tr>
        </thead>
        <tbody>
          {lots.map((l) => {
            const r = reserveState(l);
            return (
              <tr key={l.sku}>
                {onToggleWatch && (
                  <td className="c-icon">
                    <WatchButton l={l} onToggle={onToggleWatch} />
                  </td>
                )}
                <td className="c-img">{l.image ? <img src={l.image} alt="" loading="lazy" onError={hideBroken} /> : <span className="noimg" />}</td>
                <td>
                  <span className="lot-title">{l.title}</span>
                  <Meta l={l} withSize={!wide} />
                </td>
                {wide && (
                  <td className="nowrap">
                    {l.size ?? "-"}
                    {l.abv && <span className="cell-sub">{l.abv}</span>}
                  </td>
                )}
                {wide && <td>{l.location ?? "-"}</td>}
                <td className={`nowrap reserve-${r.tone}`}>{r.label}</td>
                <td className="num nowrap">
                  <PriceCell l={l} />
                </td>
                {wide && <td className="num">{l.price ? `${l.price.bids}회` : "-"}</td>}
                <td className="c-icon">
                  <OpenButton l={l} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
