import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(HealthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("renvoie 'up' quand l'API et la base répondent", () => {
    let result: string | undefined;
    service.check().subscribe((value) => (result = value));
    http.expectOne('/api/health').flush({ status: 'ok', database: 'up' });
    expect(result).toBe('up');
  });

  it("renvoie 'degraded' sur un 503", () => {
    let result: string | undefined;
    service.check().subscribe((value) => (result = value));
    http.expectOne('/api/health').flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(result).toBe('degraded');
  });

  it("renvoie 'unreachable' quand l'API ne répond pas", () => {
    let result: string | undefined;
    service.check().subscribe((value) => (result = value));
    http.expectOne('/api/health').error(new ProgressEvent('error'));
    expect(result).toBe('unreachable');
  });
});
