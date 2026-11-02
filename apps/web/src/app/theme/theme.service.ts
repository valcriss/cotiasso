import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
/** Affichage simple (langage courant, menus réduits, par défaut) ou comptable (tout le vocabulaire et les écrans de l'expert). */
export type ViewMode = 'simple' | 'accounting';

export const THEME_MODES: readonly { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'Selon le système', icon: 'brightness_auto' },
  { value: 'light', label: 'Clair', icon: 'light_mode' },
  { value: 'dark', label: 'Sombre', icon: 'dark_mode' },
];

export const DENSITIES: readonly { value: Density; label: string; icon: string }[] = [
  { value: 'comfortable', label: 'Confortable', icon: 'density_large' },
  { value: 'compact', label: 'Compacte', icon: 'density_small' },
];

export const VIEW_MODES: readonly { value: ViewMode; label: string; icon: string; hint: string }[] = [
  { value: 'simple', label: 'Simple', icon: 'sentiment_satisfied', hint: 'Recommandé : le vocabulaire de tous les jours' },
  { value: 'accounting', label: 'Comptable', icon: 'menu_book', hint: 'Journaux, écritures, grand livre… pour l’expert-comptable' },
];

const VIEW_KEY = 'cotiasso.view.mode';
const MODE_KEY = 'cotiasso.theme.mode';
const DENSITY_KEY = 'cotiasso.theme.density';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    // Stockage indisponible (navigation privée, données bloquées) : valeur par défaut, sans erreur.
    return fallback;
  }
}

function has(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Le choix s'applique à la session même si le navigateur refuse de le conserver.
  }
}

/**
 * Apparence choisie par l'utilisateur pour cet écran : mode clair/sombre et densité. Conservée localement dans le
 * navigateur (pas de réglage serveur pour l'instant) et appliquée par des classes sur `<html>`.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly root = inject(DOCUMENT).documentElement;

  readonly mode = signal<ThemeMode>('system');
  readonly density = signal<Density>('comfortable');
  readonly viewMode = signal<ViewMode>('simple');
  private viewModeChosen = false;

  /** Lit les préférences conservées et les applique ; appelé avant le premier affichage. */
  init(): void {
    this.mode.set(read(MODE_KEY, THEME_MODES.map((m) => m.value), 'system'));
    this.density.set(read(DENSITY_KEY, DENSITIES.map((d) => d.value), 'comfortable'));
    this.viewMode.set(read(VIEW_KEY, VIEW_MODES.map((v) => v.value), 'simple'));
    this.viewModeChosen = has(VIEW_KEY);
    this.apply();
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    write(MODE_KEY, mode);
    this.apply();
  }

  setDensity(density: Density): void {
    this.density.set(density);
    write(DENSITY_KEY, density);
    this.apply();
  }

  /**
   * Affichage proposé d'office (par exemple « Comptable » pour un expert-comptable en lecture seule). Ne s'applique que si la
   * personne n'a jamais choisi elle-même ; son choix, une fois fait, prime toujours.
   */
  suggestViewMode(mode: ViewMode): void {
    if (!this.viewModeChosen) this.viewMode.set(mode);
  }

  setViewMode(mode: ViewMode): void {
    this.viewModeChosen = true;
    this.viewMode.set(mode);
    write(VIEW_KEY, mode);
  }

  private apply(): void {
    const classes = this.root.classList;
    classes.toggle('theme-light', this.mode() === 'light');
    classes.toggle('theme-dark', this.mode() === 'dark');
    classes.toggle('density-compact', this.density() === 'compact');
  }
}
