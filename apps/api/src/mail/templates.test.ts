import { describe, expect, it } from "vitest";
import { formatExpiry, renderInvitationEmail, renderNotificationEmail, renderResetEmail, type EmailContext, type NotificationTemplate } from "./templates.js";

const base: EmailContext = {
  associationName: "Club des amis",
  recipientName: "Camille Durand",
  recipientEmail: "camille@exemple.fr",
  actorName: "Sam Martin",
  link: "https://compta.asso.fr/reinitialisation#token=abc123",
  // 3 novembre 2026, 13 h 00 UTC = 14 h 00 à Paris : 72 h plus tard, le 6 novembre.
  expiresAt: new Date("2026-11-06T13:00:00Z"),
  validityHours: 72,
  accentColor: "#7a1f4d",
  logo: null,
  showName: true,
};

describe("formatExpiry", () => {
  it("écrit la date en français, à l'heure de Paris, sans format technique", () => {
    expect(formatExpiry(new Date("2026-11-06T13:00:00Z"))).toBe("vendredi 6 novembre à 14 h");
    expect(formatExpiry(new Date("2026-07-14T07:30:00Z"))).toBe("mardi 14 juillet à 9 h 30");
  });
});

describe("email d'invitation", () => {
  it("dit qui invite, pour quelle association, sur quel logiciel, et pour combien de temps", () => {
    const mail = renderInvitationEmail(base);
    expect(mail.subject).toBe("Vous êtes invité·e à rejoindre Club des amis sur Cotiasso");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Bonjour Camille Durand,");
      expect(body).toContain("Sam Martin vous a ouvert un accès à Cotiasso, le logiciel de gestion et de comptabilité de Club des amis.");
      expect(body).toContain("72 heures (jusqu’au vendredi 6 novembre à 14 h)");
      expect(body).toContain("demandez simplement un nouveau lien à Sam Martin");
      expect(body).toContain("camille@exemple.fr");
      expect(body).toContain("aucun accès n’est ouvert tant que vous n’avez pas choisi de mot de passe");
    }
  });

  it("met le lien dans un bouton et en clair, et le mot de passe n'apparaît nulle part", () => {
    const mail = renderInvitationEmail(base);
    expect(mail.html).toContain('href="https://compta.asso.fr/reinitialisation#token=abc123"');
    expect(mail.html).toContain("Créer mon mot de passe");
    expect(mail.text).toContain("Créer mon mot de passe : https://compta.asso.fr/reinitialisation#token=abc123");
    expect(mail.html).toContain("Si le bouton ne fonctionne pas");
  });

  it("reste lisible sans nom d'administrateur", () => {
    const mail = renderInvitationEmail({ ...base, actorName: null });
    expect(mail.text).toContain("Un accès à Cotiasso, le logiciel de gestion et de comptabilité de Club des amis, vous a été ouvert.");
    expect(mail.text).toContain("demandez simplement un nouveau lien à l’administrateur de l’association");
  });

  it("présente Cotiasso en pied de page avec son symbole intégré", () => {
    const mail = renderInvitationEmail(base);
    expect(mail.html).toContain("Propulsé par <strong>Cotiasso</strong>");
    expect(mail.html).toContain('src="cid:cotiasso-mark"');
    const mark = mail.attachments.find((a) => a.cid === "cotiasso-mark")!;
    expect(mark.contentType).toBe("image/png");
    expect(mark.content.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("utilise la couleur de l'association pour le bouton, avec un repli sûr", () => {
    expect(renderInvitationEmail(base).html).toContain("background:#7a1f4d");
    expect(renderInvitationEmail({ ...base, accentColor: "rouge" }).html).toContain("background:#005cbb");
  });
});

describe("logo de l'association dans l'email", () => {
  const png = Buffer.from("89504e470d0a1a0a", "hex");

  it("n'affiche que le nom en texte sans logo", () => {
    const mail = renderInvitationEmail(base);
    expect(mail.html).not.toContain("cid:association-logo");
    expect(mail.html).toContain(">Club des amis</div>");
    expect(mail.attachments.map((a) => a.cid)).toEqual(["cotiasso-mark"]);
  });

  it("intègre le logo au message, avec le nom à côté ou seul selon le choix de l'association", () => {
    const withName = renderInvitationEmail({ ...base, logo: { mimeType: "image/png", data: png } });
    expect(withName.html).toContain('src="cid:association-logo" alt=""');
    expect(withName.html).toContain(">Club des amis</div>");
    expect(withName.attachments.find((a) => a.cid === "association-logo")).toMatchObject({ contentType: "image/png", filename: "logo.png" });

    const logoOnly = renderInvitationEmail({ ...base, logo: { mimeType: "image/jpeg", data: png }, showName: false });
    expect(logoOnly.html).toContain('alt="Club des amis"');
    expect(logoOnly.html).not.toContain(">Club des amis</div>");
    expect(logoOnly.attachments.find((a) => a.cid === "association-logo")).toMatchObject({ contentType: "image/jpeg", filename: "logo.jpg" });
  });
});

describe("email de réinitialisation", () => {
  const mail = renderResetEmail({ ...base, validityHours: 24, expiresAt: new Date("2026-11-04T13:00:00Z") });

  it("explique ce qui est demandé, la durée du lien et ce qui se passera ensuite", () => {
    expect(mail.subject).toBe("Réinitialisez votre mot de passe Club des amis sur Cotiasso");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Un administrateur de Club des amis a demandé la réinitialisation de votre mot de passe Cotiasso.");
      expect(body).toContain("24 heures (jusqu’au mercredi 4 novembre à 14 h)");
      expect(body).toContain("déconnecté·e de vos autres appareils");
      expect(body).toContain("votre mot de passe actuel reste valable");
    }
    expect(mail.html).toContain("Choisir un nouveau mot de passe");
  });
});

describe("valeurs saisies par une personne", () => {
  const hostile: EmailContext = {
    ...base,
    associationName: 'Club <script>alert("x")</script>\r\nBcc: pirate@exemple.fr',
    recipientName: "Camille\r\nSubject: piégé",
    actorName: "<b>Sam</b>",
  };

  it("échappe le HTML et ne laisse aucun retour à la ligne dans l'objet ni dans les phrases", () => {
    const mail = renderInvitationEmail(hostile);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>Sam</b>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text.split("\n").some((line) => line.startsWith("Bcc:") || line.startsWith("Subject:"))).toBe(false);
  });

  it("échappe aussi le lien dans le HTML", () => {
    const mail = renderResetEmail({ ...base, link: 'https://x.fr/#token="><script>1</script>' });
    expect(mail.html).not.toContain("<script>1</script>");
  });
});

