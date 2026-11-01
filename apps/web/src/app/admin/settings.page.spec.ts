import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { SettingsPage } from './settings.page';

describe('SettingsPage', () => {
  const render = async (permissions: string[]) => {
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter([]), mockAuth(permissions)],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };

  it("montre les rubriques d'administration à qui peut consulter les utilisateurs", async () => {
    const root = await render(['users:view']);
    const tabs = Array.from(root.querySelectorAll('nav.tabs a')).map((a) => a.textContent?.trim());
    expect(tabs).toEqual(['Utilisateurs', 'Rôles']);
  });

  it("indique qu'aucune rubrique n'est disponible sans permission adéquate", async () => {
    const root = await render(['settings.association:view']);
    expect(root.querySelector('nav.tabs')).toBeNull();
    expect(root.textContent).toContain("Aucune rubrique de paramètres n'est disponible");
  });
});
