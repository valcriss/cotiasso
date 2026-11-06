import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { SecurityPage } from './security.page';

const view = (over: Record<string, unknown> = {}) => ({
  mode: 'DISABLED',
  usernameless: false,
  effectiveMode: 'DISABLED',
  domain: { ok: true, rpId: 'compta.asso.fr' },
  usableKeys: 0,
  otherDomainKeys: 0,
  usersWithKeys: 0,
  ...over,
});

describe('SecurityPage', () => {
  let controller: HttpTestingController;

  const render = async (permissions: string[], settings = view()) => {
    await TestBed.configureTestingModule({
      imports: [SecurityPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions)],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SecurityPage);
    fixture.detectChanges();
    controller.expectOne('/api/security/passkeys').flush(settings);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const radios = () => Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const choose = async (index: number) => {
      radios()[index]!.click();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const save = async () => {
      root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    };
    return { fixture, root, radios, choose, save };
  };

  afterEach(() => controller.verify());

  it('affiche les trois choix en mots simples, avec le domaine auquel les clés seront liées', async () => {
    const { root, radios } = await render(['settings.association:admin']);
    expect(radios()).toHaveLength(3);
    expect(root.textContent).toContain('Désactivées');
    expect(root.textContent).toContain('À la place du code');
    expect(root.textContent).toContain('Connexion complète');
    expect(root.textContent).toContain('compta.asso.fr');
    expect(root.textContent).toContain('facultative pour chacun');
    expect(root.textContent).toContain('Personne n’a encore de clé d’accès');
  });

  it('enregistre le mode choisi ; la connexion sans adresse n’apparaît qu’en mode complet', async () => {
    const { fixture, root, choose, save } = await render(['settings.association:admin']);
    expect(root.querySelector('mat-checkbox')).toBeNull();

    await choose(2);
    expect(root.querySelector('mat-checkbox')).not.toBeNull();
    root.querySelector<HTMLInputElement>('mat-checkbox input')!.click();
    await fixture.whenStable();

    const done = save();
    const request = controller.expectOne('/api/security/passkeys');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ passkeyMode: 'FULL', passkeyUsernameless: true });
    request.flush(view({ mode: 'FULL', usernameless: true, effectiveMode: 'FULL' }));
    await done;
    fixture.detectChanges();
    expect(root.querySelector('[role="status"]')!.textContent).toContain('Réglage enregistré');
  });

  it('retire la connexion sans adresse en quittant le mode complet', async () => {
    const { choose, save } = await render(['settings.association:admin'], view({ mode: 'FULL', usernameless: true, effectiveMode: 'FULL' }));
    await choose(1);
    const done = save();
    const request = controller.expectOne('/api/security/passkeys');
    expect(request.request.body).toEqual({ passkeyMode: 'SECOND_FACTOR', passkeyUsernameless: false });
    request.flush(view({ mode: 'SECOND_FACTOR', effectiveMode: 'SECOND_FACTOR' }));
    await done;
  });

  it('empêche d’activer tant que le domaine n’est pas utilisable, et dit quoi faire', async () => {
    const { root, radios } = await render(
      ['settings.association:admin'],
      view({ domain: { ok: false, reason: 'MISSING', message: 'Les clés d’accès ne peuvent pas être activées : renseignez PUBLIC_URL.' } }),
    );
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('renseignez PUBLIC_URL');
    expect(radios().map((radio) => radio.disabled)).toEqual([false, true, true]);
  });

  it('affiche le refus du serveur en trois temps dans la page', async () => {
    const { fixture, root, choose, save } = await render(['settings.association:admin']);
    await choose(1);
    const done = save();
    controller
      .expectOne('/api/security/passkeys')
      .flush({ message: 'Les clés d’accès ne peuvent pas être activées : l’adresse publique n’est pas en https.' }, { status: 409, statusText: 'Conflict' });
    await done;
    fixture.detectChanges();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('pas en https');
  });

  it('signale les clés créées sous un autre domaine, à refaire', async () => {
    const { root } = await render(['settings.association:admin'], view({ usersWithKeys: 2, otherDomainKeys: 3 }));
    expect(root.textContent).toContain('2 personnes ont');
    expect(root.textContent).toContain('3 clés ont été créées sous un autre nom de domaine');
    expect(root.textContent).toContain('Mon compte');
  });

  it('est en lecture seule sans le droit d’administrer', async () => {
    const { root, radios } = await render(['settings.association:view']);
    expect(radios().every((radio) => radio.disabled)).toBe(true);
    expect(root.querySelector('button[type="submit"]')).toBeNull();
    expect(root.textContent).toContain('mais pas le modifier');
  });
});
