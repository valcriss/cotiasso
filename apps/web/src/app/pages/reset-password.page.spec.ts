import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ResetPasswordPage } from './reset-password.page';

const PASSWORD = 'une phrase de passe correcte';

describe('ResetPasswordPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<ResetPasswordPage>>;

  const create = async (fragment: string | null) => {
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
      ],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ResetPasswordPage);
    root = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  };

  const fill = (password: string, confirmation: string) => {
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    [password, confirmation].forEach((value, index) => {
      inputs[index]!.value = value;
      inputs[index]!.dispatchEvent(new Event('input'));
    });
  };
  const submit = async () => {
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };

  afterEach(() => controller.verify());

  it('explique qu\'un lien sans jeton est incomplet', async () => {
    await create(null);
    expect(root.textContent).toContain('Ce lien est incomplet');
    expect(root.querySelector('form')).toBeNull();
  });

  it("retire le jeton de la barre d'adresse après l'avoir lu", async () => {
    await create('token=abc123');
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith([], { fragment: undefined, replaceUrl: true });
  });

  it("n'envoie rien quand la confirmation diffère ou que le mot de passe est trop court", async () => {
    await create('token=abc123');
    fill('court', 'court');
    await submit();
    controller.expectNone('/api/auth/password-reset');
    expect(root.textContent).toContain('au moins 12 caractères');

    fill(PASSWORD, 'autre chose entierement');
    await submit();
    controller.expectNone('/api/auth/password-reset');
    expect(root.textContent).toContain('ne correspondent pas');
  });

  it('envoie le jeton et le mot de passe, puis propose de se connecter', async () => {
    await create('token=abc123');
    fill(PASSWORD, PASSWORD);
    const done = submit();
    const request = controller.expectOne('/api/auth/password-reset');
    expect(request.request.body).toEqual({ token: 'abc123', password: PASSWORD });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await done;
    await fixture.whenStable();
    expect(root.textContent).toContain('Votre mot de passe est défini');
    expect(root.querySelector('a[href="/connexion"]')).not.toBeNull();
  });

  it('affiche le motif de refus du serveur', async () => {
    await create('token=abc123');
    fill(PASSWORD, PASSWORD);
    const done = submit();
    controller
      .expectOne('/api/auth/password-reset')
      .flush({ message: 'Lien invalide ou expiré.' }, { status: 400, statusText: 'Bad Request' });
    await done;
    await fixture.whenStable();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Lien invalide ou expiré.');
  });
});
