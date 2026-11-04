import { legacyAdminGone } from "@/lib/website/legacy-gone";

function gone() {
  return legacyAdminGone("/api/admin/totp/enable");
}

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
export const HEAD = gone;
export const OPTIONS = gone;
