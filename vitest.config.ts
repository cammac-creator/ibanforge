import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // scripts/ is included on purpose: the weekly report's window logic is
    // written here, and it is exactly the kind of code nobody opens for months
    // (a one-day comparison window published a huge jump on a flat week). Untested
    // scripts are still shipped behaviour.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Fichiers de test exécutés en série, dans un seul process.
    //
    // Pourquoi : plusieurs suites écrivent dans la MÊME base de stats
    // (`data/stats.sqlite` par défaut) et vérifient leur effet par un delta
    // — « ce compteur a bougé d'exactement 1 ». En parallèle, un autre fichier
    // qui enregistre un rejet entre le relevé « avant » et le relevé « après »
    // fait échouer l'assertion, ou pire, la fait passer par compensation.
    // Sérialiser rend ces deltas déterministes.
    //
    // L'alternative — un STATS_DB_PATH par worker — changerait le contrat
    // d'isolation de toute la suite d'un coup, sur un service qui manipule de
    // l'argent réel. Ici le coût est de quelques secondes, et c'est réversible.
    //
    // ⚠️ Ne jamais « réparer » un delta qui casse en le relâchant en
    // `toBeGreaterThanOrEqual` : l'assertion ne garderait plus rien (elle
    // passerait aussi bien à 0 rejet compté qu'à 2, les deux pannes qu'elle
    // existe pour attraper). C'est ici qu'il faut regarder d'abord.
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
