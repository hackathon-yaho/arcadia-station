# ARCADIA // INCIDENT 72

아르카디아 스테이션 살인 사건을 조사하는 웹 기반 탑다운 2D 추리게임 프런트엔드입니다.

## 실행

요구 사항:

- Node.js 22 이상
- npm 11 이상

```bash
npm install
npm run dev
```

기본 개발 주소는 `http://127.0.0.1:5173`입니다.

검증:

```bash
npm run verify
npm run test:browser
```

실제 게임 백엔드를 상대로 전체 흐름을 확인하려면(백엔드가 떠 있어야 합니다):

```bash
VITE_LIVE_BACKEND=1 VITE_API_BASE_URL=http://localhost:8080/api npx vitest run src/api/httpApi.live.test.ts
```

## 조작

| 입력 | 동작 |
|---|---|
| `WASD` · 방향키 | 이동 |
| `E` | 오브젝트 조사·용의자 심문 |
| `Q` | 3초간 조사 대상 스캔 |
| `Tab` | 사건 수첩 |
| `Esc` | 현재 오버레이 닫기 |

시점 조작은 없습니다. 화면이 항상 플레이어를 따라오고, 조사할 수 있는 자리에 다가가면
화면 아래에 이름과 `E`가 뜹니다. 붉은 표식이 1일차 필수 기록입니다.
터치 환경에서는 화면 왼쪽 이동 패드와 조사·스캔·수첩 버튼이 표시됩니다.

## 현재 구현

- 태양풍 격리·사령관 사망 오프닝
- 탑다운 2D 이동과 벽 충돌 (3D 장면과 동일한 좌표·속도)
- 중앙 허브, 사령관실, 부사령관실과 직통 통로
- 의무실, 엔지니어링, 통신실, 화물·도킹, 식당·라운지, 승무원 숙소
- 구역별 바닥 색·출입구 표시, 지나온 구역만 남는 시야 제한
- 책상·크레이트·기둥 등 집기 충돌 (3D 콜라이더를 그대로 옮김)
- 사령관실 핵심 현장 오브젝트 조사
- 전문 구역의 D2 로그·실물 증거 조사
- 다섯 용의자 현장 배치와 1차 심문
- 심문·재판·수첩의 인물 일러스트 (상태별 연출 5종)
- 질문 선택, 증거 제시와 진술 기록
- 증거·타임라인·용의자·수사 보조·사건 재구성 수첩
- D1 완료 조건과 D2 심층 조사 전환
- 범인·수단·동기·흔적·비범인 배제 근거 구성
- 5단계 생존자 재판과 투표
- 정답, 입증 실패, 오답 추방, 재판 결렬 엔딩
- 새로고침 진행 복구와 새 사건 초기화
- 데스크톱·모바일 반응형 UI와 터치 조작
- 전역 오류 복구, 손상된 저장 데이터 자동 격리, API 오류별 재시도·정적 폴백
- 초기 화면 gzip 성능 예산 검사

## 정거장 배치와 일러스트

정거장의 벽·집기·바닥·조사 지점·승무원 좌표는 `src/data/stationMap.ts` 한 곳에 있습니다.
최초에는 3D 장면(`src/game/world/StationWorld.tsx`)에서 `scripts/extract-station.mjs`로
뽑아냈습니다. 그 스크립트는 JSX를 실제로 평가해서 좌표를 얻습니다 — 값이 `<group>` 중첩과
`.map()` 안에 숨어 있어 텍스트로는 읽을 수 없기 때문입니다. 3D가 제거된 지금부터는
`stationMap.ts`를 직접 고칩니다.

`src/data/stationMap.test.ts`가 배치를 지켜 줍니다. 규모와 게임 데이터 대응은 물론,
시작 지점에서 번져 나가며 **모든 구역·단서·승무원에 실제로 걸어서 닿는지**까지 확인합니다.
집기가 몸을 막기 때문에 좌표를 잘못 고치면 단서 하나가 책상에 갇혀 사건이 풀리지 않게 되는데,
그 사고는 화면을 열어 봐야만 드러나므로 테스트로 막습니다.

