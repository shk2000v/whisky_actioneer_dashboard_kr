# Whisky Tracker

Whisky Auctioneer 경매 lot을 조건별로 수집하고, watchlist 가격을 polling해 그래프로 보여주며, 한국 배송 시 총비용(관세·주세·교육세·부가세)을 계산하는 macOS용 Tauri 데스크톱 앱입니다.

## 버전

| 구성 | 버전 |
|---|---|
| Tauri | 2.x (`tauri` crate 2, `@tauri-apps/cli` 2.12.4, `@tauri-apps/api` 2.12.4, `tauri-plugin-opener` 2) |
| Rust | 2021 edition, 개발 시 rustc 1.97.0에서 확인 |
| HTTP / HTML / DB | reqwest 0.12 (rustls), scraper 0.29, rusqlite 0.37 (SQLite 번들) |
| 프론트엔드 | React 19.3, TypeScript 5.9, Vite 8.3, 차트는 직접 그린 SVG/CSS (라이브러리 없음) |
| 폰트 | Pretendard 1.3.9 (UI), Fraunces 가변 서체의 SOFT 축 (가격 숫자), 둘 다 앱에 포함 |
| Node | 22.x에서 확인 |

## Mac 앱 만들기

```bash
unzip whisky-tracker.zip && cd whisky-tracker
./build-mac.sh            # Whisky Tracker.app + .dmg 생성 (이 Mac의 CPU용)
./build-mac.sh --install  # 위와 같고, /Applications 에도 복사
```

- 필요한 것: Xcode Command Line Tools, Rust, Node.js 20 이상. 스크립트가 확인하고, 없으면 설치 방법을 안내합니다 (Rust는 확인 후 rustup으로 설치).
- 결과: `target/release/bundle/macos/Whisky Tracker.app`, `target/release/bundle/dmg/*.dmg`
- 처음 빌드는 5~10분, 이후는 1~2분.
- dmg를 만들 때 "터미널이 Finder를 제어하려고 합니다" 창이 뜨면 허용하세요. 거부해도 .app은 만들어집니다.
- 직접 빌드한 앱은 인터넷에서 받은 파일이 아니라서 "확인되지 않은 개발자" 경고가 뜨지 않습니다. 다른 Mac에 dmg를 옮겨 열 때는 경고가 뜨며, Finder에서 앱을 우클릭 → 열기로 한 번 허용하면 됩니다.
- GitHub에 올려 둘 경우 `.github/workflows/build-mac.yml`로 Actions에서 Apple Silicon/Intel용 dmg를 만들 수 있습니다 (Actions 탭 → build-mac → Run workflow).

개발 중 실행: `npm install` 후 `npm run tauri dev`

## 연결 확인 (가장 먼저 실행)

개발 환경의 웹 수집 도구로는 목록 페이지가 차단됐고, 실제 Chrome에서는 정상 응답했습니다. Mac에서 reqwest 요청이 통과하는지는 아직 확인되지 않았으므로 앱 실행 전에 아래로 확인하세요.

```bash
cargo run -p wa-core --bin wa-cli -- auctions      # 경매 목록 + 진행 중 경매/마감 시각
cargo run -p wa-core --bin wa-cli -- search "https://whiskyauctioneer.com/whisky-auctions/october-2026-auction/lots?search_keyword=old&items_per_page=32"
cargo run -p wa-core --bin wa-cli -- price 5000108 5320418
cargo run -p wa-core --bin wa-cli -- fx
cargo run -p wa-core --bin wa-cli -- calc 20 20     # £20 두 병 합산 배송
```

`요청 실패 (HTTP 403)`이 나오면 앱 설정의 User-Agent를 일반 브라우저 값으로 바꿔 다시 시도하세요. 그래도 막히면 수집 방식을 바꿔야 하므로 오류 메시지를 알려주세요.

## 기능

| 탭 | 내용 |
|---|---|
| 관심 목록 | **지금 가격**: lot별 현재가 가로 막대(0 기준 공통 축, 가격순), 내 최대 입찰가·reserve 표시, 고가 lot 제외 필터. **선택한 lot**: 가격 흐름 계단 그래프(오른쪽 빈 구간 = 마감까지 남은 시간), 같은 상품의 경매별 마지막 입찰가 막대, 단독 배송 비용. **참여 lot 합산 배송** 비용(현재가 기준 / 내 최대 입찰가 기준) |
| 검색 | 진행 중 경매가 기본 대상, 지난 경매도 선택 가능. 키워드·정렬·페이지 크기·필터(Size, Lot Location, Age, ABV, Region 등 사이트 facet API 그대로). 사이트 URL을 붙여넣어 조건 채우기 |
| 프리셋 | 조건을 이름 붙여 저장. "항상 진행 중인 경매에 적용" 옵션. 처음 1회는 모든 페이지를 수집해 lot 번호를 저장하고, 이후에는 저장된 목록을 즉시 표시. "다시 수집" / "가격만 갱신" 분리 |
| 배송비 계산기 | 항상 사용 가능. 품목 여러 개, 수수료·배송비·카드·FTA·$150 판정 방식 조정. 환율은 하루 1회 자동 갱신, 수동 갱신·수동 입력 가능 |
| 설정 | polling 모드(자동/고정/실시간), 요청 간격, User-Agent, 계산 기본값 |

