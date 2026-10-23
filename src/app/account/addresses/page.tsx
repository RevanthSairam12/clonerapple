import { AccountFrame } from '@/components/account/AccountFrame';
import { AddressesManager } from '@/components/account/AddressesManager';
import { requireAccountPageSession } from '@/lib/account/auth';
import { listCustomerAddresses } from '@/lib/account/addresses';

export const dynamic = 'force-dynamic';

export default async function AccountAddressesPage() {
  const session = await requireAccountPageSession('/account/addresses');
  const addresses = await listCustomerAddresses(session.userId);
  return <AccountFrame session={session} active="/account/addresses"><AddressesManager initial={addresses} /></AccountFrame>;
}
