import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import {
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { DocumentLayout } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateLayoutBody } from './layout-validation';
import { effectiveCompanyLimits } from '../subscriptions/entitlements.service';

const selection = {
  id: true,
  companyId: true,
  docType: true,
  name: true,
  basePreset: true,
  config: true,
  version: true,
  updatedAt: true,
} as const;
type SavedLayout = Omit<DocumentLayout, 'createdAt'>;

@Injectable()
export class DocumentLayoutsService {
  private readonly cache = new Map<
    string,
    { layout: SavedLayout | null; expires: number }
  >();
  private mutation = 0;

  constructor(
    private readonly prisma: PrismaService,
    @InjectThrottlerStorage() private readonly throttler: ThrottlerStorage,
  ) {}

  private company(companyId?: string) {
    if (!companyId)
      throw new ForbiddenException(
        'Aucune entreprise rattachée à cette session.',
      );
    return companyId;
  }

  async get(companyId: string | undefined, docType: string) {
    const scope = { companyId: this.company(companyId), docType };
    const key = `${scope.companyId}:${docType}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      if (cached.expires > Date.now()) {
        this.cache.set(key, cached);
        return cached.layout;
      }
    }
    const mutation = this.mutation;
    const layout = await this.prisma.documentLayout.findUnique({
      where: { companyId_docType: scope },
      select: selection,
    });
    if (mutation === this.mutation) {
      if (this.cache.size >= 500) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(key, { layout, expires: Date.now() + 300_000 });
    }
    return layout;
  }

  async put(companyId: string | undefined, docType: string, body: unknown) {
    const scope = { companyId: this.company(companyId), docType };
    const rate = await this.throttler.increment(
      `document-layouts:${scope.companyId}`,
      60_000,
      20,
      60_000,
      'document-layouts',
    );
    if (rate.isBlocked)
      throw new HttpException(
        'Patientez avant d’enregistrer un autre modèle.',
        429,
      );
    const draft = validateLayoutBody(body, docType);
    const layout = await this.prisma.$transaction(async (tx) => {
      const rights = await this.rights(scope.companyId, tx);
      if (
        draft.basePreset === 'BLANK' &&
        !rights.canBuildDocumentsFromScratch
      ) {
        throw new ForbiddenException(
          'La page blanche est réservée au plan Entreprise.',
        );
      }
      if (!rights.canCustomizeDocuments) {
        throw new ForbiddenException(
          'La personnalisation est disponible à partir du plan Pro.',
        );
      }
      const company = await tx.company.findUniqueOrThrow({
        where: { id: scope.companyId },
        select: { logo: true, documentTemplate: true },
      });
      if (
        draft.basePreset === 'HIST_ORCA' &&
        company.documentTemplate !== 'ORCA'
      ) {
        throw new ForbiddenException(
          'Le gabarit Orca est réservé aux entreprises qui l’utilisent.',
        );
      }
      const asset = draft.config.logo?.assetUrl;
      if (asset && asset !== company.logo) {
        const url = new URL(asset);
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        if (
          url.hostname !== 'res.cloudinary.com' ||
          (cloudName && url.pathname.split('/')[1] !== cloudName) ||
          !url.pathname.includes(`/document-layout-logos/${scope.companyId}/`)
        ) {
          throw new BadRequestException(
            'Le logo doit provenir de votre entreprise.',
          );
        }
      }
      const savedDraft = {
        ...draft,
        config: { ...draft.config, independent: true },
      };
      return tx.documentLayout.upsert({
        where: { companyId_docType: scope },
        create: { ...scope, ...savedDraft },
        update: { ...savedDraft, version: { increment: 1 } },
        select: selection,
      });
    });
    this.invalidate(scope.companyId, docType);
    return layout;
  }

  async checkLogoUpload(companyId?: string) {
    const id = this.company(companyId);
    if (!(await this.rights(id)).canCustomizeDocuments) {
      throw new ForbiddenException(
        'La personnalisation est disponible à partir du plan Pro.',
      );
    }
    const rate = await this.throttler.increment(
      `document-layout-logos:${id}`,
      60_000,
      5,
      60_000,
      'document-layout-logos',
    );
    if (rate.isBlocked)
      throw new HttpException('Patientez avant d’importer un autre logo.', 429);
    return id;
  }

  async rights(
    companyId?: string,
    client: Pick<PrismaService, 'subscription'> = this.prisma,
  ) {
    const limits = await effectiveCompanyLimits(
      client,
      this.company(companyId),
    );
    return {
      canCustomizeDocuments: limits.canCustomizeDocuments === true,
      canBuildDocumentsFromScratch:
        limits.canBuildDocumentsFromScratch === true,
    };
  }

  async reset(companyId: string | undefined, docType: string) {
    const scope = { companyId: this.company(companyId), docType };
    await this.prisma.documentLayout.deleteMany({ where: scope });
    this.invalidate(scope.companyId, docType);
    return { layout: null };
  }

  private invalidate(companyId: string, docType: string) {
    this.mutation++;
    this.cache.delete(`${companyId}:${docType}`);
  }
}
