// src/affiliate/dto/affiliate-login.dto.ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class AffiliateLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
