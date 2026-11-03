import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { mockAuth } from '../testing/auth-mock';
import { ThemeService } from '../theme/theme.service';
import { NoPeriod } from './no-period';

describe('NoPeriod', () => {
  const render = (view: 'simple' | 'accounting', permissions: string[]) => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), mockAuth(permissions)] });
    TestBed.inject(ThemeService).setViewMode(view);
    const fixture = TestBed.createComponent(NoPeriod);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('en affichage simple, parle de période et mène à l’assistant Démarrer', () => {
    const root = render('simple', ['settings.accounting:admin']);
    expect(root.textContent).toContain('Aucune période de comptabilité');
    expect(root.textContent).not.toContain('exercice');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/demarrage');
  });

  it('sans le droit de la créer, dit à qui s’adresser et ne propose pas le bouton', () => {
    const root = render('simple', []);
    expect(root.textContent).toContain('Demandez à la personne qui administre la comptabilité');
    expect(root.querySelector('a')).toBeNull();
  });

  it('en affichage comptable, garde l’exercice et Paramètres › Comptabilité', () => {
    const root = render('accounting', ['settings.accounting:admin']);
    expect(root.textContent).toContain('Aucun exercice');
    expect(root.textContent).toContain('Paramètres › Comptabilité');
  });
});
