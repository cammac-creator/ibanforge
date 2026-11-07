/** Un refus d’arrêt ne doit pas empêcher la fermeture des autres ressources de recette. */
export function signalChildren<T>(children: Set<T>, terminate: (child: T, signal: NodeJS.Signals) => void, signal: NodeJS.Signals, errors: unknown[]): void {
  for (const child of children) {
    try { terminate(child, signal); } catch (error) { errors.push(error); }
  }
}

export async function cleanupRecipe<T>({ children, terminate, closeFixture, removeTemporary, wait, errors = [] }: {
  children: Set<T>;
  terminate: (child: T, signal: NodeJS.Signals) => void;
  closeFixture: () => Promise<void>;
  removeTemporary: () => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  errors?: unknown[];
}): Promise<void> {
  try {
    signalChildren(children, terminate, 'SIGTERM', errors);
    if (children.size) await wait(1000);
    signalChildren(children, terminate, 'SIGKILL', errors);
    for (let attempt = 0; children.size && attempt < 20; attempt++) await wait(100);
    if (children.size) errors.push(new Error('Un processus de recette n’a pas confirmé son arrêt'));
  } catch (error) { errors.push(error); }
  // Même si un signal ou l’attente échoue, le serveur fictif doit pouvoir libérer son écoute.
  let fixtureClosed = false;
  try { await closeFixture(); fixtureClosed = true; } catch (error) { errors.push(error); }
  // Un enfant encore vivant peut utiliser sa copie : ne jamais la supprimer avant son arrêt.
  if (!children.size && fixtureClosed) {
    try { await removeTemporary(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Nettoyage de recette incomplet ou refusé : ' + errors.map(error => error instanceof Error ? error.message : String(error)).join(' ; '));
}
