import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DocumentLayoutsService } from './document-layouts.service';
import {
  BadRequestException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

type CompanyRequest = Request & { user: { companyId?: string } };

@Controller('document-layouts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DocumentLayoutsController {
  constructor(
    private readonly layouts: DocumentLayoutsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Post(':docType/upload-logo')
  @Roles('ADMIN', 'HR_MANAGER')
  @UseInterceptors(
    FileInterceptor('logo', { limits: { fileSize: 300 * 1024, files: 1 } }),
  )
  async uploadLogo(
    @Req() req: CompanyRequest,
    @Param('docType') docType: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.supported(docType);
    const signatures: Record<string, (buffer: Buffer) => boolean> = {
      'image/png': (buffer) =>
        buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
      'image/jpeg': (buffer) =>
        buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')),
      'image/webp': (buffer) =>
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP',
    };
    if (!file || !signatures[file.mimetype]?.(file.buffer)) {
      throw new BadRequestException(
        'Choisissez un logo PNG, JPEG ou WebP de 300 Ko maximum.',
      );
    }
    const companyId = await this.layouts.checkLogoUpload(req.user.companyId);
    return {
      logo: await this.cloudinary.uploadPublicFile(
        file,
        `document-layout-logos/${companyId}`,
      ),
    };
  }

  private supported(docType: string) {
    if (docType !== 'PAYSLIP')
      throw new NotFoundException(
        'Ce type de document n’est pas encore disponible.',
      );
    return docType;
  }

  @Get(':docType')
  async get(
    @Req() req: CompanyRequest,
    @Param('docType') docType: string,
    @Res() res: Response,
  ) {
    const layout = await this.layouts.get(
      req.user.companyId,
      this.supported(docType),
    );
    const payload = JSON.stringify({ layout });
    const etag = `"${createHash('sha256').update(payload).digest('base64url')}"`;
    res.set({ ETag: etag, 'Cache-Control': 'private, no-cache' });
    if (req.fresh) return res.status(304).end();
    return res.type('json').send(payload);
  }

  @Put(':docType')
  @Roles('ADMIN', 'HR_MANAGER')
  async put(
    @Req() req: CompanyRequest,
    @Param('docType') docType: string,
    @Body() body: unknown,
  ) {
    return {
      layout: await this.layouts.put(
        req.user.companyId,
        this.supported(docType),
        body,
      ),
    };
  }

  @Delete(':docType')
  @Roles('ADMIN', 'HR_MANAGER')
  reset(@Req() req: CompanyRequest, @Param('docType') docType: string) {
    return this.layouts.reset(req.user.companyId, this.supported(docType));
  }
}
