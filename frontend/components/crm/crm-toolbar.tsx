'use client';

import { useState } from 'react';
import {
  MessageCircle,
  RotateCcw,
  FilePenLine,
  ListFilter,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { MailFilter, MailFilterKey, RowSelection } from '@/lib/crm/mail-rows';
import { POPULATION_KEYS, REFINE_KEYS, segmentLabel, selectLabel } from '@/lib/crm/table-view';
import styles from './workspace.module.css';

const QUEUES = [
  { key: 'reply', label: 'À répondre', icon: MessageCircle },
  { key: 'followup', label: 'À relancer', icon: RotateCcw },
  { key: 'drafts', label: 'Brouillons', icon: FilePenLine },
  { key: null, label: 'Tous les contacts', icon: ListFilter },
] as const;

export function CrmToolbar({
  filters,
  queueCounts,
  selection,
  onSelection,
  query,
  onQuery,
}: {
  filters: MailFilter[];
  /** Comptages dans la population et le filtre choisis, avant la recherche. */
  queueCounts: Record<string, number>;
  selection: RowSelection;
  onSelection: (next: RowSelection) => void;
  query: string;
  onQuery: (next: string) => void;
}) {
  const filterOf = (key: MailFilterKey) => filters.find((f) => f.key === key);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Number(selection.population !== 'all') + Number(!!selection.refine);
  return (
    <div className={styles.toolbar}>
      <div className={styles.queues} role="group" aria-label="Travail à traiter">
        {QUEUES.map(({ key, label, icon: Icon }) => (
          <button
            key={key ?? 'all'}
            type="button"
            aria-pressed={(selection.work ?? null) === key}
            onClick={() => onSelection({ ...selection, work: key })}
            className={styles.queue}
          >
            <Icon size={17} strokeWidth={1.8} aria-hidden />
            <span>{label}</span>
            <strong>{queueCounts[key ?? 'all'] ?? 0}</strong>
          </button>
        ))}
      </div>
      <div className={styles.searchLine}>
        <div className={styles.searchField}>
          <Search size={18} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Nom, adresse ou contenu d’un message…"
            aria-label="Rechercher un contact"
          />
          {query && (
            <button type="button" onClick={() => onQuery('')} aria-label="Effacer la recherche">
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
        <details
          className={styles.filters}
          open={filtersOpen}
          onToggle={(e) => setFiltersOpen(e.currentTarget.open)}
        >
          <summary>
            <SlidersHorizontal size={17} aria-hidden />
            Filtres{activeFilters > 0 && <strong>{activeFilters}</strong>}
          </summary>
          <div className={styles.filterPanel}>
            <label>
              Type de contact
              <select
                value={selection.population}
                onChange={(e) =>
                  onSelection({ ...selection, population: e.target.value as MailFilterKey })
                }
              >
                {POPULATION_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {segmentLabel(key, filterOf(key)?.label ?? key)} ({filterOf(key)?.count ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Préciser la sélection
              <select
                value={selection.refine ?? ''}
                onChange={(e) =>
                  onSelection({
                    ...selection,
                    refine: (e.target.value || null) as MailFilterKey | null,
                  })
                }
              >
                <option value="">Tous les états</option>
                {REFINE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {selectLabel(key, filterOf(key)?.label ?? key)}
                  </option>
                ))}
              </select>
            </label>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => onSelection({ ...selection, population: 'all', refine: null })}
                className={styles.reset}
              >
                Retirer les filtres
              </button>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
