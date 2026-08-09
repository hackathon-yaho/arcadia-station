export type EvidenceKind = "PHYSICAL" | "DIGITAL" | "MOTIVE" | "WORLD";
export type TargetKind = EvidenceKind | "PERSON";

export type InvestigationObject = {
  id: string;
  zone: "HB" | "CO" | "XO" | "MD" | "EN" | "CM" | "CG" | "CMN" | "QT";
  title: string;
  eyebrow: string;
  kind: TargetKind;
  summary: string;
  detail: string;
  observation: string;
  evidenceLabel: string;
  required: boolean;
};

export const INVESTIGATION_OBJECTS: Record<string, InvestigationObject> = {
  CO_BODY: {
    id: "CO_BODY",
    zone: "CO",
    title: "다니엘 로스",
    eyebrow: "현장 관찰 // 피해자",
    kind: "PHYSICAL",
    summary: "사령관은 집무 책상과 환경 제어 패널 사이에 쓰러져 있다.",
    detail:
      "외부 손상만으로 사인을 확정할 수 없다. 오른손은 환경 제어 패널을 향하고 있으며, 소매 안쪽에 미세한 회색 잔류물이 남아 있다.",
    observation: "시신 원시 스캔과 주변 흔적의 교차 확인이 필요하다.",
    evidenceLabel: "피해자 현장 소견",
    required: true,
  },
  CO_DOOR_LOG: {
    id: "CO_DOOR_LOG",
    zone: "CO",
    title: "사령관실 출입 버퍼",
    eyebrow: "접근 통제 // 로컬 기록",
    kind: "DIGITAL",
    summary: "중앙 허브 방향 출입문의 로컬 카드 태그 기록이다.",
    detail:
      "통신실의 중앙 보안 로그와 독립된 문 로컬 버퍼가 남아 있다. 마지막 정상 인증 이후 한 구간의 타임스탬프가 비정상적으로 재정렬돼 있다.",
    observation: "중앙 로그와 비교하면 수정 여부를 확인할 수 있다.",
    evidenceLabel: "사령관실 로컬 출입 기록",
    required: true,
  },
  CO_XO_PASSAGE: {
    id: "CO_XO_PASSAGE",
    zone: "CO",
    title: "지휘부 직통 통로",
    eyebrow: "공간 구조 // 무기록 동선",
    kind: "WORLD",
    summary: "부사령관 집무실로 직접 연결되는 짧은 지휘부 전용 통로다.",
    detail:
      "이 통로에는 카드 리더가 없다. 정상적인 구조상 마야 헨드릭스만 이 동선을 사용할 수 있으며, 통과 자체는 출입 기록에 남지 않는다.",
    observation: "무기록 접근 가능성과 실제 사용 여부는 별개의 문제다.",
    evidenceLabel: "지휘부 직통 통로 구조",
    required: false,
  },
  CO_ENV_PANEL: {
    id: "CO_ENV_PANEL",
    zone: "CO",
    title: "독립 환경 제어 패널",
    eyebrow: "환경 제어 // 원시 로그",
    kind: "DIGITAL",
    summary: "사령관실은 정거장 주 계통과 분리된 환경 제어 장치를 갖고 있다.",
    detail:
      "산소 농도, 기압, 온도 변화가 로컬 저장 장치에 기록된다. 현재 화면에는 D-0 야간의 센서 샘플이 잠금 보존 상태로 남아 있다.",
    observation: "심층 분석은 D2에 독립 센서와 정비 로그를 함께 비교한다.",
    evidenceLabel: "사령관실 환경 원시 로그",
    required: true,
  },
  CO_TERMINAL: {
    id: "CO_TERMINAL",
    zone: "CO",
    title: "사령관 개인 단말",
    eyebrow: "감사 자료 // 전송 대기",
    kind: "MOTIVE",
    summary: "로스가 작성 중이던 정거장 감사 보고서 초안이 열려 있다.",
    detail:
      "다섯 부서 모두 검토 대상으로 표시돼 있다. 본문 일부는 잠겨 있지만, 격리 종료 직후 본사 전송이 예정되어 있었다는 메타데이터를 확인할 수 있다.",
    observation: "각 용의자가 숨기는 비밀은 살인 동기와 동일하지 않을 수 있다.",
    evidenceLabel: "감사 보고서 전송 메타데이터",
    required: true,
  },
  CO_SCANNER: {
    id: "CO_SCANNER",
    zone: "CO",
    title: "현장 스캔 스테이션",
    eyebrow: "보안 장비 // 원본 보존",
    kind: "PHYSICAL",
    summary: "현장과 시신의 기초 스캔을 수행하는 보안용 이동 장비다.",
    detail:
      "의료관의 해석과 별개로 측정 원시값을 보존한다. 현재는 표면 잔류물과 체온 저하 데이터만 확보된 상태다.",
    observation: "D2에 의료 단말의 검시 해석과 원시값을 비교할 수 있다.",
    evidenceLabel: "현장 스캔 원시 데이터",
    required: false,
  },
  HB_MAINTENANCE: {
    id: "HB_MAINTENANCE",
    zone: "HB",
    title: "중앙 허브 유지보수 패널",
    eyebrow: "환경 제어 // 물리 접근",
    kind: "WORLD",
    summary: "정비 권한이 없어도 패널 자체에는 물리적으로 접근할 수 있다.",
    detail:
      "치명 계통의 디지털 접근은 제한되지만, 현장 조작이나 인증 도용 가능성까지 배제할 수는 없다.",
    observation: "권한 부재만으로 용의자를 제외해서는 안 된다.",
    evidenceLabel: "비상 접근 프로토콜 구조",
    required: false,
  },
  XO_RESOURCE_BOARD: {
    id: "XO_RESOURCE_BOARD",
    zone: "XO",
    title: "자원 할당 현황판",
    eyebrow: "부사령관실 // 운영 기록",
    kind: "MOTIVE",
    summary: "축소 운영 이후의 자원 배분 변경 내역이 표시돼 있다.",
    detail:
      "승인자 서명 일부와 실제 배분량 사이에 반복적인 오차가 있다. 감사 보고서의 지휘부 항목과 연결될 가능성이 있다.",
    observation: "비위의 존재는 살인 실행을 직접 증명하지 않는다.",
    evidenceLabel: "자원 할당 불일치",
    required: false,
  },
  MD_MEDICAL_TERMINAL: {
    id: "MD_MEDICAL_TERMINAL",
    zone: "MD",
    title: "의료 원시 기록 단말",
    eyebrow: "의무실 // 원본 대조",
    kind: "DIGITAL",
    summary: "의료관의 검시 해석과 수정 불가능한 현장 스캔 원시값을 함께 조회한다.",
    detail:
      "해석 보고서에는 사후 수정 이력이 있지만 생체 측정값과 표면 잔류물 스펙트럼은 최초 캡처 상태로 보존되어 있다.",
    observation: "해석과 원본의 불일치는 은폐 가능성을 보여주지만 범인을 단독 확정하지 않는다.",
    evidenceLabel: "검시 해석·원시 데이터 대조",
    required: false,
  },
  MD_MEDICAL_STORAGE: {
    id: "MD_MEDICAL_STORAGE",
    zone: "MD",
    title: "약품고 반출 장치",
    eyebrow: "의무실 // 의료 재고",
    kind: "PHYSICAL",
    summary: "진정제·수면유도제·마취제의 실물 재고와 반출 기록을 대조한다.",
    detail:
      "전산 수량과 봉인된 실물 수량 사이에 한 건의 차이가 있다. 수정 이력의 작성자는 소피아 계정으로 표시된다.",
    observation: "약품 누락 시점과 피해자의 원시 스캔 성분을 함께 비교해야 한다.",
    evidenceLabel: "약품 실물·반출 기록 불일치",
    required: false,
  },
  EN_LIFE_SUPPORT: {
    id: "EN_LIFE_SUPPORT",
    zone: "EN",
    title: "생명유지 정비 단말",
    eyebrow: "엔지니어링 // 정비 원본",
    kind: "DIGITAL",
    summary: "D-0 야간 생명유지 진단 주기와 환경 제어 작업 서명을 확인한다.",
    detail:
      "정기 점검으로 분류된 작업 하나가 사령관실 로컬 센서의 변화 직전 실행됐다. 작업 범위와 실제 환경 변화는 일치하지 않는다.",
    observation: "정비 서명, 실행 위치와 물리 패널 상태를 함께 검증해야 한다.",
    evidenceLabel: "D-0 생명유지 정비 원본",
    required: false,
  },
  CM_SECURITY_ARCHIVE: {
    id: "CM_SECURITY_ARCHIVE",
    zone: "CM",
    title: "보안 로그 물리 저장 장치",
    eyebrow: "통신실 // 변경 불가 원본",
    kind: "DIGITAL",
    summary: "중앙 보안 로그의 수정 전 이벤트 블록이 물리 카트리지에 남아 있다.",
    detail:
      "사령관실 문 로컬 버퍼와 중앙 로그 사이에서 동일한 재정렬 패턴이 발견된다. 복구 작업인지 의도적 은폐인지 추가 검증이 필요하다.",
    observation: "카심의 수정 권한은 기회지만 수정된 내용의 방향이 더 중요하다.",
    evidenceLabel: "보안 로그 수정 전 원본",
    required: false,
  },
  CG_AIRLOCK_LOG: {
    id: "CG_AIRLOCK_LOG",
    zone: "CG",
    title: "에어록 로컬 안전 로그",
    eyebrow: "화물·도킹 // 압력 기록",
    kind: "DIGITAL",
    summary: "에어록과 화물 리프트의 D-0 야간 로컬 안전 이벤트를 조회한다.",
    detail:
      "치명적인 감압이나 하역 장비 충돌 이벤트는 기록되지 않았다. 화물 시스템의 살상 수단이 실제 사용됐는지를 배제하는 자료다.",
    observation: "가능한 수단과 실제 실행된 수단을 구분할 수 있다.",
    evidenceLabel: "에어록·중장비 안전 로그",
    required: false,
  },
  CG_CARGO_MANIFEST: {
    id: "CG_CARGO_MANIFEST",
    zone: "CG",
    title: "봉인 해제된 광물 상자",
    eyebrow: "화물·도킹 // 실물 재고",
    kind: "MOTIVE",
    summary: "정식 화물 목록에서 누락된 채굴 광물 표본이 숨겨져 있다.",
    detail:
      "상자 봉인 번호는 유나의 개인 작업 기록과 연결된다. 불법 반출은 증명하지만 사령관실의 살인 실행 흔적과는 직접 연결되지 않는다.",
    observation: "실제 비밀이 반드시 살인의 직접 증거는 아니다.",
    evidenceLabel: "불법 광물 반출 실물",
    required: false,
  },
  CMN_FOOD_STATION: {
    id: "CMN_FOOD_STATION",
    zone: "CMN",
    title: "식음료 배급 장치",
    eyebrow: "공용 모듈 // 무기록 구역",
    kind: "PHYSICAL",
    summary: "정거장에서 경구 투여 경로가 열려 있는 유일한 설비다.",
    detail:
      "자동 출입 기록이나 녹화 장치는 없으며, 마지막 배급 시각도 개인 인증과 연결되지 않는다. 표면 샘플 채취가 필요하다.",
    observation: "공용 구역의 사건은 디지털 기록보다 복수 진술이 중요하다.",
    evidenceLabel: "식음료 배급 설비 표면 샘플",
    required: false,
  },
  QT_ACCESS_BUFFER: {
    id: "QT_ACCESS_BUFFER",
    zone: "QT",
    title: "숙소 출입 로컬 버퍼",
    eyebrow: "승무원 숙소 // 야간 동선",
    kind: "DIGITAL",
    summary: "개인실 6개의 D-0 야간 출입 이벤트를 시간순으로 비교한다.",
    detail:
      "본인 입실은 정상 기록되고 타인 출입에는 별도 경고 태그가 붙는다. 중앙 보안 로그와 독립된 로컬 버퍼다.",
    observation: "야간 알리바이는 입실 기록뿐 아니라 이후 퇴실 가능성까지 검토해야 한다.",
    evidenceLabel: "승무원 숙소 야간 출입 기록",
    required: false,
  },
  NPC_MAYA: {
    id: "NPC_MAYA",
    zone: "XO",
    title: "마야 헨드릭스",
    eyebrow: "용의자 01 // 부사령관",
    kind: "PERSON",
    summary: "전 구역 물리 접근과 지휘 권한을 가진 부사령관이다.",
    detail:
      "정기 보고를 위해 사령관실에 방문해 시신을 발견했다고 진술했다. 사령관실 직통 통로를 기록 없이 사용할 수 있는 유일한 인물이다.",
    observation: "접근 가능성은 높지만 실제 사용 여부를 입증해야 한다.",
    evidenceLabel: "헨드릭스 1차 진술",
    required: false,
  },
  NPC_JUNHO: {
    id: "NPC_JUNHO",
    zone: "EN",
    title: "백준호",
    eyebrow: "용의자 02 // 수석 엔지니어",
    kind: "PERSON",
    summary: "생명유지와 환경 제어 계통을 담당하는 수석 엔지니어다.",
    detail:
      "가장 광범위한 살상 계통에 정당하게 접근할 수 있다. 정비 예산과 노후 부품 교체 내역에 관한 감사를 앞두고 있었다.",
    observation: "기술 설명이 길어질수록 숨기는 전제를 확인해야 한다.",
    evidenceLabel: "백준호 1차 진술",
    required: false,
  },
  NPC_SOPHIA: {
    id: "NPC_SOPHIA",
    zone: "MD",
    title: "소피아 알바레즈",
    eyebrow: "용의자 03 // 의무관",
    kind: "PERSON",
    summary: "약품고와 의료 기록, 검시 해석을 담당하는 유일한 의무관이다.",
    detail:
      "현장 스캔 원시 데이터는 수정할 수 없지만 의료 해석과 약품 반출 기록은 사후 변경할 수 있다.",
    observation: "환자 기밀과 사건 정보를 구분해 질문해야 한다.",
    evidenceLabel: "소피아 1차 진술",
    required: false,
  },
  NPC_KASIM: {
    id: "NPC_KASIM",
    zone: "CM",
    title: "카심 나예리",
    eyebrow: "용의자 04 // 통신정보장교",
    kind: "PERSON",
    summary: "통신·보안 로그를 직접 수정할 수 있는 유일한 인물이다.",
    detail:
      "D-4 태양풍 경보를 전 승무원에게 공지했으며 격리 시점을 가장 정확히 알고 있었다.",
    observation: "중앙 로그보다 각 장치의 로컬 원본을 우선 확인해야 한다.",
    evidenceLabel: "카심 1차 진술",
    required: false,
  },
  NPC_YUNA: {
    id: "NPC_YUNA",
    zone: "CG",
    title: "유나 조",
    eyebrow: "용의자 05 // 화물관리관",
    kind: "PERSON",
    summary: "에어록과 중장비, 화물·도킹 기록을 관리한다.",
    detail:
      "불법 광물 반출 의혹으로 사령관과 마찰이 있었다. 추궁을 받으면 사소한 비위부터 단계적으로 인정하는 경향이 있다.",
    observation: "인정한 비위와 살인 실행 조건을 분리해서 판단해야 한다.",
    evidenceLabel: "유나 1차 진술",
    required: false,
  },
};

