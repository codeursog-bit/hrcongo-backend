// ============================================================================
// 📁 src/blog/blog.controller.ts — COMPLET
// Inclut : upload image Cloudinary, champs SEO, OptionalJwtAuthGuard
// ============================================================================
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ExecutionContext,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { memoryStorage } from 'multer';

import { BlogService } from './blog.service';
import { CreatePostDto, UpdatePostDto, BlogQueryDto } from './dto/blog.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';

// ─── Guard optionnel : ne bloque pas si non authentifié ──────────────────────
@Injectable()
class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
  handleRequest(err: any, user: any) {
    return user || null; // pas d'erreur si non auth
  }
}

// ─── Multer options pour l'upload image ──────────────────────────────────────
const imageMulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
  fileFilter: (_: any, file: Express.Multer.File, cb: any) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(
        new BadRequestException(
          'Format non autorisé. Utilisez JPG, PNG ou WEBP.',
        ),
        false,
      );
    }
    cb(null, true);
  },
};

@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  // ── GET /blog/quota ── protégé ────────────────────────────────────────────
  @Get('quota')
  @UseGuards(JwtAuthGuard)
  getQuota(@GetUser() user: any) {
    return this.blogService.getQuota(user);
  }

  // ── GET /blog ── public (enrichi si auth) ─────────────────────────────────
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  findAll(@Query() query: BlogQueryDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.blogService.findAll(
      query,
      user?.id,
      user?.role,
      user?.companyId,
    );
  }

  // ── POST /blog/upload-image ── protégé ────────────────────────────────────
  // Upload une image de couverture vers Cloudinary
  // Champ FormData : "image"
  // Retourne : { url: "https://res.cloudinary.com/..." }
  @Post('upload-image')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('image', imageMulterOptions))
  uploadCoverImage(
    @UploadedFile() file: Express.Multer.File,
    @GetUser() user: any,
  ) {
    if (!file)
      throw new BadRequestException('Aucun fichier dans le champ "image".');
    return this.blogService.uploadCoverImage(file, user);
  }

  // ── GET /blog/:slug ── public (enrichi si auth) ───────────────────────────
  @Get(':slug')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(@Param('slug') slug: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.blogService.findBySlug(
      slug,
      user?.id,
      user?.role,
      user?.companyId,
    );
  }

  // ── POST /blog ── protégé ─────────────────────────────────────────────────
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePostDto, @GetUser() user: any) {
    return this.blogService.create(dto, user);
  }

  // ── PATCH /blog/:slug ── protégé ──────────────────────────────────────────
  @Patch(':slug')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('slug') slug: string,
    @Body() dto: UpdatePostDto,
    @GetUser() user: any,
  ) {
    return this.blogService.update(slug, dto, user);
  }

  // ── DELETE /blog/:slug ── protégé ─────────────────────────────────────────
  @Delete(':slug')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  remove(@Param('slug') slug: string, @GetUser() user: any) {
    return this.blogService.remove(slug, user);
  }

  // ── POST /blog/:slug/like ── public (fingerprint ou auth) ─────────────────
  @Post(':slug/like')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async toggleLike(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Body('fingerprint') fingerprint?: string,
  ) {
    const user = (req as any).user;
    if (user?.id) {
      return this.blogService.toggleLike(slug, user.id);
    } else if (fingerprint) {
      return this.blogService.toggleLikeAnonymous(slug, fingerprint);
    }
    return {
      liked: false,
      likesCount: 0,
      message: 'fingerprint requis pour les visiteurs',
    };
  }
}
