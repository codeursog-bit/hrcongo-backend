// // ============================================================================
// // 📁 src/main.ts — Sécurité production + Cookies + Keep-Alive
// // ============================================================================
// import { NestFactory }        from '@nestjs/core';
// import { ValidationPipe, Logger } from '@nestjs/common';
// import { AppModule }          from './app.module';
// import helmet                 from 'helmet';
// import cookieParser           from 'cookie-parser';
// import * as bodyParser        from 'body-parser';
// import { PrismaService }      from './prisma/prisma.service';
// import { GlobalExceptionFilter } from './filters/global-exception.filter';

// async function bootstrap() {
//   const logger = new Logger('Bootstrap');

//   // ══════════════════════════════════════════════════════════════════════════
//   // 🔒 BLOCAGE DÉMARRAGE EN PRODUCTION SANS SECRETS CONFIGURÉS
//   // ══════════════════════════════════════════════════════════════════════════
//   if (process.env.NODE_ENV === 'production') {
//     const required = ['JWT_SECRET', 'DATABASE_URL'];
//     const missing  = required.filter(k => !process.env[k]);
//     if (missing.length > 0) {
//       logger.error(`❌ ARRÊT : Variables d'environnement manquantes : ${missing.join(', ')}`);
//       process.exit(1);
//     }
//     if ((process.env.JWT_SECRET ?? '').length < 32) {
//       logger.error('❌ ARRÊT : JWT_SECRET doit faire au moins 32 caractères en production');
//       process.exit(1);
//     }
//     if (process.env.JWT_SECRET?.includes('secretKey_change')) {
//       logger.error('❌ ARRÊT : JWT_SECRET par défaut détecté en production !');
//       process.exit(1);
//     }
//   }

//   let app;
//   try {
//     app = await NestFactory.create(AppModule, {
//       logger:  process.env.NODE_ENV === 'production'
//         ? ['error', 'warn']
//         : ['log', 'error', 'warn', 'debug', 'verbose'],
//       rawBody: true, // pour les webhooks
//     });

//     // ════════════════════════════════════════════════════════════════════════
//     // 🍪 COOKIE PARSER — obligatoire pour lire les cookies HttpOnly
//     // ════════════════════════════════════════════════════════════════════════
//     app.use(cookieParser());

//     // ════════════════════════════════════════════════════════════════════════
//     // 🔒 HELMET — headers HTTP de sécurité
//     // ════════════════════════════════════════════════════════════════════════
//     app.use(helmet({
//       contentSecurityPolicy:     process.env.NODE_ENV === 'production',
//       crossOriginEmbedderPolicy: false,
//     }));

//     // ════════════════════════════════════════════════════════════════════════
//     // 📦 BODY PARSER — limite stricte par type de route
//     // 100kb pour JSON standard / 10mb pour les uploads multipart
//     // ════════════════════════════════════════════════════════════════════════
//     app.use('/auth',      bodyParser.json({ limit: '50kb' }));   // auth → très petit
//     app.use('/employees', bodyParser.json({ limit: '500kb' }));  // employés avec photo base64
//     app.use(bodyParser.json({
//       limit: '100kb',
//       verify: (req: any, _res, buf) => { req.rawBody = buf; },
//     }));
//     app.use(bodyParser.urlencoded({ limit: '100kb', extended: true }));

//     // ════════════════════════════════════════════════════════════════════════
//     // 🌐 CORS — origines strictement contrôlées
//     // ════════════════════════════════════════════════════════════════════════
//     const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
//       'http://localhost:3000',
//       'http://localhost:5173',
//     ];

//     app.enableCors({
//       origin: (origin, callback) => {
//         if (!origin) return callback(null, true);
//         const isAllowed       = allowedOrigins.includes(origin);
//         const isVercelPreview = origin.endsWith('.vercel.app') &&
//                                 origin.includes('nathan-devs-projects');
//         if (isAllowed || isVercelPreview) {
//           callback(null, true);
//         } else {
//           logger.warn(`❌ CORS bloqué : ${origin}`);
//           callback(new Error('Not allowed by CORS'));
//         }
//       },
//       methods:        ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
//       credentials:    true, // ← OBLIGATOIRE pour que les cookies soient envoyés
//       allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
//       exposedHeaders: ['Content-Range', 'X-Content-Range', 'X-Warning-Count', 'X-Filename'],
//       maxAge:         3600,
//     });

