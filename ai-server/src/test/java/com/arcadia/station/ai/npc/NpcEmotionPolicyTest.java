package com.arcadia.station.ai.npc;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class NpcEmotionPolicyTest {

    private final NpcEmotionPolicy policy = new NpcEmotionPolicy();

    @Test
    void neutralQuestionDoesNotPermitDefaultDefensiveness() {
        NpcTurnContext context = context(
                List.of("감정적", "억울함을 강하게 호소함"),
                "그 시간에 무엇을 하고 있었습니까?",
                List.of(),
                List.of()
        );

        assertThat(policy.allows(context, NpcTurnResponse.Emotion.DEFENSIVE)).isFalse();
        assertThat(policy.fallback(context).emotion()).isEqualTo(NpcTurnResponse.Emotion.ANXIOUS);
    }

    @Test
    void evidenceAndPersonalityChooseDifferentFallbackEmotions() {
        NpcTurnContext sophia = context(
                List.of("침착함", "전문가적", "정보를 선택적으로 공개함"),
                "이 기록을 설명해 주세요.",
                List.of("CLUE-MEDICAL-STORAGE"),
                List.of()
        );
        NpcTurnContext maya = context(
                List.of("협조적", "논리정연", "압박 시 과묵함"),
                "그 시간에 무엇을 하고 있었습니까?",
                List.of(),
                List.of()
        );

        assertThat(policy.fallback(sophia).emotion()).isEqualTo(NpcTurnResponse.Emotion.EVASIVE);
        assertThat(policy.fallback(maya).emotion()).isEqualTo(NpcTurnResponse.Emotion.CALM);
    }

    @Test
    void repeatedDefensivenessSettlesDownWhenTheQuestionDoesNotEscalate() {
        NpcTurnContext context = context(
                List.of("방어적", "기술 중심"),
                "그 시간의 작업 순서를 설명해 주세요.",
                List.of(),
                List.of(new NpcTurnContext.ConversationTurn(
                        "왜 숨겼습니까?",
                        "그건 제 잘못이 아닙니다.",
                        "DEFENSIVE",
                        List.of(),
                        List.of()
                ))
        );

        assertThat(policy.allows(context, NpcTurnResponse.Emotion.DEFENSIVE)).isFalse();
        assertThat(policy.fallback(context).emotion()).isEqualTo(NpcTurnResponse.Emotion.CALM);
    }

    @Test
    void explicitAccusationCanNaturallyMakeAnEmotionalCharacterDefensive() {
        NpcTurnContext context = context(
                List.of("감정적", "억울함을 강하게 호소함"),
                "당신이 범인인 것 아닙니까?",
                List.of(),
                List.of()
        );

        assertThat(policy.allows(context, NpcTurnResponse.Emotion.DEFENSIVE)).isTrue();
        assertThat(policy.fallback(context).emotion()).isEqualTo(NpcTurnResponse.Emotion.DEFENSIVE);
    }

    @Test
    void threatAndAccusationGetANaturalBoundaryInsteadOfCalmModeratorTone() {
        NpcTurnContext context = context(
                List.of("침착함", "전문가적", "정보를 선택적으로 공개함"),
                "최악의 답변이군. 결국 너 혼자만의 주장일 뿐이잖아. 넌 최우선 용의자야. 목딲고 기다리죠.",
                List.of(),
                List.of()
        );

        NpcEmotionPolicy.Reply reply = policy.fallback(context);

        assertThat(reply.emotion()).isEqualTo(NpcTurnResponse.Emotion.ANGRY);
        assertThat(reply.dialogue())
                .isEqualTo("협박하듯 말하면 대답할 수 없어요. 근거가 있다면 보여 주세요.")
                .doesNotContain("차분히 정리해서");
    }

    @Test
    void mayaAnswersDiscoveryQuestionWithHerOwnRoleInsteadOfGenericRefusal() {
        NpcTurnContext context = new NpcTurnContext(
                "session",
                "MAYA",
                "마야 헨드릭스",
                "부사령관",
                "사건 다음 날 아침 사령관실의 이상을 발견해 보안 절차를 가동했다.",
                null,
                List.of("침착한 지휘관", "논리정연"),
                "부사령관 집무실에서 감사 기록을 검토했습니다.",
                "발견 당시 상황을 다시 설명해 주십시오.",
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of()
        );

        NpcEmotionPolicy.Reply reply = policy.fallback(context);

        assertThat(reply.emotion()).isEqualTo(NpcTurnResponse.Emotion.CALM);
        assertThat(reply.dialogue())
                .contains("사령관실", "보안 절차")
                .doesNotContain("제가 본 건 여기까지예요");
    }

    @Test
    void yunaAnswersNeutralTimelineQuestionWithCargoClaimWithoutBecomingDefensive() {
        NpcTurnContext context = new NpcTurnContext(
                "session",
                "YUNA",
                "유나 조",
                "화물관리관",
                "화물창고와 도킹 물자 기록을 관리한다.",
                null,
                List.of("현장 감각", "솔직함", "자존심"),
                "화물칸에서 재고를 확인했습니다.",
                "사건 당일 밤에는 어디에 있었습니까?",
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of()
        );

        NpcEmotionPolicy.Reply reply = policy.fallback(context);

        assertThat(reply.emotion()).isEqualTo(NpcTurnResponse.Emotion.CALM);
        assertThat(reply.dialogue())
                .contains("화물칸에서 재고를 확인했습니다", "봉인 번호")
                .doesNotContain("저를 의심");
    }

    private NpcTurnContext context(
            List<String> traits,
            String question,
            List<String> presentedClueIds,
            List<NpcTurnContext.ConversationTurn> history
    ) {
        return new NpcTurnContext(
                "session",
                "YUNA",
                "유나 조",
                "화물관리관",
                "화물창고와 도킹 물자 기록을 관리한다.",
                null,
                traits,
                "화물칸에서 재고를 확인했습니다.",
                question,
                presentedClueIds,
                history,
                List.of(),
                List.of(),
                List.of(
                        new NpcTurnContext.QuestionCandidate("TOPIC-1", "첫 질문"),
                        new NpcTurnContext.QuestionCandidate("TOPIC-2", "둘째 질문")
                )
        );
    }
}
