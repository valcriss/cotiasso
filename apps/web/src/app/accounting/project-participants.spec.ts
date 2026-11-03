import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { mockAuth } from '../testing/auth-mock';
import { DialogTester, NO_MATERIAL_ANIMATIONS } from '../testing/dialog-harness';
import { ProjectParticipants } from './project-participants';

const project = {
  id: 'p1',
  code: 'FESTIVAL',
  name: 'Festival',
  description: '',
  status: 'ACTIVE',
  permanent: false,
  startDate: null,
  endDate: null,
  managerId: null,
};
const alice = {
  id: 'pp1',
  projectId: 'p1',
  memberId: 'm1',
  userId: null,
  name: 'Alice Martin',
  role: 'Coordinatrice',
  startDate: '2026-05-01',
  endDate: null,
  note: '',
};

describe('ProjectParticipants', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ProjectParticipants>>;
  let root: HTMLElement;
  let ui: DialogTester;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (permissions: string[], participants: unknown[]) => {
    await TestBed.configureTestingModule({
      imports: [ProjectParticipants],
      providers: [provideHttpClient(), provideHttpClientTesting(), mockAuth(permissions), NO_MATERIAL_ANIMATIONS],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectParticipants);
    fixture.componentRef.setInput('project', project);
    root = fixture.nativeElement as HTMLElement;
    ui = new DialogTester(settle);
    await settle();
    controller.expectOne('/api/projects/p1/participants').flush(participants);
    await settle();
  };
  const click = async (label: string) => {
    const button = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent!.trim().includes(label) || b.getAttribute('aria-label')?.includes(label),
    );
    expect(button, label).toBeTruthy();
    button!.click();
    await settle();
  };

  afterEach(() => {
    ui.closeAll();
    controller.verify();
  });

  it('dit que la liste ne donne aucun droit, et quoi faire en premier quand elle est vide', async () => {
    await create(['projects:view', 'projects:update'], []);
    expect(root.textContent).toContain("elle ne donne aucun droit d'accès");
    expect(root.textContent).toContain('Cliquez sur « Ajouter un participant »');
  });

  it('en lecture seule, liste les participants sans action', async () => {
    await create(['projects:view'], [alice]);
    expect(root.textContent).toContain('Alice Martin');
    expect(root.textContent).toContain('Coordinatrice');
    expect(root.textContent).toContain('01/05/2026 → en cours');
    expect(Array.from(root.querySelectorAll('button'))).toHaveLength(0);
  });

  it('ajoute un membre actif avec son rôle', async () => {
    await create(['projects:view', 'projects:update'], []);
    await click('Ajouter un participant');
    expect(ui.title).toBe('Ajouter un participant');
    expect(ui.text).toContain('ne donne aucun droit');
    controller.expectOne((r) => r.url === '/api/members' && r.params.get('status') === 'ACTIVE').flush({
      members: [{ id: 'm1', firstName: 'Alice', lastName: 'Martin' }],
      next: null,
    });
    await settle();

    await ui.submit();
    expect(ui.error).toContain('Vérifiez les champs signalés');
    expect(ui.text).toContain('Choisissez le membre qui participe');

    await ui.choose('mat-select[formcontrolname="memberId"]', 'Alice Martin');
    await ui.type('input[formcontrolname="role"]', 'Bénévole');
    await ui.submit();
    const request = controller.expectOne('/api/projects/p1/participants');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({ memberId: 'm1', role: 'Bénévole', startDate: null, endDate: null });
    request.flush({ ...alice, role: 'Bénévole' }, { status: 201, statusText: 'Created' });
    await settle();
    controller.expectOne('/api/projects/p1/participants').flush([{ ...alice, role: 'Bénévole' }]);
    await settle();
    expect(ui.isOpen).toBe(false);
    expect(ui.snackbar).toContain('Alice Martin participe maintenant au projet');
    expect(root.textContent).toContain('Bénévole');
  });

  it('indique que la liste des membres est inaccessible plutôt que de rester vide sans explication', async () => {
    await create(['projects:view', 'projects:update'], []);
    await click('Ajouter un participant');
    controller.expectOne((r) => r.url === '/api/members').flush({ message: 'Interdit' }, { status: 403, statusText: 'Forbidden' });
    await settle();
    expect(ui.text).toContain("La liste des membres n'est pas accessible avec vos droits");
  });

  it('enregistre une date de fin sans changer la personne, et garde la boîte ouverte si le serveur refuse', async () => {
    await create(['projects:view', 'projects:update'], [alice]);
    await click('Modifier Alice Martin');
    expect(ui.title).toBe('Modifier Alice Martin');
    expect(ui.text).not.toContain('Membre');
    await ui.type('input[formcontrolname="endDate"]', '2026-04-01');
    await ui.submit();
    controller
      .expectOne('/api/project-participants/pp1')
      .flush({ message: 'La fin de la participation précède son début.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    expect(ui.isOpen).toBe(true);
    expect(ui.error).toContain('précède son début');

    await ui.type('input[formcontrolname="endDate"]', '2026-09-30');
    await ui.submit();
    const request = controller.expectOne('/api/project-participants/pp1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toMatchObject({ role: 'Coordinatrice', endDate: '2026-09-30' });
    request.flush({ ...alice, endDate: '2026-09-30' });
    await settle();
    controller.expectOne('/api/projects/p1/participants').flush([{ ...alice, endDate: '2026-09-30' }]);
    await settle();
    expect(root.textContent).toContain('01/05/2026 → 30/09/2026');
  });

  it('retire un participant après confirmation, en proposant la date de fin pour garder l’historique', async () => {
    await create(['projects:view', 'projects:update'], [alice]);
    await click('Retirer Alice Martin');
    expect(ui.title).toBe('Retirer Alice Martin ?');
    expect(ui.text).toContain('indiquez plutôt une date de fin');
    await ui.click('Annuler');
    controller.expectNone('/api/project-participants/pp1');
    await click('Retirer Alice Martin');
    await ui.click('Retirer');
    const request = controller.expectOne('/api/project-participants/pp1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    controller.expectOne('/api/projects/p1/participants').flush([]);
    await settle();
    expect(root.textContent).toContain("Personne n'est encore indiqué");
  });
});
