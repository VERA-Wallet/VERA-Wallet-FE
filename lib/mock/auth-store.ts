import "server-only";

import { randomUUID } from "node:crypto";

import type { SiweChallengeRecord, SiweChallengeStore } from "@/lib/ports/nonce-store";
import { emptyOnboardingSession, type OnboardingSession, type SessionStore } from "@/lib/ports/session-store";

// Development-only in-memory stores assume one server process and one event loop.
export class MockAuthStore implements SiweChallengeStore, SessionStore {
  private readonly challenges = new Map<string, SiweChallengeRecord>();
  private readonly sessions = new Map<string, OnboardingSession>();

  async issue(record: SiweChallengeRecord) { this.challenges.set(record.jti, record); }
  async peek(jti: string) { return this.challenges.get(jti) ?? null; }
  async consume(jti: string, sessionId: string): Promise<"ok" | "not-found" | "expired" | "already-consumed"> {
    const record = this.challenges.get(jti);
    if (!record) return "not-found";
    if (record.sessionId !== sessionId) return "not-found";
    if (record.expiresAtMs <= Date.now()) return "expired";
    if (record.consumedAt !== null) return "already-consumed";
    record.consumedAt = Date.now();
    return "ok";
  }
  async get(sessionId: string) { return this.sessions.get(sessionId) ?? null; }
  async set(sessionId: string, session: OnboardingSession) { this.sessions.set(sessionId, session); }
  async destroy(sessionId: string) { this.sessions.delete(sessionId); }
}

export const SESSION_COOKIE = "vw_session";
export const newSessionId = () => randomUUID();
export const sessionCookie = (value: string, maxAge = 60 * 60): string =>
  `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
export const blankSession = emptyOnboardingSession;