describe("email de notification d'une demande de remboursement", () => {
  const notification = (template: NotificationTemplate, overrides: Partial<Parameters<typeof renderNotificationEmail>[0]> = {}) =>
    renderNotificationEmail({
      template,
      associationName: "Club des amis",
      recipientName: "Camille Durand",
      requesterName: "Léa Martin",
      requestNumber: 12,
      link: "https://compta.asso.fr/remboursements?onglet=a-traiter",
      accentColor: "#7a1f4d",
      logo: null,
      showName: true,
      ...overrides,
    });

  it("dit qui a demandé quoi et ce qu'on attend de la personne, avec un lien", () => {
    const mail = notification("TO_DECIDE");
    expect(mail.subject).toBe("Une demande de remboursement attend votre accord (n° 12)");
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain("Bonjour Camille Durand,");
      expect(body).toContain("Léa Martin a demandé le remboursement de frais avancés pour Club des amis");
      expect(body).toContain("https://compta.asso.fr/remboursements?onglet=a-traiter");
      expect(body).toContain("c’est l’état affiché dans l’application qui fait foi");
    }
    expect(mail.text).toContain("Examiner la demande");
  });

  it("propose le bon geste pour chaque situation, au demandeur comme aux validateurs", () => {
    expect(notification("TO_PAY").text).toContain("prête à être remboursée");
    expect(notification("APPROVED").subject).toContain("a reçu un accord");
    expect(notification("RETURNED").subject).toContain("est à corriger");
    expect(notification("REFUSED").subject).toContain("a été refusée");
    expect(notification("PAID").subject).toContain("est réglée");
  });

  it("ne contient jamais de montant, de motif ni de justificatif", () => {
    for (const template of ["TO_DECIDE", "TO_PAY", "APPROVED", "RETURNED", "REFUSED", "PAID"] as const) {
      const mail = notification(template);
      expect(mail.text + mail.html).not.toMatch(/€|euro|justificatif joint/i);
    }
  });

  it("neutralise ce qui est saisi par une personne (nom, association) dans le texte et le HTML", () => {
    const hostile = "Léa <script>alert(1)</script>" + String.fromCharCode(13, 10) + "Bcc: x@y.z";
    const mail = notification("TO_DECIDE", { requesterName: hostile, associationName: "Club <b>des</b> amis" });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>des</b>");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text.split(String.fromCharCode(10)).some((line) => line.startsWith("Bcc:"))).toBe(false);
  });
});
