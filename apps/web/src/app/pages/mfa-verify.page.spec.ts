import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { MfaVerifyPage } from './mfa-verify.page';

const me = {
  user: { id: '1', email: 'm@asso.fr', displayName: 'M', status: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' },
  permissions: ['projects:view'],
  mfa: { state: 'OK', enabled: true, required: true },
  csrfToken: 'csrf-1',
  expiresAt: '2026-11-02T00:00:00.000Z',
};

describe('MfaVerifyPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<MfaVerifyPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const fill = (code: string) => {
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = code;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };
  const buttonWith = (text: string) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(text));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MfaVerifyPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MfaVerifyPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => controller.verify());

  it("n'envoie rien quand le champ est vide", async () => {
    await submit();
    controller.expectNone('/api/auth/mfa/verify');
    expect(root.textContent).toContain('Saisissez le code.');
  });

  it('vérifie le code, recharge la session puis ouvre la zone authentifiée', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fill(' 123456 ');
    const done = submit();
    const request = controller.expectOne('/api/auth/mfa/verify');
    expect(request.request.body).toEqual({ code: '123456' });
    request.flush({ method: 'totp', recoveryCodesLeft: 10 });
    await settle();
    controller.expectOne('/api/auth/me').flush(me);
    await done;
    await settle();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('affiche le refus du serveur', async () => {
    fill('000000');
    const done = submit();
    controller
      .expectOne('/api/auth/mfa/verify')
      .flush({ message: 'Code invalide ou expiré.' }, { status: 400, statusText: 'Bad Request' });
    await done;
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Code invalide ou expiré.');
  });

  it('propose un code de secours en cas de perte de l\'appareil, et revient au code de l\'application', async () => {
    expect(root.textContent).toContain('Code à 6 chiffres');
    buttonWith('perdu mon appareil')!.click();
    await settle();
    expect(root.textContent).toContain('Code de secours');
    buttonWith("code de mon application")!.click();
    await settle();
    expect(root.textContent).toContain('Code à 6 chiffres');
  });
});
