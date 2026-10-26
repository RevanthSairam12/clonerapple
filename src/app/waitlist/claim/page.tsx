import Link from 'next/link';

import { ReservationCountdown } from '@/components/checkout/ReservationCountdown';
import { getUserSession } from '@/lib/user-auth';
import { isInvitationToken, invitationSecondsRemaining } from '@/lib/waitlist/rules';
import { getInvitationByToken } from '@/lib/waitlist/store';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ token?: string }>;
}

/**
 * Opening an invitation re-checks it: ownership, expiry, the product still being
 * active and the unit still being HELD. Seeing this page is not a purchase; the
 * customer must complete checkout, and the unit is only theirs once PayU's
 * capture is verified.
 */
export default async function ClaimPage({ searchParams }: Props) {
  const { token: rawToken } = await searchParams;
  const token = (rawToken ?? '').trim();
  const session = await getUserSession();

  if (!isInvitationToken(token)) {
    return (
      <Shell title="This invitation link is not valid">
        <p className="text-sm text-[#86868b]">
          Open the link from your invitation email, or check the product page for current
          availability.
        </p>
        <Link href="/" className="mt-6 inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">
          Return to Store
        </Link>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell title="Sign in to claim your unit">
        <p className="text-sm text-[#86868b]">
          This reservation belongs to a customer account. Sign in with the account that received
          the invitation to continue.
        </p>
        <Link
          href={`/auth?redirect=${encodeURIComponent(`/waitlist/claim?token=${token}`)}`}
          className="mt-6 inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium"
        >
          Sign In
        </Link>
      </Shell>
    );
  }

  const invitation = await getInvitationByToken(token);
  const productHref = invitation
    ? `/shop/product/${encodeURIComponent(invitation.productId)}`
    : '/shop';

  if (!invitation || invitation.userId !== session.userId) {
    return (
      <Shell title="This reservation is no longer available">
        <p className="text-sm text-[#86868b]">
          The invitation was already used, expired, or belongs to a different account. If the
          product is still unavailable, join the waiting list again from its product page.
        </p>
        <Link href={productHref} className="mt-6 inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">
          View the product
        </Link>
      </Shell>
    );
  }

  if (!invitation.isOpen) {
    return (
      <Shell title="This reservation has expired">
        <p className="text-sm text-[#86868b]">
          The held unit for {invitation.productName} was offered to the next customer because the
          claim window ended. This link cannot reserve it again, but you can join the waiting list
          from the product page.
        </p>
        <Link href={productHref} className="mt-6 inline-block bg-[#0071e3] text-white px-6 py-2.5 rounded-full text-sm font-medium">
          View the product
        </Link>
      </Shell>
    );
  }

  const seconds = invitationSecondsRemaining(invitation.expiresAt, new Date());
  const checkoutHref = `/checkout?reservationToken=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f] flex items-center justify-center">
      <div className="max-w-lg w-full bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea]">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
          Reserved for you
        </span>
        <h1 className="text-2xl font-semibold tracking-tight mt-3 mb-2">
          {invitation.productName}
        </h1>
        <p className="text-sm text-[#86868b] mb-6">
          One unit is being held for your account. Complete checkout before the countdown ends.
        </p>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-6">
          <ReservationCountdown seconds={seconds} label="Your unit is held for" />
        </div>

        <div className="bg-[#fbfbfd] rounded-2xl p-4 border border-[#e5e5ea] mb-6 text-sm space-y-2">
          <div className="flex justify-between gap-3">
            <span className="text-[#86868b]">Price</span>
            <span className="font-semibold">₹{(invitation.pricePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-[#86868b]">Quantity held</span>
            <span className="font-medium">1</span>
          </div>
        </div>

        <p className="text-xs text-[#86868b] mb-6">
          This reservation does not complete a purchase by itself. The unit is yours only after
          payment is verified; if the reservation expires first, it is offered to the next
          customer.
        </p>

        <Link
          href={checkoutHref}
          className="block w-full text-center bg-[#0071e3] text-white py-3.5 rounded-full text-sm font-medium hover:bg-[#0077ed] transition"
        >
          Continue to checkout
        </Link>
        <Link
          href={productHref}
          className="mt-3 block w-full text-center bg-[#f5f5f7] text-[#1d1d1f] py-3.5 rounded-full text-sm font-medium hover:bg-[#e8e8ed] transition"
        >
          View product details
        </Link>
      </div>
    </div>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f5f7] py-12 px-4 sm:px-6 lg:px-8 text-[#1d1d1f] flex items-center justify-center">
      <div className="max-w-md w-full bg-white rounded-3xl p-8 sm:p-10 shadow-sm border border-[#e5e5ea] text-center">
        <h1 className="text-2xl font-semibold tracking-tight mb-3">{title}</h1>
        {children}
      </div>
    </div>
  );
}