//     // ════════════════════════════════════════════════════════════════════════
//     // ✅ VALIDATION GLOBALE — whitelist stricte sur tous les DTOs
//     // ════════════════════════════════════════════════════════════════════════
//     app.useGlobalPipes(new ValidationPipe({
//       whitelist:            true,  // supprime les champs non déclarés dans le DTO
//       forbidNonWhitelisted: true,  // erreur si champ inconnu envoyé
//       transform:            true,
//       transformOptions:     { enableImplicitConversion: true },
//     }));

//     // ════════════════════════════════════════════════════════════════════════
//     // 🔍 GLOBAL EXCEPTION FILTER — capture + stocke toutes les erreurs
//     // ════════════════════════════════════════════════════════════════════════
//     const prismaForFilter = app.get(PrismaService);
//     app.useGlobalFilters(new GlobalExceptionFilter(prismaForFilter));

//     // ════════════════════════════════════════════════════════════════════════
//     // 🚀 DÉMARRAGE
//     // ════════════════════════════════════════════════════════════════════════
//     const port = process.env.PORT || 3001;
//     await app.listen(port);

//     // ════════════════════════════════════════════════════════════════════════
//     // 🔄 NEON KEEP-ALIVE
//     // ════════════════════════════════════════════════════════════════════════
//     const prisma = app.get(PrismaService);
//     const keepAlive = setInterval(async () => {
//       try {
//         await prisma.$queryRaw`SELECT 1`;
//       } catch (e: any) {
//         logger.warn('⚠️ DB keep-alive ping échoué:', e.message);
//       }
//     }, 4 * 60 * 1000);

//     process.on('beforeExit', () => clearInterval(keepAlive));

//     // ════════════════════════════════════════════════════════════════════════
//     // 📊 LOGS DÉMARRAGE
//     // ════════════════════════════════════════════════════════════════════════
//     logger.log('');
//     logger.log('🚀 ═══════════════════════════════════════════');
//     logger.log(`   Konza RH Backend — ${process.env.NODE_ENV || 'development'}`);
//     logger.log(`   Port     : ${port}`);
//     logger.log(`   Cookies  : HttpOnly activés ✅`);
//     logger.log(`   CORS     : ${allowedOrigins.join(', ')}`);
//     logger.log(`   JWT exp  : 2h access / 7j refresh`);
//     logger.log('   ═══════════════════════════════════════════');
//     logger.log('');

//     // ════════════════════════════════════════════════════════════════════════
//     // 🛑 GRACEFUL SHUTDOWN
//     // ════════════════════════════════════════════════════════════════════════
//     const shutdown = async (signal: string) => {
//       logger.log(`🛑 ${signal} reçu, arrêt propre…`);
//       clearInterval(keepAlive);
//       await app.close();
//       process.exit(0);
//     };

//     process.on('SIGTERM', () => shutdown('SIGTERM'));
//     process.on('SIGINT',  () => shutdown('SIGINT'));

//   } catch (error) {
//     logger.error('❌ Erreur fatale au démarrage:', error);
//     process.exit(1);
//   }
// }

// bootstrap().catch(err => {
//   console.error('❌ Erreur fatale:', err);
//   process.exit(1);
// });

