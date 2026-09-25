"use client";

import { useState } from "react";
import { useSetValueOverride } from "@/lib/queries/events";
import { assetFlow } from "@/lib/review";
import type { EventRecord } from "@/lib/transactions/types";
import type { NormalizedEvent } from "@/lib/schema/normalized-event";

/**
 * 한 거래의 금액 override 입력 — 취득가·양도가·부대비용·가스비·가격출처·증빙·50% 필요경비 의제.
 *
 * 재분류 state와 섞지 않으려고 독립 컴포넌트로 둔다(각자 자기 입력만 동기화한다).
 * 저장하면 estimate·요약·판정 캐시가 무효화돼(useSetValueOverride) 취득가 0원 경고가 사라지고 부담이 다시 계산된다.
 */
export function ValueOverrideEditor({
  event,
  version,
  onSaved,
}: {
  event: NormalizedEvent;
  version: number;
  onSaved: (mutation: EventRecord) => void;
}) {
  const setOverride = useSetValueOverride();
  const vo = event.value_override;
  const [acquisitionCost, setAcquisitionCost] = useState(vo?.acquisition_cost ?? "");
  const [disposalValue, setDisposalValue] = useState(vo?.disposal_value ?? "");
  const [incidentalCost, setIncidentalCost] = useState(vo?.incidental_cost ?? "");
  const [gasFee, setGasFee] = useState(vo?.gas_fee ?? "");
  const [priceSource, setPriceSource] = useState(vo?.price_source ?? "");
  const [evidenceUrl, setEvidenceUrl] = useState(vo?.evidence_url ?? "");
  const [deemed50, setDeemed50] = useState(vo?.deemed_expense_50 ?? false);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);

  const flow = assetFlow(event);
  const isDisposal = flow === "out";
  // 저장된 override가 하나라도 있으면 접힌 줄에서 그렇다고 말한다(입력 중인 state가 아니라 **저장된 사실**).
  const hasOverride =
    vo !== undefined &&
    vo !== null &&
    (vo.acquisition_cost !== null ||
      vo.disposal_value !== null ||
      vo.incidental_cost !== null ||
      vo.gas_fee !== null ||
      vo.price_source !== null ||
      vo.evidence_url !== null ||
      vo.deemed_expense_50 === true);
  // 빈 입력은 "비움"(null)으로 저장한다. 공백만 남긴 것도 같게 본다.
  const clean = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };

  const save = () => {
    setSaved(false);
    setConflict(false);
    setOverride.mutate(
      {
        id: event.id,
        input: {
          expectedVersion: version,
          value_override: {
            acquisition_cost: clean(acquisitionCost),
            disposal_value: clean(disposalValue),
            incidental_cost: clean(incidentalCost),
            gas_fee: clean(gasFee),
            price_source: clean(priceSource),
            evidence_url: clean(evidenceUrl),
            deemed_expense_50: deemed50,
          },
        },
      },
      {
        onSuccess: (result) => {
          if (result.status === "not_found") return;
          onSaved({ event: result.event, version: result.version });
          setConflict(result.status === "conflict");
          setSaved(result.status === "ok");
        },
      },
    );
  };

  const fieldClass = "mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2.5";
  const labelClass = "mt-3 block text-sm font-medium text-zinc-700";

  return (
    <details className="mt-6 border-t border-zinc-200 pt-5" data-surface="value-override">
      <summary className="cursor-pointer font-bold text-zinc-900 marker:text-zinc-400">
        취득가·부대비용 입력
        {/* 접힌 채로는 "내가 직접 채운 금액이 이미 있는지"를 알 길이 없다 — 그 사실만은 겉에 남긴다. */}
        <span className="ml-2 text-sm font-medium text-zinc-500">{hasOverride ? "직접 입력한 금액 있음" : "비어 있음"}</span>
      </summary>
      <p className="mt-2 text-sm text-zinc-500">취득가액과 비용을 확인할 수 있는 자료를 기준으로 입력해 주세요. 저장한 금액은 계산에 반영됩니다.</p>
      {conflict ? <p role="alert" className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">금액이 변경되었습니다. 최신 내용을 확인해 주세요.</p> : null}
      {saved && !conflict ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">금액을 저장했습니다.</p> : null}

      {isDisposal ? (
        <>
          <label className={labelClass} htmlFor="vo-disposal">양도가액 (원)</label>
          <input id="vo-disposal" inputMode="numeric" className={fieldClass} placeholder="예: 5000000" value={disposalValue} onChange={(e) => setDisposalValue(e.target.value)} />
        </>
      ) : (
        <>
          <label className={labelClass} htmlFor="vo-acquisition">취득가액 (원)</label>
          <input id="vo-acquisition" inputMode="numeric" className={fieldClass} placeholder="예: 1000000" value={acquisitionCost} onChange={(e) => setAcquisitionCost(e.target.value)} />
        </>
      )}

      <label className={labelClass} htmlFor="vo-incidental">부대비용 (원)</label>
      <input id="vo-incidental" inputMode="numeric" className={fieldClass} placeholder="예: 5000" value={incidentalCost} onChange={(e) => setIncidentalCost(e.target.value)} />

      <label className={labelClass} htmlFor="vo-gas">가스비 (원)</label>
      <input id="vo-gas" inputMode="numeric" className={fieldClass} placeholder="예: 3000" value={gasFee} onChange={(e) => setGasFee(e.target.value)} />

      <label className={labelClass} htmlFor="vo-source">가격 출처 (선택)</label>
      <input id="vo-source" className={fieldClass} placeholder="예: 업비트 종가" value={priceSource} onChange={(e) => setPriceSource(e.target.value)} />

      <label className={labelClass} htmlFor="vo-evidence">증빙 링크 (선택)</label>
      <input id="vo-evidence" className={fieldClass} placeholder="https://" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} />

      {isDisposal ? (
        <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="mt-0.5" checked={deemed50} onChange={(e) => setDeemed50(e.target.checked)} />
          <span>취득가 입증이 어려우면 양도가액의 50%를 필요경비로 인정</span>
        </label>
      ) : null}

      <button type="button" className="mt-4 w-full rounded-lg bg-primary-500 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={setOverride.isPending} onClick={save}>금액 저장</button>
    </details>
  );
}
