import { useEffect, useRef, useState } from "react";
import { PageHead } from "../components/PageHead";
import { setZone, useZone, ZONES, type Zone } from "../time";
import { listen } from "@tauri-apps/api/event";
import { api, errMsg, isTauri, type AccountSync, type PollMode, type Settings } from "../api";
import { dateTime, gbp } from "../format";

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

/** Site login: the site's own login page opens in an app window; the app never sees the password. */
function AccountSetting({ onSynced }: { onSynced: () => void }) {
  const [acc, setAcc] = useState<AccountSync | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // App re-renders every second (countdown), so the callback identity changes; keep listeners stable.
  const synced = useRef(onSynced);
  synced.current = onSynced;

  useEffect(() => {
    if (!isTauri()) return;
    api.account().then(setAcc).catch(() => {});
    const un = [
      listen<AccountSync | null>("account", (e) => {
        setAcc(e.payload);
        setBusy(false);
        setError(null);
        synced.current();
      }),
      listen<string>("account-error", (e) => {
        setError(e.payload);
        setBusy(false);
      }),
      listen("account-syncing", () => {
        setError(null);
        setBusy(true);
      }),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isTauri()) {
    return (
      <section>
        <h2 className="section-title">Whisky Auctioneer 계정</h2>
        <p className="hint">사이트 로그인은 데스크톱 앱에서만 됩니다.</p>
      </section>
    );
  }

  const winning = acc?.bids.filter((b) => b.winning).length ?? 0;
  return (
    <section aria-busy={busy}>
      <h2 className="section-title">Whisky Auctioneer 계정</h2>
      {error && <div className="notice is-error" role="alert">{error}</div>}
      {busy && <p className="hint" role="status">사이트에서 내 입찰과 관심 목록을 읽는 중입니다. 처음에는 lot 정보 페이지를 10초 간격으로 읽어서 1분 정도 걸릴 수 있습니다.</p>}
      {acc ? (
        <>
          <p>
            <b>{acc.account.name || `회원 ${acc.account.uid}`}</b> 로그인됨. 진행 중 입찰 {acc.bids.length}건(최고가 {winning}건), 사이트 관심 목록 {acc.bookmarks}건을 관심 목록에 넣었습니다.
          </p>
          {acc.bids.length > 0 && (
            <ul className="hint">
              {acc.bids.map((b) => (
                <li key={b.entityId}>
                  lot {b.entityId}: 내 입찰 {gbp(b.bidPence)}, 최대 {gbp(b.maxPence)} · {b.winning ? "최고가" : "추월당함"}
                  {b.winning && !b.metReserve && " · reserve 미달"}
                </li>
              ))}
            </ul>
          )}
          {acc.missing.length > 0 && (
            <p className="hint">상품 정보를 찾지 못한 lot {acc.missing.length}건({acc.missing.join(", ")})은 관심 목록에 넣지 못했습니다. 검색이나 프리셋으로 한 번 수집하면 다음 동기화 때 들어갑니다.</p>
          )}
          <p className="hint">최고가인 입찰은 「참여」로 표시하고, 입찰한 lot에는 사이트의 최대 입찰가를 「내 최대가」로 넣어 관심 목록에서 한국 도착 비용이 바로 계산됩니다. 마지막 동기화 {dateTime(acc.syncedAt)}.</p>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { setAcc(await api.syncAccount()); synced.current(); })}>다시 불러오기</button>
            <button className="btn btn-quiet" disabled={busy} onClick={() => run(async () => { await api.logout(); setAcc(null); })}>로그아웃</button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">사이트 로그인 창이 열립니다. 비밀번호는 그 창(사이트)에 직접 입력하며 앱은 비밀번호를 받거나 저장하지 않습니다. 로그인하면 진행 중 입찰과 사이트 관심 목록을 읽기만 합니다. 입찰이나 관심 목록 변경은 하지 않습니다.</p>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy} onClick={() => run(api.loginOpen)}>로그인</button>
          </div>
        </>
      )}
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
      <AccountSetting onSynced={onSaved} />
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
