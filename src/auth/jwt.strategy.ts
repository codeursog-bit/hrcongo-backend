// // import { ExtractJwt, Strategy } from 'passport-jwt';
// // import { PassportStrategy } from '@nestjs/passport';
// // import { Injectable } from '@nestjs/common';
// // import { ConfigService } from '@nestjs/config';
// // import { Request } from 'express';

// // // Extrait le JWT depuis :
// // //   1. Le header Authorization: Bearer <token>  (requêtes normales)
// // //   2. Le query param ?token=<token>             (EventSource / SSE qui ne supporte pas les headers custom)
// // function extractJwtFromRequestOrQuery(req: Request): string | null {
// //   // Priorité 1 : header Authorization
// //   const authHeader = req.headers?.authorization;
// //   if (authHeader && authHeader.startsWith('Bearer ')) {
// //     return authHeader.slice(7);
// //   }
// //   // Priorité 2 : query param (pour EventSource)
// //   const queryToken = (req.query as any)?.token;
// //   if (queryToken && typeof queryToken === 'string') {
// //     return queryToken;
// //   }
// //   return null;
// // }

// // @Injectable()
// // export class JwtStrategy extends PassportStrategy(Strategy) {
// //   constructor(configService: ConfigService) {
// //     super({
// //       jwtFromRequest: extractJwtFromRequestOrQuery,
// //       ignoreExpiration: false,
// //       secretOrKey:
// //         configService.get<string>('JWT_SECRET') ||
// //         'secretKey_change_in_production_123!',
// //     });
// //   }

// //    async validate(payload: any) {
// //     return {
// //       userId:           payload.sub,
// //       email:            payload.email,
// //       role:             payload.role,
// //       companyId:        payload.companyId        ?? null,
// //       cabinetId:        payload.cabinetId        ?? null,
// //       managedByCabinet: payload.managedByCabinet ?? false,
// //     };

// //   }
// // }

// import { ExtractJwt, Strategy } from 'passport-jwt';
// import { PassportStrategy } from '@nestjs/passport';
// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { Request } from 'express';

// // Extrait le JWT depuis :
// //   1. Le header Authorization: Bearer <token>  (requêtes normales)
// //   2. Le query param ?token=<token>             (EventSource / SSE qui ne supporte pas les headers custom)
// function extractJwtFromRequestOrQuery(req: Request): string | null {
//   // Priorité 1 : header Authorization
//   const authHeader = req.headers?.authorization;
//   if (authHeader && authHeader.startsWith('Bearer ')) {
//     return authHeader.slice(7);
//   }
//   // Priorité 2 : query param (pour EventSource)
//   const queryToken = (req.query as any)?.token;
//   if (queryToken && typeof queryToken === 'string') {
//     return queryToken;
//   }
//   return null;
// }

// @Injectable()
// export class JwtStrategy extends PassportStrategy(Strategy) {
//   constructor(configService: ConfigService) {
//     super({
//       jwtFromRequest: extractJwtFromRequestOrQuery,
//       ignoreExpiration: false,
//       secretOrKey:
//         configService.get<string>('JWT_SECRET') ||
//         'secretKey_change_in_production_123!',
//     });
//   }

//   async validate(payload: any) {
//     return {
//       id:               payload.sub,        // ✅ AJOUT — req.user.id fonctionne partout
//       userId:           payload.sub,        // ✅ GARDÉ — rétrocompatibilité avec le reste du code
//       email:            payload.email,
//       role:             payload.role,
//       companyId:        payload.companyId        ?? null,
//       employeeId:       payload.employeeId       ?? null, // ✅ AJOUT — nécessaire pour le guard timeline
//       cabinetId:        payload.cabinetId        ?? null,
//       managedByCabinet: payload.managedByCabinet ?? false,
//     };
//   }
// }

import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { pickFreshestCookie } from '../common/utils/cookie.util';

// ─── Extracteur : cookie d'abord, puis header Bearer (rétrocompat mobile/SSE) ──
function extractJwt(req: Request): string | null {
  // Priorité 1 — cookie HttpOnly (navigateur web).
  // pickFreshestCookie gère le cas où le navigateur envoie DEUX cookies
  // "access_token" (ancien host-only + nouveau avec domain) : on prend celui
  // dont le JWT a été émis le plus récemment au lieu de prendre le premier
  // de la liste au hasard.
  const accessToken = pickFreshestCookie(req, 'access_token');
  if (accessToken) {
    return accessToken;
  }
  // Priorité 2 — header Authorization: Bearer (apps mobiles / SSE / Postman)
  const auth = req.headers?.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  // Priorité 3 — query param (EventSource / SSE qui ne supporte pas les headers)
  const queryToken = (req.query as any)?.token;
  if (queryToken && typeof queryToken === 'string') {
    return queryToken;
  }
  return null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: extractJwt,
      ignoreExpiration: false,
      passReqToCallback: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ||
        'secretKey_change_in_production_123!',
    });
  }

  async validate(payload: any) {
    // 🔒 Tous les JWT de l'app partagent le même secret (refresh, reset password,
    // 2fa-pending, trusted-device...). Sans ce garde-fou, n'importe lequel de ces
    // tokens passerait ici comme identité d'accès, et des guards comme AdminGuard
    // (qui re-dérivent le rôle en base à partir du seul `sub`) l'accepteraient.
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Type de token invalide');
    }
    return {
      id: payload.sub, // ✅ AJOUT — req.user.id fonctionne partout
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId ?? null,
      cabinetId: payload.cabinetId ?? null,
      managedByCabinet: payload.managedByCabinet ?? false,
    };
  }
}