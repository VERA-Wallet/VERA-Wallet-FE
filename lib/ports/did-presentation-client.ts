export interface DidPresentationClient {
  createPresentation(input: { country: "KR" | "US" | "UK" | "DE" }): Promise<{ country: "KR" | "US" | "UK" | "DE" }>;
}
