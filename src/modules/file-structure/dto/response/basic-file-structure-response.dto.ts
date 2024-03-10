import { FileMimeType } from '@prisma/client';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class BasicFileStructureResponseDto {
  @Expose()
  id: number;

  @Expose()
  path: string;

  @Expose()
  title: string;

  @Expose()
  depth: number;

  @Expose()
  color: string | null;

  @Expose()
  sizeInBytes: number | null;

  @Expose()
  fileExstensionRaw: string | null;

  @Expose()
  mimeTypeRaw: string | null;

  @Expose()
  mimeType: FileMimeType | null;

  @Expose()
  lastModifiedAt: Date | null;

  @Expose()
  isEditable: boolean | null;

  @Expose()
  isFile: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  rootParentId: number | null;

  @Expose()
  parentId: number | null;
}