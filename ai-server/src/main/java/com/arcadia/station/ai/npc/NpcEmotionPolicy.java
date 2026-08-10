package com.arcadia.station.ai.npc;

import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * NPC의 감정 상태와 안전 폴백의 연기 기준을 한곳에서 결정한다.
 *
 * <p>폴백은 "답변을 포기하는 문구"가 아니다. 외부 AI가 실패하거나 응답이 검증에서 거절돼도,
 * 이 인물이 이미 말할 수 있는 알리바이와 공개 프로필을 바탕으로 질문에 맞는 역할극을 이어 간다.
 * 따라서 용의자라는 이유만으로 모두 방어적으로 만들지 않는다.</p>
 */
@Component
public class NpcEmotionPolicy {

    private static final Set<String> CONFRONTATIONAL_TERMS = Set.of(
            "거짓", "거짓말", "범인", "용의자", "살인", "범행", "숨기", "모순",
            "책임", "처벌", "인정", "네가 한", "당신이 한"
    );

    private static final Set<String> ESCALATING_TERMS = Set.of(
            "범인", "용의자", "살인", "범행", "거짓말", "네가 한", "당신이 한", "인정해"
    );

    private static final Set<String> HOSTILE_TERMS = Set.of(
            "협박", "닥쳐", "꺼져", "몰아붙", "최악", "헛소리", "개소리",
            "죽여", "죽인다", "가만 안 둬", "목을"
    );

