package com.arcadia.station.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * sessionId(프론트가 아는 ID)와 aiCaseRequestId(AI 서버가 아는 ID)를 분리해서 보관한다.
 * AI 서버는 같은 sessionId로 재요청하면 409를 반환하므로, 재시도 시 aiCaseRequestId만 새로 발급한다(스펙 3.1/4.5절).
 */
@Entity
@Table(name = "game_sessions")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GameSession {

    @Id
    @Column(nullable = false, updatable = false)
    private String sessionId;

    @Column(nullable = false)
    private String aiCaseRequestId;

    @Column(nullable = false)
    private int caseRequestAttemptCount;

    // 4.1절: 재현 가능한 리플레이를 위해 원본 seed를 보관해뒀다가 재시도 시에도 그대로 넘긴다.
    private String seed;

    // 4.4/4.5절: 현재 aiCaseRequestId로 몇 시부터 폴링을 시작했는지, 마지막으로 언제 폴링했는지.
    // 재시도로 aiCaseRequestId가 바뀌면 currentAttemptStartedAt도 초기화된다.
    private Instant currentAttemptStartedAt;
    private Instant lastPolledAt;

    // Hibernate가 @Enumerated(STRING) 컬럼에 "생성 시점의" enum 값만 허용하는 CHECK 제약을
    // 자동으로 만든다. ddl-auto=update는 기존 제약을 갱신하지 않으므로, SessionState에 새 값을
    // 추가해도(INCORRECT 등) 이미 떠 있는 DB는 여전히 옛 제약을 들고 있어 INSERT/UPDATE가
    // 500(DataIntegrityViolationException)으로 실패한다. columnDefinition을 명시해 Hibernate가
    // 이 제약을 만들지 않게 한다 — enum 값 유효성은 애플리케이션 레이어(Java enum)가 책임진다.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, columnDefinition = "varchar(32)")
    private SessionState state;

    private String worldTemplateId;
    private String worldTemplateVersion;
    private String ruleTemplateId;
    private String ruleTemplateVersion;
    private String blueprintId;
    private String blueprintSha256;
    private String generationSource;

    // 4.2절: READY 응답과 함께 오는 메타데이터. 3.1절 필드 목록에는 없지만 저장 대상으로 명시됨.
    private Integer generationAttemptCount;
    private String model;
    private String promptVersion;

    // 4.4절: "완료 응답 원문(JSON)과 blueprintSha256을 함께 저장한다" — CaseBlueprint 원문 보관용.
    // @Lob은 PostgreSQL에서 text가 아니라 oid(대용량 객체)로 매핑되므로 명시적으로 text 컬럼을 쓴다.
    @Column(columnDefinition = "text")
    private String caseBlueprintJson;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    private Instant frozenAt;

    // 13장: AI 서버가 세션 메모리를 잃어 404 SESSION_NOT_FOUND를 반환한 적이 있는 세션을 운영 로그/추적용으로 표시.
    // 기존 행이 있는 테이블에 ddl-auto=update로 NOT NULL 컬럼을 추가할 때 DEFAULT가 없으면 실패하므로 명시한다.
    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private boolean aiSessionLost;

    public GameSession(String sessionId, String aiCaseRequestId, Instant createdAt) {
        this.sessionId = sessionId;
        this.aiCaseRequestId = aiCaseRequestId;
        this.caseRequestAttemptCount = 1;
        this.state = SessionState.CREATING;
        this.createdAt = createdAt;
        this.currentAttemptStartedAt = createdAt;
    }
}
