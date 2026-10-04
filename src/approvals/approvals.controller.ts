// ============================================================================
// 📁 src/approvals/approvals.controller.ts — LOT A + LOT B (remplace celui du lot A)
//
// LOT A
//   GET    /approvals/functions/catalog
//   GET    /approvals/functions
//   PUT    /approvals/functions/users/:userId      (ADMIN uniquement)
//   GET    /approvals/me
//   POST   /approvals/me/signature
//   DELETE /approvals/me/signature
// LOT B
//   GET    /approvals/circuits
//   PUT    /approvals/circuits/:type               (ADMIN uniquement) type = loan | advance | absence
//   GET    /approvals/inbox                        avis à donner (titulaires de fonctions)
//   GET    /approvals/requests/:type/:id/state     avis + historique + décision en attente
//   GET    /approvals/requests/:type/:id/signatures  (LOT D) signatures des avis pour les documents
//   POST   /approvals/requests/:type/:id/opinions  donner / modifier son avis
//   POST   /approvals/requests/:type/:id/decision  décider (ADMIN / SUPER_ADMIN / HR_MANAGER)
//   POST   /approvals/requests/:type/:id/finalize  finaliser maintenant / confirmer
//   POST   /approvals/requests/:type/:id/cancel-pending
// ============================================================================

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  PipeTransform,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Injectable,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GetUser } from '../auth/get-user.decorator';
import { ApprovalFunctionsService } from './approval-functions.service';
import { ApprovalCircuitsService } from './core/approval-circuits.service';
import { ApprovalDecisionsService } from './approval-decisions.service';
import { ApprovalOpinionsService } from './approval-opinions.service';
import { SetUserFunctionsDto } from './dto/set-user-functions.dto';
import { SaveCircuitDto } from './dto/save-circuit.dto';
import { GiveOpinionDto } from './dto/give-opinion.dto';
import { DecisionRequestDto } from './dto/decision-request.dto';
import type { ApprovalRequestType } from './approvals.constants';
import { SIGNATURE_MAX_BYTES } from './approvals.constants';

// Multer en mémoire (même principe que le cachet entreprise) — image, 2 Mo.
const signatureMulterOptions = {
  limits: { fileSize: SIGNATURE_MAX_BYTES },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else
      cb(
        new BadRequestException('Format non autorisé. Acceptés : JPG, PNG, WEBP'),
        false,
      );
  },
};

// 'loan' | 'advance' | 'absence' | 'leave' (URL) → 'LOAN' | 'ADVANCE' | 'ABSENCE' | 'LEAVE' (interne)
@Injectable()
export class RequestTypePipe implements PipeTransform<string, ApprovalRequestType> {
  transform(value: string): ApprovalRequestType {
    const v = String(value || '').toLowerCase();
    if (v === 'loan') return 'LOAN';
    if (v === 'advance') return 'ADVANCE';
    if (v === 'absence') return 'ABSENCE';
    if (v === 'leave') return 'LEAVE';
    throw new BadRequestException('Type de demande invalide (loan | advance | absence | leave).');
  }
}

@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(
    private readonly functions: ApprovalFunctionsService,
    private readonly circuits: ApprovalCircuitsService,
    private readonly decisions: ApprovalDecisionsService,
    private readonly opinions: ApprovalOpinionsService,
  ) {}

  // ⚠️ Routes fixes d'abord ; aucune route générique ':id' à la racine.

  // ── LOT A : fonctions & signature ─────────────────────────────────────────
  @Get('functions/catalog')
  getCatalog() {
    return this.functions.getCatalog();
  }

  @Get('functions')
  listFunctions(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.functions.listCompanyFunctions(userId, companyId);
  }

  @Put('functions/users/:userId')
  setUserFunctions(
    @Param('userId', new ParseUUIDPipe()) targetUserId: string,
    @Body() dto: SetUserFunctionsDto,
    @GetUser('id') adminId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.functions.setUserFunctions(adminId, targetUserId, dto.functions, companyId);
  }

  @Get('me')
  getMe(@GetUser('id') userId: string) {
    return this.functions.getMyContext(userId);
  }

  @Post('me/signature')
  @UseInterceptors(FileInterceptor('signature', signatureMulterOptions))
  uploadSignature(
    @UploadedFile() file: Express.Multer.File,
    @GetUser('id') userId: string,
  ) {
    if (!file) {
      throw new BadRequestException('Fichier manquant dans le champ "signature".');
    }
    return this.functions.uploadMySignature(userId, file);
  }

  @Delete('me/signature')
  deleteSignature(@GetUser('id') userId: string) {
    return this.functions.deleteMySignature(userId);
  }

  // ── LOT B : circuits ──────────────────────────────────────────────────────
  @Get('circuits')
  getCircuits(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.circuits.getConfig(userId, companyId);
  }

  @Put('circuits/:type')
  saveCircuit(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Body() dto: SaveCircuitDto,
    @GetUser('id') adminId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.circuits.saveCircuit(adminId, type, dto, companyId);
  }

  // ── LOT B : avis à donner ─────────────────────────────────────────────────
  @Get('inbox')
  getInbox(
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.decisions.getInbox(userId, companyId);
  }

  // ── LOT B : par demande ───────────────────────────────────────────────────
  @Get('requests/:type/:id/state')
  getState(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.decisions.getState(userId, type, id, companyId);
  }

  // LOT D — signatures/avis pour remplir les cases des documents imprimables
  @Get('requests/:type/:id/signatures')
  getSignatures(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.decisions.getDocumentSignatures(userId, type, id, companyId);
  }

  @Post('requests/:type/:id/opinions')
  giveOpinion(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GiveOpinionDto,
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.opinions.giveOpinion(userId, type, id, dto, companyId);
  }

  @Post('requests/:type/:id/decision')
  decide(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecisionRequestDto,
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.decisions.requestDecision(userId, type, id, dto, companyId);
  }

  @Post('requests/:type/:id/finalize')
  finalize(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.decisions.finalizeNow(userId, type, id, companyId);
  }

  @Post('requests/:type/:id/cancel-pending')
  cancelPending(
    @Param('type', RequestTypePipe) type: ApprovalRequestType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @GetUser('id') userId: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.decisions.cancelPending(userId, type, id, companyId);
  }
}