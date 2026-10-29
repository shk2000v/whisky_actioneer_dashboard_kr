import { useState } from "react";
import type { Facet, Facets } from "../api";

const PRIMARY = ["size", "store", "age", "lots_abv", "region", "unique_attributes", "production_type", "maturation"];
const LABELS: Record<string, string> = {
  size: "용량",
  store: "보관 위치",
  age: "숙성 연수",
  lots_abv: "도수",
  region: "지역",
  unique_attributes: "특징",
  production_type: "종류",
  maturation: "숙성 캐스크",
  distillery: "증류소",
  brand: "브랜드",
  bottler: "병입자",
  series: "시리즈",
  item_type: "기념품",
  lot_type: "VAT 구분",
};

function FacetGroup({ f, selected, onToggle }: { f: Facet; selected: string[]; onToggle: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const opts = f.options.filter((o) => !filter || o.label.toLowerCase().includes(filter.toLowerCase()));
  return (
    <details className="facet" open={selected.length > 0 || ["size", "store"].includes(f.key)}>
      <summary>
        {LABELS[f.key] ?? f.label}
        {selected.length > 0 && <span className="facet-count">{selected.length}</span>}
      </summary>
      {f.options.length > 12 && <input className="facet-filter" aria-label={`${f.label} 찾기`} placeholder="찾기" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="facet-options">
        {opts.map((o) => (
          <label key={o.id}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} />
            <span>{o.label}</span>
            <span className="facet-n">{o.count.toLocaleString()}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

export function FacetPanel({ facets, value, onChange }: { facets: Facets | null; value: Record<string, string[]>; onChange: (v: Record<string, string[]>) => void }) {
  if (!facets) return <p className="hint">필터 옵션을 불러오는 중입니다.</p>;
  const sorted = [...facets.facets].sort((a, b) => {
    const ia = PRIMARY.indexOf(a.key);
    const ib = PRIMARY.indexOf(b.key);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.label.localeCompare(b.label);
  });
  const toggle = (key: string, id: string) => {
    const cur = value[key] ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    const out = { ...value, [key]: next };
    if (next.length === 0) delete out[key];
    onChange(out);
  };
  const active = Object.values(value).reduce((a, v) => a + v.length, 0);
  return (
    <div className="facets">
      <p className="facets-total">
        <b>{facets.total.toLocaleString()}</b>건 해당
        {active > 0 && <button className="link-btn" onClick={() => onChange({})}>필터 {active}개 지우기</button>}
      </p>
      {sorted.map((f) => (
        <FacetGroup key={f.key} f={f} selected={value[f.key] ?? []} onToggle={(id) => toggle(f.key, id)} />
      ))}
    </div>
  );
}
