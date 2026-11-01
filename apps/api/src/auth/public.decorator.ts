import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";

/** Ouvre explicitement une route sans session. Par défaut, toute route exige une session valide. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
