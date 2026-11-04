import Link from 'next/link';

import { CouponForm } from '@/components/store-admin/CouponForm';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listBrands, listCategoryOptions } from '@/lib/store-admin/catalog';
import { listCouponProductOptions } from '@/lib/store-admin/coupons';

export const dynamic = 'force-dynamic';

/**
 * New coupon, or a batch of single-use codes from one template. The form is
 * the same shape for both; only the submit endpoint and the code fields differ.
 */
export default async function StoreAdminNewCouponPage() {
  const session = await getStoreSession();
  if (session?.role !== 'store_admin' && session?.role !== 'store_owner') {
    return (
      <div>
        <Link className="sa-back" href="/store-admin/coupons">← Coupons</Link>
        <h1 className="sa-page-title">New coupon</h1>
        <p className="sa-lock-note">A viewer cannot create or generate coupons.</p>
      </div>
    );
  }

  const [products, categories, brands] = await Promise.all([
    listCouponProductOptions(),
    listCategoryOptions(),
    listBrands(),
  ]);

  const available = products.ok && categories.ok && brands.ok;

  return (
    <div>
      <Link className="sa-back" href="/store-admin/coupons">
        ← Coupons
      </Link>
      <h1 className="sa-page-title">New coupon</h1>
      <p className="sa-page-sub">
        A whole-order code or one limited to chosen products, categories or brands. The
        discount is always computed on the server inside the order transaction.
      </p>

      {!available ? (
        <p className="sa-notice">
          The product, category or brand list could not be read. Check the database connection
          and that migration 0041 is applied.
        </p>
      ) : (
        <CouponForm
          products={products.data}
          categories={categories.data.map((category) => ({
            id: category.id,
            name: category.name,
          }))}
          brands={brands.data
            .filter((brand) => brand.deletedAt === null)
            .map((brand) => ({ id: brand.id, name: brand.name }))}
        />
      )}
    </div>
  );
}
