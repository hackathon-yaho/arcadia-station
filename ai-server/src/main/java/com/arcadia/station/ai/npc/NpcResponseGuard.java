package com.arcadia.station.ai.npc;

import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class NpcResponseGuard {

    private static final Set<String> GENERIC_ASSISTANT_PHRASES = Set.of(
            "차분히 정리해서 답하겠습니다",
            "확인할 수 있는 기록을 기준으로 하나씩 살펴보죠",
            "제가 본 건 여기까지예요",
            "그 부분은 지금 답하고 싶지 않아요"
    );

    private final NpcEmotionPolicy emotions;

    public NpcResponseGuard(NpcEmotionPolicy emotions) {
        this.emotions = emotions;
    }

    public boolean isAllowed(NpcTurnContext context, NpcTurnResponse response) {
        if (response == null
                || response.dialogue() == null
                || response.dialogue().isBlank()
                || response.emotion() == null
                || response.revealedFactIds() == null) {
            return false;
        }
        if (GENERIC_ASSISTANT_PHRASES.stream().anyMatch(response.dialogue()::contains)) {
            return false;
        }
        String normalizedDialogue = normalize(response.dialogue());
        boolean repeatsPreviousDialogue = context.conversationHistory().stream()
                .map(NpcTurnContext.ConversationTurn::dialogue)
                .map(this::normalize)
                .anyMatch(normalizedDialogue::equals);
        if (repeatsPreviousDialogue) {
            return false;
        }
        Set<String> revealable = Set.copyOf(context.revealableFactIds());
        if (!revealable.containsAll(response.revealedFactIds())) {
            return false;
        }
        return emotions.allows(context, response.emotion());
    }

    /**
     * 후속 질문은 모델이 자유롭게 만들게 두지 않고 서버 후보를 그대로 사용한다. 모델이 문구를
     * 조금 다르게 반환했다는 이유만으로 안전한 본문 답변까지 버리고 같은 폴백을 반복하지 않는다.
     */
    public NpcTurnResponse withCanonicalQuestions(NpcTurnContext context, NpcTurnResponse response) {
        List<NpcTurnResponse.RecommendedQuestion> questions = context.questionCandidates().stream()
                .limit(2)
                .map(candidate -> new NpcTurnResponse.RecommendedQuestion(
                        candidate.topicId(),
                        candidate.label()
                ))
                .toList();
        return new NpcTurnResponse(
                response.dialogue(),
                response.emotion(),
                response.revealedFactIds(),
                questions
        );
    }

    public NpcTurnResponse safeFallback(NpcTurnContext context) {
        return safeFallback(context, null);
    }

    /**
     * 감정만 부적절했던 답변은 이미 화이트리스트를 통과한 사실까지 버리지 않는다. 대신 그
     * 사실을 현재 인물의 성향에 맞는 안전한 문장으로 다시 말한다.
     */
    public NpcTurnResponse safeFallback(NpcTurnContext context, NpcTurnResponse rejectedResponse) {
        List<NpcTurnResponse.RecommendedQuestion> questions = context.questionCandidates().stream()
                .limit(2)
                .map(candidate -> new NpcTurnResponse.RecommendedQuestion(
                        candidate.topicId(),
                        candidate.label()
                ))
                .toList();
        List<String> revealed = safelyRevealable(context, rejectedResponse);
        NpcEmotionPolicy.Reply reply = revealed.isEmpty()
                ? emotions.fallback(context)
                : acknowledgedReply(context, revealed.getFirst());
        return new NpcTurnResponse(
                reply.dialogue(),
                reply.emotion(),
                revealed,
                questions
        );
    }

    private List<String> safelyRevealable(NpcTurnContext context, NpcTurnResponse response) {
        if (response == null || response.revealedFactIds() == null) {
            return List.of();
        }
        Set<String> revealable = Set.copyOf(context.revealableFactIds());
        return revealable.containsAll(response.revealedFactIds())
                ? List.copyOf(response.revealedFactIds())
                : List.of();
    }

    private NpcEmotionPolicy.Reply acknowledgedReply(NpcTurnContext context, String factId) {
        String statement = context.allowedFacts().stream()
                .filter(fact -> fact.factId().equals(factId))
                .map(NpcTurnContext.AllowedFact::statement)
                .findFirst()
                .orElse("제시한 기록과 관련된 작업이 있었던 것은 확인됩니다.");
        return emotions.acknowledging(context, statement);
    }

    private String normalize(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }
}
