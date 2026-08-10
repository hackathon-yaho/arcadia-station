# Arcadia Station — 로컬 실제 Gemini 연동

이 저장소는 프론트엔드(`frontend/`), 게임 백엔드(`backend/`), AI 서버(`ai-server/`)로
구성됩니다. 실제 Gemini 호출은 AI 서버만 수행하며, API 키는 절대로 Git이나 채팅에 올리지
않습니다.

## 1. AI 서버만 실제 Gemini로 실행

처음 한 번과 이후 실행 모두 아래 한 명령으로 시작합니다.

```powershell
cd <arcadia-station 경로>\ai-server
.\scripts\run-real-ai.cmd
```

첫 실행이면 화면에 보이지 않는 입력으로 Gemini API 키를 한 번 요청하고,
`ai-server/.env` 파일을 자동으로 만듭니다. 이후에는 같은 명령만 실행하면 됩니다.

`.env`는 `KEY=VALUE` 형태의 **내 컴퓨터 전용 설정 파일**입니다. 이 파일은
`ai-server/.gitignore`에 의해 Git에서 무시되므로 API 키를 로컬에만 보관하는 용도입니다.
키를 교체하려면 `ai-server/.env`의 `GEMINI_API_KEY=` 뒤 값만 바꾸면 됩니다.

서버가 시작된 터미널에는 다음처럼 실제 API 모드가 표시되어야 합니다.

```text
[AI-MODE] ... configuredMode=API selectedGateway=GEMINI externalAiEnabled=true ...
```

## 2. AI 서버 단독 실API 테스트

실제 Gemini로 사건과 단서를 생성하고, 결과를 검증한 뒤 서버를 자동 종료합니다.
AI 서버가 이미 8081에서 실행 중이면 먼저 `Ctrl+C`로 종료합니다.

```powershell
cd <arcadia-station 경로>\ai-server
.\scripts\test-ai-case-generation.cmd -Mode gemini
```

`.env`가 있으면 키 입력 없이 사용하며, 없으면 숨김 입력으로 키를 요청합니다.
성공 기준은 다음 세 줄입니다.

```text
[AI-API][SUCCESS] ... purpose=CASE_GENERATION ... httpStatus=200
[AI-CASE][RESULT] ... mode=API generationSource=AI fallbackReason=NONE
PASS: 실제 GEMINI API 호출과 AI 단서 생성을 확인했습니다.
```

## 3. 프론트엔드·백엔드·AI 전체 테스트

세 터미널을 따로 열어 아래 순서로 실행합니다. **아래 명령은 모두 Windows PowerShell
(`powershell.exe`) 전용입니다.** Git Bash·WSL·cmd.exe에 그대로 붙여넣으면 `$env:` 구문이
조용히 실패하거나(환경변수가 안 잡힌 채 다음 줄로 넘어감) 경로가 깨질 수 있으니 반드시
PowerShell 창을 새로 열어 실행합니다.

Docker Desktop이 먼저 실행되어 있어야 합니다. 트레이 아이콘이 뜬 직후에는 엔진이 아직
준비 중일 수 있으므로, 아래 명령이 성공(오류 없이 정보 출력)할 때까지 기다린 뒤 터미널 B로
넘어갑니다.

```powershell
docker info
```

### 터미널 A — AI 서버

```powershell
cd <arcadia-station 경로>\ai-server
.\scripts\run-real-ai.cmd
```

### 터미널 B — 백엔드 real-ai 프로필

```powershell
cd <arcadia-station 경로>\backend
docker compose `
  -f docker-compose.yml `
  -f compose.real-ai.yml `
  up -d --build --force-recreate
