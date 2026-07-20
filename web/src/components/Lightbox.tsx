import { Modal } from './Modal';

interface LightboxProps {
  isOpen: boolean;
  onClose: () => void;
  src: string;
  alt: string;
}

/**
 * Full-size image view. Built on `Modal` rather than a bespoke overlay so it
 * inherits the focus trap, the Escape handler and the focus restoration for
 * free — three things a hand-rolled lightbox almost always omits.
 */
export function Lightbox({ isOpen, onClose, src, alt }: LightboxProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={alt} hideTitle size="wide">
      <img src={src} alt={alt} className="lightbox-image" />
    </Modal>
  );
}
