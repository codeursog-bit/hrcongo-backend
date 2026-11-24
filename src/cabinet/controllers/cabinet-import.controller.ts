import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CabinetMemberGuard,
  CabinetCompanyIsolationGuard,
} from '../guards/cabinet.guards';
import { CabinetImportService } from '../services/cabinet-import.service';

@Controller('cabinet/:cabinetId/import')
@UseGuards(JwtAuthGuard, CabinetMemberGuard)
export class CabinetImportController {
  constructor(private readonly importService: CabinetImportService) {}

  @Get('template')
  @UseGuards(CabinetCompanyIsolationGuard)
  async downloadTemplate(
    @Param('cabinetId') cabinetId: string,
    @Query('companyId') companyId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.importService.generateTemplate(companyId);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="template-variables-paie-konza.xlsx"',
    });
    res.send(buffer);
  }

  @Post('parse')
  @UseInterceptors(FileInterceptor('file'))
  async parseFile(
    @Param('cabinetId') cabinetId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('companyId') companyId: string,
    @Body('mapping') mappingStr: string,
  ) {
    if (!file) throw new Error('Aucun fichier reçu');
    const mapping = mappingStr ? JSON.parse(mappingStr) : undefined;
    return this.importService.parseFile(
      file.buffer,
      file.originalname,
      mapping,
    );
  }

  @Post('preview')
  async preview(
    @Param('cabinetId') cabinetId: string,
    @Body()
    body: {
      companyId: string;
      rows: any[];
      mapping: Record<string, string>;
      month: number;
      year: number;
    },
  ) {
    return this.importService.matchAndPreview(
      body.companyId,
      body.rows,
      body.mapping,
    );
  }

  @Post('apply')
  async apply(
    @Param('cabinetId') cabinetId: string,
    @Body()
    body: {
      companyId: string;
      month: number;
      year: number;
      preview: any;
      mapping: Record<string, string>;
      saveMappingName?: string;
    },
  ) {
    if (body.saveMappingName && Object.keys(body.mapping).length > 0) {
      await this.importService.saveMapping(
        cabinetId,
        body.companyId,
        body.saveMappingName,
        body.mapping,
      );
    }
    return this.importService.applyImport(
      cabinetId,
      body.companyId,
      body.month,
      body.year,
      body.preview,
    );
  }

  @Get('mappings')
  getMappings(
    @Param('cabinetId') cabinetId: string,
    @Query('companyId') companyId: string,
  ) {
    return this.importService.getMappings(cabinetId, companyId);
  }
}
