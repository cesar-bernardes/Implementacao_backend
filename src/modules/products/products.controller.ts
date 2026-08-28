import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { DemoAdminGuard } from '../organizations/demo-admin.guard';
import { ProductsService } from './products.service';

class ProductDefinitionDto {
  @IsArray() phases!: Array<Record<string, unknown>>;
}

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
@UseGuards(DemoAdminGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('configuration')
  configuration() { return this.products.configuration(); }

  @Patch('template-versions/:versionId/configuration')
  update(@Param('versionId') versionId: string, @Body() body: ProductDefinitionDto) {
    return this.products.updateConfiguration(versionId, body as never);
  }
}
