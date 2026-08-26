import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createE2eApp } from './create-e2e-app';

describe('Auth, lifestyle, analysis (e2e)', () => {
  let app: INestApplication;
  const email = `e2e-${Date.now()}@shiadata.test`;
  const password = 'password-long-enough';
  let accessToken: string;

  beforeAll(async () => {
    app = await createE2eApp();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, and rotates a refresh token', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, countryCode: 'IR' })
      .expect(201);

    accessToken = registered.body.accessToken as string;
    expect(accessToken).toMatch(/^access\./);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: registered.body.refreshToken })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: registered.body.refreshToken })
      .expect(401);

    accessToken = rotated.body.accessToken as string;
  });

  it('rejects counseling without a token, then without consent', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/lifestyle/counseling')
      .send({ message: 'سلام' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/lifestyle/counseling')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'سلام، امروز خسته‌ام' })
      .expect(403);
  });

  it('after consent, serves a crisis card and a degraded non-crisis turn', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/counseling-consent')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);

    const crisis = await request(app.getHttpServer())
      .post('/api/v1/lifestyle/counseling')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'میخوام بمیرم' })
      .expect(201);

    expect(crisis.body.crisis).toBe(true);
    expect(crisis.body.reply).toMatch(/۱۲۳/);

    const turn = await request(app.getHttpServer())
      .post('/api/v1/lifestyle/counseling')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ message: 'چطور با خانواده مهربان‌تر باشم؟' })
      .expect(201);

    expect(turn.body.crisis).toBe(false);
    expect(typeof turn.body.reply).toBe('string');
    expect(turn.body.reply.length).toBeGreaterThan(5);
  });

  it('accepts an ijtihad job without leaking Python internals', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/analysis/ijtihad?wait=2s')
      .send({ text: 'عن أبي عبد الله عليه السلام قال كذا وكذا' });

    expect([200, 202]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/chroma|traceback|sk-/i);
    if (res.status === 202) {
      expect(res.headers.location).toMatch(/\/api\/v1\/analysis\/jobs\//);
    }
  });
});
