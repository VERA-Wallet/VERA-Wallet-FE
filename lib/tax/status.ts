import type { ConfirmationStatus } from "@/lib/tax/types";

/**
 * 이 추정이 부담액을 산출하지 않았는가.
 *
 * `UNDETERMINED` 규칙이 확정되지 않아 계산 자체를 할 수 없다.
 * `SCHEDULED`    규칙은 확정됐지만 이 과세기간에는 시행 전이라 과세 대상이 아니다(한국 2027-01-01).
 *
 * 두 경우 모두 totals가 전부 0이다. 그 0을 그대로 답으로 깔면("₩0") 사용자는 "계산했더니 낼 게 없구나"로 읽고,
 * 이벤트를 하나 빼서 0을 차분하면 "이 거래는 부담에 영향 없음"이라는 없는 사실을 말하게 된다.
 * 그래서 분기점을 화면마다 따로 쓰지 않고 여기 하나로 고정한다.
 */
export function omitsCharge(status: ConfirmationStatus): boolean {
  return status === "UNDETERMINED" || status === "SCHEDULED";
}

/** 0이 나온 이유를 한 줄로. 두 상태를 같은 문장으로 말하면 "미확정"과 "시행 전"이 뭉개진다. */
export function noChargeHeadline(status: ConfirmationStatus): string {
  return status === "SCHEDULED" ? "과세 대상 아님" : "산출 불가";
}
