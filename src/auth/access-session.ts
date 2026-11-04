import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export async function validateAccessSession(prisma: PrismaService, payload: any) {
  if (payload.type !== 'access') {
    throw new UnauthorizedException('Type de token invalide');
  }
  if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') {
    throw new UnauthorizedException('Session invalide. Reconnectez-vous.');
  }
  const session = await prisma.userSession.findUnique({
    where: { jti: payload.sid },
    include: { user: { select: { isActive: true, role: true, email: true } } },
  });
  if (!session || session.userId !== payload.sub || session.revokedAt ||
      session.expiresAt <= new Date() || !session.user.isActive) {
    throw new UnauthorizedException('Session invalide ou révoquée. Reconnectez-vous.');
  }
  return {
    id: payload.sub, // ✅ AJOUT — req.user.id fonctionne partout
    userId: payload.sub,
    sessionId: payload.sid,
    email: session.user.email,
    role: session.user.role,
    companyId: payload.companyId ?? null,
    cabinetId: payload.cabinetId ?? null,
    managedByCabinet: payload.managedByCabinet ?? false,
  };
}
