import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecruitmentTestAccessService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  issue(candidate: { id: string; jobOfferId: string; retakeGrantedAt?: Date | null }) {
    return this.jwt.sign({ type: 'recruitment-test', sub: candidate.id, jobId: candidate.jobOfferId,
      version: candidate.retakeGrantedAt?.toISOString() ?? null }, { expiresIn: '24h' });
  }

  async authorize(jobId: string, token?: string, candidateId?: string) {
    const job = await this.prisma.jobOffer.findFirst({ where: { id: jobId, status: 'PUBLISHED', isExpired: false,
      OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }] }, select: { id: true } });
    if (!job) throw new NotFoundException('Test non disponible.');
    let payload: any;
    try { payload = this.jwt.verify(token || ''); } catch { throw new UnauthorizedException('Accès au test invalide ou expiré.'); }
    if (payload.type !== 'recruitment-test' || payload.jobId !== jobId || typeof payload.sub !== 'string' ||
        (candidateId && payload.sub !== candidateId)) throw new UnauthorizedException('Accès au test invalide.');
    const candidate = await this.prisma.candidate.findFirst({ where: { id: payload.sub, jobOfferId: jobId } });
    if (!candidate || (candidate.retakeGrantedAt?.toISOString() ?? null) !== payload.version) throw new UnauthorizedException('Accès au test révoqué.');
    if (candidate.testCompletedAt) throw new BadRequestException('Ce test a déjà été soumis.');
    if (candidate.status !== 'EN_ATTENTE_TEST') throw new BadRequestException('Cette candidature ne peut pas passer le test.');
    return candidate;
  }
}
