import { Link } from 'react-router-dom';

/**
 * Breadcrumbs — always shows where the user is in the
 * Dashboard → Project Workspace → Task Workspace navigation.
 * @param {{ items: Array<{ label: string, to?: string }> }} props
 *   The last item is rendered as the current (non-link) page.
 */
export default function Breadcrumbs({ items }) {
  if (!items || items.length === 0) return null;

  return (
    <nav className="flex items-center gap-1.5 text-sm mb-4 flex-wrap" aria-label="Breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-white/20">/</span>}
            {isLast || !item.to ? (
              <span className={isLast ? 'text-white/80 font-medium truncate max-w-[220px]' : 'text-white/40'}>
                {item.label}
              </span>
            ) : (
              <Link
                to={item.to}
                className="text-white/40 hover:text-brand-400 transition-colors truncate max-w-[220px]"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
