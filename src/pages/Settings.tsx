import { useEffect, useState } from "react";
import { PageHead } from "../components/PageHead";
import { setZone, useZone, ZONES, type Zone } from "../time";
import { api, errMsg, type PollMode, type Settings } from "../api";

const DEFAULT_MODES: Record<PollMode["mode"], PollMode> = {
  adaptive: { mode: "adaptive", normalMinutes: 30, finalWindowMinutes: 120, finalMinutes: 2 },
  fixed: { mode: "fixed", minutes: 10 },
  realtime: { mode: "realtime", seconds: 15 },
};

function ZoneSetting() {
  const zone = useZone();
  return (
    <section>
      <h2 className="section-title">시간 표시 기준</h2>
      <fieldset className="radios">
        <legend className="sr-only">시간 표시 기준</legend>
        {(Object.keys(ZONES) as Zone[]).map((z) => (
          <label key={z} className="check">
            <input type="radio" name="zone" checked={zone === z} onChange={() => setZone(z)} />
            {ZONES[z].long}
            {z === "kst" && " (기본)"}
          </label>
        ))}
      </fieldset>
      <p className="hint">마감 시각, 그래프, 조회 시각에 모두 적용되고 바로 저장됩니다. 상단 경매 정보의 작은 한국·영국 버튼과 같은 설정입니다.</p>
    </section>
  );
}

