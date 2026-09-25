import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`min-w-0 max-w-full rounded-card bg-white p-5 shadow-card ${className}`}
      {...props}
    />
  );
}
