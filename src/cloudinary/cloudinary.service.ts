// // src/cloudinary/cloudinary.service.ts
// // 🔄 MIGRÉ VERS SUPABASE - Interface identique, meilleure implémentation
// import { Injectable, BadRequestException } from '@nestjs/common';
// import { createClient, SupabaseClient } from '@supabase/supabase-js';

// @Injectable()
// export class CloudinaryService {
//   private supabase: SupabaseClient;

//   constructor() {
//     // ✅ Fix TypeScript: Validation des variables d'env
//     const supabaseUrl = process.env.SUPABASE_URL;
//     const supabaseKey = process.env.SUPABASE_KEY;

//     if (!supabaseUrl || !supabaseKey) {
//       throw new Error(
//         '❌ Variables d\'environnement manquantes: SUPABASE_URL et SUPABASE_KEY sont requises'
//       );
//     }

//     // ✅ Initialisation Supabase (remplace Cloudinary)
//     this.supabase = createClient(supabaseUrl, supabaseKey);

//     console.log('✅ Supabase Storage initialisé');
//   }

//   /**
//    * 🛠️ Générer un nom de fichier unique et propre
//    */
//   private generateFileName(originalName: string): string {
//     const timestamp = Date.now();
//     const random = Math.random().toString(36).substring(2, 8);

//     // Nettoyer le nom
//     const cleanName = originalName
//       .toLowerCase()
//       .normalize('NFD')
//       .replace(/[\u0300-\u036f]/g, '') // Enlever accents
//       .replace(/[^a-z0-9._-]/g, '_')
//       .replace(/_{2,}/g, '_')
//       .replace(/^_|_$/g, '');

//     const extension = cleanName.split('.').pop();
//     const nameWithoutExt = cleanName.replace(/\.[^/.]+$/, '');

//     return `${nameWithoutExt}_${timestamp}_${random}.${extension}`;
//   }

//   /**
//    * 📁 Déterminer le bucket selon le folder
//    */
//   private getBucketName(folder: string): string {
//     if (folder.includes('resume')) return 'resumes';
//     if (folder.includes('job-offer')) return 'job-offers';
//     if (folder.includes('career')) return 'career';
//     if (folder.includes('employee') || folder.includes('document')) return 'employee-documents';

//     return 'resumes'; // Par défaut
//   }

//   /**
//    * ✅ UPLOAD PUBLIC (CVs, images d'offres)
//    * 🎯 MÊME SIGNATURE que l'ancienne méthode Cloudinary
//    */
//   async uploadPublicFile(
//     file: Express.Multer.File,
//     folder: string = 'resumes'
//   ): Promise<string> {
//     if (!file) {
//       throw new BadRequestException('Aucun fichier fourni');
//     }

//     // Déterminer le type de fichier
//     const isImage = file.mimetype.startsWith('image/');

//     // Validation MIME types
//     const allowedMimeTypes = [
//       'image/jpeg',
//       'image/jpg',
//       'image/png',
//       'image/webp',
//       'application/pdf',
//       'application/msword',
//       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
//     ];

//     if (!allowedMimeTypes.includes(file.mimetype)) {
//       throw new BadRequestException(
//         `Type de fichier non autorisé: ${file.mimetype}. ` +
//         `Formats acceptés: JPG, PNG, WEBP, PDF, DOC, DOCX`
//       );
//     }

//     // Validation taille
//     const maxSize = isImage ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
//     if (file.size > maxSize) {
//       const maxMB = maxSize / (1024 * 1024);
//       throw new BadRequestException(
//         `Fichier trop volumineux: ${(file.size / (1024 * 1024)).toFixed(2)}MB (max ${maxMB}MB)`
//       );
//     }

//     // Générer le nom de fichier
//     const fileName = this.generateFileName(file.originalname);
//     const bucket = this.getBucketName(folder);
//     const filePath = `${folder}/${fileName}`;

//     console.log(`📤 Upload Supabase en cours...`, {
//       originalName: file.originalname,
//       fileName,
//       bucket,
//       path: filePath,
//       size: `${(file.size / 1024).toFixed(2)}KB`,
//       mimeType: file.mimetype
//     });

//     try {
//       // ✅ Upload vers Supabase Storage
//       const { data, error } = await this.supabase.storage
//         .from(bucket)
//         .upload(filePath, file.buffer, {
//           contentType: file.mimetype,
//           cacheControl: '3600',
//           upsert: false
//         });

