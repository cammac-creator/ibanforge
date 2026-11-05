'use client';

import { useRef, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  Activity,
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  DoorOpen,
  Mail,
  Menu,
  MessagesSquare,
  Newspaper,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import { CommandPalette } from './cmdk';
import { LogoutButton } from './logout-button';
import { localePath } from '@/lib/locale-path';
import {
  WORKSPACE_DESTINATIONS,
  workspaceCurrent,
  workspaceHref,
  type WorkspaceDestination,
} from '@/lib/dashboard/workspace';
import styles from './workspace.module.css';

const ICONS = {
  today: Sun,
  clients: Users,
  contacts: ContactRound,
  mail: Mail,
  growth: ChartNoAxesCombined,
  revenue: CircleDollarSign,
  service: Activity,
  bots: Bot,
  forums: MessagesSquare,
  doors: DoorOpen,
  bulletin: Newspaper,
};
const DAILY = WORKSPACE_DESTINATIONS.slice(0, 7);
const EXPLORE = WORKSPACE_DESTINATIONS.slice(7);
const SHORTCUTS = DAILY.filter(({ key }) => ['today', 'contacts', 'mail', 'growth'].includes(key));

export function TopNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('dashboard.workspace');
  const more = useRef<HTMLDetailsElement>(null);
  const current = workspaceCurrent(pathname, params.get('view'));
  const period = Number(params.get('period') ?? 30);
  const audience = params.get('audience') ?? undefined;
  const search = (event: MouseEvent<HTMLButtonElement>) => {
    // Sur Mac, un clic ne donne pas toujours le focus au bouton ; le retour doit rester prévisible.
    event.currentTarget.focus();
    window.dispatchEvent(new Event('ibf-open-cmdk'));
  };
  const links = (items: readonly WorkspaceDestination[], mobile = false) =>
    items.map((item) => {
      const Icon = ICONS[item.key];
      return (
        <Link
          key={item.key}
          href={localePath(locale, workspaceHref(item, period, audience))}
          prefetch={false}
          aria-current={current === item.key ? 'page' : undefined}
          className={mobile ? styles.mobileLink : styles.navLink}
          onClick={() => {
            if (more.current) more.current.open = false;
          }}
        >
          <Icon size={19} strokeWidth={1.7} aria-hidden />
          <span>{item.key === 'bulletin' ? 'Bulletin' : t(item.key)}</span>
          {!mobile && current === item.key && (
            <ChevronRight size={14} className={styles.navArrow} aria-hidden />
          )}
        </Link>
      );
    });
  const footer = (
    <>
      <Link href={localePath(locale)} className={styles.navLink}>
        <ArrowUpRight size={18} aria-hidden />
        {t('site')}
      </Link>
      <LogoutButton />
    </>
  );

  return (
    <>
      <a href="#dashboard-content" className={styles.skip}>
        {t('skip')}
      </a>
      <aside className={styles.sidebar} aria-label={t('navigation')}>
        <Link href={localePath(locale, '/dashboard')} className={styles.brand}>
          <span className={styles.brandMark}>IF</span>
          <span>
            IBANforge<small>{t('space')}</small>
          </span>
        </Link>
        <button type="button" onClick={search} className={styles.search} aria-label={t('search')}>
          <Search size={17} aria-hidden />
          <span>{t('searchShort')}</span>
          <kbd>⌘ K</kbd>
        </button>
        <p className={styles.navCaption}>{t('daily')}</p>
        <nav aria-label={t('navigation')}>{links(DAILY)}</nav>
        <p className={styles.navCaption}>{t('explore')}</p>
        <nav aria-label={t('explore')}>{links(EXPLORE)}</nav>
        <div className={styles.sidebarFooter}>{footer}</div>
      </aside>
      <header className={styles.mobileHeader}>
        <Link
          href={localePath(locale, '/dashboard')}
          className={styles.brand}
          aria-label="IBANforge"
        >
          <span className={styles.brandMark}>IF</span>
          <span>IBANforge</span>
        </Link>
        <div className={styles.mobileTools}>
          <button
            type="button"
            onClick={search}
            className={styles.iconButton}
            aria-label={t('search')}
          >
            <Search size={21} aria-hidden />
          </button>
          <details
            ref={more}
            className={styles.more}
            key={`${pathname}?${params.toString()}`}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && more.current) {
                more.current.open = false;
                more.current.querySelector('summary')?.focus();
              }
            }}
          >
            <summary className={styles.menuButton}>
              <Menu size={20} aria-hidden />
              {t('menu')}
            </summary>
            <nav className={styles.moreMenu} aria-label={t('navigation')}>
              {links(DAILY)}
              <p className={styles.navCaption}>{t('explore')}</p>
              {links(EXPLORE)}
              {footer}
            </nav>
          </details>
        </div>
      </header>
      <nav className={styles.mobileNav} aria-label={t('shortcuts')}>
        {links(SHORTCUTS, true)}
      </nav>
      <CommandPalette />
    </>
  );
}