## 경매 마감 시각과 시간 기준

- Whisky Auctioneer FAQ: 월간 경매는 **영국 현지 시간 19:00부터** 마감되고, 19:00 이후 어느 lot에든 입찰이 들어오면 **경매 전체가 2분 연장**되며, 2분간 입찰이 없으면 끝납니다. 보통 영국 시간 21~23시 사이에 끝납니다.
- 앱은 사이트 데이터의 종료 시각(`drupalSettings.auction.activeAuctions`, October 2026은 11/2 23:25 GMT, 의미 미확인)이 속한 날의 **19:00 영국 시간**을 공식 마감 시작으로 계산합니다 (`wa-core/src/ukclock.rs`, GMT/BST 전환 포함). October 2026 기준 한국 시간 11월 3일(화) 04:00.
- 상단 경매 정보에서 공식 마감까지 초 단위로 카운트다운합니다. 19:00이 지나면 "연장 진행 중"으로 바뀝니다.
- 시간 기준: 기본은 한국 시간(Asia/Seoul). 경매 정보 옆 작은 **한국 / 영국** 버튼이나 설정 화면에서 영국 시간(Europe/London, 옥셔니어 기준)으로 바꿀 수 있고, 마감 시각·그래프·조회 시각에 모두 적용됩니다. 선택은 기기에 저장됩니다.
- polling의 마감 임박 구간(기본 2시간 전부터 2분 간격)도 19:00 영국 시간 기준이며, 연장이 이어지는 동안 계속 빠르게 확인합니다.

## 창 크기별 화면

`src/layout.tsx`의 `useSize()`와 `src/styles.css`의 미디어 쿼리가 같은 기준을 씁니다. 창 최소 크기는 360×560입니다.

| 구간 | 창 너비 | 내비게이션 | 관심 목록 | 검색 결과 |
|---|---|---|---|---|
| wide | 1024px 이상 | 상단 바 안의 탭 | 막대 비교 + 상세 2단 | 표 (모든 열) |
| pad | 640–1023px | 상단 바 아래 탭 줄 | 막대 비교 1단, 상세는 오른쪽 시트 | 표 (용량·위치·입찰은 상품 칸으로 합침), 필터는 시트 |
| compact | 640px 미만 | 하단 탭 바 | 상품명 위·막대 아래, 상세는 아래쪽 시트 | 카드 목록, 필터는 시트 |

## 접근성 점검 (WCAG 2.2 AA)

- 자동 검사: axe-core 4.14를 3개 창 크기 × 라이트/다크 × 전 화면 + 열린 시트에 실행해 위반 0건 (wcag2a/2aa/21aa/22aa + best-practice).
- 재배치(1.4.10): 320px 너비에서 모든 화면에 가로 스크롤이 생기지 않음을 확인.
- 대비: 본문·보조 글자 4.5:1 이상, 입력 테두리·포커스 표시 3:1 이상 (값은 `styles.css` 상단 주석).
- 키보드: 시트는 `<dialog>`로 열려 포커스가 안에 갇히고, Esc로 닫으면 연 버튼으로 돌아감. 화면 전환 시 제목(h1)으로 포커스 이동. 가격 그래프는 화살표 키로 기록을 하나씩 읽고, 같은 내용을 표로도 제공.
- 터치 영역: compact에서 모든 버튼·입력 44px 이상, 그 외 40px.
- `prefers-reduced-motion`에서 시트 애니메이션 끔, `forced-colors`에서 선택 상태 윤곽선 표시.
- 카운트다운은 `role="timer"`(aria-live off)라 스크린리더가 매초 읽지 않고, 읽을 때는 분 단위로 읽습니다.
- 한국/영국 버튼은 보이는 크기 34×20px이지만 누르는 영역은 34×32px이고, `aria-pressed`로 선택 상태를 알립니다. 같은 설정을 설정 화면의 라디오 버튼으로도 바꿀 수 있습니다.
- 아직 안 한 것: VoiceOver로 직접 읽어 보는 확인.

## 사이트 연동 방식 (2026-10-28 실제 사이트에서 확인)

| 용도 | 엔드포인트 | 비고 |
|---|---|---|
| 경매 목록 | `GET /whisky-auctions` | `/whisky-auctions/{slug}/lots` 링크 수집 |
| 진행 중 경매·마감 시각 | 모든 페이지의 `drupalSettings.auction` | `activeAuctions: {auction_id: 마감 unix}`, `isRunning`, `refreshApp: 240` |
| lot 목록 | `GET /whisky-auctions/{slug}/lots?search_keyword=&size[6]=6&store[1]=1&sort_bef_combine=&items_per_page=&page=` | `.lot-teaser` 카드, `.bid-app-main[data-entity-id, data-auction-id, data-reserve]` |
| 현재가 | `GET /api/lot/{auction_id}/{entity_id}` | 로그인 불필요. `currentBid.amount`, `numberOfBidsPlaced`, `nextProxyBidAmount` (펜스 단위) |
| 필터 옵션 | `GET /api/facets?view_name=lots_index&view_display_id=lots_page&view_args={auction_id}` | size 6=70cl·7=75cl·8=100cl, store 1=UK·4=EU 등. size/store/age/lots_abv/region/unique_attributes 파라미터가 결과를 거르는 것 확인 |
| 환율 | `GET https://open.er-api.com/v6/latest/GBP` | 하루 1회 갱신되는 무료 API |

