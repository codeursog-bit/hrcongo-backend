// ============================================================================
// 📁 src/contract-rupture/pse.service.ts
//
// Service PSE — Plan de Sauvegarde de l'Emploi
// Art. 39 CT Congo
// ============================================================================
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePSEDto } from './dto/pse.dto';

const SEUIL_PSE = 5; // nombre de lic. éco déclenchant PSE
const FENETRE_JOURS = 30; // fenêtre glissante en jours

const ETAPES_INITIALES = [
  {
    label: "Notification à l'Inspection du Travail",
    done: false,
    requis: true,
    date: undefined,
  },
  {
    label: 'Réunion des Délégués du Personnel',
    done: false,
    requis: true,
    date: undefined,
  },
  {
    label: 'Délai de réflexion (15 jours ouvrables)',
    done: false,
    requis: true,
    date: undefined,
  },
  {
    label: 'Autorisation Commission des Litiges',
    done: false,
    requis: true,
    date: undefined,
  },
  {
    label: 'Notification individuelle aux salariés concernés',
    done: false,
    requis: true,
    date: undefined,
  },
  {
    label: "Mise en œuvre des mesures d'accompagnement",
    done: false,
    requis: false,
    date: undefined,
  },
  {
    label: 'Clôture de la procédure',
    done: false,
    requis: true,
    date: undefined,
  },
];

@Injectable()
export class PSEService {
  constructor(private prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════════════════════
  // VÉRIFIER LE SEUIL PSE
  // ══════════════════════════════════════════════════════════════════════════
  async checkSeuil(
    companyId: string,
  ): Promise<{ count: number; seuil: number; pseRequired: boolean }> {
    const depuis = new Date(Date.now() - FENETRE_JOURS * 24 * 3600 * 1000);
    const count = await this.prisma.contractRupture.count({
      where: {
        companyId,
        ruptureType: 'LICENCIEMENT_ECONOMIQUE',
        ruptureDate: { gte: depuis },
      },
    });
    return { count, seuil: SEUIL_PSE, pseRequired: count >= SEUIL_PSE };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATISTIQUES ÉCO
  // ══════════════════════════════════════════════════════════════════════════
  async getEcoStats(companyId: string) {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const d90 = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
    const d365 = new Date(now.getFullYear(), 0, 1); // 1er janvier

    const [total30j, total90j, totalAnnee] = await Promise.all([
      this.prisma.contractRupture.count({
        where: {
          companyId,
          ruptureType: 'LICENCIEMENT_ECONOMIQUE',
          ruptureDate: { gte: d30 },
        },
      }),
      this.prisma.contractRupture.count({
        where: {
          companyId,
          ruptureType: 'LICENCIEMENT_ECONOMIQUE',
          ruptureDate: { gte: d90 },
        },
      }),
      this.prisma.contractRupture.count({
        where: {
          companyId,
          ruptureType: 'LICENCIEMENT_ECONOMIQUE',
          ruptureDate: { gte: d365 },
        },
      }),
    ]);

    return {
      total30j,
      total90j,
      totalAnnee,
      seuil: SEUIL_PSE,
      pseRequired: total30j >= SEUIL_PSE,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LISTER LES PROCÉDURES PSE
  // ══════════════════════════════════════════════════════════════════════════
  async findAll(companyId: string) {
    const procedures = await this.prisma.pSEProcedure.findMany({
      where: { companyId },
      include: {
        salariesConcernes: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                employeeNumber: true,
                position: true,
              },
            },
          },
        },
      },
      orderBy: { dateOuverture: 'desc' },
    });

    return procedures.map((p) => ({
      id: p.id,
      status: p.status,
      motif: p.motif,
      nbPostesSupprimes: p.nbPostesSupprimes,
      dateOuverture: p.dateOuverture,
      dateNotificationInspection: p.dateNotificationInspection,
      dateReunionDP: p.dateReunionDP,
      dateCloture: p.dateCloture,
      notes: p.notes,
      createdBy: p.createdBy,
      etapes: (p.etapes as any[]) ?? ETAPES_INITIALES,
      salariesConcernes: p.salariesConcernes.map((s) => ({
        id: s.id,
        nom: `${s.employee.firstName} ${s.employee.lastName}`,
        poste: s.employee.position,
        matricule: s.employee.employeeNumber,
        statut: s.statut,
      })),
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CRÉER UNE PROCÉDURE PSE
  // ══════════════════════════════════════════════════════════════════════════
  async create(companyId: string, userId: string, dto: CreatePSEDto) {
    const procedure = await this.prisma.pSEProcedure.create({
      data: {
        companyId,
        createdBy: userId,
        motif: dto.motif,
        nbPostesSupprimes: dto.nbPostesSupprimes,
        notes: dto.notes,
        status: 'OUVERT',
        dateOuverture: new Date(),
        etapes: ETAPES_INITIALES as any,
        salariesConcernes: dto.salariesIds?.length
          ? {
              createMany: {
                data: dto.salariesIds.map((employeeId) => ({
                  employeeId,
                  statut: 'PREVU' as const,
                })),
              },
            }
          : undefined,
      },
    });

    return { success: true, pseId: procedure.id };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DÉTAIL D'UNE PROCÉDURE
  // ══════════════════════════════════════════════════════════════════════════
  async findOne(id: string, companyId: string) {
    const p = await this.prisma.pSEProcedure.findFirst({
      where: { id, companyId },
      include: {
        salariesConcernes: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                employeeNumber: true,
                position: true,
              },
            },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Procédure PSE introuvable');
    return p;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // METTRE À JOUR UNE ÉTAPE
  // ══════════════════════════════════════════════════════════════════════════
  async updateEtape(
    id: string,
    companyId: string,
    etapeIdx: number,
    done: boolean,
    date?: string,
  ) {
    const p = await this.prisma.pSEProcedure.findFirst({
      where: { id, companyId },
    });
    if (!p) throw new NotFoundException('Procédure PSE introuvable');

    const etapes = p.etapes as any[];
    if (etapeIdx < 0 || etapeIdx >= etapes.length) {
      throw new BadRequestException(`Étape ${etapeIdx} inexistante`);
    }

    etapes[etapeIdx] = {
      ...etapes[etapeIdx],
      done,
      date: done ? (date ?? new Date().toISOString().split('T')[0]) : undefined,
    };

    // Mise à jour des dates clés selon l'étape
    const updateData: any = { etapes };
    if (etapeIdx === 0 && done)
      updateData.dateNotificationInspection = new Date(date ?? Date.now());
    if (etapeIdx === 1 && done)
      updateData.dateReunionDP = new Date(date ?? Date.now());
    if (etapeIdx === 6 && done) {
      updateData.dateCloture = new Date(date ?? Date.now());
      updateData.status = 'CLOTURE';
    }

    // Mettre à jour le statut si 1ère étape faite
    if (etapeIdx === 0 && done && p.status === 'OUVERT')
      updateData.status = 'EN_COURS';

    await this.prisma.pSEProcedure.update({ where: { id }, data: updateData });
    return { success: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHANGER STATUT SALARIÉ
  // ══════════════════════════════════════════════════════════════════════════
  async updateSalarieConcerne(
    pseId: string,
    companyId: string,
    salariePseId: string,
    statut: 'PREVU' | 'CONFIRME' | 'MAINTENU',
  ) {
    const p = await this.prisma.pSEProcedure.findFirst({
      where: { id: pseId, companyId },
    });
    if (!p) throw new NotFoundException('Procédure PSE introuvable');

    await this.prisma.pSESalarie.update({
      where: { id: salariePseId },
      data: { statut },
    });
    return { success: true };
  }
}
