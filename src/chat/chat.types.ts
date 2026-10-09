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
  unreadCount: number;
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
}

export const MAX_BODY_LENGTH = 2000;