export const REQUIRED_SCENE_IDS = [
  "CO_BODY",
  "CO_DOOR_LOG",
  "CO_ENV_PANEL",
  "CO_TERMINAL",
];

export const TIMELINE = [
  { time: "D-4", title: "태양풍 사전 경보", detail: "카심이 전 승무원에게 공지" },
  { time: "D-0", title: "격리 시작", detail: "외부 통신 두절 · 비상 프로토콜 발동" },
  { time: "D-0 밤", title: "사망 추정 구간", detail: "정확한 시점 조사 필요" },
  { time: "D1 07:20", title: "시신 발견", detail: "마야 헨드릭스가 보안담당관 호출" },
];

export const SUSPECTS = [
  { id: "MAYA", name: "마야 헨드릭스", role: "부사령관", color: "#a85040" },
  { id: "JUNHO", name: "백준호", role: "수석 엔지니어", color: "#b58a52" },
  { id: "SOPHIA", name: "소피아 알바레즈", role: "의무관", color: "#7f9689" },
  { id: "KASIM", name: "카심 나예리", role: "통신정보장교", color: "#82799c" },
  { id: "YUNA", name: "유나 조", role: "화물관리관", color: "#a4737f" },
];

export type DialogueChoice = {
  id: string;
  label: string;
  response: string;
};

