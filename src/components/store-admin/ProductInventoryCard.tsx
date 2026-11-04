'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface StockValues {
  onHand: number;
  reserved: number;
  lowStockThreshold: number;
  trackInventory: boolean;
}

interface Props {
  productId: string;
  stock: StockValues | null;
  canEdit: boolean;
  inventoryMode?: 'product'|'variant';
  variants?: Array<{id:string;sku:string|null;optionValue:string;isActive:boolean;isPurchasable:boolean}>;
}

/**
 * The Inventory section on the product page. Counts move only through
 * `stock_movements`: the first save for a product without a stock row records
 * the opening count as a receipt, and later corrections go through the stock
 * detail page so the append-only log stays complete.
 */
export function ProductInventoryCard({ productId, stock, canEdit,inventoryMode='product',variants=[] }: Props) {
  const router = useRouter();
  const [tracking, setTracking] = useState(stock?.trackInventory ?? false);
  const [threshold, setThreshold] = useState(String(stock?.lowStockThreshold ?? 0));
  const [openingOnHand, setOpeningOnHand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [allocations,setAllocations]=useState<Record<string,string>>({});
  const [activationReason,setActivationReason]=useState('');
  async function activate(){
    const rows=Object.entries(allocations).map(([variantId,count])=>({variantId,quantity:Number(count)}));
    if(Object.values(allocations).some(v=>!v.trim())||!activationReason.trim()){setError('Enter explicit allocation counts and an activation reason.');return;}
    if(!window.confirm('Activate variant inventory? Legacy balances remain separate. Only the explicit counts entered will transfer; no split is inferred. Legacy holds or outstanding sales will block activation.'))return;
    setBusy(true);setError(null);try{
      const response=await fetch(`/api/store-admin/catalog/products/${encodeURIComponent(productId)}/variant-inventory`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'activate',confirm:true,reason:activationReason,allocations:rows})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??'Activation failed.');router.refresh();
    }catch(e){setError(e instanceof Error?e.message:'Activation failed.');}finally{setBusy(false);}
  }
  const available = stock ? Math.max(0, stock.onHand - stock.reserved) : null;
  const needsOpeningCount = stock === null && tracking;

  async function save() {
    setError(null);
    setNotice(null);

    if (stock && stock.trackInventory && !tracking) {
      const confirmed = window.confirm(
        'Stop limiting stock? Checkout will stop checking stock for this '
          + 'product, so it can be oversold. Continue?',
      );
      if (!confirmed) return;
    }

    let onHand: number | undefined;
    if (needsOpeningCount) {
      onHand = Number(openingOnHand);
      if (!Number.isInteger(onHand) || onHand < 0) {
        setError('Enter the current in-stock count as a whole number.');
        return;
      }
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/store-admin/stock/${encodeURIComponent(productId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            trackInventory: tracking,
            lowStockThreshold: Number(threshold || 0),
            ...(onHand === undefined ? {} : { onHand }),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not save the inventory settings.',
        );
      }
      setNotice(
        body?.stock?.movementId > 0
          ? 'Inventory saved. The opening count was recorded as a stock movement.'
          : 'Inventory settings saved.',
      );
      setOpeningOnHand('');
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not save the inventory settings.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">{inventoryMode==='variant'?'Retained legacy inventory':'Product inventory'}</h2>
      {inventoryMode==='variant'?<p className="sa-hint">Checkout and POS sell only exact variants above. This parent bucket is retained for historical settlement and returns; it is not added to variant availability.</p>:<p className="sa-hint">Product-level inventory remains in use until explicitly activated. Products without stock limits stay unchanged.</p>}
      {canEdit&&inventoryMode==='product'?<div className="sa-control-card"><h3>Opt in to variant inventory</h3><p className="sa-hint">Warning: configure every SKU, required model mapping and stock row first. No stock split is suggested. Leave all allocation rows untouched to retain the entire parent balance, or enter explicit transfer counts. Transfers use paired ledger movements; historical balances are never deleted.</p>{variants.filter(v=>v.isActive&&v.isPurchasable).map(v=><label key={v.id} className="sa-field">Allocate to {v.sku??v.optionValue}<input className="sa-input" type="number" min={0} step={1} value={allocations[v.id]??''} placeholder="No transfer" onChange={e=>setAllocations({...allocations,[v.id]:e.target.value})}/></label>)}<label className="sa-field">Activation reason<input className="sa-input" maxLength={200} value={activationReason} onChange={e=>setActivationReason(e.target.value)}/></label><button className="sa-btn" disabled={busy} onClick={activate}>Review and activate / allocate stock</button></div>:null}

      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="sa-notice" role="status">
          {notice}
        </p>
      ) : null}

      <dl className="sa-meta">
        <div>
          <dt>In stock</dt>
          <dd>{stock ? stock.onHand : '—'}</dd>
        </div>
        <div>
          <dt>Held in checkouts</dt>
          <dd>{stock ? stock.reserved : '—'}</dd>
        </div>
        <div>
          <dt>Available to buy</dt>
          <dd>{available === null ? '—' : available}</dd>
        </div>
        <div>
          <dt>Limit my stock</dt>
          <dd>{stock?.trackInventory ? 'Enabled' : 'Off'}</dd>
        </div>
      </dl>

      {canEdit ? (
        <>
          <div className="sa-control-grid">
            <label className="sa-check">
              <input
                type="checkbox"
                checked={tracking}
                onChange={(event) => setTracking(event.target.checked)}
              />
              Limit my stock
            </label>
            <label className="sa-field">
              <span className="sa-label">Warn me when below</span>
              <input
                className="sa-input"
                type="number"
                min={0}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </label>
            {needsOpeningCount ? (
              <label className="sa-field">
                <span className="sa-label">
                  Current in stock <span className="sa-hint">required to limit stock</span>
                </span>
                <input
                  className="sa-input"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={openingOnHand}
                  onChange={(event) => setOpeningOnHand(event.target.value)}
                />
              </label>
            ) : null}
          </div>

          {!tracking ? (
            <p className="sa-lock-note">
              Stock is not limited: checkout ignores stock and this product can be
              oversold.
            </p>
          ) : null}

          <div className="sa-inline-actions">
            <button
              className="sa-btn sa-btn-small"
              type="button"
              disabled={busy}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save inventory'}
            </button>
          </div>
        </>
      ) : (
        <p className="sa-lock-note">Only an owner or admin can change inventory.</p>
      )}

      <div className="sa-inline-actions">
        <Link
          className="sa-btn sa-btn-small"
          href={`/store-admin/stock/${encodeURIComponent(productId)}`}
        >
          Add or remove stock
        </Link>
      </div>
    </section>
  );
}
