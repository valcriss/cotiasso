import { COTIASSO_MARK_PNG_BASE64 } from "./cotiasso-mark.js";

export interface MailLogo {
  /** Un SVG n'est pas affiché par la plupart des messageries : seuls PNG et JPEG sont intégrés au message. */
  mimeType: "image/png" | "image/jpeg";
  data: Buffer;
}

export interface EmailContext {
  associationName: string;
  recipientName: string;
  recipientEmail: string;
  /** Qui a émis le lien ; null si inconnu. */
  actorName: string | null;
  /** Adresse complète du lien (le jeton est dans le fragment, après #). */
  link: string;
  expiresAt: Date;
  validityHours: number;
  /** Couleur du bouton (#rrggbb, contraste avec du texte blanc garanti par les paramètres de marque). */
  accentColor: string;
  logo: MailLogo | null;
  /** Faux quand le logo contient déjà le nom de l'association : seul le logo est montré. */
  showName: boolean;
}

export interface EmailAttachment {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

/** Ce dont le gabarit a besoin pour habiller un message : l'association, le lien, la marque. */
export type RenderContext = Pick<EmailContext, "associationName" | "link" | "accentColor" | "logo" | "showName">;

interface EmailContent {
  subject: string;
  greeting: string;
  intro: string;
  buttonLabel: string;
  afterButton: string[];
  ignoreNote: string;
}

const DEFAULT_ACCENT = "#005cbb";

/** Une seule ligne, sans retour à la ligne : une valeur saisie par une personne ne doit jamais couper un en-tête ni une phrase. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** « jeudi 6 novembre à 14 h » (heure de Paris) : une date que n'importe qui comprend, sans fuseau ni format technique. */
export function formatExpiry(date: Date): string {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const minutes = part("minute");
  return `${part("weekday")} ${part("day")} ${part("month")} à ${Number(part("hour"))} h${minutes === "00" ? "" : ` ${minutes}`}`;
}

function textBody(content: EmailContent, context: RenderContext): string {
  return [
    content.greeting,
    "",
    content.intro,
    "",
    `${content.buttonLabel} : ${context.link}`,
    "",
    ...content.afterButton.flatMap((line) => [line, ""]),
    content.ignoreNote,
    "",
    "--",
    `${oneLine(context.associationName)} utilise Cotiasso, un logiciel libre de gestion associative.`,
  ].join("\n");
}

function htmlBody(content: EmailContent, context: RenderContext, accent: string): string {
  const name = escapeHtml(oneLine(context.associationName));
  const link = escapeHtml(context.link);
  const header = [
    context.logo ? `<img src="cid:association-logo" alt="${context.showName ? "" : name}" style="display:block;max-height:56px;max-width:200px;border:0;margin:0 0 ${context.showName ? "8" : "0"}px 0;" />` : "",
    !context.logo || context.showName ? `<div style="font-size:20px;font-weight:600;color:#1b1f2a;">${name}</div>` : "",
  ].join("");
  const paragraph = (text: string, color = "#1b1f2a", size = 16) =>
    `<p style="margin:0 0 16px 0;font-size:${size}px;line-height:1.5;color:${color};">${escapeHtml(text)}</p>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f4f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:6px;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="padding:24px 28px 8px 28px;">${header}</td></tr>
<tr><td style="padding:8px 28px 8px 28px;">
${paragraph(content.greeting)}
${paragraph(content.intro)}
<p style="margin:24px 0;"><a href="${link}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 24px;border-radius:6px;">${escapeHtml(content.buttonLabel)}</a></p>
${content.afterButton.map((line) => paragraph(line)).join("\n")}
${paragraph(content.ignoreNote, "#4a5163", 14)}
<p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#4a5163;">Si le bouton ne fonctionne pas, copiez ce lien dans la barre d’adresse de votre navigateur :<br><span style="word-break:break-all;">${link}</span></p>
</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #e3e7ef;font-size:13px;color:#4a5163;">
<img src="cid:cotiasso-mark" width="20" height="20" alt="" style="vertical-align:middle;border:0;margin-right:6px;" />Propulsé par <strong>Cotiasso</strong>, logiciel libre de gestion associative.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function render(content: EmailContent, context: RenderContext): RenderedEmail {
  const accent = /^#[0-9a-fA-F]{6}$/.test(context.accentColor) ? context.accentColor : DEFAULT_ACCENT;
  const attachments: EmailAttachment[] = [
    { cid: "cotiasso-mark", filename: "cotiasso.png", contentType: "image/png", content: Buffer.from(COTIASSO_MARK_PNG_BASE64, "base64") },
  ];
  if (context.logo) {
    attachments.push({
      cid: "association-logo",
      filename: context.logo.mimeType === "image/png" ? "logo.png" : "logo.jpg",
      contentType: context.logo.mimeType,
      content: context.logo.data,
    });
  }
  return { subject: content.subject, text: textBody(content, context), html: htmlBody(content, context, accent), attachments };
}

/** Invitation d'une personne à rejoindre Cotiasso pour une association. */
export function renderInvitationEmail(context: EmailContext): RenderedEmail {
  const association = oneLine(context.associationName);
  const actor = context.actorName ? oneLine(context.actorName) : null;
  return render(
    {
      subject: `Vous êtes invité·e à rejoindre ${association} sur Cotiasso`,
      greeting: `Bonjour ${oneLine(context.recipientName)},`,
      intro: actor
        ? `${actor} vous a ouvert un accès à Cotiasso, le logiciel de gestion et de comptabilité de ${association}.`
        : `Un accès à Cotiasso, le logiciel de gestion et de comptabilité de ${association}, vous a été ouvert.`,
      buttonLabel: "Créer mon mot de passe",
      afterButton: [
        `Ce lien est valable ${context.validityHours} heures (jusqu’au ${formatExpiry(context.expiresAt)}) et ne sert qu’une fois. S’il a expiré, demandez simplement un nouveau lien à ${actor ?? "l’administrateur de l’association"}.`,
        `Votre identifiant de connexion sera : ${oneLine(context.recipientEmail)}`,
      ],
      ignoreNote: "Vous ne connaissez pas cette association ? Ignorez ce message : aucun accès n’est ouvert tant que vous n’avez pas choisi de mot de passe.",
    },
    context,
  );
}

/** Réinitialisation du mot de passe, demandée par un administrateur. */
export function renderResetEmail(context: EmailContext): RenderedEmail {
  const association = oneLine(context.associationName);
  return render(
    {
      subject: `Réinitialisez votre mot de passe ${association} sur Cotiasso`,
      greeting: `Bonjour ${oneLine(context.recipientName)},`,
      intro: `Un administrateur de ${association} a demandé la réinitialisation de votre mot de passe Cotiasso.`,
      buttonLabel: "Choisir un nouveau mot de passe",
      afterButton: [
        `Ce lien est valable ${context.validityHours} heures (jusqu’au ${formatExpiry(context.expiresAt)}) et ne sert qu’une fois. Une fois votre mot de passe changé, vous serez déconnecté·e de vos autres appareils.`,
      ],
      ignoreNote: "Vous n’êtes pas à l’origine de cette demande ? Ignorez ce message : votre mot de passe actuel reste valable. Prévenez un administrateur de l’association.",
    },
    context,
  );
}

/** Message d'essai : prouve à l'administrateur que l'envoi d'emails fonctionne, sans aucun secret ni lien de connexion. */
export function renderTestEmail(context: RenderContext & { recipientName: string }): RenderedEmail {
  const association = oneLine(context.associationName);
  return render(
    {
      subject: `Essai d’envoi d’emails de ${association} sur Cotiasso`,
      greeting: `Bonjour ${oneLine(context.recipientName)},`,
      intro: `Si vous lisez ce message, l’envoi d’emails de Cotiasso fonctionne pour ${association} : les invitations et les liens de réinitialisation arriveront bien dans les boîtes de vos membres.`,
      buttonLabel: "Ouvrir Cotiasso",
      afterButton: ["Ce message n’est qu’un essai demandé depuis l’écran Exploitation. Il ne contient aucune information à conserver."],
      ignoreNote: "Vous n’avez rien demandé ? Ignorez ce message, aucune action n’est nécessaire.",
    },
    context,
  );
}

export type NotificationTemplate ="TO_DECIDE" | "TO_PAY" | "APPROVED" | "RETURNED" | "REFUSED" | "PAID";

export interface NotificationEmailContext extends RenderContext {
  template: NotificationTemplate;
  recipientName: string;
  /** Prénom et nom de la personne qui a fait la demande. Aucun montant ni justificatif dans un email. */
  requesterName: string;
  requestNumber: number;
}

/**
 * Prévient une personne qu’une demande de remboursement avance ou l’attend (ADR 0035). Le message reste minimal : qui, quelle demande,
 * et un lien. Il ne contient ni montant, ni justificatif, ni motif : tout se lit dans l’application, qui fait foi.
 */
export function renderNotificationEmail(context: NotificationEmailContext): RenderedEmail {
  const association = oneLine(context.associationName);
  const requester = oneLine(context.requesterName);
  const number = context.requestNumber;
  const content: Record<NotificationTemplate, { subject: string; intro: string; button: string }> = {
    TO_DECIDE: {
      subject: `Une demande de remboursement attend votre accord (n° ${number})`,
      intro: `${requester} a demandé le remboursement de frais avancés pour ${association}. La demande n° ${number} attend votre accord.`,
      button: "Examiner la demande",
    },
    TO_PAY: {
      subject: `Une demande de remboursement est à rembourser (n° ${number})`,
      intro: `La demande n° ${number} de ${requester} a reçu tous les accords nécessaires : elle est prête à être remboursée.`,
      button: "Rembourser",
    },
    APPROVED: {
      subject: `Votre demande de remboursement a reçu un accord (n° ${number})`,
      intro: `Une étape de validation a donné son accord à votre demande n° ${number}. Elle continue son chemin.`,
      button: "Suivre ma demande",
    },
    RETURNED: {
      subject: `Votre demande de remboursement est à corriger (n° ${number})`,
      intro: `Votre demande n° ${number} vous a été renvoyée pour correction. Le message qui explique ce qu’il faut changer se trouve dans l’application.`,
      button: "Corriger ma demande",
    },
    REFUSED: {
      subject: `Votre demande de remboursement a été refusée (n° ${number})`,
      intro: `Votre demande n° ${number} a été refusée. Vous trouverez le motif dans l’application.`,
      button: "Voir ma demande",
    },
    PAID: {
      subject: `Votre demande de remboursement est réglée (n° ${number})`,
      intro: `Votre demande n° ${number} a été remboursée.`,
      button: "Voir ma demande",
    },
  };
  const entry = content[context.template];
  return render(
    {
      subject: entry.subject,
      greeting: `Bonjour ${oneLine(context.recipientName)},`,
      intro: entry.intro,
      buttonLabel: entry.button,
      afterButton: ["Cet email est un simple rappel : c’est l’état affiché dans l’application qui fait foi."],
      ignoreNote: `Vous recevez ce message parce que vous êtes concerné·e par cette demande chez ${association}. Vous ne connaissez pas cette association ? Ignorez ce message.`,
    },
    context,
  );
}
