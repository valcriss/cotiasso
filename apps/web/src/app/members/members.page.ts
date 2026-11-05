import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AdminApiService, type MemberCategoryInfo, type MemberInfo, type MemberOfficeInfo, type OfficeRoleInfo } from '../admin/admin-api.service';
import { AuthService } from '../auth/auth.service';
import { describeHttpError } from '../auth/error-messages';
import { todayLocalIso } from '../ui/dates';
import { Dialogs } from '../ui/dialogs.service';
import { Notifier } from '../ui/notifier.service';
import { ActionBar } from '../ui/action-bar';
import { BackLink } from '../ui/back-link';
import { routeParam } from '../ui/route-param';
import {
  AnonymizeDialog,
  CategoriesDialog,
  LinkAccountDialog,
  MemberDialog,
  OfficeDialog,
  OfficeRolesDialog,
  type AnonymizeDialogData,
  type CategoriesDialogData,
  type LinkAccountDialogData,
  type MemberDialogData,
  type OfficeDialogData,
  type OfficeRolesDialogData,
} from './member-dialogs';
import { FrDatePipe } from '../ui/fr-date.pipe';
import { Skeleton } from '../ui/skeleton';

/** Membres : fiches, catégories, fonctions et mandats (ADR 0023). */
@Component({
  selector: 'app-members-page',
  imports: [Skeleton, BackLink, RouterLink, FrDatePipe, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, ActionBar],
  styleUrl: '../admin/admin-pages.scss',
  template: `
    @if (routeId()) {
      <app-action-bar label="Actions de la fiche">
        <app-back-link to="/membres/liste" label="Retour aux membres" />
      </app-action-bar>
    } @else {
    <app-action-bar
      label="Actions des membres"
      description="Les personnes qui font vivre l'association : leurs coordonnées, leur catégorie et leurs fonctions (président, trésorier…). Un membre n'a pas besoin d'un compte de connexion."
    >
      @if (canManage()) {
        <button mat-flat-button type="button" (click)="create()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">person_add</mat-icon> Nouveau membre
        </button>
        <button mat-stroked-button type="button" (click)="manageCategories()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">category</mat-icon> Catégories
        </button>
        <button mat-stroked-button type="button" (click)="manageOfficeRoles()">
          <mat-icon fontSet="material-icons-outlined" aria-hidden="true">badge</mat-icon> Fonctions
        </button>
      }
    </app-action-bar>
    }

    @if (error(); as message) {
      <p class="alert" role="alert">{{ message }}</p>
    }

    @if (!routeId()) {
    <button mat-stroked-button type="button" class="filters-toggle" [attr.aria-expanded]="filtersOpen()" aria-controls="member-filters" (click)="filtersOpen.set(!filtersOpen())">
      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">filter_list</mat-icon> Filtres
      <mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ filtersOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
    </button>
    <form id="member-filters" class="panel filters" [class.collapsed]="!filtersOpen()" [formGroup]="filters" (ngSubmit)="search()">
      <mat-form-field appearance="outline">
        <mat-label>Nom, prénom ou email</mat-label>
        <input matInput formControlName="q" />
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>État</mat-label>
        <mat-select formControlName="status">
          <mat-option value="">Tous</mat-option>
          <mat-option value="ACTIVE">Membres actuels</mat-option>
          <mat-option value="FORMER">Anciens membres</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Cotisation{{ campaign() ? ' — ' + campaign()!.name : '' }}</mat-label>
        <mat-select formControlName="membershipStatus">
          <mat-option value="">Toutes</mat-option>
          <mat-option value="UP_TO_DATE">À jour</mat-option>
          <mat-option value="LATE">En retard (rien payé ou payé en partie)</mat-option>
          <mat-option value="NONE">Pas inscrits à la saison</mat-option>
        </mat-select>
        @if (!campaign() && !loading()) {
          <mat-hint>Aucune saison de cotisation n’est en cours.</mat-hint>
        }
      </mat-form-field>
      <mat-form-field appearance="outline">
        <mat-label>Catégorie</mat-label>
        <mat-select formControlName="categoryId">
          <mat-option value="">Toutes</mat-option>
          @for (category of categories(); track category.id) {
            <mat-option [value]="category.id">{{ category.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <div class="actions">
        <button mat-flat-button type="submit" class="full-row"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">search</mat-icon> Rechercher</button>
      </div>
    </form>
    }

    @if (routeId() && selected(); as detail) {
      <section class="panel" [attr.aria-label]="'Fiche de ' + detail.member.firstName + ' ' + detail.member.lastName">
        <div class="head">
          <h3>
            <mat-icon fontSet="material-icons-outlined" aria-hidden="true">badge</mat-icon>
            <span>{{ detail.member.firstName }} {{ detail.member.lastName }}</span>
            @if (detail.member.status === 'FORMER') {
              <span class="chip">Ancien membre</span>
            }
          </h3>
        </div>
        <dl class="details">
          <dt>Email</dt>
          <dd>{{ detail.member.email ?? '—' }}</dd>
          <dt>Téléphone</dt>
          <dd>{{ detail.member.phone ?? '—' }}</dd>
          <dt>Adresse</dt>
          <dd>{{ address(detail.member) }}</dd>
          <dt>Catégorie</dt>
          <dd>{{ detail.member.categoryName ?? '—' }}</dd>
          <dt>Entrée</dt>
          <dd>{{ (detail.member.joinedOn | frDate) || '—' }}</dd>
          @if (detail.member.leftOn) {
            <dt>Sortie</dt>
            <dd>{{ detail.member.leftOn | frDate }}</dd>
          }
          <dt>Compte de connexion</dt>
          <dd>{{ detail.member.hasAccount ? 'Relié : peut se connecter et faire des demandes de remboursement' : 'Aucun (pas nécessaire pour être membre)' }}</dd>
          @if (detail.member.note) {
            <dt>Note</dt>
            <dd>{{ detail.member.note }}</dd>
          }
        </dl>
        @if (canLink() && !detail.member.anonymized && detail.member.status === 'ACTIVE') {
          <div class="actions">
            @if (detail.member.hasAccount) {
              <button mat-button type="button" [disabled]="busy()" (click)="unlinkAccount(detail.member)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">link_off</mat-icon> Détacher du compte
              </button>
            } @else {
              <button mat-stroked-button class="full-row" type="button" [disabled]="busy()" (click)="linkAccount(detail.member)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">link</mat-icon> Associer à un compte utilisateur
              </button>
              <span class="muted full-row-hint">Le lien se fait tout seul quand un compte a la même adresse email que la fiche.</span>
            }
          </div>
        }
        @if (detail.member.anonymized) {
          <p class="muted">Ce membre est anonymisé : ses données personnelles ont été effacées, son historique est conservé.</p>
        } @else if (canManage()) {
          <div class="actions">
            <button mat-stroked-button type="button" (click)="edit(detail.member)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">edit</mat-icon> Modifier
            </button>
            @if (detail.member.status === 'ACTIVE') {
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="markFormer(detail.member)">
                <mat-icon fontSet="material-icons-outlined" aria-hidden="true">logout</mat-icon> Marquer comme sorti
              </button>
            } @else {
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="reactivate(detail.member)">Réactiver</button>
              <button mat-button class="danger" type="button" (click)="anonymize(detail.member)">Anonymiser…</button>
            }
          </div>
        }

        <h4>Fonctions et mandats</h4>
        @if (detail.offices.length === 0) {
          <p class="muted">Aucune fonction enregistrée.</p>
        } @else {
          <ul class="offices">
            @for (office of detail.offices; track office.id) {
              <li>
                <strong class="office-title">{{ office.title }}</strong>
                <span class="muted office-dates">depuis le {{ office.startsOn | frDate }}@if (office.endsOn) { jusqu'au {{ office.endsOn | frDate }} } @else { (en cours) }</span>
                @if (canManage() && !detail.member.anonymized) {
                  <span class="office-actions">
                  @if (office.current) {
                    <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="'Terminer la fonction ' + office.title" (click)="endOffice(office)">Terminer aujourd'hui</button>
                  }
                  <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="'Retirer la fonction ' + office.title" (click)="removeOffice(office)">Retirer</button>
                  </span>
                }
              </li>
            }
          </ul>
        }
        @if (canManage() && !detail.member.anonymized) {
          <div class="actions">
            <button mat-stroked-button class="full-row" type="button" (click)="addOffice(detail.member)">
              <mat-icon fontSet="material-icons-outlined" aria-hidden="true">add</mat-icon> Ajouter une fonction
            </button>
          </div>
        }
      </section>
    }

    @if (routeId()) {
      @if (loadingDetail() && !selected()) {
        <app-skeleton variant="table" />
      } @else if (!selected() && !error() && !loadingDetail()) {
        <p class="alert" role="alert">
          Cette fiche est introuvable. Elle a peut-être été retirée de votre accès, ou l'adresse est incomplète. Revenez à la liste des membres pour en choisir une autre.
        </p>
      }
    } @else if (loading()) {
      <app-skeleton variant="table" />
    } @else if (members().length === 0) {
      <section class="panel">
        <p class="muted">
          Aucun membre ne correspond.
          @if (canManage() && !hasFilter()) {
            Commencez par « Nouveau membre » pour enregistrer les personnes de l'association.
          }
        </p>
      </section>
    } @else {
      <table class="table keep-table members-table">
        <caption class="sr-only">Membres</caption>
        <thead>
          <tr>
            <th scope="col">Nom</th>
            <th scope="col" class="wide-only">Catégorie</th>
            <th scope="col" class="wide-only">Fonctions</th>
            <th scope="col" class="wide-only">État</th>
            <th scope="col">Cotisation</th>
            <th scope="col" class="wide-only"><span class="sr-only">Ouvrir</span></th>
          </tr>
        </thead>
        <tbody>
          @for (member of members(); track member.id) {
            <tr [class.disabled]="member.status === 'FORMER'">
              <td>
                <a class="member-link" [routerLink]="['/membres/liste', member.id]">
                  <strong>{{ member.lastName }} {{ member.firstName }}</strong>
                </a>
                @if (member.status === 'FORMER') {
                  <span class="chip narrow-only">Ancien membre</span>
                }
                @if (member.email) {
                  <div class="muted wide-only">{{ member.email }}</div>
                }
              </td>
              <td class="wide-only">{{ member.categoryName ?? '—' }}</td>
              <td class="wide-only">{{ member.currentOffices.join(', ') || '—' }}</td>
              <td class="wide-only">{{ member.status === 'ACTIVE' ? 'Membre' : 'Ancien membre' }}</td>
              <td>
                @if (cotisation(member); as c) {
                  <span class="status" [class.ok]="c.ok"><mat-icon fontSet="material-icons-outlined" aria-hidden="true">{{ c.icon }}</mat-icon> {{ c.label }}</span>
                } @else {
                  <span class="muted">—</span>
                }
              </td>
              <td class="row-actions wide-only">
                <a mat-button [routerLink]="['/membres/liste', member.id]" [attr.aria-label]="'Ouvrir la fiche de ' + member.firstName + ' ' + member.lastName">Ouvrir</a>
              </td>
            </tr>
          }
        </tbody>
      </table>
      @if (next()) {
        <div class="more"><button mat-stroked-button type="button" [disabled]="loadingMore()" (click)="more()">Charger la suite</button></div>
      }
    }
  `,
  styles: `
    .filters-toggle {
      display: none;
    }
    @media (max-width: 720px) {
      .filters-toggle {
        --mat-button-outlined-container-height: 40px;
        background: var(--app-surface);
        display: inline-flex;
        justify-content: center;
        margin-bottom: 12px;
        width: 100%;
      }
      form.filters.collapsed {
        display: none;
      }
    }
    .narrow-only {
      display: none;
    }
    .member-link {
      color: inherit;
      text-decoration: none;
    }
    /* Petit écran : la liste ne garde que le nom et la cotisation pour montrer plus de membres ; le reste est dans la fiche. */
    @media (max-width: 720px) {
      .table.members-table {
        display: table;
        width: 100%;
      }
      .members-table th,
      .members-table td {
        padding: 10px 8px;
        vertical-align: middle;
      }
      .wide-only {
        display: none;
      }
      .narrow-only {
        display: inline-block;
      }
    }
    .details {
      display: grid;
      gap: 4px 16px;
      grid-template-columns: max-content 1fr;
      margin: 8px 0 16px;
    }
    .details dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .details dd {
      margin: 0;
    }
    .offices {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .offices li {
      background: var(--app-surface-muted);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      display: grid;
      gap: 2px 12px;
      margin-bottom: 8px;
      padding: 10px 14px;
    }
    .office-title {
      font: var(--mat-sys-title-small);
    }
    .office-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-inline-start: -8px;
    }
    @media (max-width: 720px) {
      .full-row-hint {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class MembersPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly dialogs = inject(Dialogs);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /** La fiche ouverte vient de l'adresse (`/membres/liste/:id`) : `null` sur la liste. */
  protected readonly routeId = routeParam('id');
  protected readonly loadingDetail = signal(!!this.routeId());
  private readonly notifier = inject(Notifier);

  /** Sur téléphone, les filtres sont repliés par défaut ; sur grand écran ils sont toujours visibles. */
  protected readonly filtersOpen = signal(false);
  protected readonly members = signal<MemberInfo[]>([]);
  protected readonly categories = signal<MemberCategoryInfo[]>([]);
  protected readonly officeRoles = signal<OfficeRoleInfo[]>([]);
  protected readonly selected = signal<{ member: MemberInfo; offices: MemberOfficeInfo[] } | null>(null);
  protected readonly next = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly filters = this.fb.group({ q: [''], status: [''], categoryId: [''], membershipStatus: [''] });
  /** Saison de cotisation en cours (aucune : pas de situation de cotisation à montrer). */
  protected readonly campaign = signal<{ id: string; name: string } | null>(null);
  protected readonly canManage = computed(() => {
    this.auth.permissions();
    return this.auth.can('members:manage');
  });
  protected readonly canLink = computed(() => {
    this.auth.permissions();
    return this.auth.can('members.account:link');
  });

  constructor() {
    void this.init();
    effect(() => {
      const id = this.routeId();
      untracked(() => {
        if (id) void this.open(id);
        else this.selected.set(null);
      });
    });
  }

  protected hasFilter(): boolean {
    const { q, status, categoryId, membershipStatus } = this.filters.getRawValue();
    return !!(q || status || categoryId || membershipStatus);
  }

  /** Où en est la cotisation du membre pour la saison en cours, en un mot ; `null` s'il n'y a pas de saison en cours. */
  protected cotisation(member: MemberInfo): { label: string; icon: string; ok: boolean } | null {
    switch (member.membershipStatus) {
      case 'UP_TO_DATE':
        return { label: 'À jour', icon: 'check_circle', ok: true };
      case 'EXEMPT':
        return { label: 'À jour (exonéré)', icon: 'check_circle', ok: true };
      case 'PARTIAL':
        return { label: 'Payée en partie', icon: 'warning', ok: false };
      case 'DUE':
        return { label: 'En retard', icon: 'warning', ok: false };
      case 'NONE':
        return { label: 'Pas inscrit', icon: 'radio_button_unchecked', ok: false };
      default:
        return null;
    }
  }

  protected address(member: MemberInfo): string {
    const place = [member.postalCode, member.city].filter(Boolean).join(' ');
    return [member.addressLine, place].filter(Boolean).join(', ') || '—';
  }

  protected async search(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.api.listMembers(this.query());
      this.members.set(page.members);
      this.next.set(page.next);
      this.campaign.set(page.campaign ?? null);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger les membres.').message);
    } finally {
      this.loading.set(false);
    }
  }

  protected async more(): Promise<void> {
    const after = this.next();
    if (!after) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.listMembers({ ...this.query(), after });
      this.members.update((current) => [...current, ...page.members]);
      this.next.set(page.next);
    } catch (failure) {
      this.error.set(describeHttpError(failure, 'Impossible de charger la suite.').message);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Charge la fiche de l'adresse ; une fiche inconnue ou hors de portée reste `null` (le serveur répond 404). */
  protected async open(id: string): Promise<void> {
    this.loadingDetail.set(true);
    this.error.set(null);
    try {
      this.selected.set(await this.api.getMember(id));
    } catch (failure) {
      this.selected.set(null);
      if ((failure as { status?: number }).status !== 404) this.error.set(describeHttpError(failure, 'Impossible de charger la fiche.').message);
    } finally {
      this.loadingDetail.set(false);
    }
  }

  protected async create(): Promise<void> {
    const created = await this.dialogs.open<MemberInfo, MemberDialogData>(MemberDialog, { size: 'md', data: { member: null, categories: this.categories() } });
    if (!created) return;
    this.notifier.success(`Fiche de ${created.firstName} ${created.lastName} créée.`);
    await this.router.navigate(['/membres/liste', created.id]);
  }

  protected async edit(member: MemberInfo): Promise<void> {
    const saved = await this.dialogs.open<MemberInfo, MemberDialogData>(MemberDialog, { size: 'md', data: { member, categories: this.categories() } });
    if (!saved) return;
    this.notifier.success('Fiche enregistrée.');
    await this.open(saved.id);
  }

  protected async markFormer(member: MemberInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Marquer ${member.firstName} ${member.lastName} comme sorti ?`,
      message: "La date de sortie sera aujourd'hui. La fiche et l'historique (adhésions, règlements) sont conservés, et vous pourrez le réactiver.",
      confirmLabel: 'Marquer comme sorti',
    });
    if (!confirmed) return;
    await this.change(member, { status: 'FORMER' }, `${member.firstName} est marqué(e) comme sorti(e).`);
  }

  protected reactivate(member: MemberInfo): Promise<void> {
    return this.change(member, { status: 'ACTIVE' }, `${member.firstName} est de nouveau membre.`);
  }

  protected async linkAccount(member: MemberInfo): Promise<void> {
    const done = await this.dialogs.open<{ hasAccount: true }, LinkAccountDialogData>(LinkAccountDialog, {
      size: 'md',
      data: { memberId: member.id, memberName: `${member.firstName} ${member.lastName}` },
    });
    if (!done) return;
    this.notifier.success(`${member.firstName} ${member.lastName} est associé(e) à un compte de connexion.`);
    await this.open(member.id);
  }

  protected async unlinkAccount(member: MemberInfo): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: `Détacher ${member.firstName} ${member.lastName} de son compte ?`,
      message: 'La fiche, ses adhésions et son historique sont conservés. Cette personne pourra toujours se connecter, mais ne pourra plus faire de demande de remboursement tant que la fiche n’est pas reliée à un compte. Vous pourrez la relier de nouveau.',
      confirmLabel: 'Détacher',
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.unlinkMemberAccount(member.id);
      this.notifier.success('La fiche est détachée du compte.');
      this.selected.set(await this.api.getMember(member.id));
    }, 'Impossible de détacher le compte.');
  }

  protected async anonymize(member: MemberInfo): Promise<void> {
    const done = await this.dialogs.open<MemberInfo, AnonymizeDialogData>(AnonymizeDialog, { size: 'md', data: { member } });
    if (!done) return;
    this.notifier.success('Membre anonymisé.');
    await this.open(done.id);
  }

  protected async manageCategories(): Promise<void> {
    const categories = await this.dialogs.open<MemberCategoryInfo[], CategoriesDialogData>(CategoriesDialog, {
      size: 'md',
      dismissible: true,
      data: { categories: this.categories() },
    });
    if (categories) this.categories.set(categories);
  }

  protected async manageOfficeRoles(): Promise<void> {
    const roles = await this.dialogs.open<OfficeRoleInfo[], OfficeRolesDialogData>(OfficeRolesDialog, {
      size: 'md',
      dismissible: true,
      data: { roles: this.officeRoles() },
    });
    if (roles) this.officeRoles.set(roles);
  }

  protected async addOffice(member: MemberInfo): Promise<void> {
    const added = await this.dialogs.open<MemberOfficeInfo, OfficeDialogData>(OfficeDialog, {
      size: 'md',
      data: { memberId: member.id, memberName: `${member.firstName} ${member.lastName}`, roles: this.officeRoles().filter((role) => role.active) },
    });
    if (!added) return;
    this.notifier.success(`Fonction « ${added.title} » ajoutée.`);
    await this.open(member.id);
  }

  protected async endOffice(office: MemberOfficeInfo): Promise<void> {
    const member = this.selected()?.member;
    if (!member) return;
    await this.run(async () => {
      await this.api.updateMemberOffice(office.id, { endsOn: todayLocalIso() });
      this.notifier.success(`Fonction « ${office.title} » terminée.`);
      await this.open(member.id);
    }, "La fonction n'a pas pu être terminée.");
  }

  protected async removeOffice(office: MemberOfficeInfo): Promise<void> {
    const member = this.selected()?.member;
    if (!member) return;
    const confirmed = await this.dialogs.confirm({
      title: `Retirer la fonction « ${office.title} » ?`,
      message: "À utiliser pour corriger une erreur de saisie. Pour garder l'historique d'un mandat terminé, utilisez plutôt « Terminer aujourd'hui ».",
      confirmLabel: 'Retirer',
      danger: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.api.removeMemberOffice(office.id);
      this.notifier.success('Fonction retirée.');
      await this.open(member.id);
    }, "La fonction n'a pas pu être retirée.");
  }

  private async change(member: MemberInfo, patch: { status: 'ACTIVE' | 'FORMER' }, success: string): Promise<void> {
    await this.run(async () => {
      await this.api.updateMember(member.id, { ...patch, version: member.version });
      this.notifier.success(success);
      await this.open(member.id);
    }, "La fiche n'a pas pu être modifiée.");
  }

  private query() {
    const { q, status, categoryId, membershipStatus } = this.filters.getRawValue();
    return {
      ...(q && { q }),
      ...(status && { status: status as 'ACTIVE' | 'FORMER' }),
      ...(categoryId && { categoryId }),
      ...(membershipStatus && { membershipStatus: membershipStatus as 'UP_TO_DATE' | 'LATE' | 'NONE' }),
    };
  }

  private async run(action: () => Promise<void>, fallback: string): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      this.error.set(describeHttpError(failure, fallback).message);
    } finally {
      this.busy.set(false);
    }
  }

  private async init(): Promise<void> {
    this.categories.set(await this.api.listMemberCategories().catch(() => []));
    this.officeRoles.set(await this.api.listOfficeRoles().catch(() => []));
    // Un lien de la vue d'ensemble ouvre la liste déjà filtrée sur les cotisations en retard.
    if (this.route.snapshot.queryParamMap.get('cotisation') === 'late') this.filters.patchValue({ membershipStatus: 'LATE' });
    if (!this.routeId()) await this.search();
    else this.loading.set(false);
  }
}
