import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Shared INR currency formatter. Formats numbers into Indian Rupee format (e.g. ₹2,499.00).
 * Never outputs any dollar symbol.
 */
export function formatINR(price: number): string {
  return `₹${price.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

