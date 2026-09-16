import { useEffect, useRef, useState } from 'react';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

export function ActionMenu({ label = '更多', icon: MenuIcon = MoreHorizontal, children, className = '' }) {
  const detailsRef = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!detailsRef.current?.contains(event.target)) detailsRef.current?.removeAttribute('open');
    };
    const closeWithEscape = (event) => {
      if (event.key === 'Escape') detailsRef.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [open]);
  return (
    <details ref={detailsRef} className={`action-menu ${className}`.trim()} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><MenuIcon size={18} /><span>{label}</span><ChevronDown className="action-menu-chevron" size={15} /></summary>
      <div className="action-menu-popover" onClick={(event) => {
        if (event.target.closest('button, a') && !event.target.closest('[data-menu-keep-open]')) {
          detailsRef.current?.removeAttribute('open');
        }
      }}>{children}</div>
    </details>
  );
}
