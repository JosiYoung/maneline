import { toast } from "sonner";

/**
 * Central toast wrapper — all app-wide notifications go through this so
 * styling and message conventions stay consistent. See
 * FRONTEND-UI-GUIDE.md §8.
 *
 * Mount the `<Toaster />` once at the app root (see src/main.tsx).
 */
export const notify = {
  success: (msg: string) => toast.success(msg),
  error: (msg: string) => toast.error(msg),
  info: (msg: string) => toast.info(msg),
  // Protocol / supplement reminder — longer-lived so it's not missed.
  reminder: (animal: string, protocolName: string) =>
    toast(`${animal}: ${protocolName} due now`, { duration: 10000 }),
};
