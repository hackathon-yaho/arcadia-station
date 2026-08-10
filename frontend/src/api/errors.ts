/**
 * API 오류 정규화. mock 어댑터와 HTTP 어댑터가 같은 오류 타입을 던져야
 * 화면의 재시도 분기가 모드와 무관하게 동작한다.
 */
export class ArcadiaApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ArcadiaApiError";
  }
}

/**
 * 서버가 이 세션을 더는 모르는 상태인지.
 *
 * 사건 데이터는 전부 서버에 있고 클라이언트는 세션 ID만 들고 있다. 서버에서 그 ID가 사라지면
 * 진행 상황을 되살릴 방법이 없으므로 새 사건으로 보내야 한다. 반대로 통신 실패나 서버 재기동처럼
 * 다시 붙으면 그만인 오류까지 여기 포함하면, 멀쩡한 진행 상황을 버리게 된다.
 */
export function isSessionLost(error: unknown): boolean {
  return error instanceof ArcadiaApiError && error.code === "SESSION_NOT_FOUND";
}
