import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class LoginLaunchGameDto {
  @ApiProperty({
    description: 'Security code',
    maxLength: 20,
    example: 'abcd1234',
  })
  @IsString()
  @IsNotEmpty()
  cert: string;

  @ApiProperty({
    description: 'Agent ID',
    maxLength: 50,
    example: 'agent001',
  })
  @IsString()
  @IsNotEmpty()
  agentId: string;

  @ApiProperty({
    description: 'User ID',
    maxLength: 50,
    example: 'player123',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'Is Mobile Login',
    example: false,
  })
  @IsOptional()
  isMobileLogin?: boolean;

  @ApiProperty({
    description: 'External URL',
    maxLength: 200,
    example: 'https://www.google.com.tw',
  })
  @IsOptional()
  @IsString()
  externalURL?: string;

  @ApiProperty({
    description: 'Platform',
    maxLength: 50,
    example: 'SPADE',
  })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiProperty({
    description: 'Game Type',
    maxLength: 50,
    example: 'LIVE',
  })
  @IsString()
  @IsNotEmpty()
  gameType: string;

  @ApiProperty({
    description: 'Game Code',
    maxLength: 50,
    example: 'MX-LIVE-002',
  })
  @IsString()
  @IsNotEmpty()
  gameCode: string;

  @ApiProperty({
    description: 'Hall',
    maxLength: 50,
    example: 'SPD',
  })
  @IsOptional()
  @IsString()
  hall?: string;

  @ApiProperty({
    description: 'Language',
    maxLength: 10,
    example: 'en',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({
    description: 'Bet Limit',
    example: '{"SPADE":{"LIVE":{"limitId":[280301,280303,280307]}}}',
  })
  @IsOptional()
  @IsString()
  betLimit?: string;

  @ApiProperty({
    description: 'Auto Bet Mode',
    maxLength: 10,
    example: '1',
  })
  @IsOptional()
  @IsString()
  autoBetMode?: string;

  @ApiProperty({
    description: 'Is Launch Game Table',
    example: true,
  })
  @IsOptional()
  isLaunchGameTable?: boolean;

  @ApiProperty({
    description: 'Game Table ID',
    maxLength: 50,
    example: '1',
  })
  @IsOptional()
  @IsString()
  gameTableId?: string;

  @ApiProperty({
    description: 'Is Enable Jackpot',
    example: false,
  })
  @IsOptional()
  isEnableJackpot?: boolean;

  @ApiProperty({
    description: 'Landing Sport ID',
    maxLength: 50,
    example: '3',
  })
  @IsOptional()
  @IsString()
  landingSportId?: string;
}
