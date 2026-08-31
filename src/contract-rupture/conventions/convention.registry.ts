// ============================================================================
// convention.registry.ts — Registre central de toutes les conventions
// ============================================================================
import { IConvention } from './convention.interface';
import { CommerceConvention } from './commerce.convention';
import {
  IndustrieConvention,
  PetroleConvention,
  BTPConvention,
  HotellerieConvention,
  PharmacieConvention,
  TransportConvention,
  PresseConvention,
  NTICConvention,
} from './all-conventions';

const registry: Record<string, IConvention> = {
  COMMERCE: new CommerceConvention(),
  INDUSTRIE: new IndustrieConvention(),
  PETROLE: new PetroleConvention(),
  BTP: new BTPConvention(),
  HOTELLERIE: new HotellerieConvention(),
  PHARMACIE: new PharmacieConvention(),
  TRANSPORT: new TransportConvention(),
  PRESSE: new PresseConvention(),
  NTIC: new NTICConvention(),
};

export function getConvention(code: string): IConvention {
  const conv = registry[code?.toUpperCase()];
  if (!conv) throw new Error(`Convention inconnue : ${code}`);
  return conv;
}

export function listConventions(): {
  code: string;
  nom: string;
  secteurs: string[];
}[] {
  return Object.values(registry).map((c) => ({
    code: c.code,
    nom: c.nom,
    secteurs: c.secteurs,
  }));
}
