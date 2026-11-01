import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { AccountPage } from './account.page';

const CURRENT = 'une phrase de passe correcte';
const NEXT = 'un nouveau mot de passe valide';

describe('AccountPage', () => {
  let controller: HttpTestingController;
  let root: HTMLElement;
  let fixture: ReturnType<typeof TestBed.createComponent<AccountPage>>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const fill = (current: string, next: string, confirmation: string) => {
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    [current, next, confirmation].forEach((value, index) => {
      inputs[index]!.value = value;
      inputs[index]!.dispatchEvent(new Event('input'));
    });
  };
  const submit = async () => {
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth([])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountPage);
    root = fixture.nativeElement as HTMLElement;
    await settle();
  });

  afterEach(() => controller.verify());

  it("affiche l'identité de l'utilisateur connecté", () => {
    expect(root.textContent).toContain('admin@asso.fr');
  });

  it("n'envoie rien quand la confirmation diffère ou que le mot de passe est trop court", async () => {
    fill(CURRENT, 'court', 'court');
    await submit();
    controller.expectNone('/api/auth/password');
    expect(root.textContent).toContain('au moins 12 caractères');

    fill(CURRENT, NEXT, 'autre chose entierement');
    await submit();
    controller.expectNone('/api/auth/password');
    expect(root.textContent).toContain('ne correspondent pas');
  });

  it('change le mot de passe, vide le formulaire et confirme', async () => {
    fill(CURRENT, NEXT, NEXT);
    await submit();
    const request = controller.expectOne('/api/auth/password');
    expect(request.request.body).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Mot de passe modifié');
    expect(Array.from(root.querySelectorAll<HTMLInputElement>('input')).every((i) => i.value === '')).toBe(true);
  });

  it("affiche le refus du serveur quand le mot de passe actuel est incorrect", async () => {
    fill('mauvais mot de passe', NEXT, NEXT);
    await submit();
    controller
      .expectOne('/api/auth/password')
      .flush({ message: 'Le mot de passe actuel est incorrect.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('mot de passe actuel est incorrect');
    expect(root.querySelector('[role="status"]')).toBeNull();
  });
});
