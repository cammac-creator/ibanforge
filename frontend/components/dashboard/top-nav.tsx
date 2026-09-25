'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  DoorOpen,
  LayoutDashboard,
  Mail,
  MessagesSquare,
  MoreHorizontal,
  Search,
  Users,
  ContactRound,
} from 'lucide-react';
import { CommandPalette } from './cmdk';
import { LogoutButton } from './logout-button';
import { localePath } from '@/lib/locale-path';
import styles from './workspace.module.css';

const DESTINATIONS = [
  { key: 'overview', path: '/dashboard', icon: LayoutDashboard },
  { key: 'contacts', path: '/dashboard/contacts', icon: ContactRound },
  { key: 'mail', path: '/dashboard/courrier', icon: Mail },
  { key: 'clients', path: '/dashboard/clients', icon: Users },
  { key: 'bots', path: '/dashboard/clients-bot', icon: Bot },
  { key: 'forums', path: '/dashboard/forums', icon: MessagesSquare },
  // Le tableau des portes du lundi (plan d'audit, semaine 2).
  { key: 'doors', path: '/dashboard/portes', icon: DoorOpen },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations('dashboard.workspace');
  const more = useRef<HTMLDetailsElement>(null);
  const current =
    DESTINATIONS.find((item) => pathname.replace(/\/$/, '').endsWith(item.path)) ?? DESTINATIONS[0];
  const search = () => window.dispatchEvent(new Event('ibf-open-cmdk'));

  const links = (items: readonly (typeof DESTINATIONS)[number][], mobile = false) =>
    items.map((item) => (
      <Link
        key={item.key}
        href={localePath(locale, item.path)}
        prefetch={false}
        aria-current={current.key === item.key ? 'page' : undefined}
        className={mobile ? styles.mobileLink : styles.navLink}
        onClick={() => {
          if (more.current) more.current.open = false;
        }}
      >
        <item.icon size={19} strokeWidth={1.7} aria-hidden />
        <span>{t(item.key)}</span>
        {!mobile && current.key === item.key && (
          <ChevronRight size={14} className={styles.navArrow} aria-hidden />
        )}
      </Link>
    ));

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
        <nav aria-label={t('navigation')}>{links(DESTINATIONS.slice(0, 4))}</nav>
        <p className={styles.navCaption}>{t('explore')}</p>
        <nav aria-label={t('explore')}>{links(DESTINATIONS.slice(4))}</nav>
        <div className={styles.sidebarFooter}>
          <Link href={localePath(locale)} className={styles.navLink}>
            <ArrowUpRight size={18} aria-hidden />
            {t('site')}
          </Link>
          <LogoutButton />
        </div>
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
        <button
          type="button"
          onClick={search}
          className={styles.iconButton}
          aria-label={t('search')}
        >
          <Search size={21} aria-hidden />
        </button>
      </header>
      <nav className={styles.mobileNav} aria-label={t('navigation')}>
        {links(DESTINATIONS.slice(0, 4), true)}
        <details ref={more} className={styles.more} key={pathname}>
          <summary
            className={styles.mobileLink}
            aria-label={t('more')}
            data-active={
              current.key === 'bots' || current.key === 'forums' || current.key === 'doors'
            }
          >
            <MoreHorizontal size={21} aria-hidden />
            <span>{t('more')}</span>
          </summary>
          <div className={styles.moreMenu}>
            {links(DESTINATIONS.slice(4))}
            <Link href={localePath(locale)} className={styles.navLink}>
              <ArrowUpRight size={18} aria-hidden />
              {t('site')}
            </Link>
            <LogoutButton />
          </div>
        </details>
      </nav>
      <CommandPalette />
    </>
  );
}
