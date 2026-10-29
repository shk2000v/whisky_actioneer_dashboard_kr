import { useEffect, useState } from "react";
import { api, errMsg, SORT_OPTIONS, type AuctionOverview, type LotView, type Preset, type PresetResult } from "../api";
import { AuctionSelect } from "../components/AuctionSelect";
import { Icon } from "../components/Icon";
import { LotTable } from "../components/LotTable";
import { PageHead } from "../components/PageHead";
import { Sheet, useSize } from "../layout";
import { dateTime } from "../format";
import { useToggleWatch } from "./Search";

// Facet ids observed on /api/facets (2026-10-28). Unknown ids fall back to "key id".
const FACET_NAMES: Record<string, Record<string, string>> = {
  size: { "1": "5cl 이하", "2": "6-19cl", "3": "20cl", "4": "35cl", "5": "50cl", "6": "70cl", "7": "75cl", "8": "100cl", "9": "150cl 이상" },
  store: { "1": "UK", "4": "EU" },
  age: { "0": "10년 미만", "10": "10-19년", "20": "20-29년", "30": "30-39년", "40": "40년 이상" },
  lots_abv: { "40": "40-46%", "46": "46-50%", "50": "50% 초과" },
};

function conditions(p: Preset): string[] {
  const q = p.query;
  const out: string[] = [];
  if (q.keyword) out.push(`"${q.keyword}"`);
  for (const [k, ids] of Object.entries(q.facets ?? {})) {
    const names = FACET_NAMES[k];
    out.push(names ? ids.map((id) => names[id] ?? `${k} ${id}`).join(", ") : `${k} ${ids.join(", ")}`);
  }
  const sort = SORT_OPTIONS.find(([v]) => v === q.sort)?.[1];
  if (sort) out.push(sort);
  return out.length ? out : ["조건 없음"];
}

