// ============================================================================
// 📁 src/finance/finance.controller.ts
// Routes /finance/* — réservées à l'ADMIN (sauf l'activation : SUPER_ADMIN).
// ============================================================================

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FinanceService } from './finance.service';
import {
  ActivateFinanceDto,
  CreateFinanceCategoryDto,
  CreateFinanceTransactionDto,
  ExportFinanceTransactionsDto,
  FinanceBudgetsQueryDto,
  FinanceDashboardQueryDto,
  ListFinanceCategoriesDto,
  ListFinanceTransactionsDto,
  UpdateFinanceCategoryDto,
  UpdateFinanceSettingsDto,
  UpdateFinanceTransactionDto,
  UpsertFinanceBudgetDto,
} from './dto/finance.dto';

// Multer en mémoire — streamé directement vers Cloudinary
const receiptMulterOptions = {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB (le service limite les images à 5 MB)
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestException(
          'Format non autorisé. Acceptés : JPG, PNG, WEBP, PDF.',
        ),
        false,
      );
    }
  },
};

@Controller('finance')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // ── Statut (pour afficher ou non le menu) ───────────────────────────────────
  @Get('status')
  status(@Request() req) {
    return this.finance.getStatus(req.user.userId);
  }

  // ── Activation par le SUPER_ADMIN ───────────────────────────────────────────
  @Put('activation/:companyId')
  @Roles('SUPER_ADMIN')
  activate(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: ActivateFinanceDto,
  ) {
    return this.finance.setActivation(companyId, dto.enabled);
  }

  // ── Paramètres ──────────────────────────────────────────────────────────────
  @Get('settings')
  getSettings(@Request() req) {
    return this.finance.getSettings(req.user.userId);
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateFinanceSettingsDto, @Request() req) {
    return this.finance.updateSettings(req.user.userId, dto);
  }

  // ── Catégories ──────────────────────────────────────────────────────────────
  @Get('categories')
  listCategories(@Query() q: ListFinanceCategoriesDto, @Request() req) {
    return this.finance.listCategories(req.user.userId, q);
  }

  @Post('categories')
  createCategory(@Body() dto: CreateFinanceCategoryDto, @Request() req) {
    return this.finance.createCategory(req.user.userId, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFinanceCategoryDto,
    @Request() req,
  ) {
    return this.finance.updateCategory(req.user.userId, id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@Param('id', new ParseUUIDPipe()) id: string, @Request() req) {
    return this.finance.removeCategory(req.user.userId, id);
  }

  // ── Transactions ────────────────────────────────────────────────────────────
  @Get('transactions')
  listTransactions(@Query() q: ListFinanceTransactionsDto, @Request() req) {
    return this.finance.listTransactions(req.user.userId, q);
  }

  // ⚠️ Doit rester AVANT les routes 'transactions/:id'
  @Get('transactions/export')
  exportTransactions(@Query() q: ExportFinanceTransactionsDto, @Request() req) {
    return this.finance.exportTransactions(req.user.userId, q);
  }

  @Post('transactions')
  createTransaction(@Body() dto: CreateFinanceTransactionDto, @Request() req) {
    return this.finance.createTransaction(req.user.userId, dto);
  }

  @Patch('transactions/:id')
  updateTransaction(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFinanceTransactionDto,
    @Request() req,
  ) {
    return this.finance.updateTransaction(req.user.userId, id, dto);
  }

  @Delete('transactions/:id')
  removeTransaction(@Param('id', new ParseUUIDPipe()) id: string, @Request() req) {
    return this.finance.removeTransaction(req.user.userId, id);
  }

  // Multipart/form-data — champ "receipt"
  @Post('transactions/:id/receipt')
  @UseInterceptors(FileInterceptor('receipt', receiptMulterOptions))
  uploadReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new BadRequestException('Fichier manquant dans le champ "receipt".');
    }
    return this.finance.uploadReceipt(req.user.userId, id, file);
  }

  @Delete('transactions/:id/receipt')
  removeReceipt(@Param('id', new ParseUUIDPipe()) id: string, @Request() req) {
    return this.finance.removeReceipt(req.user.userId, id);
  }

  // ── Budgets ─────────────────────────────────────────────────────────────────
  @Get('budgets')
  getBudgets(@Query() q: FinanceBudgetsQueryDto, @Request() req) {
    return this.finance.getBudgets(req.user.userId, q);
  }

  @Put('budgets')
  upsertBudget(@Body() dto: UpsertFinanceBudgetDto, @Request() req) {
    return this.finance.upsertBudget(req.user.userId, dto);
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────
  @Get('dashboard')
  dashboard(@Query() q: FinanceDashboardQueryDto, @Request() req) {
    return this.finance.getDashboard(req.user.userId, q);
  }
}