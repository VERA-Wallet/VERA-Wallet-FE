"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { navigationCommitted } from "@/lib/diagnostics/performance";
export function NavigationTiming() {
  const path = usePathname();
  useEffect(() => { if (path) navigationCommitted(path); }, [path]);
  return null;
}
