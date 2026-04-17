import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware class merger. All shadcn-style components in this app
 * route their `className` props through `cn()` so conditional and
 * override classes compose without specificity fights.
 *
 *   cn("px-4 py-2", isDanger && "bg-destructive")
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
