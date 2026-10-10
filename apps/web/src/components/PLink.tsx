// Link that preloads the destination page's code (and optionally its data) on hover, focus, touch or when visible.
import { forwardRef, useEffect, useRef } from 'react';
import { Link, type LinkProps } from 'react-router';
import { preloadPath } from '../routes';
import { prefetch } from '../lib/query';

type Props = LinkProps & { data?: string | string[]; preloadVisible?: boolean };

export const PLink = forwardRef<HTMLAnchorElement, Props>(function PLink({ to, data, preloadVisible, onMouseEnter, onFocus, onTouchStart, viewTransition = false, ...rest }, fwd) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const path = typeof to === 'string' ? to : to.pathname ?? '';
  const warm = () => {
    preloadPath(path);
    if (data) (Array.isArray(data) ? data : [data]).forEach(k => prefetch(k));
  };
  useEffect(() => {
    if (!preloadVisible || !ref.current || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { preloadPath(path); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [preloadVisible, path]);
  return (
    <Link
      ref={el => { ref.current = el; if (typeof fwd === 'function') fwd(el); else if (fwd) fwd.current = el; }}
      to={to}
      viewTransition={viewTransition}
      onMouseEnter={e => { warm(); onMouseEnter?.(e); }}
      onFocus={e => { warm(); onFocus?.(e); }}
      onTouchStart={e => { warm(); onTouchStart?.(e); }}
      {...rest}
    />
  );
});
