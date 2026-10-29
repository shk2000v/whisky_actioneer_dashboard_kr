import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { api, canRun, errMsg, isDemo, isTauri, type AuctionOverview, type FxRecord, type PollerStatus } from "./api";
import { Icon, type IconName } from "./components/Icon";
import { countdownClock, countdownParts, dateTimeWeekday } from "./format";
import { useSize } from "./layout";
import { dateTimeShort, hourMinute, setZone, useZone, zoneAbbr, ZONES, type Zone } from "./time";
import { CalculatorPage } from "./pages/Calculator";
import { PresetsPage } from "./pages/Presets";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { WatchlistPage } from "./pages/Watchlist";

type Tab = "watch" | "search" | "presets" | "calc" | "settings";
const NAV: [Tab, string, IconName][] = [
  ["watch", "관심 목록", "glass"],
  ["search", "검색", "search"],
  ["presets", "프리셋", "bookmark"],
  ["calc", "배송비", "calc"],
  ["settings", "설정", "settings"],
];

/** Re-render every `ms` (only the component that uses it). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    // Align ticks to the start of each second so the clock never skips a digit.
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now() / 1000);
      t = setTimeout(tick, ms - (Date.now() % ms));
    };
    t = setTimeout(tick, ms - (Date.now() % ms));
    return () => clearTimeout(t);
  }, [ms]);
  return now;
}

/** Tiny two-option switch for the display time zone. Hit area is taller than it looks (see .zone-toggle). */
function ZoneToggle() {
  const zone = useZone();
  return (
    <span className="zone-toggle" role="group" aria-label="시간 기준">
      {(Object.keys(ZONES) as Zone[]).map((z) => (
        <button key={z} type="button" aria-pressed={zone === z} title={ZONES[z].long} onClick={() => setZone(z)}>
          {ZONES[z].label}
        </button>
      ))}
    </span>
  );
}

function AuctionChip({ overview, onRefresh }: { overview: AuctionOverview | null; onRefresh: () => void }) {
  const now = useNow(1000);
  const zone = useZone();
  const a = overview?.active;
  // Official close (19:00 UK). After it, bids extend the whole auction by 2 minutes each.
  const close = a ? a.closeUnix ?? a.endUnix : 0;
  const before = !!a?.isRunning && close > now;
  const extending = !!a?.isRunning && close <= now;
  const c = a ? countdownParts(close, now) : null;
  const urgent = before && close - now < 3600;
  const name = a ? a.title.replace(/ Auction$/, "") : "";
  const abbr = a ? zoneAbbr(close, zone) : "";
  return (
    <div className={`auction-chip${before || extending ? " is-live" : ""}${urgent || extending ? " is-urgent" : ""}`}>
      <span className="live-dot" aria-hidden="true" />
      {before && c ? (
        <span className="auction-chip-text">
          <span className="auction-chip-title">{name}</span>
          <span className="countdown" role="timer" aria-label={`${name} 마감까지 ${c.d > 0 ? `${c.d}일 ` : ""}${c.h}시간 ${c.m}분`}>
            {countdownClock(close, now)}
          </span>
          <span className="auction-chip-end">
            <span>
              {dateTimeWeekday(close)} 마감 <abbr title={ZONES[zone].long}>{abbr}</abbr>
            </span>
            <ZoneToggle />
          </span>
        </span>
      ) : extending ? (
        <span className="auction-chip-text">
          <span className="auction-chip-title">{name}</span>
          <span className="countdown is-text">연장 진행 중</span>
          <span className="auction-chip-end">
            <span title="19:00(영국) 이후 입찰이 들어오면 경매 전체가 2분씩 연장되고, 2분간 입찰이 없으면 끝납니다.">
              {hourMinute(close)} {abbr}부터 입찰마다 2분 연장
            </span>
            <ZoneToggle />
          </span>
        </span>
      ) : (
        <span className="auction-chip-text">
          <span className="auction-chip-title">{a ? `${name} 마감됨` : "진행 중인 경매 없음"}</span>
        </span>
      )}
      <button className="icon-btn" aria-label="경매 정보 새로고침" onClick={onRefresh}>
        <Icon name="refresh" size={16} />
      </button>
    </div>
  );
}