//       if (error) {
//         console.error('❌ Erreur upload Supabase:', error);
//         throw new BadRequestException(`Erreur upload: ${error.message}`);
//       }

//       // ✅ Récupérer l'URL publique
//       const { data: { publicUrl } } = this.supabase.storage
//         .from(bucket)
//         .getPublicUrl(data.path);

//       console.log(`✅ Fichier uploadé avec succès:`, {
//         url: publicUrl,
//         path: data.path,
//         bucket
//       });

//       return publicUrl;

//     } catch (error: any) {
//       console.error('❌ Erreur lors de l\'upload:', error);
//       throw new BadRequestException(
//         error.message || 'Erreur lors de l\'upload du fichier'
//       );
//     }
//   }

//   /**
//    * 🔒 UPLOAD PRIVÉ (documents RH sensibles)
//    * 🎯 MÊME SIGNATURE que l'ancienne méthode Cloudinary
//    */
//   async uploadPrivateFile(
//     file: Express.Multer.File,
//     folder: string = 'employee-documents'
//   ): Promise<{
//     url: string;
//     publicId: string;
//   }> {
//     if (!file) {
//       throw new BadRequestException('Aucun fichier fourni');
//     }

//     const maxSize = 10 * 1024 * 1024;
//     if (file.size > maxSize) {
//       throw new BadRequestException(
//         `Fichier trop volumineux (max 10MB). Taille: ${(file.size / (1024 * 1024)).toFixed(2)}MB`
//       );
//     }

//     const allowedMimeTypes = [
//       'application/pdf',
//       'application/msword',
//       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
//       'application/vnd.ms-excel',
//       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//     ];

//     if (!allowedMimeTypes.includes(file.mimetype)) {
//       throw new BadRequestException(
//         `Type de fichier non autorisé: ${file.mimetype}`
//       );
//     }

//     const fileName = this.generateFileName(file.originalname);
//     const bucket = 'employee-documents'; // Bucket privé
//     const filePath = `${folder}/${fileName}`;

//     console.log(`🔒 Upload privé Supabase...`, {
//       originalName: file.originalname,
//       fileName,
//       bucket,
//       path: filePath
//     });

//     try {
//       // Upload vers bucket privé
//       const { data, error } = await this.supabase.storage
//         .from(bucket)
//         .upload(filePath, file.buffer, {
//           contentType: file.mimetype,
//           cacheControl: '3600',
//           upsert: false
//         });

//       if (error) {
//         console.error('❌ Erreur upload privé:', error);
//         throw new BadRequestException(`Erreur: ${error.message}`);
//       }

//       console.log('🔒 Document privé uploadé:', data.path);

//       // Pour les fichiers privés, on retourne le path comme publicId
//       // L'URL sera générée avec getSignedUrl()
//       return {
//         url: data.path, // On stocke le path, pas l'URL publique
//         publicId: data.path
//       };

//     } catch (error: any) {
//       console.error('❌ Erreur upload privé:', error);
//       throw new BadRequestException(
//         error.message || 'Erreur lors de l\'upload du fichier privé'
//       );
//     }
//   }

//   /**
//    * 🔑 GÉNÉRER URL SIGNÉE pour fichiers privés
//    * 🎯 MÊME SIGNATURE que l'ancienne méthode Cloudinary
//    */
//   async getSignedUrl(publicId: string, expiresInSeconds: number = 3600): Promise<string> {
//     try {
//       // publicId = le path du fichier dans Supabase
//       const bucket = publicId.includes('employee') ? 'employee-documents' : 'resumes';

//       // ✅ Fix TypeScript: await pour récupérer data et error
//       const { data, error } = await this.supabase.storage
//         .from(bucket)
//         .createSignedUrl(publicId, expiresInSeconds);

//       if (error) {
//         console.error('❌ Erreur génération URL signée:', error);
//         throw new BadRequestException('Erreur génération URL signée');
//       }

//       if (!data || !data.signedUrl) {
//         throw new BadRequestException('Aucune URL signée générée');
//       }

//       console.log('🔑 URL signée générée:', {
//         path: publicId,
//         expiresIn: `${expiresInSeconds / 60} minutes`
//       });

//       return data.signedUrl;

//     } catch (error: any) {
//       console.error('❌ Erreur URL signée:', error);
//       throw new BadRequestException(
//         error.message || 'Erreur lors de la génération de l\'URL signée'
//       );
//     }
//   }

