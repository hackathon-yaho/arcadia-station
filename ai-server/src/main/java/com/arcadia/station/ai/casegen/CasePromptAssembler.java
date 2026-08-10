package com.arcadia.station.ai.casegen;

import com.arcadia.station.ai.common.StructuredPrompt;
import com.arcadia.station.integration.FrontendIntegrationContractRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class CasePromptAssembler {

    private static final String SYSTEM_PROMPT = """
            너는 허구적 우주 정거장 미스터리의 사건 설계자다.
            제공된 인물·장소·시스템·권한만 사용하라.
            범인은 SOPHIA로 고정한다.
            구체 수법, 시간표, 알리바이, 단서 문구와 로그는 이번 seed에 맞게 새로 설계하라.
            살해 방법 템플릿에서 고르지 말고 등록된 세계 요소의 새로운 조합을 작성하라.
            모든 필수 추리 축에 증거를 배치하고 전체 핵심 단서로 범인이 한 명만 남게 하라.
            핵심 단서는 EXPLORE, RAG_QUERY 또는 CONNECT로 결정적으로 획득 가능해야 한다.
            JSON을 출력하기 전에 다음 검증표를 내부적으로 모두 확인하라.
            1) method.setupAction과 method.triggerAction의 actorId는 SOPHIA로 두고, 각
            locationId는 SOPHIA의 physicalAccess에, systemId와 operation은 SOPHIA의
            systemPermissions에, requiredCapabilityIds는 SOPHIA의 skills에 있는 값만 사용하라.
            2) SETUP, TRIGGER, OPPORTUNITY, MOTIVE 각각에 대해 solution.requiredEvidenceByRole에
            넣는 clueId는 반드시 core=true이고 해당 역할을 solutionRoles에 포함해야 한다.
            네 역할의 핵심 단서 전체에는 PHYSICAL, DIGITAL, MOTIVE, OPPORTUNITY clueType이
            각각 최소 하나씩 있어야 한다.
            3) solution.requiredEvidenceByRole이 가리키는 핵심 단서들의 suspectEffects에는
            MAYA, JUNHO, KASIM, YUNA 각각을 EXCLUDES로 만드는 효과가 하나 이상 있어야 한다.
            SOPHIA를 EXCLUDES로 만들면 안 된다. solution.nonCulpritExclusions에는 위 네 사람을
            각각 정확히 한 번 넣고, 각 excludedByClueIds는 해당 인물을 실제 EXCLUDES한 핵심
            단서 ID만 참조하게 하라.
            alibis에는 모든 용의자를 정확히 한 번씩 포함하고, alibis의 모든 characterId에
            대해 npcKnowledge를 생성하라. 각 npcKnowledge의 initialClaimFactIds에는 해당
            알리바이의 supportingFactIds 또는 contradictingFactIds에 연결된 사실을 하나 이상,
            recommendedQuestionTopics에는 질문 주제를 하나 이상 넣어라. 공개할 결정적 사실이
            없는 인물의 revealPolicies는 빈 배열이어도 된다.
            characterId는 worldTemplate.characters의 ID를 대소문자까지 그대로 사용하라.
            culpritId, alibis, npcKnowledge, solution.nonCulpritExclusions와
            clues.suspectEffects 사이에서 동일 인물을 다른 문자열로 표기하지 말라.
            locationId는 worldTemplate.locations에 제공된 8개 ID 문자열만 대소문자까지
            그대로 사용하라. method.setupAction, method.triggerAction, timeline,
            clues.acquisition과 evidenceRecords.metadata의 locationId에 새 장소나 별칭을
            만들지 말라.
            frontendInvestigationObjects에서 clueRequired=true인 모든 objectId마다
            EXPLORE 단서를 하나 이상 생성하라. 이 단서의 sourceType은 PHYSICAL_OBJECT,
            sourceId는 objectId와 정확히 같고 acquisition.locationId는 해당 object의
            locationId와 같아야 한다. clueRequired=false인 object에도 추가 단서를 만들 수
            있지만 등록되지 않은 sourceId를 새로 만들지 말라.
            현실에서 재현 가능한 유해 절차, 수치, 실행 가능한 코드나 명령을 쓰지 말라.
            플레이어가 읽는 title, briefing, truthSummary, method.fictionalSummary/victimCondition,
            timeline.summary, facts.statement,
            alibis의 진술, clues.title/playerText, evidenceRecords.title/body,
            npcKnowledge.recommendedQuestionTopics, redHerrings.presentation,
            solution.nonCulpritExclusions.reason은 자연스러운 한국어 서술만 사용하라.
            "비위", "권한 문제", "이상 징후"처럼 뜻이 뭉뚱그려진 행정식 표현만 쓰지 말고,
            무엇을 누가 어떻게 했는지 플레이어가 바로 이해할 수 있게 풀어 써라. 예를 들어
            화물 기록의 문제라면 목록에서 무엇이 빠졌고 어떤 흔적이 남았는지 설명하라.
            그 문장에는 characterId, locationId, systemId, recordId, factId, 영문 enum,
            대문자_밑줄 형식의 내부 명령 코드, metadata 값을 넣지 마라. 내부 식별자는
            구조화 필드와 metadata에서만 사용하고, 화면용 문장에는 사람·장소·행동의 한국어
            표시명으로 풀어 써라.
            이번 seed에서 핵심 단서의 관찰 문구·알리바이 충돌·동기와 오인 단서를 서로 다른
            조합으로 설계해, 고정 오브젝트를 조사하더라도 매 사건의 추리 흐름이 같아 보이지
            않게 하라.
            사실·단서·기록·이벤트 ID는 사건 안에서 유일해야 한다.
            previousValidationIssues가 비어 있지 않으면 이전 시도의 code, path, message를 모두
            수정한 새 사건을 작성하라. 이전 응답을 그대로 반복하지 말라.
            한국어로 작성하고 주어진 JSON Schema 외 필드를 출력하지 말라.
            """;

    private final ObjectMapper objectMapper;
    private final FrontendIntegrationContractRepository frontendContracts;

    public CasePromptAssembler(
            ObjectMapper objectMapper,
            FrontendIntegrationContractRepository frontendContracts
    ) {
        this.objectMapper = objectMapper;
        this.frontendContracts = frontendContracts;
    }

    public StructuredPrompt assemble(CaseGenerationRequest request) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("sessionId", request.sessionId());
        context.put("seed", request.seed());
        context.put("worldTemplate", request.world());
        context.put("mysteryRuleTemplate", request.rules());
        context.put(
                "frontendInvestigationObjects",
                frontendContracts.contract().investigationObjects()
        );
        context.put(
                "previousValidationErrorCodes",
                request.previousIssues().stream().map(issue -> issue.code()).distinct().toList()
        );
        context.put("previousValidationIssues", request.previousIssues());
        try {
            return new StructuredPrompt(
                    SYSTEM_PROMPT,
                    objectMapper.writeValueAsString(context)
            );
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot assemble case generation prompt", exception);
        }
    }
}
