import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmployeesImportService } from './employees-import.service';

const multerOptions = {
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req: any, file: any, cb: any) => {
    if (
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel'
    ) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException('Seuls les fichiers Excel sont acceptés.'),
        false,
      );
    }
  },
};

@Controller('employees/import')
@UseGuards(JwtAuthGuard, RolesGuard)
// 🔒 CORRECTIF SÉCURITÉ (audit, moyen) : n'importe quel compte authentifié —
// y compris un EMPLOYEE — pouvait importer/créer en masse des employés dans
// sa propre entreprise (pas de fuite cross-entreprise, mais une action RH
// sensible non restreinte au bon rôle). Import réservé désormais à
// ADMIN/HR_MANAGER/SUPER_ADMIN, cohérent avec le reste du module employees/.
@Roles('ADMIN', 'HR_MANAGER', 'SUPER_ADMIN')
export class EmployeesImportController {
  constructor(private readonly importService: EmployeesImportService) {}

  @Get('template')
  async downloadTemplate(@Res() res: Response) {
    try {
      const buffer = this.importService.generateExcelTemplate();
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template.xlsx"',
        'Content-Length': buffer.length,
      });
      res.send(buffer);
    } catch (error: any) {
      throw new BadRequestException(`Erreur: ${error.message}`);
    }
  }

  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async analyzeFile(
    @UploadedFile() file: Express.Multer.File,
    @GetUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni.');
    const analysis = await this.importService.analyzeExcelFile(
      file.buffer,
      userId,
    );
    return { success: true, data: analysis };
  }

  @Post('validate')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async validateMapping(
    @UploadedFile() file: Express.Multer.File,
    @Body('mappings') mappingsStr: string,
    @GetUser('id') userId: string,
  ) {
    if (!file || !mappingsStr)
      throw new BadRequestException('Fichier ou mappings manquant.');
    const mappings = JSON.parse(mappingsStr);
    const validation = await this.importService.validateImportData(
      file.buffer,
      mappings,
      userId,
    );
    return { success: validation.isValid, data: validation };
  }

  @Post('execute')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async executeImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('mappings') mappingsStr: string,
    @GetUser('id') userId: string,
  ) {
    if (!file || !mappingsStr)
      throw new BadRequestException('Fichier ou mappings manquant.');
    const mappings = JSON.parse(mappingsStr);
    const validation = await this.importService.validateImportData(
      file.buffer,
      mappings,
      userId,
    );
    if (!validation.isValid) {
      return {
        success: false,
        message: 'Validation échouée',
        data: validation,
      };
    }
    const result = await this.importService.executeImport(
      file.buffer,
      mappings,
      userId,
    );
    return { success: result.success, data: result };
  }
}