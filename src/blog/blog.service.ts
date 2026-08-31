// ============================================================================
// 📁 src/blog/blog.service.ts — COMPLET
// Inclut : champs SEO (seoTitle, seoDesc, keywords), upload image Cloudinary
// ============================================================================
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreatePostDto, UpdatePostDto, BlogQueryDto } from './dto/blog.dto';

const CAN_POST_ROLES = ['HR_MANAGER', 'ADMIN', 'SUPER_ADMIN', 'CABINET_ADMIN'];
const MONTHLY_LIMIT = 4;

// ─── Sélection liste (sans content) ──────────────────────────────────────────
const POST_LIST_SELECT = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverImage: true,
  category: true,
  scope: true,
  likesCount: true,
  publishedAt: true,
  createdAt: true,
  seoTitle: true,
  seoDesc: true,
  keywords: true,
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      company: { select: { tradeName: true, legalName: true, logo: true } },
    },
  },
  company: { select: { tradeName: true, legalName: true, logo: true } },
};

// ─── Sélection détail (avec content) ─────────────────────────────────────────
const POST_DETAIL_SELECT = {
  ...POST_LIST_SELECT,
  content: true,
  updatedAt: true,
  companyId: true,
  scope: true,
};

@Injectable()
export class BlogService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  // ─── Slug ────────────────────────────────────────────────────────────────────
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 90);
  }

  private async uniqueSlug(base: string): Promise<string> {
    const exists = await this.prisma.blogPost.findUnique({
      where: { slug: base },
    });
    return exists ? `${base}-${Date.now()}` : base;
  }

  // ─── keywords helper ─────────────────────────────────────────────────────────
  private encodeKeywords(kw?: string[]): string | null {
    if (!kw || kw.length === 0) return null;
    return JSON.stringify(kw);
  }

  // ─── UPLOAD IMAGE de couverture ───────────────────────────────────────────────
  async uploadCoverImage(
    file: Express.Multer.File,
    user: { id: string; role: string; companyId?: string },
  ): Promise<{ url: string }> {
    if (!CAN_POST_ROLES.includes(user.role)) {
      throw new ForbiddenException('Rôle non autorisé à uploader des images.');
    }
    if (!file) throw new BadRequestException('Aucun fichier fourni.');

    const folder =
      user.role === 'SUPER_ADMIN'
        ? 'blog/global'
        : `blog/${user.companyId || 'general'}`;

    const url = await this.cloudinary.uploadPublicFile(file, folder);
    return { url };
  }

  // ─── GET liste paginée ────────────────────────────────────────────────────────
  async findAll(
    query: BlogQueryDto,
    requestUserId?: string,
    requestUserRole?: string,
    requestUserCompanyId?: string,
  ) {
    const page = Math.max(1, parseInt(query.page || '1'));
    const limit = Math.min(20, parseInt(query.limit || '12'));
    const skip = (page - 1) * limit;

    let scopeFilter: any;
    if (requestUserRole === 'SUPER_ADMIN') {
      scopeFilter = {};
    } else if (requestUserCompanyId) {
      scopeFilter = {
        OR: [
          { scope: 'GLOBAL' },
          { scope: 'COMPANY', companyId: requestUserCompanyId },
        ],
      };
    } else {
      scopeFilter = { scope: 'GLOBAL' };
    }

    const where: any = {
      published: true,
      ...scopeFilter,
      ...(query.category ? { category: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { excerpt: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [posts, total] = await Promise.all([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take: limit,
        select: POST_LIST_SELECT,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    // Injecter hasLiked si auth
    let postsWithLike = posts as any[];
    if (requestUserId) {
      const likedIds = await this.prisma.blogLike.findMany({
        where: { userId: requestUserId, post: { published: true } },
        select: { postId: true },
      });
      const likedSet = new Set(likedIds.map((l) => l.postId));
      postsWithLike = posts.map((p) => ({
        ...p,
        hasLiked: likedSet.has(p.id),
        keywords: p.keywords ? JSON.parse(p.keywords) : [],
      }));
    } else {
      postsWithLike = posts.map((p) => ({
        ...p,
        keywords: p.keywords ? JSON.parse(p.keywords) : [],
      }));
    }

    return {
      posts: postsWithLike,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: skip + limit < total,
        hasPrev: page > 1,
      },
    };
  }

  // ─── GET par slug ─────────────────────────────────────────────────────────────
  async findBySlug(
    slug: string,
    requestUserId?: string,
    requestUserRole?: string,
    requestUserCompanyId?: string,
  ) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug, published: true },
      select: POST_DETAIL_SELECT,
    });

    if (!post) throw new NotFoundException('Article introuvable');

    if ((post as any).scope === 'COMPANY') {
      if (requestUserRole === 'SUPER_ADMIN') {
        // ok
      } else if (
        requestUserCompanyId &&
        requestUserCompanyId === (post as any).companyId
      ) {
        // ok
      } else {
        throw new ForbiddenException(
          'Cet article est réservé aux membres de cette entreprise',
        );
      }
    }

    const hasLiked = requestUserId
      ? !!(await this.prisma.blogLike.findUnique({
          where: { postId_userId: { postId: post.id, userId: requestUserId } },
        }))
      : false;

    return {
      ...post,
      hasLiked,
      keywords: (post as any).keywords
        ? JSON.parse((post as any).keywords)
        : [],
    };
  }

  // ─── CREATE ───────────────────────────────────────────────────────────────────
  async create(
    dto: CreatePostDto,
    user: { id: string; role: string; companyId?: string },
  ) {
    // 1. Vérif rôle
    if (!CAN_POST_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        `Rôle non autorisé (${user.role}). Autorisés : HR_MANAGER, ADMIN, SUPER_ADMIN, CABINET_ADMIN.`,
      );
    }

    // 2. Quota mensuel
    if (user.role !== 'SUPER_ADMIN' && user.companyId) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const quota = await this.prisma.blogMonthlyQuota.upsert({
        where: {
          companyId_year_month: { companyId: user.companyId, year, month },
        },
        create: {
          companyId: user.companyId,
          year,
          month,
          count: 0,
          limit: MONTHLY_LIMIT,
        },
        update: {},
      });

      if (quota.count >= quota.limit) {
        throw new ForbiddenException(
          `Quota mensuel atteint : ${quota.count}/${quota.limit} posts publiés ce mois.`,
        );
      }
    }

    // 3. Slug unique
    const baseSlug = this.slugify(dto.title);
    const slug = await this.uniqueSlug(baseSlug);

    // 4. Scope + SEO
    const scope = user.role === 'SUPER_ADMIN' ? 'GLOBAL' : 'COMPANY';
    const published = dto.published !== false;
    const seoTitle = dto.seoTitle || dto.title.slice(0, 60);
    const seoDesc = dto.seoDesc || dto.excerpt?.slice(0, 160) || '';

    // 5. Création
    const post = await this.prisma.blogPost.create({
      data: {
        authorId: user.id,
        companyId:
          user.role !== 'SUPER_ADMIN' ? (user.companyId ?? null) : null,
        title: dto.title,
        slug,
        excerpt: dto.excerpt ?? null,
        content: dto.content,
        category: (dto.category ?? 'GENERAL') as any,
        coverImage: dto.coverImage ?? null,
        scope: scope as any,
        published,
        publishedAt: published ? new Date() : null,
        // SEO
        seoTitle,
        seoDesc,
        keywords: this.encodeKeywords(dto.keywords),
      } as any,
      select: POST_DETAIL_SELECT,
    });

    // 6. Incrémenter quota
    if (user.role !== 'SUPER_ADMIN' && user.companyId) {
      const now = new Date();
      await this.prisma.blogMonthlyQuota.update({
        where: {
          companyId_year_month: {
            companyId: user.companyId,
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          },
        },
        data: { count: { increment: 1 } },
      });
    }

    return {
      ...post,
      keywords: (post as any).keywords
        ? JSON.parse((post as any).keywords)
        : [],
    };
  }

  // ─── UPDATE ───────────────────────────────────────────────────────────────────
  async update(
    slug: string,
    dto: UpdatePostDto,
    user: { id: string; role: string },
  ) {
    const post = await this.prisma.blogPost.findUnique({ where: { slug } });
    if (!post) throw new NotFoundException('Article introuvable');

    const isOwner = post.authorId === user.id;
    const isSA = user.role === 'SUPER_ADMIN';
    const isAdmin = user.role === 'ADMIN';
    if (!isOwner && !isSA && !isAdmin)
      throw new ForbiddenException('Non autorisé');

    // Nouveau slug si titre changé
    let newSlug = post.slug;
    if (dto.title && dto.title !== post.title) {
      const base = this.slugify(dto.title);
      newSlug = await this.uniqueSlug(base);
    }

    const wasPublished = (post as any).published;
    const willPublish =
      dto.published !== undefined ? dto.published : wasPublished;
    const publishedAt =
      !wasPublished && willPublish ? new Date() : (post as any).publishedAt;

    const updated = await this.prisma.blogPost.update({
      where: { id: post.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title, slug: newSlug }),
        ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.category !== undefined && { category: dto.category as any }),
        ...(dto.coverImage !== undefined && { coverImage: dto.coverImage }),
        ...(dto.published !== undefined && {
          published: willPublish,
          publishedAt,
        }),
        // SEO
        ...(dto.seoTitle !== undefined && { seoTitle: dto.seoTitle }),
        ...(dto.seoDesc !== undefined && { seoDesc: dto.seoDesc }),
        ...(dto.keywords !== undefined && {
          keywords: this.encodeKeywords(dto.keywords),
        }),
      } as any,
      select: POST_DETAIL_SELECT,
    });

    return {
      ...updated,
      keywords: (updated as any).keywords
        ? JSON.parse((updated as any).keywords)
        : [],
    };
  }

  // ─── DELETE ───────────────────────────────────────────────────────────────────
  async remove(slug: string, user: { id: string; role: string }) {
    const post = await this.prisma.blogPost.findUnique({ where: { slug } });
    if (!post) throw new NotFoundException('Article introuvable');

    const isOwner = post.authorId === user.id;
    const isSA = user.role === 'SUPER_ADMIN';
    const isAdmin = user.role === 'ADMIN';
    if (!isOwner && !isSA && !isAdmin)
      throw new ForbiddenException('Non autorisé');

    // Supprimer l'image Cloudinary si présente
    if ((post as any).coverImage) {
      const publicId = this.cloudinary.extractPublicId(
        (post as any).coverImage,
      );
      if (publicId) {
        await this.cloudinary.deleteFile(publicId, 'image').catch(() => {});
      }
    }

    await this.prisma.blogPost.delete({ where: { id: post.id } });
    return { success: true, message: 'Article supprimé' };
  }

  // ─── LIKE / UNLIKE (connecté) ─────────────────────────────────────────────────
  async toggleLike(slug: string, userId: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug, published: true },
    });
    if (!post) throw new NotFoundException('Article introuvable');

    const existing = await this.prisma.blogLike.findUnique({
      where: { postId_userId: { postId: post.id, userId } },
    });

    if (existing) {
      await this.prisma.$transaction([
        this.prisma.blogLike.delete({ where: { id: existing.id } }),
        this.prisma.blogPost.update({
          where: { id: post.id },
          data: { likesCount: { decrement: 1 } },
        }),
      ]);
      const u = await this.prisma.blogPost.findUnique({
        where: { id: post.id },
        select: { likesCount: true },
      });
      return { liked: false, likesCount: u!.likesCount };
    } else {
      await this.prisma.$transaction([
        this.prisma.blogLike.create({ data: { postId: post.id, userId } }),
        this.prisma.blogPost.update({
          where: { id: post.id },
          data: { likesCount: { increment: 1 } },
        }),
      ]);
      const u = await this.prisma.blogPost.findUnique({
        where: { id: post.id },
        select: { likesCount: true },
      });
      return { liked: true, likesCount: u!.likesCount };
    }
  }

  // ─── LIKE anonyme (fingerprint) ───────────────────────────────────────────────
  async toggleLikeAnonymous(slug: string, fingerprint: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug, published: true },
    });
    if (!post) throw new NotFoundException('Article introuvable');

    const existing = await (this.prisma as any).blogAnonymousLike
      .findUnique({
        where: { postId_fingerprint: { postId: post.id, fingerprint } },
      })
      .catch(() => null);

    if (existing) {
      await this.prisma.$transaction([
        (this.prisma as any).blogAnonymousLike.delete({
          where: { id: existing.id },
        }),
        this.prisma.blogPost.update({
          where: { id: post.id },
          data: { likesCount: { decrement: 1 } },
        }),
      ]);
      const u = await this.prisma.blogPost.findUnique({
        where: { id: post.id },
        select: { likesCount: true },
      });
      return { liked: false, likesCount: u!.likesCount };
    } else {
      await this.prisma.$transaction([
        (this.prisma as any).blogAnonymousLike
          .create({ data: { postId: post.id, fingerprint } })
          .catch(() => {}),
        this.prisma.blogPost.update({
          where: { id: post.id },
          data: { likesCount: { increment: 1 } },
        }),
      ]);
      const u = await this.prisma.blogPost.findUnique({
        where: { id: post.id },
        select: { likesCount: true },
      });
      return { liked: true, likesCount: u!.likesCount };
    }
  }

  // ─── QUOTA ────────────────────────────────────────────────────────────────────
  async getQuota(user: { id: string; role: string; companyId?: string }) {
    if (user.role === 'SUPER_ADMIN') {
      return {
        unlimited: true,
        used: 0,
        limit: null,
        remaining: null,
        canPost: true,
      };
    }
    if (!user.companyId) {
      return {
        unlimited: false,
        used: 0,
        limit: MONTHLY_LIMIT,
        remaining: MONTHLY_LIMIT,
        canPost: true,
      };
    }

    const now = new Date();
    const quota = await this.prisma.blogMonthlyQuota.findUnique({
      where: {
        companyId_year_month: {
          companyId: user.companyId,
          year: now.getFullYear(),
          month: now.getMonth() + 1,
        },
      },
    });

    const used = quota?.count ?? 0;
    const lim = quota?.limit ?? MONTHLY_LIMIT;
    return {
      unlimited: false,
      used,
      limit: lim,
      remaining: Math.max(0, lim - used),
      canPost: used < lim,
    };
  }
}
