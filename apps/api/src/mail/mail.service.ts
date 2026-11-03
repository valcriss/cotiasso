import { Inject, Injectable, Logger } from "@nestjs/common";
import type { SendMailOptions } from "nodemailer";
import type { RenderedEmail } from "./templates.js";

export const MAIL_TRANSPORT = Symbol("MAIL_TRANSPORT");

/** Ce que l'API attend d'un transport d'emails : nodemailer en production, un faux dans les tests. */
export interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>;
}

export interface OutgoingMail {
  /** Adresse d'expédition (adresse seule) et nom affiché. */
  from: { address: string; name: string };
  to: string;
  replyTo?: string;
  email: RenderedEmail;
}

/**
 * Envoi d'emails. Désactivé tant que SMTP n'est pas configuré (`transport` nul) : l'appelant le sait par `enabled` et garde alors
 * son parcours sans email. Le contenu d'un message (qui porte un lien secret) n'est jamais journalisé.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null) {}

  get enabled(): boolean {
    return this.transport !== null;
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) throw new Error("L'envoi d'emails n'est pas configuré.");
    try {
      await this.transport.sendMail({
        from: { address: mail.from.address, name: mail.from.name.replace(/[\r\n"]+/g, " ").trim() },
        to: mail.to,
        ...(mail.replyTo && { replyTo: mail.replyTo }),
        subject: mail.email.subject,
        text: mail.email.text,
        html: mail.email.html,
        attachments: mail.email.attachments,
        // Un lien de connexion ne doit pas être compté ni transformé par un service de suivi : rien d'ajouté au message.
        headers: { "X-Auto-Response-Suppress": "All" },
      });
    } catch (error) {
      // Seuls le code et le message du serveur de messagerie sont journalisés, jamais le contenu du message.
      const detail = error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : "erreur inconnue";
      this.logger.warn(`Envoi d'email impossible (${detail})`);
      throw error;
    }
  }
}
