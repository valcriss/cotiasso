import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AdminApiService, type MemberCategoryInfo, type MemberInfo, type MemberOfficeInfo, type OfficeRoleInfo } from '../admin/admin-api.service';
import { describeHttpError } from '../auth/error-messages';
import { todayLocalIso } from '../ui/dates';
import { FormDialog } from '../ui/form-dialog';
import { DateField } from '../ui/date-field';

const INVALID = 'Vérifiez les champs signalés en rouge, puis validez de nouveau.';
const blank = (value: string) => (value.trim() === '' ? null : value.trim());

export interface MemberDialogData {
  /** Membre à modifier, ou `null` pour en créer un. */
  member: MemberInfo | null;
  categories: MemberCategoryInfo[];
}

/** Création et modification d'une fiche membre. Renvoie la fiche enregistrée. */
@Component({
  selector: 'app-member-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="member ? 'Modifier ' + member.firstName + ' ' + member.lastName : 'Nouveau membre'"
        description="Seuls le prénom et le nom sont nécessaires : ne notez que ce qui vous est utile (email pour les rappels, adresse pour le courrier)."
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Prénom</mat-label>
            <input matInput formControlName="firstName" required />
            @if (form.controls.firstName.hasError('required')) {
              <mat-error>Saisissez le prénom.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Nom</mat-label>
            <input matInput formControlName="lastName" required />
            @if (form.controls.lastName.hasError('required')) {
              <mat-error>Saisissez le nom.</mat-error>
            }
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Email (facultatif)</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="off" />
            @if (form.controls.email.hasError('email')) {
              <mat-error>Cette adresse email n'est pas valide. Exemple : marie@exemple.fr</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Téléphone (facultatif)</mat-label>
            <input matInput formControlName="phone" autocomplete="off" />
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Adresse (facultatif)</mat-label>
          <input matInput formControlName="addressLine" autocomplete="off" />
        </mat-form-field>
        <div class="row">
          <mat-form-field appearance="outline">
            <mat-label>Code postal</mat-label>
            <input matInput formControlName="postalCode" autocomplete="off" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Ville</mat-label>
            <input matInput formControlName="city" autocomplete="off" />
          </mat-form-field>
        </div>
        <div class="row">
          <mat-form-field appearance="outline" class="grow">
            <mat-label>Catégorie (facultatif)</mat-label>
            <mat-select formControlName="categoryId">
              <mat-option value="">Aucune</mat-option>
              @for (category of activeCategories(); track category.id) {
                <mat-option [value]="category.id">{{ category.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <app-date-field label="Date d'entrée (facultatif)" formControlName="joinedOn" />
        </div>
        <mat-form-field appearance="outline">
          <mat-label>Note (facultatif)</mat-label>
          <input matInput formControlName="note" />
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class MemberDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<MemberDialog, MemberInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<MemberDialogData>(MAT_DIALOG_DATA);
  protected readonly member = this.data.member;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    firstName: [this.member?.firstName ?? '', [Validators.required]],
    lastName: [this.member?.lastName ?? '', [Validators.required]],
    email: [this.member?.email ?? '', [Validators.email]],
    phone: [this.member?.phone ?? ''],
    addressLine: [this.member?.addressLine ?? ''],
    postalCode: [this.member?.postalCode ?? ''],
    city: [this.member?.city ?? ''],
    categoryId: [this.member?.categoryId ?? ''],
    joinedOn: [this.member?.joinedOn ?? ''],
    note: [this.member?.note ?? ''],
  });

  /** Catégories proposées : les actives, plus celle du membre même si elle a été désactivée depuis. */
  protected activeCategories() {
    return this.data.categories.filter((c) => c.active || c.id === this.member?.categoryId);
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const raw = this.form.getRawValue();
    const body = {
      firstName: raw.firstName.trim(),
      lastName: raw.lastName.trim(),
      email: blank(raw.email),
      phone: blank(raw.phone),
      addressLine: blank(raw.addressLine),
      postalCode: blank(raw.postalCode),
      city: blank(raw.city),
      categoryId: raw.categoryId || null,
      joinedOn: raw.joinedOn || null,
      note: blank(raw.note),
    };
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(this.member ? await this.api.updateMember(this.member.id, { ...body, version: this.member.version }) : await this.api.createMember(body));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La fiche n'a pas pu être enregistrée. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface OfficeDialogData {
  memberId: string;
  memberName: string;
  /** Fonctions du catalogue qu'on peut encore attribuer (les archivées sont exclues). */
  roles: OfficeRoleInfo[];
}

/** Ajout d'une fonction ou d'un mandat (Président, Trésorier…). Renvoie la fonction créée. */
@Component({
  selector: 'app-office-dialog',
  imports: [DateField, ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Nouvelle fonction de ' + data.memberName"
        description="Une fonction (Président, Trésorier, Secrétaire…) avec ses dates. Elle ne donne aucun droit dans l'application : les droits se règlent dans les rôles."
        submitLabel="Ajouter la fonction"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        @if (data.roles.length === 0) {
          <p class="alert" role="status">
            Aucune fonction n’est disponible. Fermez cette boîte, puis utilisez le bouton « Fonctions » en haut de la page pour créer « Président », « Trésorier »… avant de les attribuer.
          </p>
        }
        <mat-form-field appearance="outline">
          <mat-label>Fonction</mat-label>
          <mat-select formControlName="officeRoleId" required>
            @for (role of data.roles; track role.id) {
              <mat-option [value]="role.id">{{ role.name }}</mat-option>
            }
          </mat-select>
          @if (form.controls.officeRoleId.hasError('required')) {
            <mat-error>Choisissez la fonction, par exemple « Trésorier ».</mat-error>
          }
        </mat-form-field>
        <div class="row">
          <app-date-field class="grow" label="Depuis le" formControlName="startsOn" errorText="Indiquez la date de début." required />
          <app-date-field class="grow" label="Jusqu'au (facultatif)" formControlName="endsOn" hint="Laissez vide si la fonction continue." />
        </div>
      </app-form-dialog>
    </form>
  `,
})
export class OfficeDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<OfficeDialog, MemberOfficeInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<OfficeDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({
    officeRoleId: ['', [Validators.required]],
    startsOn: [todayLocalIso(), [Validators.required]],
    endsOn: [''],
  });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    const raw = this.form.getRawValue();
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.addMemberOffice(this.data.memberId, { officeRoleId: raw.officeRoleId, startsOn: raw.startsOn, endsOn: raw.endsOn || null }));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "La fonction n'a pas pu être ajoutée. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface OfficeRolesDialogData {
  roles: OfficeRoleInfo[];
}

const STARTER_ROLES = ['Président', 'Trésorier', 'Secrétaire'];

/** Catalogue des fonctions de l'association : ajout, archivage. Renvoie la liste à jour quand on la ferme. */
@Component({
  selector: 'app-office-roles-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `
    .role {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      padding: 6px 0;
    }
    form {
      align-items: baseline;
      display: flex;
      gap: 8px;
    }
    form mat-form-field {
      flex: 1;
    }
    .starters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
  `,
  template: `
    <h2 mat-dialog-title>Fonctions du bureau</h2>
    <mat-dialog-content>
      <p class="muted">
        La liste des fonctions de votre association (Président, Trésorier, Secrétaire…). On les attribue ensuite aux membres, avec des dates. Une fonction ne donne aucun droit dans l’application, mais elle servira à
        désigner qui doit donner son accord. Une fonction ne se supprime pas : archivez-la quand elle n’existe plus.
      </p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @for (role of roles(); track role.id) {
        <div class="role">
          <span [class.muted]="!role.active">{{ role.name }} · {{ role.mandateCount }} mandat(s)@if (!role.active) { (archivée) }</span>
          <button mat-button type="button" [disabled]="busy()" [attr.aria-label]="(role.active ? 'Archiver ' : 'Réactiver ') + role.name" (click)="toggle(role)">
            {{ role.active ? 'Archiver' : 'Réactiver' }}
          </button>
        </div>
      } @empty {
        <p class="muted">Aucune fonction pour l’instant. Ajoutez celles de votre bureau :</p>
        <div class="starters">
          @for (starter of starters; track starter) {
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="create(starter)">{{ starter }}</button>
          }
        </div>
      }
      <form [formGroup]="form" (ngSubmit)="add()" novalidate>
        <mat-form-field appearance="outline">
          <mat-label>Nouvelle fonction</mat-label>
          <input matInput formControlName="name" placeholder="Vice-président" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="busy()">Ajouter</button>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" (click)="close()">Fermer</button>
    </mat-dialog-actions>
  `,
})
export class OfficeRolesDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<OfficeRolesDialog, OfficeRoleInfo[]>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<OfficeRolesDialogData>(MAT_DIALOG_DATA);
  protected readonly roles = signal<OfficeRoleInfo[]>(this.data.roles);
  protected readonly starters = STARTER_ROLES;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ name: [''] });

  protected async add(): Promise<void> {
    const name = this.form.getRawValue().name.trim();
    if (!name) {
      this.error.set('Donnez un nom à la fonction, par exemple « Vice-président ».');
      return;
    }
    await this.create(name);
    if (!this.error()) this.form.reset({ name: '' });
  }

  protected create(name: string): Promise<void> {
    return this.run(async () => {
      await this.api.createOfficeRole(name);
    });
  }

  protected toggle(role: OfficeRoleInfo): Promise<void> {
    return this.run(async () => {
      await this.api.updateOfficeRole(role.id, { active: !role.active });
    });
  }

  protected close(): void {
    this.reference.close(this.roles());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      this.roles.set(await this.api.listOfficeRoles());
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L’opération a échoué. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface AnonymizeDialogData {
  member: MemberInfo;
}

/** Anonymisation d'un membre sorti : irréversible, motif obligatoire. Renvoie la fiche anonymisée. */
@Component({
  selector: 'app-anonymize-dialog',
  imports: [ReactiveFormsModule, FormDialog, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <app-form-dialog
        [title]="'Anonymiser ' + data.member.firstName + ' ' + data.member.lastName + ' ?'"
        description="Son nom, ses coordonnées et sa note seront effacés pour toujours : il apparaîtra comme « Ancien membre ». Ses adhésions et ses règlements restent dans les comptes. On ne peut pas revenir en arrière."
        submitLabel="Anonymiser définitivement"
        [dirty]="form.dirty"
        [busy]="busy()"
        [error]="error()"
      >
        <mat-form-field appearance="outline">
          <mat-label>Motif</mat-label>
          <input matInput formControlName="reason" placeholder="Demande de la personne, fin de conservation…" required />
          <mat-hint>Conservé dans le journal d'audit, sans les données effacées.</mat-hint>
          @if (form.controls.reason.hasError('minlength') || form.controls.reason.hasError('required')) {
            <mat-error>Indiquez le motif en quelques mots (5 caractères au moins).</mat-error>
          }
        </mat-form-field>
      </app-form-dialog>
    </form>
  `,
})
export class AnonymizeDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<AnonymizeDialog, MemberInfo>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<AnonymizeDialogData>(MAT_DIALOG_DATA);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ reason: ['', [Validators.required, Validators.minLength(5)]] });

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(INVALID);
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    try {
      this.reference.close(await this.api.anonymizeMember(this.data.member.id, this.form.getRawValue().reason.trim()));
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'anonymisation n'a pas pu être faite. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface CategoriesDialogData {
  categories: MemberCategoryInfo[];
}

/** Gestion des catégories de membres : ajout, renommage, désactivation. Renvoie la liste à jour quand on la ferme. */
@Component({
  selector: 'app-categories-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `
    .category {
      align-items: center;
      display: flex;
      gap: 8px;
      justify-content: space-between;
      padding: 6px 0;
    }
    form {
      align-items: baseline;
      display: flex;
      gap: 8px;
    }
    form mat-form-field {
      flex: 1;
    }
  `,
  template: `
    <h2 mat-dialog-title>Catégories de membres</h2>
    <mat-dialog-content>
      <p class="muted">Une catégorie regroupe des membres qui paient le même tarif (par exemple « Adulte », « Étudiant »). Une catégorie utilisée ne se supprime pas : désactivez-la.</p>
      @if (error(); as message) {
        <p class="alert" role="alert">{{ message }}</p>
      }
      @for (category of categories(); track category.id) {
        <div class="category">
          <span [class.muted]="!category.active">{{ category.name }} · {{ category.memberCount }} membre(s)@if (!category.active) { (désactivée) }</span>
          <button mat-button type="button" [disabled]="busy()" (click)="toggle(category)">{{ category.active ? 'Désactiver' : 'Réactiver' }}</button>
        </div>
      } @empty {
        <p class="muted">Aucune catégorie pour l'instant : ajoutez-en une ci-dessous.</p>
      }
      <form [formGroup]="form" (ngSubmit)="add()" novalidate>
        <mat-form-field appearance="outline">
          <mat-label>Nouvelle catégorie</mat-label>
          <input matInput formControlName="name" placeholder="Étudiant" />
        </mat-form-field>
        <button mat-flat-button type="submit" [disabled]="busy()">Ajouter</button>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" (click)="close()">Fermer</button>
    </mat-dialog-actions>
  `,
})
export class CategoriesDialog {
  private readonly api = inject(AdminApiService);
  private readonly reference = inject<MatDialogRef<CategoriesDialog, MemberCategoryInfo[]>>(MatDialogRef);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly data = inject<CategoriesDialogData>(MAT_DIALOG_DATA);
  protected readonly categories = signal<MemberCategoryInfo[]>(this.data.categories);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.group({ name: [''] });

  protected async add(): Promise<void> {
    const name = this.form.getRawValue().name.trim();
    if (!name) {
      this.error.set('Donnez un nom à la catégorie, par exemple « Étudiant ».');
      return;
    }
    await this.run(async () => {
      await this.api.createMemberCategory(name);
      this.form.reset({ name: '' });
    });
  }

  protected toggle(category: MemberCategoryInfo): Promise<void> {
    return this.run(async () => {
      await this.api.updateMemberCategory(category.id, { active: !category.active });
    });
  }

  protected close(): void {
    this.reference.close(this.categories());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      this.categories.set(await this.api.listMemberCategories());
    } catch (failure) {
      this.error.set(describeHttpError(failure, "L'opération a échoué. Réessayez dans un instant.").message);
    } finally {
      this.busy.set(false);
    }
  }
}
