import { UserRole } from '@prisma/client';

/** Rôles autorisés à utiliser la messagerie (SUPER_ADMIN et CABINET_* exclus). */
export const CHAT_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.HR_MANAGER,
  UserRole.MANAGER,
  UserRole.EMPLOYEE,
];

/** Identité de la personne connectée — TOUJOURS issue du JWT, jamais du corps de requête. */
export interface ChatActor {
  id: string;
  role: UserRole;
  companyId: string;
}

export interface ChatContactDto {
  id: string;
  name: string;
  role: UserRole;
  department: string | null;
  /** URL de la photo de la fiche employé (null si aucune, ex. admin sans fiche) */
  photoUrl: string | null;
}

export interface ChatConversationDto {
  id: string;
  other: ChatContactDto;
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastFromMe: boolean;
  /** État du dernier message quand il est de moi : envoyé / reçu / lu (absent sinon). */
  lastStatus?: ChatReceiptStatus;
  unreadCount: number;
}

export type ChatReceiptStatus = 'sent' | 'delivered' | 'read';

/** Accusés de l'AUTRE personne de la conversation (le client en déduit ✓ / ✓✓ / ✓✓ lu). */
export interface ChatPeerDto {
  /** a reçu les messages jusqu'à cet instant (app ouverte ou conversation ouverte) — jamais plus ancien que `readAt` */
  deliveredAt: string | null;
  /** a lu la conversation jusqu'à cet instant */
  readAt: string | null;
}

export interface ChatReceiptDto extends ChatPeerDto {
  conversationId: string;
}

export interface ChatMessageDto {
  id: string;
  seq: number;
  mine: boolean;
  body: string;
  createdAt: string;
}

export interface ChatPollDto {
  v: string;
  changed: boolean;
  serverTime: string;
  unreadTotal?: number;
  /** Conversations modifiées depuis `since` (pour ne recharger que ce qui a bougé). */
  conversations?: { id: string; unreadCount: number }[];
  /** Accusés (reçu / lu) modifiés depuis `since` pour mes conversations récentes. */
  receipts?: ChatReceiptDto[];
}

export const MAX_BODY_LENGTH = 2000;