```

### 터미널 C — 프론트엔드 HTTP 모드

환경변수는 셸에 인라인으로 넘기지 말고 `frontend/.env.local` 파일에 적습니다. 인라인으로
넘기면 셸(특히 Git Bash)에 따라 `/api`처럼 `/`로 시작하는 값이 엉뚱한 경로로 바뀌어 프론트가
"게임 서버와 통신하지 못했습니다" 오류를 내는 경우가 있었습니다. `.env.local`은 Vite가
파일로 직접 읽으므로 이 문제가 없습니다.

`frontend/.env.local` 파일을 만들고(이미 있으면 아래 세 줄로 덮어씁니다) 다음 내용을 넣습니다.

```text
VITE_API_MODE=http
VITE_API_BASE_URL=/api
VITE_API_PROXY_TARGET=http://127.0.0.1:8080
```

그다음 실행합니다.

```powershell
cd <arcadia-station 경로>\frontend
npm.cmd install
npm.cmd run dev
```

콘솔에 찍히는 실제 주소를 확인합니다(보통 `http://127.0.0.1:5173`) — 5173 포트가 이미
사용 중이면 Vite가 자동으로 5174 등으로 올라가므로, 브라우저는 항상 터미널 C 로그에 찍힌
URL로 접속합니다. `LOCAL-*` 세션 ID가 보이면 아직 mock 모드이므로 `frontend/.env.local`의
`VITE_API_MODE=http` 설정을 다시 확인합니다.

## 4. 실제 Gemini 호출 확인법

AI 서버를 실행한 **터미널 A**의 로그가 기준입니다.

새 게임을 시작하면 백엔드가 곧바로 `202 VALIDATING`을 반환하고, 실제 사건 생성은 뒤에서
비동기로 진행됩니다(실제 Gemini 호출이라 수십 초~2분 걸릴 수 있습니다). 이 동안 화면이
멈춘 것처럼 보여도 오류가 아니니, 터미널 A에 `purpose=CASE_GENERATION`과 함께
`[AI-API][SUCCESS]`가 찍힐 때까지 기다립니다.

또한 AI 서버는 사건·심문 세션을 메모리에만 저장하므로, AI 서버를 재시작하면 그 이전에
만든 사건은 사라집니다. 백엔드 DB에는 세션 기록이 남아 브라우저가 예전 세션을 계속
불러오려 하지만, 그 세션으로 심문을 시도하면 "지금은 대답할 수 없습니다" 같은 폴백
문구가 뜹니다 — 버그가 아니라 방어 로직입니다. 서버를 새로 켠 뒤에는 이전 세션을 잇지
말고 항상 새 게임으로 시작해서 확인합니다.

| 플레이 동작 | 호출 여부 | 성공 로그 |
|---|---|---|
| 새 게임 시작 | Gemini 1회 | `purpose=CASE_GENERATION` + `httpStatus=200` |
| 오브젝트 조사 | Gemini 호출 없음 | 기존 사건의 동결 단서 반환 |
| NPC 창 처음 열기 | Gemini 호출 없음 | 프론트의 정적 첫 대사 |
| 추천 질문·직접 질문·단서 제시 | 질문마다 Gemini 1회 | `purpose=NPC_TURN` + `httpStatus=200` |

질문이 실제 Gemini 응답으로 처리됐는지는 아래 두 로그가 연속으로 나오면 확인됩니다.

```text
[AI-API][REQUEST] ... purpose=NPC_TURN ...
[AI-API][SUCCESS] ... purpose=NPC_TURN ... httpStatus=200
```

`[AI-CASE][RESULT] ... mode=FALLBACK` 또는 `[AI-API][FAILURE]`가 보이면 해당 결과는
실제 AI 생성 결과를 사용하지 못하고 안전한 fallback으로 전환된 것입니다.

## 5. 종료

- AI 서버: 터미널 A에서 `Ctrl+C`
- 백엔드: `cd backend` 후 위와 동일한 `-f` 옵션을 사용해 `docker compose down`
- 프론트엔드: 터미널 C에서 `Ctrl+C`

세부 AI 계약과 API 형식은 [ai-server/README.md](ai-server/README.md),
[backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md)를 참고합니다.
