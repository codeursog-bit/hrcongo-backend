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
  let role = session.user.role;
  let cabinetId = payload.cabinetId ?? null;
  if (role === 'CABINET_ADMIN' || role === 'CABINET_GESTIONNAIRE') {
    const member = await prisma.cabinetUser.findFirst({
      where: { userId: payload.sub, ...(cabinetId ? { cabinetId } : {}), cabinet: { isActive: true } },
      select: { cabinetId: true, role: true },
    });
    if (!member) throw new UnauthorizedException('Accès au cabinet révoqué ou cabinet désactivé');
    cabinetId = member.cabinetId;
    role = member.role === 'CABINET_ADMIN' ? 'CABINET_ADMIN' : 'CABINET_GESTIONNAIRE';
  }
  return {
    id: payload.sub, // ✅ AJOUT — req.user.id fonctionne partout
    userId: payload.sub,
    sessionId: payload.sid,
    email: session.user.email,
    role,
    companyId: payload.companyId ?? null,
    cabinetId,
    managedByCabinet: payload.managedByCabinet ?? false,
  };
}
