import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GetUser } from '../../auth/get-user.decorator';
import { PortfolioCompaniesService } from './portfolio-companies.service';
import { CreateCompanyDto } from '../../companies/dto/create-company.dto';

// 🆕 POST /portfolio/companies — créer une nouvelle entreprise depuis le
// portefeuille. La liste (GET) reste sur /auth/my-companies, déjà en place.
@Controller('portfolio/companies')
@UseGuards(AuthGuard('jwt'))
export class PortfolioCompaniesController {
  constructor(private readonly service: PortfolioCompaniesService) {}

  @Post()
  create(@GetUser('id') userId: string, @Body() dto: CreateCompanyDto) {
    return this.service.create(userId, dto);
  }
}