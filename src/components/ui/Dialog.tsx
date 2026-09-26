import React from 'react';
import { Modal, type ModalProps } from '@/src/components/ui/Modal';

export interface DialogProps extends Omit<ModalProps, 'isOpen' | 'onClose'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog is the Radix-style name for the same overlay the project already
 * ships as `Modal`. It exists so callers can use the familiar
 * `open` / `onOpenChange` prop pair without introducing a second styling or
 * accessibility system: every visual and behavioural detail is delegated to
 * `Modal`.
 */
export const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, ...rest }) => (
  <Modal {...rest} isOpen={open} onClose={() => onOpenChange(false)} />
);
