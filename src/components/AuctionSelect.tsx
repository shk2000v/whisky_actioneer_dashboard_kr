import type { AuctionOverview } from "../api";

/** `null` = follow the running auction. */
export function AuctionSelect({
  overview,
  value,
  onChange,
  allowFollow = true,
}: {
  overview: AuctionOverview | null;
  value: string | null;
  onChange: (slug: string | null) => void;
  allowFollow?: boolean;
}) {
  const active = overview?.active?.isRunning ? overview.active : null;
  const past = (overview?.auctions ?? []).filter((a) => a.hasLots && a.slug !== active?.slug);
  return (
    <select aria-label="경매" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
      {allowFollow && <option value="">{active ? `진행 중: ${active.title}` : "진행 중인 경매 없음"}</option>}
      {!allowFollow && active && <option value={active.slug}>진행 중: {active.title}</option>}
      <optgroup label="지난 경매 (낙찰가는 로그인 필요)">
        {past.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.title}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
