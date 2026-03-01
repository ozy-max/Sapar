import { Injectable } from '@nestjs/common';
import { City } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class CityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<City | null> {
    return this.prisma.city.findUnique({ where: { id } });
  }

  async findByName(name: string): Promise<City | null> {
    return this.prisma.city.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  async findAll(): Promise<City[]> {
    return this.prisma.city.findMany({ orderBy: { name: 'asc' } });
  }
}
