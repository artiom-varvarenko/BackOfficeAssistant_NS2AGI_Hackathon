import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { useRouter } from './navigation';

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, replace, scroll, prefetch: _prefetch, onClick, ...props }, ref) {
  const router = useRouter();
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.download !== undefined || (props.target && props.target !== '_self')) return;
    const destination = new URL(href, window.location.href);
    if (destination.origin !== window.location.origin || !['http:', 'https:'].includes(destination.protocol) || destination.pathname.startsWith('/api/')) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    event.preventDefault();
    router[replace ? 'replace' : 'push'](`${destination.pathname}${destination.search}${destination.hash}`, { scroll });
  };
  return <a {...props} ref={ref} href={href} onClick={click} />;
});

export default Link;
