import { useEffect, useState } from "react";
import { api, errMsg, PAGE_SIZES, SORT_OPTIONS, type AuctionOverview, type Facets, type FilterQuery, type LotView, type SearchResult } from "../api";
import { AuctionSelect } from "../components/AuctionSelect";
import { FacetPanel } from "../components/FacetPanel";
import { Icon } from "../components/Icon";
import { LotTable } from "../components/LotTable";
import { PageHead } from "../components/PageHead";
import { Sheet, useSize } from "../layout";

export function useToggleWatch(setLots: (f: (l: LotView[]) => LotView[]) => void, onError: (m: string) => void) {
  return async (lot: LotView) => {
    try {
      if (lot.watched) await api.watchRemove(lot.sku);
      else await api.watchAdd(lot.sku);
      setLots((ls) => ls.map((x) => (x.sku === lot.sku ? { ...x, watched: !lot.watched } : x)));
    } catch (e) {
      onError(errMsg(e));
    }
  };
}

export function SearchPage({ overview, onPresetSaved }: { overview: AuctionOverview | null; onPresetSaved: () => void }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("computed_current_bid_ASC");
  const [perPage, setPerPage] = useState(32);
  const [facetSel, setFacetSel] = useState<Record<string, string[]>>({});
  const [facets, setFacets] = useState<Facets | null>(null);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [lots, setLots] = useState<LotView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetFollow, setPresetFollow] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const size = useSize();

  const query: FilterQuery = { keyword: keyword || null, facets: facetSel, sort, itemsPerPage: perPage };
  const qKey = JSON.stringify([slug, query]);

  useEffect(() => {
    if (!overview) return;
    const t = setTimeout(() => {
      api.facets(slug, query).then(setFacets).catch((e) => setError(errMsg(e)));
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey, overview?.active?.slug]);

  const run = async (p = 0) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.search(slug, query, p);
      setResult(r);
      setLots(r.lots);
      setPage(p);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const applyUrl = async () => {
    try {
      const { slug: s, query: q } = await api.parseUrl(urlInput);
      setSlug(overview?.active?.slug === s ? null : s);
      setKeyword(q.keyword ?? "");
      setSort(q.sort ?? "relevance_DESC");
      setPerPage(q.itemsPerPage ?? 32);
      setFacetSel(q.facets ?? {});
      setUrlInput("");
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const savePreset = async () => {
    try {
      const p = await api.savePreset(null, presetName, presetFollow ? null : slug ?? overview?.active?.slug ?? null, query);
      setPresetName("");
      setSaved(`"${p.name}" 프리셋을 저장했습니다.`);
      onPresetSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const toggleWatch = useToggleWatch(setLots, setError);
  const activeFilters = Object.values(facetSel).reduce((a, v) => a + v.length, 0);
  const filters = (
    <>
          <FacetPanel facets={facets} value={facetSel} onChange={setFacetSel} />
          <details className="disclosure">
            <summary>사이트 주소로 조건 채우기</summary>
            <input aria-label="Whisky Auctioneer 목록 주소" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="whiskyauctioneer.com/whisky-auctions/…/lots?…" />
            <button className="btn" disabled={!urlInput} onClick={applyUrl}>조건 채우기</button>
          </details>
          <details className="disclosure">
            <summary>이 조건을 프리셋으로 저장</summary>
            <input aria-label="프리셋 이름" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="프리셋 이름" />
            <label className="check">
              <input type="checkbox" checked={presetFollow} onChange={(e) => setPresetFollow(e.target.checked)} />
              매달 진행 중인 경매에 적용
            </label>
            <button className="btn" disabled={!presetName.trim()} onClick={savePreset}>프리셋 저장</button>
          </details>
    </>
  );
  const totalPages = result?.totalRows ? Math.ceil(result.totalRows / result.perPage) : null;

  return (
    <div className="page">
      <PageHead title="검색" />
      <form
          className="searchbar" role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void run(0);
          }}
        >
          <AuctionSelect overview={overview} value={slug} onChange={setSlug} />
          <input type="search" aria-label="키워드" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="키워드, 예: Macallan 18" />
          <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select aria-label="페이지당 개수" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}개씩</option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={busy}>{busy ? "불러오는 중" : "검색"}</button>
          {size !== "wide" && (
            <button type="button" className="btn" onClick={() => setFiltersOpen(true)}>
              <Icon name="filter" size={16} />
              필터{activeFilters > 0 ? ` ${activeFilters}` : ""}
            </button>
          )}
        </form>
      {error && <div className="notice is-error" role="alert">{error}</div>}
      {saved && <div className="notice is-ok" role="status">{saved}</div>}

      <div className="split">
        {size === "wide" && (
          <aside className="filters" aria-label="필터">
            {filters}
          </aside>
        )}
        <section className="results">
          {result && (
            <div className="results-head">
              <span>
                <b>{result.totalRows?.toLocaleString() ?? "?"}</b>건 중 {page + 1}
                {totalPages ? `/${totalPages}` : ""} 페이지
                {!result.isActive && <span className="hint"> 지난 경매는 가격이 공개되지 않습니다</span>}
              </span>
              <span className="pager">
                <button className="btn" disabled={busy || page === 0} onClick={() => run(page - 1)}>이전</button>
                <button className="btn" disabled={busy || (totalPages != null && page + 1 >= totalPages) || lots.length < result.perPage} onClick={() => run(page + 1)}>다음</button>
              </span>
            </div>
          )}
          <LotTable
            lots={lots}
            onToggleWatch={toggleWatch}
            emptyText={result ? "조건에 맞는 lot이 없습니다. 필터를 줄여 보세요." : "조건을 정하고 검색하세요. 사이트 부담을 줄이려고 목록 요청은 10초 간격으로 보냅니다."}
          />
        </section>
      </div>
      {size !== "wide" && (
        <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="필터">
          <div className="filters in-sheet">{filters}</div>
          <div className="sheet-foot">
            <button className="btn btn-primary" onClick={() => { setFiltersOpen(false); void run(0); }}>
              {facets ? `${facets.total.toLocaleString()}건 보기` : "적용"}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
