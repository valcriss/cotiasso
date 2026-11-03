import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router, provideRouter } from '@angular/router';
import { SetupPage } from './setup.page';

const session = {
  user: { id: '1', email: 'm@asso.fr', displayName: 'M', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' },
  permissions: ['projects:view'],
  mfa: { state: 'OK', enabled: false, required: false },
  csrfToken: 'csrf-1',
  expiresAt: '2026-11-02T00:00:00.000Z',
};
const PASSWORD = 'une phrase de passe correcte';

describe('SetupPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<SetupPage>>;

  const fill = (values: { token?: string; name?: string; email?: string; password?: string; confirmation?: string }) => {
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    const ordered = [values.token ?? 'jeton', values.name ?? 'Marie', values.email ?? 'm@asso.fr', values.password ?? PASSWORD];
    ordered.push(values.confirmation ?? ordered[3]!);
    ordered.forEach((value, index) => {
      inputs[index]!.value = value;
      inputs[index]!.dispatchEvent(new Event('input'));
    });
  };
  const submit = async () => {
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SetupPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SetupPage);
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => controller.verify());

  it('dit où trouver le jeton, avec la commande exacte, sans l’afficher lui-même', () => {
    const help = root.querySelector('details.token-help')!;
    expect(help.querySelector('summary')!.textContent).toContain('Où trouver le jeton');
    expect(help.querySelector('code')!.textContent).toBe('./scripts/install-token.sh --env-file .env.prod');
    expect(help.textContent).toContain('docker compose restart api');
  });

  it('copie la commande qui donne le jeton, et le confirme', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const button = Array.from(root.querySelectorAll<HTMLButtonElement>('.token-help button')).find((b) => b.textContent!.includes('Copier'))!;
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('./scripts/install-token.sh --env-file .env.prod');
    expect(root.querySelector('.token-help button')!.textContent).toContain('Copié ✓');
  });

  it("n'envoie rien quand le mot de passe est trop court ou mal confirmé", async () => {
    fill({ password: 'court', confirmation: 'court' });
    await submit();
    controller.expectNone('/api/setup');
    expect(root.textContent).toContain('au moins 12 caractères');

    fill({ confirmation: 'autre chose entierement' });
    await submit();
    controller.expectNone('/api/setup');
    expect(root.textContent).toContain('ne correspondent pas');
  });

  it("crée le compte et envoie le jeton sans espaces autour, sans la confirmation", async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill({ token: '  jeton-secret  ' });
    const done = submit();
    const request = controller.expectOne('/api/setup');
    expect(request.request.body).toEqual({ token: 'jeton-secret', displayName: 'Marie', email: 'm@asso.fr', password: PASSWORD, alsoTreasurer: true });
    request.flush(session);
    await done;
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it("affiche les motifs de refus du serveur", async () => {
    fill({});
    const done = submit();
    controller
      .expectOne('/api/setup')
      .flush({ message: 'Mot de passe refusé.', issues: ['Ce mot de passe est trop courant.'] }, { status: 400, statusText: 'Bad Request' });
    await done;
    await fixture.whenStable();
    const alert = root.querySelector('[role="alert"]')!.textContent!;
    expect(alert).toContain('Mot de passe refusé.');
    expect(alert).toContain('trop courant');
  });

  it("signale un jeton d'installation invalide", async () => {
    fill({});
    const done = submit();
    controller.expectOne('/api/setup').flush({ message: "Jeton d'installation invalide." }, { status: 403, statusText: 'Forbidden' });
    await done;
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("Jeton d'installation invalide.");
  });
});
