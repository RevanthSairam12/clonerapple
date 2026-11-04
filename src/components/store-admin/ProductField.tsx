import React, { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { ProductHelp, productHelpText } from './ProductHelp';

type ControlProps = { id?: string; 'aria-describedby'?: string; className?: string; readOnly?: boolean };
export function ProductField({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const generated = useId();
  const control = isValidElement<ControlProps>(children) ? children as ReactElement<ControlProps> : null;
  const id = control?.props.id ?? generated;
  const helpId = `${generated}-help`;
  return <div className="sa-field sa-product-field"><div className="sa-product-field-heading"><label className="sa-label" htmlFor={id}>{label}</label><ProductHelp label={label} id={helpId}>{help ?? productHelpText(label)}</ProductHelp></div>{control ? cloneElement(control, { id, 'aria-describedby': [control.props['aria-describedby'], helpId].filter(Boolean).join(' '), className: [control.props.className, control.props.readOnly ? 'sa-input-readonly' : ''].filter(Boolean).join(' ') }) : children}</div>;
}
