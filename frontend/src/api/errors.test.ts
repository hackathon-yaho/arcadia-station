import { describe, expect, it } from "vitest";
import { ArcadiaApiError, isSessionLost } from "./errors";

describe("isSessionLost", () => {
  it("서버가 세션을 모르면 소실로 본다", () => {
    expect(
      isSessionLost(new ArcadiaApiError("세션을 찾을 수 없습니다.", "SESSION_NOT_FOUND", false)),
    ).toBe(true);
  });

  it("다시 붙으면 그만인 실패는 소실로 보지 않는다", () => {
    // 이걸 소실로 판정하면 서버 재기동이나 잠깐의 통신 장애마다 멀쩡한 진행 상황을 버리게 된다.
    expect(
      isSessionLost(new ArcadiaApiError("게임 서버와 통신하지 못했습니다.", "NETWORK_ERROR", true)),
    ).toBe(false);
    expect(
      isSessionLost(new ArcadiaApiError("서버 오류가 발생했습니다.", "SERVER_ERROR", true)),
    ).toBe(false);
  });

  it("진행을 막을 뿐 세션은 살아 있는 오류도 소실이 아니다", () => {
    expect(
      isSessionLost(new ArcadiaApiError("이미 종료된 세션입니다.", "INVALID_SESSION_STATE", false)),
    ).toBe(false);
  });

  it("API 오류가 아니면 판단하지 않는다", () => {
    expect(isSessionLost(new Error("SESSION_NOT_FOUND"))).toBe(false);
    expect(isSessionLost(null)).toBe(false);
    expect(isSessionLost(undefined)).toBe(false);
  });
});
