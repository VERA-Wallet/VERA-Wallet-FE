import Link from "next/link";
import { Settings } from "lucide-react";

export function SettingsLink() {
  return (
    <Link href="/settings" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">
      <Settings aria-hidden="true" className="size-5" />
      설정
    </Link>
  );
}
