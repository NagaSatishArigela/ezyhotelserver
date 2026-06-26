import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PublicPropertiesService,
  PublicPropertyDetail,
  PublicPropertyListResult,
} from './public-properties.service';
import { ListPublicPropertiesQueryDto } from './dto/list-public-properties-query.dto';

/** Guest-facing, unauthenticated property discovery (M3.5). */
@ApiTags('Properties / Public')
@Controller('properties/public')
export class PublicPropertiesController {
  constructor(private readonly publicProperties: PublicPropertiesService) {}

  @ApiOperation({ summary: 'List approved, active properties' })
  @Get()
  list(@Query() query: ListPublicPropertiesQueryDto): Promise<PublicPropertyListResult> {
    return this.publicProperties.list(query);
  }

  @ApiOperation({ summary: 'Get an approved property with room types and photos' })
  @Get(':propertyId')
  getById(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
  ): Promise<PublicPropertyDetail> {
    return this.publicProperties.getById(propertyId);
  }
}
