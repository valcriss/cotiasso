import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { mockAuth } from '../testing/auth-mock';
import { ProjectGrants } from './project-grants';

const project = { id: 'p1', code: 'ATELIERS', name: 'Ateliers', description: '', status: 'ACTIVE', permanent: false, startDate: null, endDate: null, managerId: null };
const grant = {
  id: 'g1',
  funder: { id: 'f1', name: 'Région', type: 'LOCAL_AUTHORITY', archived: false },
  reference: null,
  title: 'Aide au festival',
  status: 'GRANTED',
  requestedAmount: '1000.00',
  grantedAmount: '1000.00',
  requestedOn: null,
  decidedOn: '2026-03-15',
  periodStart: null,
  periodEnd: null,
  conditions: '',
  note: '',
  reason: null,
  closedOn: null,
  residual: null,
  residualNote: null,
  allocations: [
    { projectId: 'p1', projectCode: 'ATELIERS', projectName: 'Ateliers', amount: '600.00' },
    { projectId: 'p2', projectCode: 'FESTIVAL', projectName: 'Festival', amount: '400.00' },
  ],
  allocatedTotal: '1000.00',
};

describe('ProjectGrants', () => {
  let controller: HttpTestingController;
  let fixture: ReturnType<typeof TestBed.createComponent<ProjectGrants>>;
  let root: HTMLElement;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const create = async (listed: unknown[]) => {
    await TestBed.configureTestingModule({
      imports: [ProjectGrants],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectGrants);
    fixture.componentRef.setInput('project', project);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/projects/p1/grants').flush(listed);
    await settle();
  };

  afterEach(() => controller.verify());

  it('liste les subventions du projet avec la part qui lui revient, pas le total', async () => {
    await create([grant]);
    const cells = Array.from(root.querySelectorAll('tbody td')).map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells).toEqual(['Aide au festival', 'Région', 'Accordée', '600,00 €']);
    expect(root.textContent).toContain('la part qui lui revient');
    expect(root.querySelector('a[href="/subventions"]')).toBeTruthy();
  });

  it('dit quoi faire quand aucune subvention ne finance le projet', async () => {
    await create([]);
    expect(root.textContent).toContain("Aucune subvention n'est affectée à ce projet");
  });

  it('affiche un message clair si le chargement échoue', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectGrants],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), mockAuth(['grants:view'])],
    }).compileComponents();
    controller = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ProjectGrants);
    fixture.componentRef.setInput('project', project);
    root = fixture.nativeElement as HTMLElement;
    await settle();
    controller.expectOne('/api/projects/p1/grants').flush({ message: 'Projet introuvable.' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('introuvable');
  });
});
