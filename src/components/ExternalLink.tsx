import { isTauri, openExternal } from "../api";

/**
 * A real link to a Whisky Auctioneer page. In the desktop app the click is handed to the system
 * browser (Tauri opener); in a browser it is an ordinary new-tab link.
 */
export function ExternalLink({ href, className, label, children }: { href: string; className?: string; label?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={label}
      onClick={
        isTauri()
          ? (e) => {
              e.preventDefault();
              void openExternal(href);
            }
          : undefined
      }
    >
      {children}
    </a>
  );
}
