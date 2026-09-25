import type { ComponentPropsWithoutRef } from "react";

/** Preserve the complete value, including on narrow screens and with enlarged text. */
export function ValueText({ className = "", ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      data-layout-value=""
      className={`inline-block min-w-0 max-w-full align-bottom whitespace-normal wrap-anywhere tabular-nums ${className}`}
      {...props}
    />
  );
}
