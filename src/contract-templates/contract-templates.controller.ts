// ============================================================================
// 📁 src/contract-templates/contract-templates.controller.ts
// Routes : /contract-templates/*   (ADMIN / HR_MANAGER / SUPER_ADMIN)
// 🔒 Opérations lourdes (import Word, génération, Word/PDF) : 20 requêtes/min par IP.
// 🔒 Isolation : l'entreprise vient de la base (jamais du client) ; UUID stricts ; no-store sur les fichiers.
// ============================================================================
import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put,
  Query, Request, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ContractTemplatesService } from './contract-templates.service';
import {
  CreateTemplateDto, UpdateTemplateDto, ResolveDto, GenerateCustomContractDto, CustomVariableDto, SaveDefaultDto,
} from './contract-templates.dto';

// Upload Word : pas de `dest` ni de `storage` → multer garde le fichier EN MÉMOIRE (jamais sur le disque)
const docxUploadOptions = {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const okMime = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const okName = /\.docx$/i.test(file.originalname || '');
    if (okMime || okName) cb(null, true);
    else cb(new BadRequestException('Seuls les fichiers Word (.docx) sont acceptés. Pour un PDF, copiez-collez son texte dans l\'éditeur.'), false);
  },
};

@Controller('contract-templates')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class ContractTemplatesController {
  constructor(
    private service: ContractTemplatesService,
    private prisma: PrismaService,
  ) {}

  /**
   * 🔒 Entreprise de l'utilisateur connecté, lue en base (jamais fournie par le client).
   * Un compte sans entreprise (ex. SUPER_ADMIN) est refusé : un companyId nul ferait
   * créer un modèle « système » visible par TOUTES les entreprises.
   */
  private async companyIdOf(req: any): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { companyId: true },
    });
    if (!user?.companyId) {
      throw new ForbiddenException('Aucune entreprise active : sélectionnez une entreprise pour gérer les contrats.');
    }
    return user.companyId;
  }

  /** Les contrats contiennent des données personnelles et salariales : jamais de cache navigateur/proxy. */
  private noStore(res: Response) {
    res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  }

  // ⚠️ Routes statiques AVANT les routes en :id (ordre important dans NestJS)

  // ── Variables ──────────────────────────────────────────────────────────────
  @Get('variables')
  async variables(@Request() req: any) {
    return this.service.getCatalog(await this.companyIdOf(req));
  }

  @Get('custom-variables')
  async listCustomVariables(@Request() req: any) {
    return this.service.listCustomVariables(await this.companyIdOf(req));
  }

  @Post('custom-variables')
  async saveCustomVariable(@Body() dto: CustomVariableDto, @Request() req: any) {
    return this.service.upsertCustomVariable(await this.companyIdOf(req), dto);
  }

  @Delete('custom-variables/:key')
  async deleteCustomVariable(@Param('key') key: string, @Request() req: any) {
    return this.service.deleteCustomVariable(await this.companyIdOf(req), key);
  }

  // Valeur enregistrée UNE fois pour l'entreprise (sigle, NIU, capital…) depuis l'écran de génération
  @Post('defaults')
  async saveDefault(@Body() dto: SaveDefaultDto, @Request() req: any) {
    return this.service.saveDefault(await this.companyIdOf(req), dto.key.trim().toLowerCase(), dto.value);
  }

  // ── Import d'un fichier Word (.docx) : lu en mémoire, converti en JSON, jeté ──
  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  @Post('import-docx')
  @UseInterceptors(FileInterceptor('file', docxUploadOptions))
  async importDocx(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('Aucun fichier reçu.');
    return this.service.importFromDocx(file.buffer);
  }

  // ── Génération ─────────────────────────────────────────────────────────────
  @Post('resolve')
  async resolve(@Body() dto: ResolveDto, @Request() req: any) {
    return this.service.resolve(await this.companyIdOf(req), dto.templateId, dto.employeeId, dto.overrides || {});
  }

  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  @Post('generate')
  async generate(@Body() dto: GenerateCustomContractDto, @Request() req: any) {
    return this.service.generate(await this.companyIdOf(req), req.user.userId, dto);
  }

  @Get('contracts')
  async listContracts(@Query('employeeId') employeeId: string | undefined, @Request() req: any) {
    if (employeeId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(employeeId))) {
      throw new BadRequestException('Identifiant employé invalide');
    }
    return this.service.listContracts(await this.companyIdOf(req), employeeId);
  }

  @Delete('contracts/:id')
  async deleteContract(@Param('id', new ParseUUIDPipe()) id: string, @Request() req: any) {
    return this.service.deleteContract(id, await this.companyIdOf(req));
  }

  // Word — consommé par api.getBlob() côté front
  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  @Get('contracts/:id/docx')
  async docx(@Param('id', new ParseUUIDPipe()) id: string, @Request() req: any, @Res({ passthrough: true }) res: Response) {
    const { buffer, fileName } = await this.service.getDocx(id, await this.companyIdOf(req));
    this.noStore(res);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }

  // PDF — affichage direct (inline) ou téléchargement
  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  @Get('contracts/:id/pdf')
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('download') download: string | undefined,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName } = await this.service.getPdf(id, await this.companyIdOf(req));
    this.noStore(res);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download === '1' ? 'attachment' : 'inline'}; filename="${fileName}"`,
    });
    return new StreamableFile(buffer);
  }

  // ── Modèles ────────────────────────────────────────────────────────────────
  @Get()
  async list(@Request() req: any) {
    return this.service.listTemplates(await this.companyIdOf(req));
  }

  @Post()
  async create(@Body() dto: CreateTemplateDto, @Request() req: any) {
    return this.service.createTemplate(await this.companyIdOf(req), req.user.userId, dto);
  }

  @Get(':id')
  async getOne(@Param('id', new ParseUUIDPipe()) id: string, @Request() req: any) {
    return this.service.getTemplate(id, await this.companyIdOf(req));
  }

  @Put(':id')
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTemplateDto, @Request() req: any) {
    return this.service.updateTemplate(id, await this.companyIdOf(req), dto);
  }

  @Delete(':id')
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Request() req: any) {
    return this.service.deleteTemplate(id, await this.companyIdOf(req));
  }

  @Post(':id/duplicate')
  async duplicate(@Param('id', new ParseUUIDPipe()) id: string, @Request() req: any) {
    return this.service.duplicateTemplate(id, await this.companyIdOf(req), req.user.userId);
  }

  @Throttle({ short: { limit: 20, ttl: 60_000 } })
  @Get(':id/preview-pdf')
  async previewPdf(@Param('id', new ParseUUIDPipe()) id: string, @Request() req: any, @Res({ passthrough: true }) res: Response) {
    const buffer = await this.service.previewTemplatePdf(id, await this.companyIdOf(req));
    this.noStore(res);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="apercu.pdf"' });
    return new StreamableFile(buffer);
  }
}