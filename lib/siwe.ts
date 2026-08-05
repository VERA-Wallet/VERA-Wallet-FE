import "server-only";

import { SiweMessage } from "siwe";
import { verifyMessage } from "viem";

import type { SiweChallengeRecord } from "@/lib/ports/nonce-store";

export type ParsedSiweMessage = Pick<SiweMessage, "address" | "domain" | "uri" | "chainId" | "nonce" | "issuedAt">;

export function parseSiweMessage(message: string): ParsedSiweMessage | null {
  try {
    const parsed = new SiweMessage(message);
    return parsed.issuedAt ? parsed : null;
  } catch { return null; }
}

export function compareChallenge(message: ParsedSiweMessage, record: SiweChallengeRecord): string | null {
  if (message.nonce !== record.jti) return "nonce";
  if (message.domain !== record.domain) return "domain";
  if (message.uri !== record.uri) return "uri";
  if (message.chainId !== record.chainId) return "chainId";
  if (message.issuedAt !== record.issuedAt) return "issuedAt";
  return null;
}

export async function verifySiweSignature(message: string, signature: string, address: string): Promise<boolean> {
  try { return await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }); }
  catch { return false; }
}
