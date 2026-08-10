package com.arcadia.station.ai.template;

import java.util.List;

public record WorldTemplate(
        String templateId,
        String version,
        String locale,
        Setting setting,
        List<CharacterDefinition> characters,
        List<LocationDefinition> locations,
        List<StationSystemDefinition> systems,
        List<EvidenceSourceDefinition> evidenceSources
) {
    public record Setting(
            String name,
            String era,
            String summary,
            List<String> publicFacts,
            List<String> privateFacts,
            List<String> worldInvariants,
            List<String> forbiddenElements
    ) {}

    public record CharacterDefinition(
            String id,
            String displayName,
            String occupation,
            boolean suspect,
            String publicProfile,
            NpcPersona persona,
            List<String> personalityTraits,
            List<String> skills,
            List<String> physicalAccess,
            List<SystemPermission> systemPermissions,
            List<String> knowledgeDomains,
            List<String> motiveDomains,
            List<RelationshipSeed> relationshipSeeds,
            String privateBackground,
            List<String> forbiddenCapabilities
    ) {}

    /**
     * 플레이어에게 알려져도 되는 인물 연기 기준이다. 사건의 비밀이나 범행 여부는 넣지 않고,
     * 실AI 프롬프트와 안전 폴백이 같은 말투를 유지할 수 있도록 공개 배경만 둔다.
     */
    public record NpcPersona(
            int age,
            String background,
            String baselineAttitude,
            String pressureResponse,
            List<String> speechHabits
    ) {}

    public record SystemPermission(String systemId, List<String> allowedOperations) {}

    public record RelationshipSeed(
            String characterId,
            String publicRelation,
            List<String> privatePossibilities
    ) {}

    public record LocationDefinition(
            String id,
            String displayName,
            String publicDescription,
            String accessCondition,
            List<String> connectedLocationIds,
            List<String> installedSystemIds,
            List<String> investigableObjectTypes,
            List<String> evidenceSourceTypes
    ) {}

    public record StationSystemDefinition(
            String id,
            String displayName,
            List<String> responsibleRoles,
            List<String> accessibleCharacterIds,
            List<String> allowedOperations,
            List<String> dependentSystemIds,
            List<String> auditSourceTypes,
            List<String> limitations
    ) {}

    public record EvidenceSourceDefinition(String type, List<String> requiredMetadataKeys) {}
}
