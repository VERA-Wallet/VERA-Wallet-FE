import type { EvidenceDocument } from "@/lib/tax/evidence";

/** 체인에 봉인된 계산 근거 한 건. 값은 전부 서버가 확정한 사실이다 — FE가 지어내지 않는다. */
export type EvidenceRecord = {
  merkleRoot: string;
  countryCode: string;
  taxYear: number;
  leafCount: number;
  recordedAt: string;
  /** pending = 제출했고 아직 체인에 안 실림, anchored = 실림, failed = 재시도 소진. */
  anchorStatus: string;
  txHash: string | null;
  blockNumber: string | null;
  anchoredAt: string | null;
  explorerUrl: string | null;
};

/**
 * 체인을 직접 읽어 대조한 결과. OmniOne에는 블록 탐색기가 없어 사용자가 트랜잭션을 눈으로 볼 수 없으므로,
 * 서버가 대신 읽어 "체인의 해시 == 내 근거의 루트"를 확인해 준다.
 */
export type EvidenceChainCheck = {
  merkleRoot: string;
  txHash: string | null;
  blockNumber: string | null;
  /** 체인을 읽는 데 성공했는가. false면 아래 값은 "아니다"가 아니라 "모른다"이다. */
  readFromChain: boolean;
  success: boolean;
  anchoredPayloadHash: string | null;
  matches: boolean;
  checkedAt: string;
};

export interface TaxEvidenceProvider {
  /** 정본 문서를 올린다. 서버가 루트를 다시 계산하므로 FE 루트와 어긋나면 거절된다. */
  record(document: EvidenceDocument): Promise<EvidenceRecord>;
  /** 그 해에 이미 봉인한 근거. 없으면 null — 화면이 "아직 기록 안 함"을 말할 근거다. */
  latest(country: string, taxYear: number): Promise<EvidenceRecord | null>;
  /** 체인을 지금 읽어 대조한다. 저장된 값을 되읽는 것이 아니라 체인에 묻는다. */
  checkChain(merkleRoot: string): Promise<EvidenceChainCheck>;
}
