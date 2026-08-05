import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-card bg-white p-5 shadow-card ${className}`}
      {...props}
    />
  );
}
