import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

export const THEME_MODES: readonly { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'system', label: 'Selon le système', icon: 'brightness_auto' },
  { value: 'light', label: 'Clair', icon: 'light_mode' },
  { value: 'dark', label: 'Sombre', icon: 'dark_mode' },
];

export const DENSITIES: readonly { value: Density; label: string; icon: string }[] = [
  { value: 'comfortable', label: 'Confortable', icon: 'density_large' },
  { value: 'compact', label: 'Compacte', icon: 'density_small' },
];

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

  /** Lit les préférences conservées et les applique ; appelé avant le premier affichage. */
  init(): void {
    this.mode.set(read(MODE_KEY, THEME_MODES.map((m) => m.value), 'system'));
    this.density.set(read(DENSITY_KEY, DENSITIES.map((d) => d.value), 'comfortable'));
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

  private apply(): void {
    const classes = this.root.classList;
    classes.toggle('theme-light', this.mode() === 'light');
    classes.toggle('theme-dark', this.mode() === 'dark');
    classes.toggle('density-compact', this.density() === 'compact');
  }
}
