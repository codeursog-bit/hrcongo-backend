import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import * as QRCode from 'qrcode';
import { CheckinCredentialType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { RegisterKioskDeviceDto } from './dto/register-device.dto';
import { RegisterCredentialDto } from './dto/register-credential.dto';
import { ScanCheckinDto } from './dto/scan.dto';

// companyPorters : Map<companyId, actingUserId> — TOUTES les entreprises que
// cette tablette peut servir (l'entreprise principale + les supplémentaires),
// chacune avec son propre porteur stable.
type KioskContext = {
  id: string;
  companyId: string;
  actingUserId: string;
  companyPorters: Map<string, string>;
};

@Injectable()
export class CheckinDevicesService {
  // En mémoire, par instance serveur : suffisant pour éviter des écritures
  // en base redondantes. Si le process redémarre, au pire une écriture de
  // plus est faite — aucune conséquence fonctionnelle.
  private readonly lastActivityWrite = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    // ✅ On réutilise TEL QUEL le service existant : congés, jours fériés,
    // shifts, géofencing GPS, abonnement... rien n'est dupliqué.
    private readonly attendanceService: AttendanceService,
  ) {}

  private async touchDeviceActivity(deviceId: string) {
    const last = this.lastActivityWrite.get(deviceId) ?? 0;
    const now = Date.now();
    if (now - last < 5 * 60 * 1000) return; // < 5 min depuis la dernière écriture

    this.lastActivityWrite.set(deviceId, now);
    await this.prisma.kioskDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date() },
    });
  }

  // ============================================================
  // 📟 GESTION DES TABLETTES (routes admin, JWT classique)
  // ============================================================

  async registerDevice(companyId: string, dto: RegisterKioskDeviceDto) {
    const actingUser = await this.prisma.user.findFirst({
      where: { id: dto.actingUserId, companyId },
    });
    if (!actingUser) {
      throw new BadRequestException(
        "L'utilisateur choisi n'appartient pas à cette entreprise.",
      );
    }

    const apiKey = randomBytes(32).toString('hex');

    const device = await this.prisma.kioskDevice.create({
      data: {
        name: dto.name,
        apiKey,
        companyId,
        actingUserId: dto.actingUserId,
        midDayStartHour: dto.midDayStartHour ?? null,
        midDayEndHour: dto.midDayEndHour ?? null,
      },
    });

    // ⚠️ La clé en clair n'est renvoyée qu'une seule fois, à la création.
    // Elle n'est plus jamais renvoyée ensuite (voir listDevices ci-dessous).
    return { id: device.id, name: device.name, apiKey };
  }

  async listDevices(companyId: string) {
    return this.prisma.kioskDevice.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        isActive: true,
        lastSeenAt: true,
        createdAt: true,
        midDayStartHour: true,
        midDayEndHour: true,
        _count: { select: { additionalCompanies: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateMidDay(companyId: string, id: string, midDayStartHour: number | null, midDayEndHour: number | null) {
    const device = await this.prisma.kioskDevice.findFirst({ where: { id, companyId } });
    if (!device) throw new NotFoundException('Tablette introuvable.');

    return this.prisma.kioskDevice.update({
      where: { id },
      data: { midDayStartHour, midDayEndHour },
      select: { id: true, midDayStartHour: true, midDayEndHour: true },
    });
  }

  async deactivateDevice(companyId: string, id: string) {
    const device = await this.prisma.kioskDevice.findFirst({
      where: { id, companyId },
    });
    if (!device) throw new NotFoundException('Tablette introuvable.');

    await this.prisma.kioskDevice.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  }

  // ============================================================
  // 🏢 PARTAGE D'UNE TABLETTE ENTRE PLUSIEURS ENTREPRISES
  // ============================================================
  // Seul l'admin de l'entreprise PRINCIPALE de la tablette peut gérer ses
  // entreprises supplémentaires — évite qu'un admin d'une autre société ne
  // vienne modifier une tablette qui ne lui appartient pas.

  async listAdditionalCompanies(ownerCompanyId: string, deviceId: string) {
    const device = await this.prisma.kioskDevice.findFirst({
      where: { id: deviceId, companyId: ownerCompanyId },
    });
    if (!device) throw new NotFoundException('Tablette introuvable.');

    return this.prisma.kioskDeviceCompany.findMany({
      where: { deviceId },
      select: {
        id: true,
        companyId: true,
        company: { select: { tradeName: true, legalName: true } },
        actingUserId: true,
        actingUser: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addAdditionalCompany(
    ownerCompanyId: string,
    deviceId: string,
    additionalCompanyId: string,
    actingUserId: string,
  ) {
    const device = await this.prisma.kioskDevice.findFirst({
      where: { id: deviceId, companyId: ownerCompanyId },
    });
    if (!device) throw new NotFoundException('Tablette introuvable.');

    if (additionalCompanyId === ownerCompanyId) {
      throw new BadRequestException(
        "C'est déjà l'entreprise principale de cette tablette.",
      );
    }

    // ⚠️ Le porteur DOIT appartenir fixement à cette entreprise (pas un
    // compte "portefeuille" dont l'entreprise active change) — sinon les
    // règles de la mauvaise entreprise pourraient s'appliquer au scan.
    const actingUser = await this.prisma.user.findFirst({
      where: { id: actingUserId, companyId: additionalCompanyId },
    });
    if (!actingUser) {
      throw new BadRequestException(
        "Ce porteur doit être un compte qui appartient fixement à l'entreprise supplémentaire choisie.",
      );
    }

    try {
      return await this.prisma.kioskDeviceCompany.create({
        data: { deviceId, companyId: additionalCompanyId, actingUserId },
      });
    } catch {
      throw new ConflictException(
        'Cette entreprise est déjà desservie par cette tablette.',
      );
    }
  }

  async removeAdditionalCompany(ownerCompanyId: string, deviceId: string, linkId: string) {
    const device = await this.prisma.kioskDevice.findFirst({
      where: { id: deviceId, companyId: ownerCompanyId },
    });
    if (!device) throw new NotFoundException('Tablette introuvable.');

    await this.prisma.kioskDeviceCompany.deleteMany({
      where: { id: linkId, deviceId },
    });
    return { success: true };
  }

  // ============================================================
  // 🪪 GESTION DES IDENTIFIANTS — badges NFC / QR codes
  // ============================================================

  async registerCredential(allowedCompanyIds: string[], dto: RegisterCredentialDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, companyId: { in: allowedCompanyIds } },
    });
    if (!employee) {
      throw new BadRequestException(
        "Cet employé n'appartient à aucune des entreprises autorisées.",
      );
    }

    if (dto.type === CheckinCredentialType.NFC_BADGE && !dto.identifier) {
      throw new BadRequestException(
        "L'identifiant du badge (lu depuis la tablette) est requis.",
      );
    }

    const identifier = dto.identifier ?? randomUUID();

    const existing = await this.prisma.checkinCredential.findUnique({
      where: { identifier },
    });
    if (existing) {
      throw new ConflictException(
        'Ce badge est déjà associé à un autre employé.',
      );
    }

    // ✅ companyId pris sur l'EMPLOYÉ, pas sur un paramètre unique — c'est
    // ce qui rend une tablette partagée entre plusieurs sociétés cohérente :
    // chaque badge est rattaché à la bonne entreprise automatiquement.
    return this.prisma.checkinCredential.create({
      data: {
        type: dto.type,
        identifier,
        employeeId: dto.employeeId,
        companyId: employee.companyId,
      },
    });
  }

  // Génère (ou récupère) le QR code d'un employé, prêt à être affiché/imprimé.
  async getOrCreateQrCode(companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
    });
    if (!employee) throw new NotFoundException('Employé introuvable.');

    let credential = await this.prisma.checkinCredential.findFirst({
      where: {
        employeeId,
        companyId,
        type: CheckinCredentialType.QR_CODE,
        isActive: true,
      },
    });

    if (!credential) {
      credential = await this.prisma.checkinCredential.create({
        data: {
          type: CheckinCredentialType.QR_CODE,
          identifier: randomUUID(),
          employeeId,
          companyId,
        },
      });
    }

    const qrImageDataUrl = await QRCode.toDataURL(credential.identifier);
    return { identifier: credential.identifier, qrImageDataUrl };
  }

  async listCredentials(companyId: string) {
    return this.prisma.checkinCredential.findMany({
      where: { companyId },
      select: {
        id: true,
        type: true,
        identifier: true,
        isActive: true,
        createdAt: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeCredential(companyId: string, id: string) {
    const credential = await this.prisma.checkinCredential.findFirst({
      where: { id, companyId },
    });
    if (!credential) throw new NotFoundException('Identifiant introuvable.');

    await this.prisma.checkinCredential.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
    });
    return { success: true };
  }

  // ============================================================
  // 📲 ENRÔLEMENT / CONSULTATION DEPUIS LA TABLETTE (clé device, pas de JWT)
  // ============================================================

  // Horaires d'ouverture — fusionnés sur TOUTES les entreprises desservies
  // par cette tablette (fenêtre la plus large, pour ne jamais bloquer un
  // employé légitime d'une des sociétés). Pour une tablette mono-entreprise,
  // ça revient exactement aux horaires de cette seule entreprise.
  async getSchedule(companyIds: string[], deviceId: string) {
    const [allSettings, device] = await Promise.all([
      Promise.all(
        companyIds.map((companyId) =>
          this.prisma.payrollSettings.findFirst({
            where: { companyId },
            orderBy: { effectiveDate: 'desc' },
            select: {
              officialStartHour: true,
              officialEndHour: true,
              lateToleranceMinutes: true,
              workDays: true,
            },
          }),
        ),
      ),
      this.prisma.kioskDevice.findUnique({
        where: { id: deviceId },
        select: { midDayStartHour: true, midDayEndHour: true },
      }),
    ]);

    const settingsList = allSettings.filter((s): s is NonNullable<typeof s> => !!s);

    const officialStartHour = settingsList.length
      ? Math.min(...settingsList.map((s) => s.officialStartHour ?? 8))
      : 8;
    const officialEndHour = settingsList.length
      ? Math.max(...settingsList.map((s) => s.officialEndHour ?? 17))
      : 17;
    const lateToleranceMinutes = settingsList.length
      ? Math.max(...settingsList.map((s) => s.lateToleranceMinutes ?? 60))
      : 60;
    const workDays = settingsList.length
      ? Array.from(new Set(settingsList.flatMap((s) => (s.workDays as number[] | undefined) ?? [1, 2, 3, 4, 5])))
      : [1, 2, 3, 4, 5];

    return {
      officialStartHour,
      officialEndHour,
      lateToleranceMinutes,
      workDays,
      midDayStartHour: device?.midDayStartHour ?? null,
      midDayEndHour: device?.midDayEndHour ?? null,
    };
  }

  // Liste allégée des employés actifs de TOUTES les entreprises desservies,
  // pour le sélecteur affiché sur la tablette pendant l'enrôlement.
  async listEmployeesForKiosk(companyIds: string[]) {
    return this.prisma.employee.findMany({
      where: { companyId: { in: companyIds }, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  // Vérifie si un identifiant scanné est déjà associé à quelqu'un, sans
  // déclencher de pointage — utilisé pendant l'enrôlement pour éviter
  // d'écraser un badge déjà attribué.
  async lookupIdentifier(companyIds: string[], identifier: string) {
    const credential = await this.prisma.checkinCredential.findFirst({
      where: { identifier, companyId: { in: companyIds }, isActive: true },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });

    if (!credential) return { found: false as const };

    return {
      found: true as const,
      employeeName: `${credential.employee.firstName} ${credential.employee.lastName}`,
    };
  }

  // Enrôle un badge/QR directement depuis la tablette : même logique que
  // registerCredential (admin web), simplement appelée avec TOUTES les
  // entreprises desservies par cette tablette comme périmètre autorisé.
  async enrollFromKiosk(companyIds: string[], dto: RegisterCredentialDto) {
    return this.registerCredential(companyIds, dto);
  }

  // ============================================================
  // 📲 SCAN DEPUIS LA TABLETTE (badge approché ou QR lu)
  // ============================================================

  async scan(device: KioskContext, dto: ScanCheckinDto) {
    // Écriture "dernière activité" plafonnée à une fois toutes les 5 minutes :
    // une tablette très fréquentée fait des dizaines de scans/minute, pas la
    // peine d'écrire en base à chaque fois pour un simple indicateur visuel.
    this.touchDeviceActivity(device.id).catch(() => undefined);

    const credential = await this.prisma.checkinCredential.findUnique({
      where: { identifier: dto.identifier },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!credential || !credential.isActive) {
      // Code distinct exprès : le front de la tablette peut basculer sur
      // un écran d'enrôlement ("badge inconnu, associer à un employé ?").
      throw new NotFoundException({
        statusCode: 404,
        error: 'CREDENTIAL_NOT_FOUND',
        message: "Ce badge / QR code n'est associé à aucun employé.",
        identifier: dto.identifier,
      });
    }

    // ✅ Le porteur est résolu selon l'entreprise DU BADGE, pas une
    // entreprise unique fixée sur la tablette — c'est ce qui permet à une
    // même tablette de servir plusieurs sociétés correctement.
    const actingUserId = device.companyPorters.get(credential.companyId);
    if (!actingUserId) {
      throw new ForbiddenException(
        "Cette tablette n'est pas autorisée à enregistrer les pointages de l'entreprise de ce badge.",
      );
    }

    const attendanceDto: any = {
      employeeId: credential.employeeId,
      notes: `Pointage via ${
        credential.type === CheckinCredentialType.NFC_BADGE
          ? 'badge'
          : 'QR code'
      } (tablette)`,
      confirmRestDay: dto.confirmRestDay,
      confirmWorkDuringLeave: dto.confirmWorkDuringLeave,
    };

    try {
      // 1ʳᵉ tentative : entrée. Toute la logique métier existante
      // (congé, férié, shift, GPS, abonnement) s'applique automatiquement,
      // et s'applique aux règles de la BONNE entreprise puisque actingUserId
      // appartient fixement à celle-ci.
      const result = await this.attendanceService.checkIn(attendanceDto, actingUserId);
      return { ...result, employee: credential.employee, action: 'CHECK_IN' };
    } catch (error: any) {
      const alreadyCheckedIn =
        error?.getResponse?.()?.error === 'ATTENDANCE_ALREADY_EXISTS';

      // Si l'employé a déjà pointé son entrée aujourd'hui, un second scan
      // (badge ou QR) est interprété comme le pointage de sortie.
      if (!alreadyCheckedIn) throw error;

      const result = await this.attendanceService.checkOut(attendanceDto, actingUserId);
      return {
        ...result,
        employee: credential.employee,
        action: 'CHECK_OUT',
      };
    }
  }
}