// ============================================================================
// 📁 src/companies/companies.controller.ts
// ✅ Fix : GET :id déplacé en DERNIER pour ne pas capturer "bulletin-template",
//          "mine", etc. + guard UUID pour éviter les crashs Prisma
// ============================================================================
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AuthGuard } from '@nestjs/passport';

// Multer en mémoire — pas de disque, directement streamé vers Cloudinary
const logoMulterOptions = {
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/svg+xml',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          'Format non autorisé. Acceptés : JPG, PNG, WEBP, SVG',
        ),
        false,
      );
    }
  },
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('companies')
@UseGuards(AuthGuard('jwt'))
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() createCompanyDto: CreateCompanyDto, @Request() req) {
    return this.companiesService.create(createCompanyDto, req.user.userId);
  }

  // ✅ Routes fixes en PREMIER — avant GET :id
  // GET /companies/mine — infos de l'entreprise du user connecté
  @Get('mine')
  findMyCompany(@Request() req) {
    return this.companiesService.findByUser(req.user.userId);
  }

  // PATCH /companies — mise à jour entreprise du user connecté
  @Patch()
  update(@Body() updateCompanyDto: UpdateCompanyDto, @Request() req) {
    return this.companiesService.update(req.user.userId, updateCompanyDto);
  }

  // ── LOGO ──────────────────────────────────────────────────────────────────

  /**
   * POST /companies/:id/logo
   * Multipart/form-data — champ "logo" (fichier image)
   * Upload vers Cloudinary, sauvegarde URL en BDD
   * Retourne : { logo: "https://res.cloudinary.com/..." }
   */
  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('logo', logoMulterOptions))
  uploadLogo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException('Fichier manquant dans le champ "logo".');
    return this.companiesService.uploadLogo(id, file);
  }

  /**
   * DELETE /companies/:id/logo
   * Supprime le logo Cloudinary et remet logo à null en BDD
   * Retourne : { logo: null }
   */
  @Delete(':id/logo')
  deleteLogo(@Param('id') id: string) {
    return this.companiesService.deleteLogo(id);
  }

  // ── CACHET / SIGNATURE ───────────────────────────────────────────────────

  /**
   * POST /companies/:id/cachet
   * Multipart/form-data — champ "cachet" (fichier image)
   * Upload vers Cloudinary, sauvegarde URL en BDD
   * Retourne : { cachetUrl: "https://res.cloudinary.com/..." }
   */
  @Post(':id/cachet')
  @UseInterceptors(FileInterceptor('cachet', logoMulterOptions))
  uploadCachet(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file)
      throw new BadRequestException('Fichier manquant dans le champ "cachet".');
    return this.companiesService.uploadCachet(id, file);
  }

  /**
   * DELETE /companies/:id/cachet
   * Supprime le cachet Cloudinary et remet cachetUrl à null en BDD
   * Retourne : { cachetUrl: null }
   */
  @Delete(':id/cachet')
  deleteCachet(@Param('id') id: string) {
    return this.companiesService.deleteCachet(id);
  }

  // ✅ GET :id en DERNIER — pour ne pas capturer "mine", "bulletin-template", etc.
  // GET /companies/:id — infos d'une entreprise par ID (utilisé par cabinet)
  @Get(':id')
  findOne(@Param('id') id: string) {
    // Guard UUID — évite que des segments de route textuels arrivent ici
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException(`Identifiant invalide : "${id}"`);
    }
    return this.companiesService.findOne(id);
  }
}
