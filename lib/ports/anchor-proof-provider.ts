export interface AnchorProofProvider {
  getProof(eventId: string): Promise<{
    tx_hash: string;
    merkle_root: string;
    anchored_at: string;
    explorer_url: string | null;
  } | null>;
}
