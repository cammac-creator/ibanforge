export type RayState = 'attente' | 'ok' | 'absent' | 'erreur';
export type Projection = {
  centre: { x: number; y: number };
  marque: { x: number; y: number };
  sorties: { x: number; y: number }[];
};
export interface LensEngine {
  inspection(value: boolean): void;
  raccorder(fraction: number): Projection;
  donnees(values: RayState[]): void;
  surligner(index: number): void;
  pause(value: boolean): void;
  instant(time: number): void;
  detruire(): void;
}
export function creerBraise(
  host: HTMLElement,
  notify: (signal: { perdu?: boolean }) => void,
): LensEngine;