export function PresetsPage({ overview, reloadKey }: { overview: AuctionOverview | null; reloadKey: number }) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [result, setResult] = useState<PresetResult | null>(null);
  const [lots, setLots] = useState<LotView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newFollow, setNewFollow] = useState(true);
  const [textFilter, setTextFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const size = useSize();

  const load = () => api.presets().then(setPresets).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    void load();
  }, [reloadKey]);

  const collect = async (id: number, s: string | null) => {
    setBusy("사이트에서 모든 페이지를 수집하는 중입니다. 페이지마다 10초씩 걸립니다.");
    try {
      const r = await api.runPreset(id, s, true);
      setResult(r);
      setLots(r.lots);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const open = async (id: number, s: string | null) => {
    setCurrent(id);
    setError(null);
    try {
      const r = await api.presetCached(id, s);
      setResult(r);
      setLots(r.lots);
      if (!r.run) await collect(id, s);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const refreshPrices = async () => {
    setBusy("가격을 갱신하는 중입니다.");
    try {
      setLots(await api.refreshPrices(lots.map((l) => l.sku)));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const addFromUrl = async () => {
    try {
      const p = await api.presetFromUrl(newName, newUrl, newFollow);
      setNewName("");
      setNewUrl("");
      await load();
      setCreating(false);
      void open(p.id, null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const remove = async (id: number) => {
    await api.deletePreset(id).catch((e) => setError(errMsg(e)));
    if (current === id) {
      setCurrent(null);
      setResult(null);
      setLots([]);
    }
    void load();
  };

  const toggleWatch = useToggleWatch(setLots, setError);
  const createForm = (
    <div className="stack-form">
            <input aria-label="프리셋 이름" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="프리셋 이름" />
            <input aria-label="Whisky Auctioneer 목록 주소" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="whiskyauctioneer.com/whisky-auctions/…/lots?…" />
            <label className="check">
              <input type="checkbox" checked={newFollow} onChange={(e) => setNewFollow(e.target.checked)} />
              매달 진행 중인 경매에 적용
            </label>
            <button className="btn" disabled={!newName.trim() || !newUrl.trim()} onClick={addFromUrl}>프리셋 만들기</button>
    </div>
  );
  const preset = presets.find((p) => p.id === current) ?? null;
  const q = textFilter.toLowerCase();
  const shown = q ? lots.filter((l) => `${l.title} ${l.subtitle ?? ""} ${l.sku}`.toLowerCase().includes(q)) : lots;

  return (
    <div className="page">
      <PageHead title="프리셋">
        {size !== "wide" && (
          <button className="btn" onClick={() => setCreating(true)}>
            새 프리셋
          </button>
        )}
      </PageHead>
      {error && <div className="notice is-error" role="alert">{error}</div>}

      <div className="split">
        {size !== "wide" && (
          <ul className="preset-chips" aria-label="프리셋">
            {presets.map((p) => (
              <li key={p.id}>
                <button className={`chip${p.id === current ? " is-active" : ""}`} aria-pressed={p.id === current} onClick={() => open(p.id, slug)}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {size === "wide" && (
        <aside className="filters" aria-label="프리셋 목록">
          <ul className="preset-list">
            {presets.map((p) => (
              <li key={p.id} className={p.id === current ? "is-active" : undefined}>
                <button className="preset-open" onClick={() => open(p.id, slug)}>
                  <span className="preset-name">{p.name}</span>
                  <span className="preset-scope">{p.auctionSlug ? p.auctionSlug : "매달 진행 중인 경매"}</span>
                  <span className="preset-conds">
                    {conditions(p).map((c) => (
                      <span key={c} className="tag">{c}</span>
                    ))}
                  </span>
                </button>
                <button className="icon-btn" aria-label={`${p.name} 삭제`} onClick={() => remove(p.id)}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          <details className="disclosure" open={presets.length === 0}>
            <summary>사이트 주소로 프리셋 만들기</summary>
            {createForm}
          </details>
        </aside>
        )}
        <section className="results">
          {preset ? (
            <>
              <div className="results-toolbar">
                <AuctionSelect
                  overview={overview}
                  value={slug}
                  onChange={(s) => {
                    setSlug(s);
                    void open(preset.id, s);
                  }}
                />
                <input type="search" className="grow" aria-label="결과 안에서 찾기" placeholder="결과 안에서 찾기" value={textFilter} onChange={(e) => setTextFilter(e.target.value)} />
                <button className="btn" disabled={!!busy || !result?.isActive} onClick={refreshPrices}>가격만 갱신</button>
                <button className="btn btn-primary" disabled={!!busy} onClick={() => collect(preset.id, slug)}>다시 수집</button>
                <button className="btn btn-quiet" onClick={() => remove(preset.id)}>삭제</button>
              </div>
              <div className="results-head" role="status">
                <span>
                  {busy ??
                    (result?.run ? (
                      <>
                        <b>{lots.length}</b>건 저장됨, 사이트 기준 {result.run.totalRows ?? "?"}건
                        {!result.run.complete && ", 최대 페이지 수에서 멈춤"}. 마지막 수집 {dateTime(result.run.ranAt)}
                      </>
                    ) : null)}
                </span>
              </div>
              <LotTable lots={shown} onToggleWatch={toggleWatch} />
            </>
          ) : (
            <div className="empty-state">
              <p>{size === "wide" ? "왼쪽에서" : "위에서"} 프리셋을 고르세요.</p>
              <p className="hint">처음 열 때 한 번 사이트에서 전체 페이지를 수집하고, 그다음부터는 저장해 둔 lot 목록을 바로 보여줍니다.</p>
            </div>
          )}
        </section>
      </div>
      {size !== "wide" && (
        <Sheet open={creating} onClose={() => setCreating(false)} title="새 프리셋">
          <p className="hint">Whisky Auctioneer 경매 목록에서 필터를 고른 뒤 주소창의 URL을 붙여 넣으세요.</p>
          {createForm}
        </Sheet>
      )}
    </div>
  );
}
