'use client';

import { useEffect } from 'react';
import { useCart } from '@/lib/cart/CartContext';

/**
 * Empties the bag only once the order is confirmed paid.
 *
 * The checkout form used to clear the cart before handing the customer to
 * PayU, so a blocked or abandoned gateway redirect wiped the bag and the next
 * checkout looked like "this item is unavailable".
 */
export function ClearCartOnSuccess() {
  const { clearCart } = useCart();

  useEffect(() => {
    clearCart();
  }, [clearCart]);

  return null;
}