/** Web test build only: says plainly that the data is a fixed snapshot. */
function DemoNote() {
  const at = window.__WT_SNAPSHOT__?.capturedAt;
  return (
    <p className="demo-note" role="note">
      <b>웹 테스트판</b>
      <span>
        {at ? `${dateTimeShort(at)}에 받아 둔 실제 데이터` : "받아 둔 실제 데이터"}로 동작합니다. 가격은 자동으로 갱신되지 않습니다. 관심 목록에는 처음에 예시로 5개를 담아 두었고, 바꾼 내용은 이 브라우저에만 저장됩니다.
      </span>
    </p>
  );
}

export default function App() {
  const size = useSize();
  // Re-render every page when the display time zone changes.
  useZone();
  const [tab, setTab] = useState<Tab>("watch");
  const [overview, setOverview] = useState<AuctionOverview | null>(null);
  const [fx, setFx] = useState<FxRecord | null>(null);
  const [poller, setPoller] = useState<PollerStatus | null>(null);
  const [watchKey, setWatchKey] = useState(0);
  const [presetKey, setPresetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!canRun()) return;
    api.overview(false).then(setOverview).catch((e) => setError(errMsg(e)));
    api.fx(false).then(setFx).catch(() => {});
    if (!isTauri()) return;
    const unsubs = [
      listen<AuctionOverview>("overview-updated", (e) => setOverview(e.payload)),
      listen<FxRecord>("fx-updated", (e) => setFx(e.payload)),
      listen<PollerStatus>("poller-status", (e) => setPoller(e.payload)),
      listen("watchlist-updated", () => setWatchKey((k) => k + 1)),
    ];
    return () => {
      unsubs.forEach((u) => u.then((f) => f()));
    };
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    // Move focus to the new page heading so screen readers announce the change.
    requestAnimationFrame(() => mainRef.current?.querySelector<HTMLElement>("h1")?.focus());
  };

  if (!canRun()) {
    return (
      <main className="standalone">
        <h1>Whisky Tracker</h1>
        <p>이 화면은 데스크톱 앱 안에서 동작합니다. 터미널에서 <code>npm run tauri dev</code>로 실행하세요.</p>
      </main>
    );
  }

  const refreshOverview = () => api.overview(true).then(setOverview).catch((e) => setError(errMsg(e)));
  const nav = (
    <nav className={size === "compact" ? "tabbar" : "tabs"} aria-label="화면 이동">
      {NAV.map(([k, label, icon]) => (
        <button key={k} className={tab === k ? "is-active" : undefined} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>
          <Icon name={icon} size={size === "compact" ? 22 : 18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );

  const status = { fx, poller };

  return (
    <div className={`app size-${size}`}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.querySelector<HTMLElement>("h1")?.focus(); }}>
        본문으로 건너뛰기
      </a>
      <header className="topbar">
        <span className="wordmark">Whisky Tracker</span>
        {size === "wide" && nav}
        <AuctionChip overview={overview} onRefresh={refreshOverview} />
      </header>
      {size === "pad" && nav}
      <main id="main" ref={mainRef} className="content">
        {isDemo() && <DemoNote />}
        {error && (
          <div className="notice is-error" role="alert">
            <span>{error}</span>
            <button className="icon-btn" aria-label="오류 메시지 닫기" onClick={() => setError(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {tab === "watch" && <WatchlistPage overview={overview} reloadKey={watchKey} status={status} />}
        {tab === "search" && <SearchPage overview={overview} onPresetSaved={() => setPresetKey((k) => k + 1)} />}
        {tab === "presets" && <PresetsPage overview={overview} reloadKey={presetKey} />}
        {tab === "calc" && <CalculatorPage fx={fx} onFx={setFx} />}
        {tab === "settings" && <SettingsPage onSaved={() => setWatchKey((k) => k + 1)} />}
      </main>
      {size === "compact" && nav}
    </div>
  );
}