/**
 * NPC 심문의 정적 UI 문구.
 *
 * `opening`은 사건 내용이 아니라 인물의 성격만 담는다. 첫 인사는 API를 거치지 않고 바로
 * 띄우는데, 여기에 사건 사실을 적어 두면 매번 새로 생성되는 사건과 어긋나고 아직 조사하지도
 * 않은 결론을 NPC가 먼저 말해 버린다. 사건에 대한 답변은 전부 서버가 만든다.
 *
 * `choices`는 첫 질문에만 쓰인다. 한 번 오간 뒤의 선택지는 서버가 준 `recommendedQuestions`로
 * 바뀐다(`GameUI.tsx`의 `InterrogationPanel`).
 */
export const NPC_DIALOGUE: Record<
  string,
  {
    callSign: string;
    opening: string;
    posture: string;
    choices: DialogueChoice[];
  }
> = {
  NPC_MAYA: {
    callSign: "XO / MAYA HENDRICKS",
    opening:
      "왔군요. 혼란스러운 건 알지만, 확인이 필요한 게 있으면 순서대로 물어보세요.",
    posture: "협조적 · 답변 통제",
    choices: [
      {
        id: "discovery",
        label: "발견 당시 상황을 다시 설명해 주십시오.",
        response:
          "07시 20분, 중앙 허브에서 일반 출입문을 사용했습니다. 직통 통로는 쓰지 않았어요. 사령관은 책상 앞이 아니라 환경 패널 쪽에 쓰러져 있었습니다.",
      },
      {
        id: "passage",
        label: "직통 통로에는 왜 기록 장치가 없습니까?",
        response:
          "지휘 연속성을 위한 구식 설계입니다. 그 구조가 절 의심하게 만든다는 건 이해하지만, 구조와 사용 기록은 다른 문제죠.",
      },
      {
        id: "audit",
        label: "감사 보고서 내용을 알고 있었습니까?",
        response:
          "지휘부 감사가 진행 중이라는 사실은 알고 있었습니다. 세부 초안은 로스 사령관 개인 단말에 있었고 제게 공유되지 않았습니다.",
      },
    ],
  },
  NPC_JUNHO: {
    callSign: "ENG / BAEK JUNHO",
    opening: "정비 기록은 정리해 두었습니다. 필요한 부분부터 말씀하세요.",
    posture: "방어적 · 기술 용어 증가",
    choices: [
      {
        id: "systems",
        label: "사령관실 환경을 외부에서 조작할 수 있습니까?",
        response:
          "정상 절차라면 지휘 인증이나 로컬 패널이 필요합니다. 정비 우회는 가능하지만 물리 흔적과 작업 서명이 남습니다.",
      },
      {
        id: "whereabouts",
        label: "D-0 야간에는 어디에 있었습니까?",
        response:
          "엔지니어링에서 태양풍 부하를 감시했습니다. 정비 단말 세션과 생명유지 진단 주기를 확인하면 됩니다.",
      },
      {
        id: "audit",
        label: "부품 교체 예산 감사를 받고 있었습니까?",
        response:
          "예산 집행에 오차가 있었던 건 맞지만 정거장을 위험하게 만든 적은 없습니다. 살인과 회계 문제를 억지로 묶지 마십시오.",
      },
    ],
  },
  NPC_SOPHIA: {
    callSign: "MED / SOFIA ALVAREZ",
    opening:
      "안녕하세요. 지금은 모두 예민한 상황이군요. 제가 아는 범위에서 차분히 답하겠습니다.",
    posture: "침착 · 정보 선택",
    choices: [
      {
        id: "cause",
        label: "현재 추정 가능한 사인은 무엇입니까?",
        response:
          "급격한 저산소 상태와 약물성 반응을 모두 열어 둬야 합니다. 현재 수치만으로 둘 중 하나를 배제할 수 없습니다.",
      },
      {
        id: "records",
        label: "의료 기록을 수정할 수 있습니까?",
        response:
          "환자 기록 정정 권한은 제게 있습니다. 하지만 스캐너 원시 측정값은 보안 저장소에 별도로 보존되며 제가 지울 수 없습니다.",
      },
      {
        id: "trial",
        label: "무허가 임상시험 의혹에 답하십시오.",
        response:
          "그 질문은 환자 기밀과 연구 윤리 절차를 포함합니다. 정식 조사 요청을 남기면 관련 기록을 제공하겠습니다.",
      },
    ],
  },
  NPC_KASIM: {
    callSign: "COMMS / KASIM NAYYERI",
    opening: "통신 채널은 안정적입니다. 질문이 있다면 사실대로 답하겠습니다.",
    posture: "빠른 답변 · 과잉 설명",
    choices: [
      {
        id: "tamper",
        label: "보안 로그를 수정했습니까?",
        response:
          "손상된 인덱스를 재구성했습니다. 원본 이벤트를 삭제한 게 아니라 순서를 복구한 겁니다. 문 로컬 버퍼와 비교하면 확인할 수 있어요.",
      },
      {
        id: "warning",
        label: "태양풍 도달 시각을 언제 확정했습니까?",
        response:
          "D-4 최초 관측 때 전 승무원에게 범위를 공지했고, D-0 여섯 시간 전에 최종 도달 시각을 갱신했습니다. 모두가 경보를 받았습니다.",
      },
      {
        id: "leak",
        label: "경쟁 컨소시엄과 통신한 기록이 있습니다.",
        response:
          "지금은 사령관의 죽음을 조사하는 중 아닙니까? 통신 감사 건은 별도 사안입니다. 필요하면 원본 카트리지를 확인하십시오.",
      },
    ],
  },
  NPC_YUNA: {
    callSign: "CARGO / JO YUNA",
    opening: "화물 관련 기록도 확인 중이에요. 궁금한 점이 있으면 물어보세요.",
    posture: "감정적 · 단계적 인정",
    choices: [
      {
        id: "cargo",
        label: "누락된 화물 기록을 설명하십시오.",
        response:
          "광물 표본 몇 개를 정식 목록에서 뺀 건 맞아요. 개인적으로 보관하려 했습니다. 그렇다고 사람을 에어록에 넣은 건 아니에요.",
      },
      {
        id: "whereabouts",
        label: "D-0 야간의 동선을 말하십시오.",
        response:
          "화물칸에서 자동 하역 장비를 고정하고 숙소로 돌아갔어요. 장비 종료 기록과 숙소 출입 기록이 남아 있을 겁니다.",
      },
      {
        id: "ross",
        label: "사령관과 마지막으로 언제 다퉜습니까?",
        response:
          "격리 전날입니다. 화물 전수 검사를 하겠다고 했어요. 화가 났던 건 사실이지만, 그날 밤 찾아가진 않았습니다.",
      },
    ],
  },
};
