import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refreshRegisteredWallets, walletsQueryKey, holdingsQueryKey } from "@/lib/queries/holdings";

describe("wallet registration cache refresh", () => {
  it("fetches the added wallet even when the prior list is still within its freshness window", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
    client.setQueryData(walletsQueryKey, { wallets: ["old"] });
    client.setQueryData([...holdingsQueryKey, "*"], { wallets: ["old"] });
    client.setQueryData(["unrelated"], "keep");
    await refreshRegisteredWallets(client);
    expect(await client.fetchQuery({ queryKey: walletsQueryKey, queryFn: async () => ({ wallets: ["old", "added"] }) })).toEqual({ wallets: ["old", "added"] });
    expect(client.getQueryState([...holdingsQueryKey, "*"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
    client.clear();
  });

  it("ignores a pre-registration response arriving after the new list was fetched", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
    let resolve!: (wallets: string[]) => void;
    const oldRequest = client.fetchQuery({ queryKey: walletsQueryKey, queryFn: () => new Promise<string[]>(done => { resolve = done; }) }).catch(() => undefined);
    await refreshRegisteredWallets(client);
    await client.fetchQuery({ queryKey: walletsQueryKey, queryFn: async () => ["old", "added"] });
    resolve(["old"]);
    await oldRequest;
    expect(client.getQueryData(walletsQueryKey)).toEqual(["old", "added"]);
    client.clear();
  });
});
