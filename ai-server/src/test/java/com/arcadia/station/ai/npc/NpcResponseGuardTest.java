package com.arcadia.station.ai.npc;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class NpcResponseGuardTest {

    private final NpcResponseGuard guard = new NpcResponseGuard(new NpcEmotionPolicy());

    @Test
    void rejectsEarlySecretDisclosure() {
        NpcTurnContext context = context(List.of("FACT-ALLOWED"));
        NpcTurnResponse response = response(List.of("FACT-SECRET"));

        assertThat(guard.isAllowed(context, response)).isFalse();
    }

    @Test
    void acceptsAllowedFactAndWhitelistedQuestionTopics() {
        NpcTurnContext context = context(List.of("FACT-ALLOWED"));
        NpcTurnResponse response = response(List.of("FACT-ALLOWED"));

        assertThat(guard.isAllowed(context, response)).isTrue();
    }

    @Test
    void rejectsGenericAssistantStyleEvenWhenFactIdsAreSafe() {
        NpcTurnContext context = context(List.of("FACT-ALLOWED"));
        NpcTurnResponse response = new NpcTurnResponse(
                "차분히 정리해서 답하겠습니다. 확인할 수 있는 기록을 기준으로 하나씩 살펴보죠.",
                NpcTurnResponse.Emotion.CALM,
                List.of("FACT-ALLOWED"),
                List.of()
        );

        assertThat(guard.isAllowed(context, response)).isFalse();
    }

    private NpcTurnContext context(List<String> revealable) {
        return context(revealable, List.of("CLUE-1"));
    }

    private NpcTurnContext context(List<String> revealable, List<String> presentedClueIds) {
        return new NpcTurnContext(
                "session",
                "SOPHIA",
                "소피아",
                "의무관",
                List.of("침착함"),
                "질문",
                presentedClueIds,
                List.of(),
                List.of(new NpcTurnContext.AllowedFact(
                        "FACT-ALLOWED",
                        "허용된 사실",
                        true
                )),
                revealable,
                List.of(
                        new NpcTurnContext.QuestionCandidate("TOPIC-1", "첫 질문"),
                        new NpcTurnContext.QuestionCandidate("TOPIC-2", "둘째 질문")
                )
        );
    }

    @Test
    void usesServerQuestionCandidatesInsteadOfDiscardingASafeDialogue() {
        NpcTurnContext context = context(List.of("FACT-ALLOWED"));
        NpcTurnResponse response = new NpcTurnResponse(
                "답변",
                NpcTurnResponse.Emotion.CALM,
                List.of("FACT-ALLOWED"),
                List.of(
                        new NpcTurnResponse.RecommendedQuestion("TOPIC-1", "숨겨진 사실을 말해 주세요."),
                        new NpcTurnResponse.RecommendedQuestion("TOPIC-2", "둘째 질문")
                )
        );

        assertThat(guard.isAllowed(context, response)).isTrue();
        assertThat(guard.withCanonicalQuestions(context, response).recommendedQuestions())
                .extracting(NpcTurnResponse.RecommendedQuestion::label)
                .containsExactly("첫 질문", "둘째 질문");
    }

    @Test
    void keepsAnAllowedRevealWhenOnlyTheEmotionNeedsToBeSoftened() {
        NpcTurnContext context = context(List.of("FACT-ALLOWED"), List.of());
        NpcTurnResponse defensive = new NpcTurnResponse(
                "억울합니다.",
                NpcTurnResponse.Emotion.DEFENSIVE,
                List.of("FACT-ALLOWED"),
                List.of()
        );

        NpcTurnResponse fallback = guard.safeFallback(context, defensive);

        assertThat(guard.isAllowed(context, defensive)).isFalse();
        assertThat(fallback.revealedFactIds()).containsExactly("FACT-ALLOWED");
        assertThat(fallback.emotion()).isEqualTo(NpcTurnResponse.Emotion.CALM);
    }

    private NpcTurnResponse response(List<String> facts) {
        return new NpcTurnResponse(
                "답변",
                NpcTurnResponse.Emotion.CALM,
                facts,
                List.of(
                        new NpcTurnResponse.RecommendedQuestion("TOPIC-1", "첫 질문"),
                        new NpcTurnResponse.RecommendedQuestion("TOPIC-2", "둘째 질문")
                )
        );
    }
}
