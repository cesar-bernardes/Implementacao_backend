import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { DemoAdminGuard } from '../organizations/demo-admin.guard';
import { ProductsService } from './products.service';

class ProductDefinitionDto {
  @IsArray() phases!: Array<Record<string, unknown>>;
}

class CreateProductDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() @MinLength(2) templateName?: string;
  @IsOptional() @IsString() @MinLength(2) initialPhaseName?: string;
}

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
@UseGuards(DemoAdminGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('configuration')
  configuration() { return this.products.configuration(); }

  @Post()
  create(@Body() body: CreateProductDto) { return this.products.create(body); }

  @Patch('template-versions/:versionId/configuration')
  update(@Param('versionId') versionId: string, @Body() body: ProductDefinitionDto) {
    return this.products.updateConfiguration(versionId, body as never);
  }
}
