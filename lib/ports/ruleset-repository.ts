export interface RuleSetRepository {
  getByCountry(code: string): Promise<{ country: string; cost_basis: string; badge_label: string } | null>;
}
