import { Injectable } from '@nestjs/common';
import { FsCollabRedisBody, HSETObject } from '../../../model/types';
import { RedisService } from './redis.service';

@Injectable()
export class CollabRedis {
  constructor(private readonly redis: RedisService) {}

  async getMasterSocketId(key: string): Promise<string | null> {
    const masterSocketId = await this.redis.hget(key, 'masterSocketId');

    return masterSocketId === JSON.stringify(null) ? null : masterSocketId;
  }

  async addServant(key: string, id: string): Promise<void> {
    const servants = await this.getServants(key);

    if (servants.includes(id)) {
      return;
    }

    await this.redis.hsetsingle(key, 'servants', JSON.stringify([...servants, id]));
  }

  async getServants(key: string): Promise<string[]> {
    const servants = await this.redis.hget(key, 'servants');

    if (!servants) {
      return [];
    }

    try {
      return JSON.parse(servants) as string[];
    } catch (error) {
      return [];
    }
  }

  async setServants(key: string, newServants: string[]) {
    return this.redis.hsetsingle(key, 'servants', JSON.stringify(newServants));
  }

  async removeMasterSocketId(fsCollabKeyName: string) {
    await this.redis.hsetsingle(fsCollabKeyName, 'masterSocketId', JSON.stringify(null));
  }

  async createFsCollabHashTable(
    key: string,
    params: {
      doc: string;
      masterUserId: number;
      servants: string[];
      updates: string[];
      masterSocketId: string | null;
    },
  ): Promise<void> {
    const { doc, masterUserId, servants, updates, masterSocketId } = params;

    const object: FsCollabRedisBody = {
      doc,
      masterSocketId: masterSocketId === null ? JSON.stringify(null) : masterSocketId,
      masterUserId,
      servants: JSON.stringify(servants),
      updates: JSON.stringify(updates),
    };

    // create hash table
    await this.redis.hsetobject(key, object as HSETObject);
  }
}