//   /**
//    * 🗑️ SUPPRESSION de fichier
//    * 🎯 MÊME SIGNATURE que l'ancienne méthode Cloudinary
//    */
//   async deleteFile(
//     publicId: string,
//     resourceType: 'image' | 'raw' = 'raw'
//   ): Promise<void> {
//     try {
//       // publicId = le path complet du fichier
//       const bucket = this.extractBucketFromPath(publicId);

//       console.log(`🗑️ Suppression en cours:`, { publicId, bucket });

//       const { error } = await this.supabase.storage
//         .from(bucket)
//         .remove([publicId]);

//       if (error) {
//         console.error('❌ Erreur suppression:', error);
//         throw new BadRequestException(`Erreur suppression: ${error.message}`);
//       }

//       console.log('✅ Fichier supprimé avec succès:', publicId);

//     } catch (error: any) {
//       console.error('❌ Erreur suppression:', error);
//       throw new BadRequestException(
//         error.message || 'Erreur lors de la suppression'
//       );
//     }
//   }

//   /**
//    * 🔍 EXTRAIRE PUBLIC_ID depuis URL
//    * 🎯 MÊME SIGNATURE que l'ancienne méthode Cloudinary
//    * Adapté pour Supabase URLs
//    */
//   extractPublicId(url: string): string | null {
//     try {
//       // Format URL Supabase:
//       // https://[project].supabase.co/storage/v1/object/public/[bucket]/[path]

//       if (!url.includes('supabase')) {
//         console.warn('⚠️ URL ne semble pas être de Supabase:', url);
//         return null;
//       }

//       // Extraire le path après /public/ ou /sign/
//       const publicMatch = url.match(/\/public\/[^/]+\/(.+)$/);
//       const signMatch = url.match(/\/sign\/[^/]+\/(.+)\?/);

//       const path = publicMatch?.[1] || signMatch?.[1];

//       if (!path) {
//         console.warn('⚠️ Impossible d\'extraire le path de l\'URL:', url);
//         return null;
//       }

//       console.log('🔍 Path extrait:', { url, path });

//       return path;

//     } catch (error) {
//       console.error('❌ Erreur extraction path:', error);
//       return null;
//     }
//   }

//   /**
//    * 🔧 Helper: Extraire le bucket depuis un path
//    */
//   private extractBucketFromPath(path: string): string {
//     if (path.includes('employee') || path.includes('document')) {
//       return 'employee-documents';
//     }
//     if (path.includes('job-offer')) {
//       return 'job-offers';
//     }
//     if (path.includes('career')) {
//       return 'career';
//     }
//     return 'resumes';
//   }

//   /**
//    * ℹ️ OBTENIR INFOS sur un fichier (bonus)
//    */
//   async getFileInfo(publicId: string) {
//     try {
//       const bucket = this.extractBucketFromPath(publicId);

//       const { data, error } = await this.supabase.storage
//         .from(bucket)
//         .list(publicId.split('/')[0], {
//           search: publicId.split('/').pop()
//         });

//       if (error || !data || data.length === 0) {
//         throw new BadRequestException('Fichier introuvable');
//       }

//       const fileInfo = data[0];

//       return {
//         publicId: publicId,
//         name: fileInfo.name,
//         bucket: bucket,
//         size: fileInfo.metadata?.size || 0,
//         mimeType: fileInfo.metadata?.mimetype,
//         createdAt: fileInfo.created_at,
//         updatedAt: fileInfo.updated_at
//       };

