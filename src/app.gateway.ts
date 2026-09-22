import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

// 🐛 CORRIGÉ : l'origine CORS était codée en dur sur 'http://localhost:3000',
// séparément de la config CORS dynamique déjà utilisée dans main.ts
// (process.env.CORS_ORIGINS). En production, le front tourne sur
// https://konza-rh.cg (ou un déploiement Vercel) → toutes les requêtes
// Socket.IO (polling + upgrade websocket) étaient bloquées par le
// navigateur, d'où l'erreur CORS répétée dans la console.
// On réutilise exactement la même logique que main.ts pour rester cohérent
// et ne pas avoir deux listes d'origines autorisées à maintenir séparément.
const allowedOrigins: string[] = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

@WebSocketGateway({
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Requêtes sans origine (Postman, curl, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);

      const isVercelPreview = origin.endsWith('.vercel.app') && origin.includes('nathan-devs-projects');
      const isRenderPreview = origin.endsWith('.onrender.com');
      if (isVercelPreview || isRenderPreview) return callback(null, true);

      callback(new Error('Not allowed by CORS (Socket.IO)'));
    },
    credentials: true,
  },
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server; // initialisé par Nest/Socket.IO au démarrage du gateway, pas dans le constructeur

  private readonly logger = new Logger(AppGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  // ============================================================================
  // ✅ FIX FUITE MULTI-TENANT (Sept 2026)
  // ----------------------------------------------------------------------------
  // Avant : this.server.emit(...) diffusait à TOUS les sockets connectés,
  // toutes entreprises confondues, sans aucune authentification à la
  // connexion. Confirmé de bout en bout : côté front, NotificationProvider.tsx
  // ne filtrait "admin-notification" que par rôle (APPROVER_ROLES), jamais
  // par entreprise — un admin de l'entreprise A recevait donc en temps réel
  // les toasts de pointage/correction/suppression de l'entreprise B (nom,
  // heure, site GPS, photo). "company-notification" (formations, notes de
  // service) n'avait même aucun filtre du tout côté client.
  //
  // Après : chaque socket est authentifié à la connexion via le MÊME JWT que
  // les requêtes HTTP classiques (cookie HttpOnly "access_token" en
  // priorité — c'est déjà ce qu'envoie le front avec `withCredentials: true`
  // dans NotificationProvider.tsx, donc AUCUN changement front n'est
  // nécessaire — puis header Authorization, puis query param, dans le même
  // ordre que extractJwt() côté auth HTTP classique pour rester cohérent).
  // Le companyId est extrait UNIQUEMENT de ce token vérifié côté serveur
  // (jamais d'une donnée envoyée par le client, pour empêcher qu'un client
  // malveillant prétende appartenir à une autre entreprise). Le socket
  // rejoint la room `company:{companyId}`, et les deux méthodes de diffusion
  // ciblent désormais cette room au lieu d'un emit global.
  //
  // ⚠️ Reste à vérifier de votre côté :
  // - Tous les AUTRES appels à sendCompanyNotification ailleurs dans le code
  //   doivent maintenant passer companyId dans leur payload, sinon leur
  //   notification sera silencieusement bloquée (échec sûr — pas de fuite,
  //   la fonctionnalité s'arrête juste tant que ce n'est pas fait).
  // ============================================================================

  private extractToken(client: Socket): string | null {
    // Priorité 1 — cookie HttpOnly (même logique que extractJwt() côté HTTP)
    const cookieHeader = client.handshake.headers?.cookie;
    if (cookieHeader) {
      const match = cookieHeader
        .split(';')
        .map(c => c.trim())
        .find(c => c.startsWith('access_token='));
      if (match) return decodeURIComponent(match.slice('access_token='.length));
    }

    // Priorité 2 — header Authorization: Bearer (apps mobiles / clients non-navigateur)
    const authHeader = client.handshake.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

    // Priorité 3 — socket.io "auth" payload : io(url, { auth: { token } })
    const authToken = (client.handshake.auth as any)?.token;
    if (typeof authToken === 'string' && authToken) return authToken;

    // Priorité 4 — query param (dernier recours, pour parité avec extractJwt())
    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken) return queryToken;

    return null;
  }

  handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(`Socket ${client.id} connecté sans token — déconnexion`);
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'secretKey_change_in_production_123!',
      });

      const companyId = payload?.companyId;
      if (!companyId) {
        this.logger.warn(`Socket ${client.id} : token valide mais sans companyId — déconnexion`);
        client.disconnect();
        return;
      }

      client.join(`company:${companyId}`);
      client.data.companyId = companyId;
      client.data.userId = payload?.sub;
    } catch (err) {
      this.logger.warn(`Socket ${client.id} : token invalide — déconnexion (${(err as Error).message})`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Rien à faire manuellement : Socket.IO retire automatiquement le
    // client de toutes ses rooms (dont company:{companyId}) à la déconnexion.
  }

  // Notification pour les Admins/RH d'UNE SEULE entreprise (celle de payload.companyId)
  sendAdminNotification(payload: { companyId?: string | null; [key: string]: any }) {
    if (!payload.companyId) {
      // ✅ Garde-fou : on refuse de diffuser plutôt que de retomber sur un
      // emit global — une notification manquée (visible dans les logs) vaut
      // toujours mieux qu'une fuite vers toutes les entreprises.
      this.logger.error(
        'sendAdminNotification appelé sans companyId — notification NON envoyée pour éviter une fuite multi-tenant.',
      );
      return;
    }
    this.server.to(`company:${payload.companyId}`).emit('admin-notification', payload);
  }

  // Notification pour TOUS les employés d'UNE SEULE entreprise (ex: Nouvelle formation, Note de service)
  sendCompanyNotification(payload: { companyId?: string | null; [key: string]: any }) {
    if (!payload.companyId) {
      this.logger.error(
        'sendCompanyNotification appelé sans companyId — notification NON envoyée pour éviter une fuite multi-tenant.',
      );
      return;
    }
    this.server.to(`company:${payload.companyId}`).emit('company-notification', payload);
  }
}