    /** 단순 확인 질문에는 DEFENSIVE를 허용하지 않는다. */
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
        return new Reply(emotion, fallbackDialogue(context, emotion));
    }

    /** 제시된 증거로 공개가 허용된 사실을 현재 인물의 말투로 다시 말한다. */
    public Reply acknowledging(NpcTurnContext context, String statement) {
        NpcTurnResponse.Emotion emotion = chooseFallbackEmotion(context);
        String dialogue = switch (context.characterId()) {
            case "MAYA" -> "그 기록은 확인했습니다. " + statement
                    + " 다만 기록 하나만으로 원인을 단정하지 말고, 시간과 권한을 함께 보셔야 합니다.";
            case "JUNHO" -> "그 기록이 맞다면 " + statement
                    + " 작업 순서와 권한 범위를 같이 보면 제 역할과는 구분될 겁니다.";
            case "SOPHIA" -> "기록 자체는 부정하지 않겠습니다. " + statement
                    + " 다만 그 기록이 의미하는 범위는 의료 기준에 맞춰 해석해야 합니다.";
            case "KASIM" -> "원본 기록을 보셨군요. " + statement
                    + " 전송 시각과 접근 권한까지 대조하면 빠진 맥락이 보일 겁니다.";
            case "YUNA" -> "그 자료라면 숨길 생각은 없어요. " + statement
                    + " 화물 문제와 이번 사건을 같은 일로 단정하기 전에는 확인할 게 더 있습니다.";
            default -> "그 기록은 확인했습니다. " + statement;
        };
        return new Reply(emotion, dialogue);
    }

    private String fallbackDialogue(NpcTurnContext context, NpcTurnResponse.Emotion emotion) {
        if (isHostile(context)) {
            return "협박하듯 말하면 대답할 수 없어요. 근거가 있다면 보여 주세요.";
        }

        String claim = initialClaim(context);
        QuestionIntent intent = questionIntent(context);
        return switch (context.characterId()) {
            case "MAYA" -> mayaReply(context, intent, claim, emotion);
            case "JUNHO" -> junhoReply(intent, claim, emotion);
            case "SOPHIA" -> sophiaReply(intent, claim, emotion);
            case "KASIM" -> kasimReply(intent, claim, emotion);
            case "YUNA" -> yunaReply(intent, claim, emotion);
            default -> genericReply(context, intent, claim, emotion);
        };
    }

    private String mayaReply(
            NpcTurnContext context,
            QuestionIntent intent,
            String claim,
            NpcTurnResponse.Emotion emotion
    ) {
        return switch (intent) {
            case DISCOVERY -> "제가 사령관실의 이상을 확인한 뒤 즉시 보안 절차를 가동한 것은 맞습니다. "
                    + "그 이후에는 현장을 보존했고, 확인된 순서대로 보고했습니다.";
            case TIMELINE -> "사건 당시에는 " + claim
                    + " 제 업무 기록은 시간 순서대로 남아 있으니, 필요한 구간을 지정해 주시면 확인하겠습니다.";
            case EVIDENCE -> "감사 기록은 운영 판단을 위해 검토한 자료입니다. "
                    + "그 기록을 사건과 연결하려면 시각과 권한이 모두 맞는지부터 보셔야 합니다.";
            case MOTIVE -> "운영 책임자로서 갈등을 조정할 일은 있었습니다. "
                    + "하지만 개인적인 불만과 실제 행동은 구분해서 판단해 주십시오.";
            case GENERAL -> emotion == NpcTurnResponse.Emotion.EVASIVE
                    ? "확인되지 않은 추측에는 답을 보태지 않겠습니다. 기록으로 확인되는 범위라면 설명하겠습니다."
                    : "질문을 구체적으로 해 주십시오. 제가 확인한 운영 기록의 범위에서는 성실히 답하겠습니다.";
        };
    }

    private String junhoReply(QuestionIntent intent, String claim, NpcTurnResponse.Emotion emotion) {
        return switch (intent) {
            case TIMELINE -> "사건 당시에는 " + claim
                    + " 단말 작업 이력과 정비 구역 출입 기록을 같이 보면 작업 순서가 맞을 겁니다.";
            case EVIDENCE -> "기록은 이름만 보지 말고 실행 시각과 권한 범위를 봐야 합니다. "
                    + "제가 담당한 정비 작업과 다른 작업은 구분됩니다.";
            case DISCOVERY -> "현장 발견 이후에는 설비 쪽 점검 요청을 받기 전까지 제 작업 구역에 있었습니다. "
                    + "제가 확인한 것은 정비 기록뿐입니다.";
            case MOTIVE -> "예산과 부품 문제로 지적받은 부분은 따로 설명할 수 있습니다. "
                    + "그게 설비를 이용해 누군가를 해쳤다는 뜻은 아닙니다.";
            case GENERAL -> emotion == NpcTurnResponse.Emotion.DEFENSIVE
                    ? "의심하실 수는 있지만, 제 작업 기록부터 보시면 됩니다. 추측보다 순서가 먼저예요."
                    : "질문을 작업 단위로 나눠 주시면, 제가 한 일과 하지 않은 일을 구분해 답하겠습니다.";
        };
    }

    private String sophiaReply(QuestionIntent intent, String claim, NpcTurnResponse.Emotion emotion) {
        return switch (intent) {
            case TIMELINE -> "사건 당시에는 " + claim
                    + " 의료 기록과 안전 점검 기록은 서로 다른 문서이니 구분해서 확인해 주세요.";
            case EVIDENCE -> emotion == NpcTurnResponse.Emotion.EVASIVE
                    ? "그 기록의 존재는 알고 있습니다. 다만 의료 기록의 일부만 떼어 해석하면 잘못된 결론에 이를 수 있어요."
                    : "제시한 기록은 확인하겠습니다. 의료적 판단과 실제 작업 기록을 분리해서 보셔야 합니다.";
            case DISCOVERY -> "발견 당시의 의학적 소견은 기록된 범위에서만 말씀드리겠습니다. "
                    + "추정과 확인된 사실을 섞는 건 좋지 않습니다.";
            case MOTIVE -> "감사나 면담이 부담스럽지 않았다고 말하진 않겠습니다. "
                    + "하지만 부담을 느꼈다는 사실만으로 행동까지 단정할 수는 없어요.";
            case GENERAL -> "제가 확인한 범위에서는 답하겠습니다. "
                    + "의료 기록에 관한 질문이라면 어떤 시각과 자료를 말하는지 함께 알려 주세요.";
        };
    }

    private String kasimReply(QuestionIntent intent, String claim, NpcTurnResponse.Emotion emotion) {
        return switch (intent) {
            case TIMELINE -> "사건 당시에는 " + claim
                    + " 통신실 단말은 신호 상태와 접속 시각을 함께 남기니, 그 순서대로 확인하면 됩니다.";
            case EVIDENCE -> "통신 기록은 한 줄만 보면 안 됩니다. "
                    + "원본 전송 시각, 중계 상태, 열람 권한을 같이 맞춰야 어느 기록이 먼저인지 보입니다.";
            case DISCOVERY -> "발견 직후에는 비상 통신과 보안 채널이 먼저 열렸습니다. "
                    + "제가 현장에서 본 것보다 통신실에 남은 호출 기록이 더 정확할 겁니다.";
            case MOTIVE -> "개인적인 이해관계가 있었다는 지적은 들을 수 있겠죠. "
                    + "그래도 그걸 통신 기록 조작과 바로 연결하면 중간 과정이 빠집니다.";
            case GENERAL -> emotion == NpcTurnResponse.Emotion.ANXIOUS
                    ? "제가 설명을 길게 한 건 확인할 기록이 여러 개라서예요. 하나씩 대조하면 바로 정리됩니다."
                    : "어떤 기록을 말하는지 지정해 주시면, 그 경로부터 설명하겠습니다.";
        };
    }

    private String yunaReply(QuestionIntent intent, String claim, NpcTurnResponse.Emotion emotion) {
        return switch (intent) {
            case TIMELINE -> "사건 당시에는 " + claim
                    + " 화물칸은 물건 하나가 움직여도 봉인 번호와 보관 위치가 남습니다.";
            case EVIDENCE -> "화물 목록에 차이가 있었던 건 제가 확인 중이었습니다. "
                    + "봉인 번호와 실제 보관함을 맞춰 보면, 무엇이 빠졌는지는 분명해질 거예요.";
            case DISCOVERY -> "저는 발견 현장에 있지 않았어요. 제 쪽에서 확인할 수 있는 건 화물칸과 에어록의 작업 기록입니다.";
            case MOTIVE -> "화물 기록 문제로 곤란했던 건 맞아요. "
                    + "그래도 그 일과 사람을 해친 일은 전혀 다른 문제예요.";
            case GENERAL -> emotion == NpcTurnResponse.Emotion.DEFENSIVE
                    ? "저를 의심하실 수는 있어요. 하지만 화물칸 기록을 보면 제가 한 일과 하지 않은 일이 구분됩니다."
                    : "화물 쪽 일이라면 제가 기억하는 순서대로 설명할게요. 어떤 기록이 궁금한가요?";
        };
    }

    private String genericReply(
            NpcTurnContext context,
            QuestionIntent intent,
            String claim,
            NpcTurnResponse.Emotion emotion
    ) {
        if (intent == QuestionIntent.TIMELINE && !claim.isBlank()) {
            return "사건 당시에는 " + claim + " 관련 기록을 확인하면 제 진술을 검증할 수 있습니다.";
        }
        if (intent == QuestionIntent.EVIDENCE) {
            return "제시한 자료는 확인하겠습니다. 기록의 시각과 권한 범위를 함께 봐야 합니다.";
        }
        return emotion == NpcTurnResponse.Emotion.DEFENSIVE
                ? "추측만으로 결론 내리지는 말아 주세요. 확인 가능한 기록부터 보시면 됩니다."
                : "확인 가능한 범위의 질문이라면 답하겠습니다. 무엇을 먼저 확인하시겠습니까?";
    }

    private String initialClaim(NpcTurnContext context) {
        if (context.initialClaim() == null || context.initialClaim().isBlank()) {
            return "제 업무 기록을 확인하고 있었습니다.";
        }
        return context.initialClaim().trim();
    }

    private QuestionIntent questionIntent(NpcTurnContext context) {
        String question = normalizedQuestion(context);
        if (containsAny(question, "발견", "시신", "현장", "처음 봤")) {
            return QuestionIntent.DISCOVERY;
        }
        if (containsAny(question, "동선", "어디", "언제", "시간", "순서", "당일", "전날", "다음 날")) {
            return QuestionIntent.TIMELINE;
        }
        if (!context.presentedClueIds().isEmpty()
                || containsAny(question, "기록", "로그", "자료", "증거", "권한", "단말", "봉인")) {
            return QuestionIntent.EVIDENCE;
        }
        if (containsAny(question, "감사", "동기", "다퉜", "갈등", "돈", "예산", "화물")) {
            return QuestionIntent.MOTIVE;
        }
        return QuestionIntent.GENERAL;
    }

    private NpcTurnResponse.Emotion chooseFallbackEmotion(NpcTurnContext context) {
        if (isHostile(context)) {
            return NpcTurnResponse.Emotion.ANGRY;
        }
        if (isEscalatingAccusation(context)) {
            if (hasTrait(context, "정보를 선택", "경계 설정", "선택적으로 공개")) {
                return NpcTurnResponse.Emotion.EVASIVE;
            }
            if (hasTrait(context, "과잉 설명")) {
                return NpcTurnResponse.Emotion.ANXIOUS;
            }
            return NpcTurnResponse.Emotion.DEFENSIVE;
        }
        if (!context.presentedClueIds().isEmpty()) {
            if (hasTrait(context, "정보를 선택", "경계 설정", "선택적으로 공개")) {
                return NpcTurnResponse.Emotion.EVASIVE;
            }
            if (hasTrait(context, "감정적", "억울", "과잉 설명")) {
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
        if (hasTrait(context, "감정적", "억울", "과잉 설명")) {
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

    private boolean hasTrait(NpcTurnContext context, String... fragments) {
        return context.personalityTraits().stream()
                .map(trait -> trait.toLowerCase(Locale.ROOT))
                .anyMatch(trait -> java.util.Arrays.stream(fragments)
                        .map(fragment -> fragment.toLowerCase(Locale.ROOT))
                        .anyMatch(trait::contains));
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

    private String normalizedQuestion(NpcTurnContext context) {
        return context.question().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private boolean containsAny(String value, String... terms) {
        return java.util.Arrays.stream(terms).anyMatch(value::contains);
    }

    private enum QuestionIntent {
        DISCOVERY,
        TIMELINE,
        EVIDENCE,
        MOTIVE,
        GENERAL
    }

    public record Reply(NpcTurnResponse.Emotion emotion, String dialogue) {}
}
