import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService, type AuthUser } from '../auth/auth.service';
import { NAVIGATION } from '../navigation';
import { Shell } from './shell';

const user: AuthUser = {
  id: '1',
  email: 'marie@asso.fr',
  displayName: 'Marie',
  status: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('Shell', () => {
  const logout = vi.fn(() => Promise.resolve());
  const permissions = signal<ReadonlySet<string>>(new Set(NAVIGATION.map((item) => item.permission ?? '').concat('settings.association:view')));

  beforeEach(async () => {
    logout.mockClear();
    permissions.set(new Set(NAVIGATION.map((item) => item.permission ?? '').concat('settings.association:view')));
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: signal(user).asReadonly(),
            permissions: permissions.asReadonly(),
            can: (permission: string | undefined) => permission === undefined || permissions().has(permission),
            logout,
          },
        },
      ],
    }).compileComponents();
  });

  it('ne montre que les rubriques autorisées', async () => {
    permissions.set(new Set(['projects:view', 'documents:view']));
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent?.trim());
    expect(labels).toEqual(["Vue d'ensemble", 'Projets', 'Documents'].map((l) => expect.stringContaining(l)));
  });

  it('affiche la navigation du cadrage et les paramètres', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) =>
      a.textContent?.trim(),
    );
    expect(labels).toEqual([...NAVIGATION.map((item) => item.label), 'Paramètres'].map((l) => expect.stringContaining(l)));
  });

  it("affiche l'utilisateur connecté", async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.who')?.textContent).toContain('Marie');
  });

  it('replie le menu en conservant des libellés accessibles', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
    await fixture.whenStable();
    expect(root.querySelector('.shell')!.classList).toContain('collapsed');
    expect(root.querySelector('button[aria-expanded]')!.getAttribute('aria-label')).toBe('Déplier le menu');
    expect(root.querySelectorAll('a.item span').length).toBe(0);
    expect(root.querySelector('button[aria-label="Se déconnecter"]')).not.toBeNull();
  });

  it('déconnecte puis renvoie vers la page de connexion', async () => {
    const fixture = TestBed.createComponent(Shell);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Se déconnecter"]')!.click();
    await fixture.whenStable();
    expect(logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/connexion');
  });
});
