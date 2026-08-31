// src/affiliate/dto/update-commission-rate.dto.ts
import { IsNumber, Min, Max } from 'class-validator';

export class UpdateCommissionRateDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionRate: number;
}
