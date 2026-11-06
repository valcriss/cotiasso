import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export interface CeremonyOptions {
  /** Origine annoncée au navigateur (par défaut celle de l'authentificateur). */
  origin?: string;
  /** Vérification de l'utilisateur (empreinte, visage, code) : vraie par défaut. */
  userVerified?: boolean;
}

type Cbor = Parameters<typeof isoCBOR.encode>[0];
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest();

/**
 * Authentificateur WebAuthn simulé (clé ES256, attestation « none ») : fabrique des réponses valides, ou volontairement
 * erronées (autre origine, sans vérification de l'utilisateur), pour tester les cérémonies sans navigateur.
 * Ne remplace pas un essai sur un vrai appareil.
 */
export class VirtualAuthenticator {
  readonly credentialId = randomBytes(32);
  counter = 0;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(
    readonly origin: string,
    readonly rpId: string,
    /** Clé synchronisée (iCloud, Google) : éligible à la sauvegarde. */
    private readonly synced = true,
  ) {
    ({ privateKey: this.privateKey, publicKey: this.publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" }));
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  create(options: PublicKeyCredentialCreationOptionsJSON, ceremony: CeremonyOptions = {}): RegistrationResponseJSON {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: ceremony.origin ?? this.origin, crossOrigin: false }));
    const jwk = this.publicKey.export({ format: "jwk" });
    const coseKey = new Map<string | number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]);
    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(Buffer.from(options.rp.id ?? this.rpId)),
      Buffer.from([this.flags(ceremony.userVerified !== false) | FLAG_AT]),
      this.counterBytes(),
      Buffer.alloc(16),
      credentialIdLength,
      this.credentialId,
      Buffer.from(isoCBOR.encode(coseKey)),
    ]);
    const attestationObject = isoCBOR.encode(new Map<string | number, Cbor>([["fmt", "none"], ["attStmt", new Map<string | number, Cbor>()], ["authData", authData]]));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
    };
  }

  get(options: PublicKeyCredentialRequestOptionsJSON, userHandle: Uint8Array | null, ceremony: CeremonyOptions = {}): AuthenticationResponseJSON {
    this.counter += 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: ceremony.origin ?? this.origin, crossOrigin: false }));
    const authData = Buffer.concat([sha256(Buffer.from(options.rpId ?? this.rpId)), Buffer.from([this.flags(ceremony.userVerified !== false)]), this.counterBytes()]);
    const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        ...(userHandle && { userHandle: b64u(userHandle) }),
      },
    };
  }

  private flags(userVerified: boolean): number {
    return FLAG_UP | (userVerified ? FLAG_UV : 0) | (this.synced ? FLAG_BE | FLAG_BS : 0);
  }

  private counterBytes(): Buffer {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(this.counter);
    return bytes;
  }
}
