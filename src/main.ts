import path from 'path';
import figlet from 'figlet';
import nunjucks from 'nunjucks';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { performance } from 'node:perf_hooks';
import { NestApplication, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { Logger } from '@nestjs/common';
import { AppModule } from './modules/app.module';
import { EnvService } from './modules/@global/env/env.service';
import { ENV_SERVICE_TOKEN } from './modules/@global/env/env.constants';
import { cyanLog } from './common/helper';
import { setupNunjucksFilters } from './common/nunjucks';
import { absPublicPath } from './modules/file-structure/file-structure.helper';

// Cool libraries for future
// https://nosir.github.io/cleave.js/
// https://sarcadass.github.io/granim.js/examples.html

// process.on('uncaughtException', err => {
//   console.log(err);
//   throw new InternalServerErrorException('Something went wrong');
// });

//@ts-expect-error
BigInt.prototype.toJSON = function () {
  return this.toString();
};

NestFactory.create<NestExpressApplication>(AppModule).then(async app => {
  const logger = new Logger(NestApplication.name);

  const startingTime = performance.now();
  const assetsPath = path.join(__dirname, './assets');
  const envService = app.get<string, EnvService>(ENV_SERVICE_TOKEN);

  const nunjuckMainRenderer = nunjucks.configure(assetsPath, {
    express: app,
    autoescape: true,
    watch: true,
    throwOnUndefined: false,
    trimBlocks: false,
    lstripBlocks: false,
  });

  setupNunjucksFilters(nunjuckMainRenderer);

  app.enableCors({
    credentials: true,
    exposedHeaders: ['Content-Title'],
    //! asd
    origin: [envService.get('FRONTEND_URL')],
    // origin: [envService.get('FRONTEND_URL'), 'http://localhost:3000'],
  });

  app.enableShutdownHooks();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser(envService.get('COOKIE_SECRET')));
  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },
    }),
  );
  app.use(compression());
  app.setViewEngine('njk');
  app.setBaseViewsDir(assetsPath);
  app.use('/public', express.static(absPublicPath()));

  await app.listen(envService.get('PORT'));

  // measure startup time
  const totalTimeInMs = (performance.now() - startingTime).toFixed(3) + ' ms';
  logger.log(`Nest application initialized in ${totalTimeInMs}`);

  // log misc stuff
  cyanLog(
    figlet.textSync(`Running api : ${envService.get('PORT')}`, {
      font: 'Rectangles',
      width: 80,
      whitespaceBreak: true,
    }),
  );
});
