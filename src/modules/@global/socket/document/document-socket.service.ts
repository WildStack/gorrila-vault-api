import path from 'path';
import { Namespace } from 'socket.io';
import { BadRequestException, Injectable } from '@nestjs/common';

import { DocumentSocket } from './document-socket.type';
import { constants } from '../../../../common/constants';
import { FileStructurePublicShareService } from '../../../file-structure-public-share/file-structure-public-share.service';
import { CollabRedis } from '../../redis';
import { absUserContentPath } from '../../../file-structure/file-structure.helper';
import { fsCustom } from '../../../../common/helper';
import { FileStructureService } from '../../../file-structure/file-structure.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class DocumentSocketService {
  /**
   * @description This variable is only reference to actual document socket gateway server namespace
   */
  wss: Namespace;

  constructor(
    private readonly redis: RedisService,

    private readonly collabRedis: CollabRedis,
    private readonly fsService: FileStructureService,
    private readonly fsPublicShareService: FileStructurePublicShareService,
  ) {}

  async setLock(socket: DocumentSocket) {
    const lockKeyName = socket.handshake.isServant
      ? constants.redis.buildFSLockName(socket.handshake.data.filesStructureId)
      : constants.redis.buildFSLockName(socket.handshake.auth.filesStructureId);

    // expire after 2 day if something happens
    // also this will override if there is dangling key in redis
    await this.redis.set(lockKeyName, socket.id, { EX: constants.redis.twoDayInSec });
  }

  async removeLock(socket: DocumentSocket) {
    const lockKeyName = socket.handshake.isServant
      ? constants.redis.buildFSLockName(socket.handshake.data.filesStructureId)
      : constants.redis.buildFSLockName(socket.handshake.auth.filesStructureId);

    await this.redis.del(lockKeyName);
  }

  async checkSharing(socket: DocumentSocket<'user'>) {
    const { enabled } = await this.fsPublicShareService.isEnabled(
      { user: { id: socket.handshake.accessTokenPayload.userId } },
      socket.handshake.auth.filesStructureId,
    );

    if (!enabled) {
      return;
    }

    const fsPublicShare = await this.fsPublicShareService.getBy({
      fileStructureId: socket.handshake.auth.filesStructureId,
      userId: socket.handshake.accessTokenPayload.userId,
    });

    const fsCollabKeyName = constants.redis.buildFSCollabName(fsPublicShare.fileStructure.sharedUniqueHash);

    //! Exists must be before setting masterSocketId
    const exists = await this.redis.exists(fsCollabKeyName);

    if (!exists) {
      const sourceContentPath = path.join(
        absUserContentPath(socket.handshake.user.uuid),
        fsPublicShare.fileStructure.path,
      );

      const documentText = await fsCustom.readFile(sourceContentPath).catch(() => {
        throw new BadRequestException('File not found');
      });

      // create hash table
      await this.collabRedis.createFsCollabHashTable(fsCollabKeyName, {
        doc: documentText,
        masterSocketId: socket.id,
        masterUserId: socket.handshake.accessTokenPayload.userId,
        servants: [],
        updates: [],
      });
    } else {
      // update socket id
      await this.redis.hsetsingle(fsCollabKeyName, 'masterSocketId', socket.id);
    }

    // notify everyone the join
    const servants = await this.collabRedis.getServants(fsCollabKeyName);

    for (const socketId of servants) {
      this.wss.to(socketId).emit(constants.socket.events.UserJoined, { socketId: socket.id });
    }
  }

  async checkSharingForServant(socket: DocumentSocket<'servant'>) {
    // enabling logic is checked in socket middleware
    const data = socket.handshake.data;
    const fsCollabKeyName = constants.redis.buildFSCollabName(data.sharedUniqueHash);

    //! Exists must be before setting masterSocketId
    const exists = await this.redis.exists(fsCollabKeyName);

    if (!exists) {
      const { path: fsPath } = await this.fsService.getByIdSelect(
        { user: { id: data.user.id } },
        data.filesStructureId,
        { path: true },
      );

      const sourceContentPath = path.join(absUserContentPath(data.user.uuid), fsPath);

      const documentText = await fsCustom.readFile(sourceContentPath).catch(() => {
        throw new BadRequestException('File not found');
      });

      // create hash table
      await this.collabRedis.createFsCollabHashTable(fsCollabKeyName, {
        doc: documentText,
        masterSocketId: null,
        masterUserId: data.user.id,
        servants: [socket.id],
        updates: [],
      });
    } else {
      // add servant
      await this.collabRedis.addServant(fsCollabKeyName, socket.id);
    }

    // notify everyone the join
    const [servants, masterSocketId] = await Promise.all([
      this.collabRedis.getServants(fsCollabKeyName),
      this.collabRedis.getMasterSocketId(fsCollabKeyName),
    ]);

    for (const socketId of servants.concat(masterSocketId ?? '').filter(Boolean)) {
      if (socketId !== socket.id) {
        this.wss.to(socketId).emit(constants.socket.events.UserJoined, { socketId: socket.id });
      }
    }
  }

  async removeServant(fsCollabKeyName: string, socket: DocumentSocket<'servant'>, activeServants: string[]) {
    const newServants = activeServants.filter(id => id !== socket.id);
    await this.collabRedis.setServants(fsCollabKeyName, newServants);
  }

  async saveFileStructure(props: {
    fsCollabKeyName: string;
    fsId: number;
    userId: number;
    uuid: string;
  }): Promise<void> {
    const { fsId, fsCollabKeyName, userId, uuid } = props;

    const text = await this.redis.hget(fsCollabKeyName, 'doc');

    if (!text) {
      return;
    }

    await this.fsService.replaceText(fsId, { text }, { user: { id: userId, uuid } });
  }

  async getDisconnectParams(
    socket: DocumentSocket,
  ): Promise<{ activeServants: string[]; fsCollabKeyName: string; fsId: number }> {
    const fsId: number = socket.handshake.isServant
      ? socket.handshake.data.filesStructureId
      : socket.handshake.auth?.filesStructureId;

    const userId = socket.handshake.isServant
      ? socket.handshake.data.user.id
      : socket.handshake.accessTokenPayload.userId;

    // This should not happend if happens then just disconnect
    if (!fsId) {
      throw new BadRequestException('Missing filesStructureId or userId');
    }

    const fs = await this.fsService.getById({ user: { id: userId } }, fsId);
    const { fsCollabKeyName, servants } = await this.getServantsBySharedUniqueHash(fs.sharedUniqueHash);

    return {
      fsId,
      fsCollabKeyName,
      activeServants: servants,
    };
  }

  async getServantsBySharedUniqueHash(
    sharedUniqueHash: string,
  ): Promise<{ fsCollabKeyName: string; servants: string[] }> {
    const fsCollabKeyName = constants.redis.buildFSCollabName(sharedUniqueHash);
    const servants = await this.collabRedis.getServants(fsCollabKeyName);

    return {
      servants,
      fsCollabKeyName,
    };
  }
}