- **실시간:** 사이트에 WebSocket 등 푸시가 없습니다. 사이트 자체 입찰 위젯도 로그인 사용자 대상으로 240초(상세 페이지 120초)마다 `/api/lot`을 다시 부릅니다. 앱의 실시간 모드는 최소 10초 간격 polling입니다.
- **Reserve:** `data-reserve` 값을 펜스로 해석해 표시합니다(0 = reserve 없음). 근거는 같은 응답의 `nextProxyBidAmount: 2000`이 시작가 £20과 일치한다는 점이며, 사이트가 이 의미를 공식 문서로 밝힌 것은 아닙니다.
- **지난 경매:** 로그인하지 않으면 낙찰가가 표시되지 않습니다("Log in or register to access hammer price"). 지난 경매 검색 결과에는 가격이 없습니다.
- **요청 간격:** robots.txt `Crawl-delay: 10`에 맞춰 목록·필터 요청은 최소 10초 간격입니다. `/api/lot`은 사이트 페이지가 화면의 lot 수만큼(32개 페이지에서 32회) 한 번에 호출하는 것을 확인했고, 앱은 기본 0.5초 간격으로 순차 호출합니다.
- **로그인 기능:** 1차 버전에서 제외했습니다. 내가 입찰한 lot은 watchlist에서 "참여"로 표시해 계산합니다.

## 한국 배송 비용 계산식

`wa-core/src/tax.rs`에 있으며 단위 테스트로 이전 계산 결과와 대조했습니다.

- 물품가격 = 낙찰가 × (1 + 수수료 12.5%)
- 면세 판정: **1병 · 1L 이하 · 물품가격 $150 이하**일 때만 관세·부가세 면제(주세·교육세는 부과). 2병 이상이면 금액과 무관하게 전액 과세
- 과세가격(CIF) = 물품가격 + 배송비(기본 $50, 실제 견적과 다를 수 있음)
- 관세 20%(한-영 FTA 원산지 증명 시 0%), 주세 = (CIF + 관세) × 72%, 교육세 = 주세 × 30%, 부가세 = (CIF + 관세 + 주세 + 교육세) × 10%
- 카드 결제 시 (물품가격 + 배송비) × 3.5%
- 검증값: £50·수수료 15%·$50·환율 1781.69/1.3233 → 328,669원 (2026-10-05 계산기와 일치), £20 두 병·12.5%·$50·1769.18/1.3347 → 372,822원

## 구조

```
wa-core/            Rust 라이브러리 (UI 없이 테스트 가능)
  src/parse.rs      목록 HTML, drupalSettings, /api/lot, /api/facets 파서
  src/client.rs     reqwest 클라이언트 + 요청 간격 제한
  src/db.rs         SQLite: lots, price_snapshots, watchlist, presets, preset_lots(조건별 lot 키 캐시), auctions
  src/service.rs    검색·프리셋·watchlist·polling·환율·계산 서비스
  src/poll.rs       polling 주기 계산
  src/tax.rs        한국 수입 비용 계산
  src/rpc.rs        UI가 부르는 명령 전체 (나중에 웹 서버를 붙여도 그대로 재사용)
  src/poller.rs     백그라운드 갱신 루프
  src/bin/wa-cli.rs 연결 확인용 CLI
  tests/            HTML 고정 데이터 + 로컬 mock 서버 통합 테스트
src-tauri/          Tauri 2 셸: `rpc` 명령 하나 + 백그라운드 poller 이벤트
src/                React UI (layout.tsx: 창 크기 구간, 시트)
```

가격 스냅샷은 값이 바뀌었을 때, 또는 마지막 기록 후 1시간이 지났을 때만 저장해 DB가 커지지 않게 했습니다.

## 테스트

```bash
cargo test -p wa-core     # 파서, 쿼리, 세금 계산, polling 주기, DB, mock 서버 통합 흐름
npm run build             # 타입 체크 + 프론트 빌드
```

## 출처

- Whisky Auctioneer robots.txt: https://whiskyauctioneer.com/robots.txt
- Whisky Auctioneer Buyer Fees: https://whiskyauctioneer.com/buy-whisky/fees-and-payment-terms
- 엔드포인트·필드: 2026-10-28 Chrome에서 October 2026 Auction 페이지의 DOM, `drupalSettings`, 네트워크 요청, 사이트 JS(`/api/lot`, `/api/bids`, `/api/facets`, `refreshApp`)를 직접 확인
- 환율: https://open.er-api.com/v6/latest/GBP
- 직구 주류 면세 기준: https://www.taxwatch.co.kr/article/tax/2024/03/25/0002
