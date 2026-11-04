import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService, type AuthUser } from '../auth/auth.service';
import { BrandingService } from '../branding/branding.service';
import { NAVIGATION } from '../navigation';
import { ThemeService } from '../theme/theme.service';
import { SetupStatus } from '../pages/setup-status.service';
import { ReimbursementsApi } from '../reimbursements/reimbursements-api';
import { Shell } from './shell';

const logoUrl = signal<string | null>(null);
const brandingValue = signal<{ appName: string; sidebarBackground: string; sidebarText: string; logoShowsName?: boolean }>({ appName: 'Mon Asso', sidebarBackground: '#eaf2fd', sidebarText: '#0b2a55' });

const user: AuthUser = {
  id: '1',
  email: 'marie@asso.fr',
  displayName: 'Marie',
  status: 'ACTIVE',
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('Shell', () => {
  const logout = vi.fn(() => Promise.resolve());
  /** Droits seulement sur un projet : `canAny` les compte, `can` les ignore. */
  const scoped = signal<ReadonlySet<string>>(new Set());
  const permissions = signal<ReadonlySet<string>>(new Set(NAVIGATION.map((item) => item.permission ?? '').concat('settings.association:view')));
  /** Le circuit de validation des remboursements est-il utilisable ? (réponse de `GET /reimbursements/status`) */
  let circuitReady = true;

  beforeEach(async () => {
    logout.mockClear();
    circuitReady = true;
    scoped.set(new Set());
    permissions.set(new Set(NAVIGATION.map((item) => item.permission ?? '').concat('settings.association:view')));
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [
        provideRouter([]),
        { provide: ReimbursementsApi, useValue: { status: () => Promise.resolve({ enabled: true, ready: circuitReady, canRequest: true, reason: null }) } },
        { provide: BrandingService, useValue: { branding: brandingValue, logoUrl } },
        {
          provide: AuthService,
          useValue: {
            user: signal(user).asReadonly(),
            permissions: permissions.asReadonly(),
            can: (permission: string | undefined) => permission === undefined || permissions().has(permission),
            canAny: (permission: string | undefined) => permission === undefined || permissions().has(permission) || scoped().has(permission),
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
    expect(labels).toEqual(["Vue d'ensemble", 'Projets', 'Documents', 'Aide et lexique'].map((l) => expect.stringContaining(l)));
  });

  it('pour un droit limité à un projet, montre les rubriques filtrées par le serveur mais pas la page Documents générale', async () => {
    permissions.set(new Set());
    scoped.set(new Set(['projects:view', 'grants:view', 'documents:view']));
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent?.trim());
    expect(labels).toEqual(["Vue d'ensemble", 'Projets', 'Subventions', 'Aide et lexique'].map((l) => expect.stringContaining(l)));
  });

  it('montre les remboursements seulement quand le circuit de validation est utilisable', async () => {
    permissions.set(new Set(['reimbursements:create', 'projects:view']));
    const labelsOf = (fixture: ReturnType<typeof TestBed.createComponent<Shell>>) =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent ?? '');

    const ready = TestBed.createComponent(Shell);
    await ready.whenStable();
    ready.detectChanges();
    expect(labelsOf(ready).some((l) => l.includes('Remboursements'))).toBe(true);
  });

  it('masque les remboursements tant que le circuit de validation est en panne ou absent', async () => {
    circuitReady = false;
    permissions.set(new Set(['reimbursements:create', 'projects:view']));
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    fixture.detectChanges();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent ?? '');
    expect(labels.some((l) => l.includes('Remboursements'))).toBe(false);
    expect(labels.some((l) => l.includes('Projets'))).toBe(true);
  });

  it("affiche le nom de l'association défini par la marque blanche", async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.brand .name')?.textContent).toContain('Mon Asso');
  });

  it("affiche le logo de l'association à côté de son nom quand il y en a un, sans texte alternatif redondant", async () => {
    logoUrl.set('/api/branding/logo?v=abc');
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const image = root.querySelector<HTMLImageElement>('.brand img.logo');
    expect(image?.getAttribute('src')).toBe('/api/branding/logo?v=abc');
    expect(image?.getAttribute('alt')).toBe('');
    expect(root.querySelector('.brand .name')?.textContent).toContain('Mon Asso');
    logoUrl.set(null);
    fixture.detectChanges();
    expect(root.querySelector('.brand img.logo')).toBeNull();
  });

  it("n'affiche que le logo quand l'association a choisi « logo seul », en gardant son nom comme texte alternatif", async () => {
    logoUrl.set('/api/branding/logo?v=abc');
    brandingValue.update((value) => ({ ...value, logoShowsName: false }));
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.brand .name')).toBeNull();
    expect(root.querySelector('.brand img.logo')?.getAttribute('alt')).toBe('Mon Asso');
    // Sans logo, le nom s'affiche toujours, même si « logo seul » était demandé.
    logoUrl.set(null);
    fixture.detectChanges();
    expect(root.querySelector('.brand .name')?.textContent).toContain('Mon Asso');
    brandingValue.update((value) => ({ ...value, logoShowsName: undefined }));
  });

  it('affiche la navigation du cadrage et les paramètres', async () => {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) =>
      a.textContent?.trim(),
    );
    // Affichage simple par défaut : les rubriques de l'expert (Comptabilité) sont masquées du menu.
    expect(labels).toEqual([...NAVIGATION.filter((item) => !item.expert).map((item) => item.label), 'Paramètres', 'Aide et lexique'].map((l) => expect.stringContaining(l)));
    expect(labels.join(' ')).not.toContain('Comptabilité');
  });

  it("montre toutes les rubriques en affichage comptable", async () => {
    TestBed.inject(ThemeService).setViewMode('accounting');
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent?.trim());
    expect(labels).toEqual([...NAVIGATION.map((item) => item.label), 'Paramètres', 'Aide et lexique'].map((l) => expect.stringContaining(l)));
    TestBed.inject(ThemeService).setViewMode('simple');
  });

  it("ouvre d'office l'affichage comptable pour un expert-comptable (export sans saisie), sauf choix déjà fait", async () => {
    permissions.set(new Set(['entries:view', 'reports:view', 'reports:export']));
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent?.trim()).join(' ');
    expect(labels).toContain('Comptabilité');
  });

  it("garde l'affichage simple d'un trésorier (il peut saisir et exporter)", async () => {
    permissions.set(new Set(['entries:view', 'reports:view', 'reports:export', 'transactions:manage']));
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent?.trim()).join(' ');
    expect(labels).not.toContain('Comptabilité');
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

  describe('entrée « Démarrer »', () => {
    const complete = { fiscalYear: true, accounts: true, financialAccount: true, categories: true, startMode: 'HISTORY' as const, openingSituation: 'NONE' as const };
    const labels = (fixture: { nativeElement: unknown }) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a.item')).map((a) => a.textContent!.trim());

    it("apparaît, juste après la vue d'ensemble, tant qu'une étape manque, pour qui peut la faire", async () => {
      permissions.set(new Set(['settings.accounting:admin', 'projects:view']));
      TestBed.inject(SetupStatus).set({ ...complete, financialAccount: false });
      const fixture = TestBed.createComponent(Shell);
      await fixture.whenStable();
      const items = labels(fixture);
      expect(items[0]).toContain("Vue d'ensemble");
      expect(items[1]).toContain('Démarrer');
    });

    it("disparaît quand toutes les étapes sont faites, et reste absente sans le droit d'administrer la comptabilité", async () => {
      permissions.set(new Set(['settings.accounting:admin']));
      TestBed.inject(SetupStatus).set(complete);
      let fixture = TestBed.createComponent(Shell);
      await fixture.whenStable();
      expect(labels(fixture).join('|')).not.toContain('Démarrer');
      TestBed.inject(SetupStatus).set({ ...complete, fiscalYear: false });
      permissions.set(new Set(['projects:view']));
      fixture = TestBed.createComponent(Shell);
      await fixture.whenStable();
      expect(labels(fixture).join('|')).not.toContain('Démarrer');
    });

    it('compte la situation de départ comme étape quand on repart d’une situation d’ouverture', () => {
      const status = TestBed.inject(SetupStatus);
      status.set({ ...complete, startMode: 'OPENING', openingSituation: 'DRAFT' });
      expect(status.incomplete()).toBe(true);
      status.set({ ...complete, startMode: 'OPENING', openingSituation: 'POSTED' });
      expect(status.incomplete()).toBe(false);
      status.set({ ...complete, startMode: 'OPENING', openingSituation: 'SKIPPED' });
      expect(status.incomplete()).toBe(false);
    });
  });
});
