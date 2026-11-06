-- 0062: Re-derive the storefront gate for products already selling by option.
--
-- `products.in_stock` predates variant inventory. It was written only while a
-- product was in product mode, and activation left whatever value it had. A
-- product activated while its parent balance was zero therefore kept
-- `in_stock = false` forever, and the storefront published "Stock not
-- available" over options that were genuinely buyable. Options were never the
-- problem: the flag was simply stale.
--
-- In variant mode there is no product-level stock pool, so the column is a
-- gate and never a count. It means "at least one option is buyable" — an
-- untracked active option counts as buyable, matching stockStateFrom().
--
-- Additive and idempotent: it recomputes one boolean column and touches no
-- other row, column or table. Products in product mode are left exactly as
-- they are.

update products p
   set in_stock = exists (
         select 1
           from stock s
           join product_variants v
             on v.id = s.variant_id
            and v.product_id = s.product_id
          where s.product_id = p.id
            and v.is_active
            and v.is_purchasable
            and v.retired_at is null
            and (not s.track_inventory or s.on_hand - s.reserved > 0)
       ),
       updated_at = now()
 where p.inventory_mode = 'variant'
   and p.deleted_at is null
   and p.in_stock is distinct from exists (
         select 1
           from stock s
           join product_variants v
             on v.id = s.variant_id
            and v.product_id = s.product_id
          where s.product_id = p.id
            and v.is_active
            and v.is_purchasable
            and v.retired_at is null
            and (not s.track_inventory or s.on_hand - s.reserved > 0)
       );