인물 초상 7장은 `public/assets/characters/*.webp`입니다. 원본 시트(`art/_sheet.png`)를
바꿨다면 다시 자릅니다(Pillow 필요):

```bash
py -3 scripts/slice-portraits.py
```

## 데이터 경계

기본값인 `VITE_API_MODE=mock`에서는 세션 생성부터 조사, 심문, 일차 종료, 수사 보조, 이론 저장과 판정까지 브라우저 내부 어댑터로 동작합니다. `VITE_API_MODE=http`로 바꾸면 같은 UI와 상태 흐름이 게임 백엔드의 `/api/v1` REST API를 사용합니다.

게임 백엔드 연결:

```bash
# 1. 게임 백엔드 (서버 8080 + PostgreSQL 5432)
cd ../backend && docker compose up -d --build

# 2. 프런트엔드
cp .env.example .env.local   # VITE_API_MODE=http 로 수정
npm run dev
```

백엔드 기본 프로필은 Fake AI 클라이언트라 AI 서버 없이도 전체 흐름이 동작합니다. 실제 AI 사건 생성을 쓰려면 AI 서버를 8081에 띄우고 백엔드를 `real-ai` 프로필로 실행합니다.

백엔드에 CORS 설정이 없어 브라우저가 8080을 직접 호출하면 차단됩니다. 개발에서는 `vite.config.ts`의 `/api` 프록시를 거칩니다.

프런트엔드 `ArcadiaApi`와 백엔드 계약은 모양이 다르며, `src/api/httpApi.ts`가 그 차이를 흡수합니다. UI와 Zustand 액션은 두 모드에서 동일합니다. 변환 규칙, 식별자 매핑, 알려진 제약은 [`API_INTEGRATION.md`](./docs/API_INTEGRATION.md)에 정리되어 있습니다.

프런트엔드는 운영 환경에서 범인 ID나 비공개 `CaseBible`을 받지 않습니다.

개발용 오류 화면은 URL의 `mockError`로 재현할 수 있습니다.

```text
?mockError=session
?mockError=inspect
?mockError=interrogation
?mockError=assistant
?mockError=day
?mockError=theory
?mockError=verdict
```

재판 폴백 사건은 `?mockCase=maya|junho|sophia|kasim|yuna`로 재현합니다. 이 선택 기능은 mock 모드에만 존재합니다.

## 주요 경로

```text
src/
├─ audio/
│  └─ AudioDirector.tsx    # 정거장 환경음
├─ data/
│  ├─ investigation.ts     # 공개 조사 데이터와 NPC 정적 대사
│  ├─ stationMap.ts        # 벽·집기·바닥·문·조사 지점·승무원 좌표
│  ├─ characters.ts        # 인물 7인과 초상 경로
│  └─ mockVerdict.ts       # 개발용 판정 어댑터
├─ domain/
│  ├─ movement.ts          # 이동·충돌·최근접 탐색 (화면 없이 검증 가능)
│  └─ theoryValidation.ts
├─ store/
│  └─ gameStore.ts         # 진행·수첩·재판 상태와 로컬 복구
└─ ui/
   ├─ StationCanvas.tsx    # 탑다운 렌더러와 게임 루프
   ├─ Portrait.tsx         # 인물 초상 (상태 5종)
   ├─ GameUI.tsx           # 오프닝, HUD, 조사, 심문, 수첩, 재판, 결과
   ├─ MobileControls.tsx   # 터치 이동·게임 액션
   └─ AppErrorBoundary.tsx
```

세계관과 구현 기준은 [`DEVELOPMENT_SPEC.md`](./docs/DEVELOPMENT_SPEC.md)를 따릅니다.
