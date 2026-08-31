import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody } from '@nestjs/websockets';
import { Server } from 'socket.io';

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
export class AppGateway {
  @WebSocketServer()
  server: Server;

  // Notification pour les Admins/RH uniquement
  sendAdminNotification(payload: any) {
    this.server.emit('admin-notification', payload);
  }

  // Notification pour TOUS les employés (ex: Nouvelle formation, Note de service)
  sendCompanyNotification(payload: any) {
    this.server.emit('company-notification', payload);
  }
}