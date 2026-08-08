package com.arcadia.station.ai.npc;

import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * 심문 분위기를 서버가 일관되게 제어한다.
 *
 * <p>NPC는 용의자라는 이유만으로 매번 방어적으로 굴지 않는다. 실제 고발·증거 제시에는
 * 방어하거나 말을 아낄 수 있지만, 보통의 확인 질문에는 각 인물의 기본 성향에 맞춰 차분히
 * 또는 조심스럽게 응답하게 한다. 이 규칙은 외부 AI 응답이 검증에서 탈락했을 때의 폴백에도
 * 적용돼, 폴백이 대화의 분위기를 단조롭게 만들지 않게 한다.</p>
 */
@Component
public class NpcEmotionPolicy {

    private static final Set<String> CONFRONTATIONAL_TERMS = Set.of(
            "거짓", "거짓말", "범인", "용의자", "살인", "범행", "숨기", "은폐", "모순",
            "책임", "의심", "해명", "인정", "왜 했", "네가 했", "당신이 했"
    );

    private static final Set<String> ESCALATING_TERMS = Set.of(
            "범인", "용의자", "살인", "범행", "거짓말", "네가 했", "당신이 했", "인정해"
    );

    private static final Set<String> HOSTILE_TERMS = Set.of(
            "닥쳐", "입 다물", "꺼져", "쓰레기", "최악의 답변", "헛소리", "개소리",
            "목 닦", "목딲", "죽여", "죽인다", "가만 안 둬", "두고 봐"
    );

    /**
     * 단순한 확인 질문에 DEFENSIVE를 연속으로 붙이지 않는다. 정면 고발이나 새 증거를
     * 제시한 경우에만 방어적인 반응이 자연스럽다.
     */
    public boolean allows(NpcTurnContext context, NpcTurnResponse.Emotion emotion) {
        if (emotion != NpcTurnResponse.Emotion.DEFENSIVE) {
            return true;
        }
        if (!isConfrontational(context)) {
            return false;
        }
        return previousEmotion(context) != NpcTurnResponse.Emotion.DEFENSIVE
                || isEscalatingAccusation(context);
    }

    public Reply fallback(NpcTurnContext context) {
        NpcTurnResponse.Emotion emotion = chooseFallbackEmotion(context);
        return new Reply(emotion, switch (emotion) {
            case CALM -> "제가 본 건 여기까지예요. 더 확인할 자료가 있다면 보여 주세요.";
            case ANXIOUS -> "그렇게 몰아붙이면 저도 더 조심스러워져요. 제가 아는 건 이미 말씀드렸어요.";
            case EVASIVE -> "그 부분은 지금 답하고 싶지 않아요. 다른 자료가 있다면 보여 주세요.";
            case ANGRY -> "협박하듯 말하면 대답할 수 없어요. 근거가 있다면 보여 주세요.";
            case DEFENSIVE -> "의심하시는 건 알겠어요. 하지만 제 말만으로 결론 내리진 말아 주세요.";
        });
    }

    /** 확인된 사실을 말할 때도 감정에 맞는 말투를 유지한다. */
    public Reply acknowledging(NpcTurnContext context, String statement) {
        NpcTurnResponse.Emotion emotion = chooseFallbackEmotion(context);
        String dialogue = switch (emotion) {
            case CALM -> "그 기록은 확인됩니다. " + statement
                    + " 그 사실이 사건과 어떤 관계인지까지는 기록을 더 대조해 봐야 합니다.";
            case ANXIOUS -> "그 기록이 남아 있는 건 맞습니다. " + statement
                    + " 오해를 부를 수 있다는 건 알지만, 제가 아는 범위에서는 그게 전부입니다.";
            case EVASIVE -> "그 기록 자체를 부정하지는 않겠습니다. " + statement
                    + " 다만 그 이상의 해석은 지금 단정하기 어렵습니다.";
            case ANGRY -> "그 기록 하나로 저를 몰아붙이는 건 공정하지 않습니다. " + statement
                    + " 확인할 부분이 있다면 기록을 더 대조해 보세요.";
            case DEFENSIVE -> "그 기록이 있다면 일부는 인정하죠. " + statement
                    + " 하지만 그것만으로 사건 전체가 설명되지는 않습니다.";
        };
        return new Reply(emotion, dialogue);
    }

    private NpcTurnResponse.Emotion chooseFallbackEmotion(NpcTurnContext context) {
        if (isHostile(context)) {
            return NpcTurnResponse.Emotion.ANGRY;
        }
        if (isEscalatingAccusation(context)) {
            if (hasTrait(context, "압박 시 과묵", "압박 시 침묵", "선택적으로 공개")) {
                return NpcTurnResponse.Emotion.EVASIVE;
            }
            if (hasTrait(context, "말이 빠름", "과잉 설명")) {
                return NpcTurnResponse.Emotion.ANXIOUS;
            }
            return NpcTurnResponse.Emotion.DEFENSIVE;
        }
        if (!context.presentedClueIds().isEmpty()) {
            if (hasTrait(context, "압박 시 과묵", "압박 시 침묵", "선택적으로 공개")) {
                return NpcTurnResponse.Emotion.EVASIVE;
            }
            if (hasTrait(context, "감정적", "억울함", "말이 빠름", "과잉 설명")) {
                return NpcTurnResponse.Emotion.ANXIOUS;
            }
            return NpcTurnResponse.Emotion.CALM;
        }

        NpcTurnResponse.Emotion previous = previousEmotion(context);
        if (previous == NpcTurnResponse.Emotion.DEFENSIVE
                || previous == NpcTurnResponse.Emotion.ANXIOUS
                || previous == NpcTurnResponse.Emotion.ANGRY
                || previous == NpcTurnResponse.Emotion.EVASIVE) {
            return NpcTurnResponse.Emotion.CALM;
        }
        if (hasTrait(context, "감정적", "억울함", "말이 빠름", "과잉 설명")) {
            return NpcTurnResponse.Emotion.ANXIOUS;
        }
        return NpcTurnResponse.Emotion.CALM;
    }

    private boolean isConfrontational(NpcTurnContext context) {
        String question = normalizedQuestion(context);
        return !context.presentedClueIds().isEmpty()
                || CONFRONTATIONAL_TERMS.stream().anyMatch(question::contains);
    }

    private boolean isEscalatingAccusation(NpcTurnContext context) {
        String question = normalizedQuestion(context);
        return ESCALATING_TERMS.stream().anyMatch(question::contains);
    }

    private boolean isHostile(NpcTurnContext context) {
        String question = normalizedQuestion(context);
        return HOSTILE_TERMS.stream().anyMatch(question::contains);
    }

    private NpcTurnResponse.Emotion previousEmotion(NpcTurnContext context) {
        if (context.conversationHistory().isEmpty()) {
            return null;
        }
        String value = context.conversationHistory().getLast().emotion();
        try {
            return NpcTurnResponse.Emotion.valueOf(value);
        } catch (IllegalArgumentException | NullPointerException ignored) {
            return null;
        }
    }

    private boolean hasTrait(NpcTurnContext context, String... fragments) {
        return context.personalityTraits().stream()
                .map(trait -> trait.toLowerCase(Locale.ROOT))
                .anyMatch(trait -> java.util.Arrays.stream(fragments)
                        .map(fragment -> fragment.toLowerCase(Locale.ROOT))
                        .anyMatch(trait::contains));
    }

    private String normalizedQuestion(NpcTurnContext context) {
        return context.question().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    public record Reply(NpcTurnResponse.Emotion emotion, String dialogue) {}
}
