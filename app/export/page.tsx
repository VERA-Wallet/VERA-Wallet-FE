import { redirect } from "next/navigation";
import { requireCompletedOnboarding, requireDidSession } from "@/lib/dal";
import { ExportView } from "@/components/export/export-view";

export default async function ExportPage() {
  if (await requireCompletedOnboarding()) return <ExportView />;
  redirect(await requireDidSession() ? "/connect-wallet" : "/login");
}