// ============================================================================
// 📁 src/main.ts
// Sécurité production + Cookies HttpOnly + CORS Vercel/Render + Keep-Alive
// ============================================================================
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import * as bodyParser from 'body-parser';
import { PrismaService } from './prisma/prisma.service';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // ══════════════════════════════════════════════════════════════════════════
  // 🔒 BLOCAGE DÉMARRAGE EN PRODUCTION SANS SECRETS CONFIGURÉS
  // ══════════════════════════════════════════════════════════════════════════
  if (process.env.NODE_ENV === 'production') {
    const required = ['JWT_SECRET', 'DATABASE_URL'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      logger.error(`❌ ARRÊT : Variables manquantes : ${missing.join(', ')}`);
      process.exit(1);
    }
    if ((process.env.JWT_SECRET ?? '').length < 32) {
      logger.error('❌ ARRÊT : JWT_SECRET doit faire au moins 32 caractères');
      process.exit(1);
    }
    if (process.env.JWT_SECRET?.includes('secretKey_change')) {
      logger.error('❌ ARRÊT : JWT_SECRET par défaut détecté en production !');
      process.exit(1);
    }
  }

  let app;
  try {
    app = await NestFactory.create(AppModule, {
      logger:
        process.env.NODE_ENV === 'production'
          ? ['error', 'warn']
          : ['log', 'error', 'warn', 'debug', 'verbose'],
      rawBody: true,
    });

    // ════════════════════════════════════════════════════════════════════════
    // 🍪 COOKIE PARSER — obligatoire pour lire les cookies HttpOnly
    // ════════════════════════════════════════════════════════════════════════
    app.use(cookieParser());

    // ════════════════════════════════════════════════════════════════════════
    // 🔒 HELMET — headers HTTP de sécurité
    // ════════════════════════════════════════════════════════════════════════
    app.use(
      helmet({
        contentSecurityPolicy: process.env.NODE_ENV === 'production',
        crossOriginEmbedderPolicy: false,
      }),
    );

    // ════════════════════════════════════════════════════════════════════════
    // 📦 BODY PARSER — limites strictes par route
    // IMPORTANT : exclure les routes d'upload multipart pour que Multer
    // puisse lire le fichier. bodyParser.json() consommerait le stream avant
    // FileInterceptor → "Aucun fichier reçu"
    // ════════════════════════════════════════════════════════════════════════
    const isUploadRoute = (path: string) =>
      path.includes('/import/parse') || path.includes('/upload');

    app.use('/auth', bodyParser.json({ limit: '50kb' }));
    app.use('/employees', bodyParser.json({ limit: '500kb' }));
    app.use((req: any, res: any, next: any) => {
      if (isUploadRoute(req.path)) return next(); // laisser Multer gérer
      bodyParser.json({
        limit: '100kb',
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      })(req, res, next);
    });
    app.use((req: any, res: any, next: any) => {
      if (isUploadRoute(req.path)) return next();
      bodyParser.urlencoded({ limit: '100kb', extended: true })(req, res, next);
    });

    // ════════════════════════════════════════════════════════════════════════
    // 🌐 CORS — critique pour Vercel (front) + Render (back) sur plan gratuit
    //
    // IMPORTANT Vercel + Render cookies :
    //   - Front Vercel  : https://xxx.vercel.app
    //   - Back Render   : https://xxx.onrender.com
    //   → Deux domaines DIFFÉRENTS = cookies cross-site
    //   → sameSite DOIT être 'none' + secure: true en production
    //   → credentials: true obligatoire côté CORS ET côté fetch
    //
    // ⚠️ Render plan gratuit : le service "spin-down" après 15 min d'inactivité.
    //   Le keep-alive Prisma ci-dessous maintient la DB mais pas le process.
    //   Première requête après spin-down = 30-50s de cold start.
    //   Ajouter RENDER_EXTERNAL_URL en variable d'env sur Render pour le ping.
    // ════════════════════════════════════════════════════════════════════════
    const isProd = process.env.NODE_ENV === 'production';

    // Origines autorisées : depuis .env (CORS_ORIGINS=url1,url2) ou fallback dev
    const allowedOrigins: string[] = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : ['http://localhost:3000', 'http://localhost:5173'];

    app.enableCors({
      origin: (origin, callback) => {
        // Requêtes sans origine (Postman, curl, server-to-server)
        if (!origin) return callback(null, true);

        // Origine dans la liste explicite
        if (allowedOrigins.includes(origin)) return callback(null, true);

        // Previews Vercel dynamiques (ex: konza-xyz-nathan-devs-projects.vercel.app)
        const isVercelPreview =
          origin.endsWith('.vercel.app') &&
          origin.includes('nathan-devs-projects');

        // Previews Render dynamiques (back appelé depuis preview front)
        const isRenderPreview = origin.endsWith('.onrender.com');

        if (isVercelPreview || isRenderPreview) return callback(null, true);

        logger.warn(`❌ CORS bloqué : ${origin}`);
        callback(new Error('Not allowed by CORS'));
      },
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      credentials: true, // OBLIGATOIRE pour envoyer/recevoir les cookies
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
      ],
      exposedHeaders: [
        'Content-Range',
        'X-Content-Range',
        'X-Warning-Count',
        'X-Filename',
      ],
      maxAge: 3600,
    });

    // ════════════════════════════════════════════════════════════════════════
    // 🍪 CONFIG COOKIE — sameSite 'none' en prod (cross-site Vercel ↔ Render)
    //    À utiliser dans auth.service.ts COOKIE_CONFIG :
    //    sameSite: isProd ? 'none' : 'lax'
    //    secure:   isProd
    //
    //    On expose isProd comme variable globale pour auth.service.ts
    // ════════════════════════════════════════════════════════════════════════
    // NB : la config cookie est dans auth.service.ts → COOKIE_CONFIG.
    //      Ce flag est lu automatiquement via process.env.NODE_ENV.

    // ════════════════════════════════════════════════════════════════════════
    // ✅ VALIDATION GLOBALE
    // ════════════════════════════════════════════════════════════════════════
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    // ════════════════════════════════════════════════════════════════════════
    // 🔍 GLOBAL EXCEPTION FILTER
    // ════════════════════════════════════════════════════════════════════════
    const prismaForFilter = app.get(PrismaService);
    app.useGlobalFilters(new GlobalExceptionFilter(prismaForFilter));

    // ════════════════════════════════════════════════════════════════════════
    // 🚀 DÉMARRAGE
    // ════════════════════════════════════════════════════════════════════════
    const port = process.env.PORT || 3001;
    await app.listen(port);

    // ════════════════════════════════════════════════════════════════════════
    // 🔄 KEEP-ALIVE DB (Neon/PlanetScale/Supabase)
    //    Évite le cold-start DB, mais ne résout pas le spin-down Render.
    //    Pour résoudre le spin-down Render : ajouter un cron externe qui
    //    ping GET /health toutes les 10 min (ex: cron-job.org gratuit).
    // ════════════════════════════════════════════════════════════════════════
    const prisma = app.get(PrismaService);
    const keepAlive = setInterval(
      async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
        } catch (e: any) {
          logger.warn('⚠️ DB keep-alive ping échoué:', e.message);
        }
      },
      4 * 60 * 1000,
    ); // toutes les 4 minutes

    process.on('beforeExit', () => clearInterval(keepAlive));

    // ════════════════════════════════════════════════════════════════════════
    // 📊 LOGS DÉMARRAGE
    // ════════════════════════════════════════════════════════════════════════
    logger.log('');
    logger.log('🚀 ═══════════════════════════════════════════════');
    logger.log(
      `   Konza RH Backend — ${process.env.NODE_ENV || 'development'}`,
    );
    logger.log(`   Port      : ${port}`);
    logger.log(
      `   Cookies   : HttpOnly ✅  SameSite: ${isProd ? 'none (cross-site)' : 'lax (local)'}`,
    );
    logger.log(`   CORS      : ${allowedOrigins.join(', ')}`);
    logger.log(`   JWT exp   : 2h access / 30j refresh`);
    logger.log(`   Render    : spin-down après 15min inactivité ⚠️`);
    logger.log(`              → pinger GET /health toutes les 10min`);
    logger.log('   ═══════════════════════════════════════════════');
    logger.log('');

    // ════════════════════════════════════════════════════════════════════════
    // 🛑 GRACEFUL SHUTDOWN
    // ════════════════════════════════════════════════════════════════════════
    const shutdown = async (signal: string) => {
      logger.log(`🛑 ${signal} reçu, arrêt propre…`);
      clearInterval(keepAlive);
      await app.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('❌ Erreur fatale au démarrage:', error);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