//     } catch (error: any) {
//       console.error('❌ Erreur récupération infos fichier:', error);
//       throw new BadRequestException('Impossible de récupérer les infos du fichier');
//     }
//   }
// }
// src/cloudinary/cloudinary.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  /**
   * 🛠️ Générer un nom de fichier propre
   */
  private generateFileName(originalName: string): string {
    const cleanName = originalName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Enlever accents
      .replace(/[^a-z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');

    const timestamp = Date.now();
    const extension = cleanName.split('.').pop();
    const nameWithoutExt = cleanName.replace(/\.[^/.]+$/, '');

    return `${nameWithoutExt}_${timestamp}.${extension}`;
  }

  /**
   * ✅ UPLOAD PUBLIC (CVs, images d'offres)
   */
  async uploadPublicFile(
    file: Express.Multer.File,
    folder: string = 'resumes',
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const isImage = file.mimetype.startsWith('image/');
    const isPDF = file.mimetype === 'application/pdf';

    const allowedMimeTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Type de fichier non autorisé: ${file.mimetype}. Formats acceptés: JPG, PNG, WEBP, PDF, DOC, DOCX`,
      );
    }

    const maxSize = isImage ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      throw new BadRequestException(
        `Fichier trop volumineux: ${(file.size / (1024 * 1024)).toFixed(2)}MB (max ${maxMB}MB)`,
      );
    }

    // ✅ CLÉ: 'raw' pour PDF/documents, 'image' pour images
    const resourceType = isImage ? 'image' : 'raw';
    const cleanFileName = this.generateFileName(file.originalname);

    console.log(`📤 Upload Cloudinary en cours...`, {
      originalName: file.originalname,
      cleanName: cleanFileName,
      mimeType: file.mimetype,
      size: `${(file.size / 1024).toFixed(2)}KB`,
      resourceType,
      folder,
    });

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: resourceType, // ✅ 'raw' pour les PDFs
          type: 'upload',
          access_mode: 'public', // ✅ Téléchargeable publiquement
          public_id: cleanFileName.replace(/\.[^/.]+$/, ''),
          format: isPDF ? 'pdf' : undefined,
          ...(isImage && {
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [
              { quality: 'auto:good' },
              { fetch_format: 'auto' },
            ],
          }),
          use_filename: false,
          unique_filename: false,
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            console.error('❌ Erreur upload Cloudinary:', {
              message: error.message,
              http_code: error.http_code,
            });
            return reject(
              new BadRequestException(`Erreur upload: ${error.message}`),
            );
          }

          if (!result) {
            return reject(
              new BadRequestException('Upload échoué - aucun résultat'),
            );
          }

          console.log(`✅ Upload réussi:`, {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
          });

          resolve(result.secure_url);
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  /**
   * 🔒 UPLOAD PRIVÉ (documents RH sensibles)
   */
  async uploadPrivateFile(
    file: Express.Multer.File,
    folder: string = 'employee-documents',
  ): Promise<{ url: string; publicId: string }> {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        `Fichier trop volumineux (max 10MB). Taille: ${(file.size / (1024 * 1024)).toFixed(2)}MB`,
      );
    }

    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Type de fichier non autorisé: ${file.mimetype}`,
      );
    }

    const isPDF = file.mimetype === 'application/pdf';
    const cleanFileName = this.generateFileName(file.originalname);

    console.log(`🔒 Upload privé Cloudinary...`, {
      originalName: file.originalname,
      cleanName: cleanFileName,
      folder,
    });

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: 'raw',
          type: 'authenticated', // 🔒 Accès authentifié uniquement
          access_mode: 'authenticated',
          public_id: cleanFileName.replace(/\.[^/.]+$/, ''),
          format: isPDF ? 'pdf' : undefined,
          use_filename: false,
          unique_filename: false,
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            console.error('❌ Erreur upload privé:', error);
            return reject(new BadRequestException(`Erreur: ${error.message}`));
          }

          if (!result) {
            return reject(new BadRequestException('Upload échoué'));
          }

          console.log('🔒 Document privé uploadé:', result.public_id);

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  /**
   * 🔑 URL SIGNÉE pour fichiers privés
   */
  getSignedUrl(publicId: string, expiresInSeconds: number = 3600): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    const signedUrl = cloudinary.url(publicId, {
      type: 'authenticated',
      sign_url: true,
      secure: true,
      resource_type: 'raw',
      expires_at: expiresAt,
    });

    console.log(
      '🔑 URL signée générée (expire dans',
      expiresInSeconds / 60,
      'min)',
    );

    return signedUrl;
  }

  /**
   * 🗑️ SUPPRESSION de fichier
   */
  async deleteFile(
    publicId: string,
    resourceType: 'image' | 'raw' = 'raw',
  ): Promise<void> {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });

      if (result.result === 'ok') {
        console.log('✅ Fichier supprimé:', publicId);
      } else {
        console.warn('⚠️ Résultat suppression:', result);
      }
    } catch (error) {
      console.error('❌ Erreur suppression:', error);
      throw new BadRequestException('Erreur suppression');
    }
  }

  /**
   * 🔍 EXTRAIRE PUBLIC_ID depuis URL Cloudinary
   */
  extractPublicId(url: string): string | null {
    try {
      const uploadIndex = url.indexOf('/upload/');
      if (uploadIndex === -1) return null;

      const afterUpload = url.substring(uploadIndex + 8);
      const withoutVersion = afterUpload.replace(/^v\d+\//, '');
      const publicId = withoutVersion.replace(/\.[^/.]+$/, '');

      return publicId;
    } catch (error) {
      console.error('Erreur extraction public_id:', error);
      return null;
    }
  }
}
