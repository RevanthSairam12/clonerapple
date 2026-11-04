import { legacyAdminGone } from '@/lib/website/legacy-gone';

// The concrete media/[id] GET takes precedence and remains public.
function gone() {
  return legacyAdminGone('/api/admin/[...rest]');
}

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
export const HEAD = gone;
export const OPTIONS = gone;
