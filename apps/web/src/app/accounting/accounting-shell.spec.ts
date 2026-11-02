import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AccountingShell } from './accounting-shell';

@Component({ template: '<p class="stub">contenu</p>' })
class Stub {}

describe('AccountingShell', () => {
  const setup = async (url: string) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'comptabilite',
            component: AccountingShell,
            children: [
              { path: '', pathMatch: 'full', component: Stub },
              { path: 'grand-livre', component: Stub },
              { path: 'balance', component: Stub },
              { path: 'journaux', component: Stub },
              { path: 'reprise', component: Stub },
              { path: 'progression', component: Stub },
            ],
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    // routerLinkActive se met à jour après la navigation : on laisse les micro-tâches se vider.
    await new Promise<void>((resolve) => setTimeout(resolve));
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  };

  it('propose les six rubriques et marque uniquement la rubrique courante', async () => {
    const root = await setup('/comptabilite/balance');
    const tabs = Array.from(root.querySelectorAll('nav.tabs a'));
    expect(tabs.map((a) => a.querySelector('span')!.textContent)).toEqual(['Écritures', 'Grand livre', 'Balance', 'Livre-journal', 'Reprise', 'Progression']);
    expect(tabs.filter((a) => a.classList.contains('active')).map((a) => a.querySelector('span')!.textContent)).toEqual(['Balance']);
    expect(root.querySelector('p.stub')!.textContent).toBe('contenu');
  });

  it("n'active « Écritures » que sur la page racine", async () => {
    const root = await setup('/comptabilite');
    const active = Array.from(root.querySelectorAll('nav.tabs a.active')).map((a) => a.querySelector('span')!.textContent);
    expect(active).toEqual(['Écritures']);
  });
});
