// import { registerAs } from '@nestjs/config';
// import * as Joi from 'joi';

// // ========================================
// // 📋 SCHÉMA DE VALIDATION DES VARIABLES D'ENVIRONNEMENT
// // ========================================
// export const validationSchema = Joi.object({
//   // Base de données
//   DATABASE_URL: Joi.string().required()
//     .description('URL de connexion à la base de données'),

//   // JWT & Sécurité
//   JWT_SECRET: Joi.string().min(32).required()
//     .description('Clé secrète JWT (minimum 32 caractères)'),

//   JWT_EXPIRATION: Joi.string().default('7d')
//     .description('Durée de validité du token JWT'),

//   // Encryption
//   ENCRYPTION_KEY: Joi.string().min(32).optional()
//     .description('Clé de chiffrement (optionnel, utilise JWT_SECRET si absent)'),

//   // Serveur
//   PORT: Joi.number().default(3001)
//     .description('Port du serveur'),

//   NODE_ENV: Joi.string()
//     .valid('development', 'production', 'test')
//     .default('development')
//     .description('Environnement d\'exécution'),

//   // Frontend
//   FRONTEND_URL: Joi.string().uri().default('http://localhost:3000')
//     .description('URL du frontend pour CORS'),

//   // Email (optionnel pour notifications)
//   SMTP_HOST: Joi.string().optional()
//     .description('Serveur SMTP'),

//   SMTP_PORT: Joi.number().optional()
//     .description('Port SMTP'),

//   SMTP_USER: Joi.string().optional()
//     .description('Utilisateur SMTP'),

//   SMTP_PASSWORD: Joi.string().optional()
//     .description('Mot de passe SMTP'),

//   SMTP_FROM: Joi.string().email().optional()
//     .description('Email expéditeur'),

//   // Limites & Performance
//   MAX_EMPLOYEES_BATCH: Joi.number().default(500)
//     .description('Nombre max d\'employés pour génération batch'),

//   PAYROLL_CACHE_TTL: Joi.number().default(300)
//     .description('Durée du cache (secondes) pour les rapports'),
// });

// // ========================================
// // ⚙️ CONFIGURATION PAR MODULE
// // ========================================

// export const databaseConfig = registerAs('database', () => ({
//   url: process.env.DATABASE_URL,
// }));

// export const authConfig = registerAs('auth', () => {
//   const secret = process.env.JWT_SECRET;

//   if (!secret) {
//     throw new Error('❌ JWT_SECRET is required in .env file');
//   }

//   if (secret.length < 32) {
//     throw new Error('❌ JWT_SECRET must be at least 32 characters long');
//   }

//   return {
//     jwtSecret: secret,
//     jwtExpiration: process.env.JWT_EXPIRATION || '7d',
//     encryptionKey: process.env.ENCRYPTION_KEY || secret,
//   };
// });

// export const appConfig = registerAs('app', () => ({
//   port: parseInt(process.env.PORT, 10) || 3001,
//   nodeEnv: process.env.NODE_ENV || 'development',
//   frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
// }));

// export const emailConfig = registerAs('email', () => ({
//   host: process.env.SMTP_HOST,
//   port: parseInt(process.env.SMTP_PORT, 10),
//   user: process.env.SMTP_USER,
//   password: process.env.SMTP_PASSWORD,
//   from: process.env.SMTP_FROM,
//   enabled: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
// }));

// export const performanceConfig = registerAs('performance', () => ({
//   maxEmployeesBatch: parseInt(process.env.MAX_EMPLOYEES_BATCH, 10) || 500,
//   payrollCacheTTL: parseInt(process.env.PAYROLL_CACHE_TTL, 10) || 300,
// }));

// // ========================================
// // 📦 EXPORT TOUT
// // ========================================
// export default [
//   databaseConfig,
//   authConfig,
//   appConfig,
//   emailConfig,
//   performanceConfig,
// ];

import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

// ========================================
// 📋 SCHÉMA DE VALIDATION DES VARIABLES D'ENVIRONNEMENT
// ========================================
export const validationSchema = Joi.object({
  // Base de données
  DATABASE_URL: Joi.string()
    .required()
    .description('URL de connexion à la base de données'),

  // JWT & Sécurité
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .description('Clé secrète JWT (minimum 32 caractères)'),

  JWT_EXPIRATION: Joi.string()
    .default('7d')
    .description('Durée de validité du token JWT'),

  // Encryption
  ENCRYPTION_KEY: Joi.string()
    .min(32)
    .optional()
    .description(
      'Clé de chiffrement (optionnel, utilise JWT_SECRET si absent)',
    ),

  // Serveur
  PORT: Joi.number().default(3001).description('Port du serveur'),

  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development')
    .description("Environnement d'exécution"),

  // Frontend
  FRONTEND_URL: Joi.string()
    .uri()
    .default('http://localhost:3000')
    .description('URL du frontend pour CORS'),

  // Email (optionnel pour notifications)
  SMTP_HOST: Joi.string().optional().description('Serveur SMTP'),

  SMTP_PORT: Joi.number().optional().description('Port SMTP'),

  SMTP_USER: Joi.string().optional().description('Utilisateur SMTP'),

  SMTP_PASSWORD: Joi.string().optional().description('Mot de passe SMTP'),

  SMTP_FROM: Joi.string().email().optional().description('Email expéditeur'),

  // Limites & Performance
  MAX_EMPLOYEES_BATCH: Joi.number()
    .default(500)
    .description("Nombre max d'employés pour génération batch"),

  PAYROLL_CACHE_TTL: Joi.number()
    .default(300)
    .description('Durée du cache (secondes) pour les rapports'),
});

// ========================================
// ⚙️ CONFIGURATION PAR MODULE
// ========================================

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL!,
}));

export const authConfig = registerAs('auth', () => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('❌ JWT_SECRET is required in .env file');
  }

  if (secret.length < 32) {
    throw new Error('❌ JWT_SECRET must be at least 32 characters long');
  }

  return {
    jwtSecret: secret,
    jwtExpiration: process.env.JWT_EXPIRATION || '7d',
    encryptionKey: process.env.ENCRYPTION_KEY || secret,
  };
});

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
}));

export const emailConfig = registerAs('email', () => ({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.SMTP_FROM,
  enabled: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
}));

export const performanceConfig = registerAs('performance', () => ({
  maxEmployeesBatch: parseInt(process.env.MAX_EMPLOYEES_BATCH || '500', 10),
  payrollCacheTTL: parseInt(process.env.PAYROLL_CACHE_TTL || '300', 10),
}));

// ========================================
// 📦 EXPORT TOUT
// ========================================
export default [
  databaseConfig,
  authConfig,
  appConfig,
  emailConfig,
  performanceConfig,
];