export function SettingsPage({ onSaved }: { onSaved: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then(setS).catch((e) => setError(errMsg(e)));
  }, []);

  if (!s) return <p className="muted">{error ?? "불러오는 중…"}</p>;
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const p = s.poll;
  const setPoll = (poll: PollMode) => setS({ ...s, poll });
  const tax = s.tax;

  const save = async () => {
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      setMsg("설정을 저장했습니다. 허용 범위를 벗어난 값은 가장 가까운 값으로 맞췄습니다.");
      setError(null);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="page settings">
      <PageHead title="설정" />
      {error && <div className="notice is-error" role="alert">{error}</div>}
      {msg && <div className="notice is-ok" role="status">{msg}</div>}
      <ZoneSetting />
      <section>
        <h2 className="section-title">관심 목록 가격 갱신</h2>
        <div className="form-grid">
        <fieldset className="radios full">
          <legend className="sr-only">갱신 방식</legend>
          {(["adaptive", "fixed", "realtime"] as const).map((m) => (
            <label key={m} className="check">
              <input type="radio" checked={p.mode === m} onChange={() => setPoll(DEFAULT_MODES[m])} />
              {m === "adaptive" ? "자동: 평소엔 느리게, 마감이 가까우면 빠르게" : m === "fixed" ? "고정 간격" : "실시간에 가깝게 (짧은 간격)"}
            </label>
          ))}
        </fieldset>
        {p.mode === "adaptive" && (
          <>
            <label className="field"><span>평소 간격 (분)</span><input type="number" min={1} value={p.normalMinutes} onChange={(e) => setPoll({ ...p, normalMinutes: num(e.target.value) })} /></label>
            <label className="field"><span>마감 전 구간 (분)</span><input type="number" min={1} value={p.finalWindowMinutes} onChange={(e) => setPoll({ ...p, finalWindowMinutes: num(e.target.value) })} /></label>
            <label className="field"><span>마감 구간 간격 (분)</span><input type="number" min={1} value={p.finalMinutes} onChange={(e) => setPoll({ ...p, finalMinutes: num(e.target.value) })} /></label>
          </>
        )}
        {p.mode === "fixed" && (
          <label className="field"><span>간격 (분)</span><input type="number" min={1} value={p.minutes} onChange={(e) => setPoll({ ...p, minutes: num(e.target.value) })} /></label>
        )}
        {p.mode === "realtime" && (
          <label className="field"><span>간격 (초, 최소 10)</span><input type="number" min={10} value={p.seconds} onChange={(e) => setPoll({ ...p, seconds: num(e.target.value) })} /></label>
        )}
        <p className="hint full">
          사이트는 가격을 밀어 주지 않습니다. 사이트 자체 입찰 화면도 240초(상세 페이지는 120초)마다 다시 물어보며, 실시간 모드는 이 확인을 더 자주 하는 방식입니다.
        </p>
        </div>
      </section>

      <section>
        <h2 className="section-title">요청 간격</h2>
        <div className="form-grid">
        <label className="field"><span>목록과 필터 요청 간격 (초, 최소 10)</span><input type="number" min={10} step={1} value={s.pageGapSecs} onChange={(e) => setS({ ...s, pageGapSecs: num(e.target.value) })} /></label>
        <label className="field"><span>가격 API 요청 간격 (초)</span><input type="number" min={0.2} step={0.1} value={s.apiGapSecs} onChange={(e) => setS({ ...s, apiGapSecs: num(e.target.value) })} /></label>
        <label className="field"><span>프리셋 1회 최대 페이지</span><input type="number" min={1} max={200} value={s.maxPagesPerRun} onChange={(e) => setS({ ...s, maxPagesPerRun: num(e.target.value) })} /></label>
        <label className="check"><input type="checkbox" checked={s.pricesOnSearch} onChange={(e) => setS({ ...s, pricesOnSearch: e.target.checked })} /> 검색 직후 가격 조회 (진행 중 경매만)</label>
        <label className="field full"><span>User-Agent</span><input value={s.userAgent} onChange={(e) => setS({ ...s, userAgent: e.target.value })} /></label>
        <p className="hint full">robots.txt의 Crawl-delay가 10초라 목록 요청은 10초보다 짧게 할 수 없습니다.</p>
        </div>
      </section>

      <section>
        <h2 className="section-title">한국 배송 계산 기본값</h2>
        <div className="form-grid">
        <label className="field"><span>구매 수수료 %</span><input type="number" step={0.5} value={+(tax.commissionRate * 100).toFixed(2)} onChange={(e) => setS({ ...s, tax: { ...tax, commissionRate: num(e.target.value) / 100 } })} /></label>
        <label className="field"><span>DHL 배송비 $</span><input type="number" step={1} value={tax.shippingUsd} onChange={(e) => setS({ ...s, tax: { ...tax, shippingUsd: num(e.target.value) } })} /></label>
        <label className="field"><span>면세 한도 $</span><input type="number" step={1} value={tax.usdLimit} onChange={(e) => setS({ ...s, tax: { ...tax, usdLimit: num(e.target.value) } })} /></label>
        <label className="field"><span>카드 수수료 %</span><input type="number" step={0.1} value={+(tax.cardRate * 100).toFixed(2)} onChange={(e) => setS({ ...s, tax: { ...tax, cardRate: num(e.target.value) / 100 } })} /></label>
        <label className="check"><input type="checkbox" checked={tax.cardSurcharge} onChange={(e) => setS({ ...s, tax: { ...tax, cardSurcharge: e.target.checked } })} /> 한국 카드 결제</label>
        <label className="check"><input type="checkbox" checked={tax.fta} onChange={(e) => setS({ ...s, tax: { ...tax, fta: e.target.checked } })} /> 한-영 FTA 관세 0%</label>
        <label className="check"><input type="checkbox" checked={tax.includeShippingInLimit} onChange={(e) => setS({ ...s, tax: { ...tax, includeShippingInLimit: e.target.checked } })} /> $150 판정에 배송비 포함</label>
        <p className="hint full">세율은 관세 {tax.dutyRate * 100}%, 주세 {tax.liquorRate * 100}%, 교육세는 주세의 {tax.eduRate * 100}%, 부가세 {tax.vatRate * 100}%입니다.</p>
        </div>
      </section>
      <div className="settings-save"><button className="btn btn-primary" onClick={save}>설정 저장</button></div>
    </div>
  );
}
