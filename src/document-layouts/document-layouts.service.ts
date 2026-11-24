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
    const draft = validateLayoutBody(body);
    const layout = await this.prisma.$transaction(async (tx) => {
      // L’écriture de l’entreprise sérialise les activations d’un même tenant.
      const company = await tx.company.update({
        where: { id: scope.companyId },
        data: { documentTemplate: 'CUSTOM' },
        select: { logo: true },
      });
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
      return tx.documentLayout.upsert({
        where: { companyId_docType: scope },
        create: { ...scope, ...draft },
        update: { ...draft, version: { increment: 1 } },
        select: selection,
      });
    });
    this.invalidate(scope.companyId, docType);
    return layout;
  }

  async checkLogoUpload(companyId?: string) {
    const id = this.company(companyId);
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
