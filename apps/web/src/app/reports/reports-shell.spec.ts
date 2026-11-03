import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { ThemeService } from '../theme/theme.service';
import { ReportsShell } from './reports-shell';

describe('Rapports : onglets (#24)', () => {
  const render = async (view: 'simple' | 'accounting') => {
    await TestBed.configureTestingModule({ imports: [ReportsShell], providers: [provideRouter([])] }).compileComponents();
    TestBed.inject(ThemeService).setViewMode(view);
    const fixture = TestBed.createComponent(ReportsShell);
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav.tabs a')).map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
  };

  it('en affichage simple, dit ce que répond chaque état et garde le nom comptable à côté', async () => {
    const tabs = await render('simple');
    expect(tabs).toEqual([
      'trending_upReçu et dépensé (compte de résultat)',
      'balancePossédé et dû (bilan)',
      'account_balanceMouvements d’argent (trésorerie)',
      'lockComptes arrêtés (rapports figés)',
      'groupsAssemblée générale (dossier de l’assemblée)',
    ]);
  });

  it('en affichage comptable, garde les noms comptables', async () => {
    const tabs = await render('accounting');
    expect(tabs).toEqual(['trending_upCompte de résultat', 'balanceBilan', 'account_balanceTrésorerie', 'lockRapports figés', 'groupsDossier de l’assemblée']);
  });
});
