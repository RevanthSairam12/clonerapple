'use client';

import { ProductWorkflow, type ProductWorkflowProps } from './ProductWorkflow';

/** Creation and editing share the same staged sections and atomic save endpoint. */
export function ProductCreateForm(props: Omit<ProductWorkflowProps, 'product' | 'metadataState'>) {
  return <ProductWorkflow {...props} />;
}
