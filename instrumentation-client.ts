import { installPerformanceDiagnostics, navigationStarted } from "@/lib/diagnostics/performance";
installPerformanceDiagnostics();
export function onRouterTransitionStart(url: string) { navigationStarted(url); }
